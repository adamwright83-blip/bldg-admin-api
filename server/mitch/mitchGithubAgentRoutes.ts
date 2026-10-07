import type { Express, Request, Response } from "express";
import { mitchEventSchema } from "../../shared/mitchEvents";
import type { MitchEventService } from "./mitchEventService";
import {
  requireMitchGithubOidc,
  requireMitchGithubOidcApiKey,
  type MitchGithubIdentity,
} from "./mitchGithubOidc";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rawJson(req: Request): Record<string, unknown> {
  if (!Buffer.isBuffer(req.body))
    throw new Error("Expected raw JSON request body");
  const value = JSON.parse(req.body.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected JSON object");
  return value as Record<string, unknown>;
}

function reviewerRequestsWriteTools(body: Record<string, unknown>): boolean {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return tools.some(tool => {
    if (!tool || typeof tool !== "object") return false;
    const name = String((tool as Record<string, unknown>).name ?? "");
    return /(^|[^a-z])(edit|write|bash|notebookedit)([^a-z]|$)/i.test(name);
  });
}

async function identityForModel(req: Request): Promise<MitchGithubIdentity> {
  try {
    return await requireMitchGithubOidcApiKey(req);
  } catch {
    return requireMitchGithubOidc(req);
  }
}

export function registerMitchGithubAgentRoutes(
  app: Express,
  deps: { events: MitchEventService }
): void {
  app.post("/api/mitch/autonomous/event", async (req, res) => {
    try {
      const identity = await requireMitchGithubOidc(req);
      const event = mitchEventSchema.parse(rawJson(req));
      if (event.actorId !== identity.actorId)
        return res.status(403).json({
          error: "GitHub workflow cannot claim another Mitch actor identity",
        });
      if (
        identity.role === "executor" &&
        !["implementation_handback", "agent_failed"].includes(event.type)
      )
        return res.status(403).json({
          error: "Mitch executor workflow may submit only executor events",
        });
      if (
        identity.role === "reviewer" &&
        !["design_review_handback", "qa_handback"].includes(event.type)
      )
        return res.status(403).json({
          error: "Mitch reviewer workflow may submit only review events",
        });
      const result = await deps.events.receive(event);
      return res.status(202).json(result);
    } catch (error) {
      return res.status(422).json({ error: errorMessage(error) });
    }
  });

  const proxy = async (req: Request, res: Response) => {
    try {
      const identity = await identityForModel(req);
      const body = rawJson(req);
      const model = typeof body.model === "string" ? body.model : "";
      if (!/^claude-/i.test(model))
        return res.status(400).json({ error: "Claude model required" });
      if (
        typeof body.max_tokens === "number" &&
        (body.max_tokens < 1 || body.max_tokens > 20_000)
      )
        return res.status(400).json({ error: "max_tokens outside Mitch limit" });
      if (identity.role === "reviewer" && reviewerRequestsWriteTools(body))
        return res.status(403).json({
          error: "Independent Mitch reviewer may not request write or shell tools",
        });

      const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
      if (!apiKey)
        return res.status(503).json({ error: "Anthropic provider unavailable" });

      const suffix = req.path.endsWith("/count_tokens")
        ? "/v1/messages/count_tokens"
        : "/v1/messages";
      const upstream = await fetch("https://api.anthropic.com" + suffix, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version":
            (Array.isArray(req.headers["anthropic-version"])
              ? req.headers["anthropic-version"][0]
              : req.headers["anthropic-version"]) || "2023-06-01",
          ...(req.headers["anthropic-beta"]
            ? {
                "anthropic-beta": Array.isArray(req.headers["anthropic-beta"])
                  ? req.headers["anthropic-beta"].join(",")
                  : req.headers["anthropic-beta"],
              }
            : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20 * 60_000),
      });
      res.status(upstream.status);
      const contentType = upstream.headers.get("content-type");
      if (contentType) res.setHeader("content-type", contentType);
      res.setHeader("cache-control", "no-store");
      return res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      console.error("[MitchGithubAgent] model proxy failed", error);
      return res.status(502).json({ error: "Mitch model gateway failed" });
    }
  };

  app.post("/api/mitch/autonomous/model/v1/messages", proxy);
  app.post("/api/mitch/autonomous/model/v1/messages/count_tokens", proxy);
}
