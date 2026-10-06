import type { Express, Request, Response } from "express";
import {
  claimExternalExecution,
  claimExternalReview,
  reportExternalExecution,
  reportExternalReview,
  type ExternalExecutionResult,
} from "./externalTransport";
import {
  requirePresidentGithubOidc,
  requirePresidentGithubOidcApiKey,
} from "./githubOidc";
import { getPresidentCycleStore } from "../cycle/runtime";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function oidc(
  req: Request,
  res: Response
): Promise<boolean> {
  try {
    await requirePresidentGithubOidc(req);
    return true;
  } catch (error) {
    res.status(401).json({ error: errorMessage(error) });
    return false;
  }
}

export function registerPresidentGithubAgentRoutes(app: Express) {
  app.post(
    "/api/president/autonomous/agent/claim-execution",
    async (req, res) => {
      if (!(await oidc(req, res))) return;
      try {
        const claim = await claimExternalExecution(
          getPresidentCycleStore(),
          "president-github-actions-executor"
        );
        if (!claim) return res.status(204).end();
        return res.json(claim);
      } catch (error) {
        console.error("[PresidentExternal] claim execution failed", error);
        return res.status(409).json({ error: errorMessage(error) });
      }
    }
  );

  app.post(
    "/api/president/autonomous/agent/report-execution",
    async (req, res) => {
      if (!(await oidc(req, res))) return;
      try {
        const { cycleId, missionId, leaseToken, result } = req.body ?? {};
        if (
          typeof cycleId !== "string" ||
          typeof missionId !== "string" ||
          typeof leaseToken !== "string" ||
          !result ||
          typeof result !== "object"
        )
          return res.status(400).json({ error: "Invalid execution report" });
        if (
          result.ok === true &&
          result.route === "RESEARCH" &&
          typeof result.artifactText === "string" &&
          result.artifactText.length > 120_000
        )
          return res.status(413).json({ error: "Research artifact too large" });
        await reportExternalExecution(getPresidentCycleStore(), {
          cycleId,
          missionId,
          leaseToken,
          result: result as ExternalExecutionResult,
        });
        return res.json({ ok: true });
      } catch (error) {
        console.error("[PresidentExternal] execution report rejected", error);
        return res.status(409).json({ error: errorMessage(error) });
      }
    }
  );

  app.post(
    "/api/president/autonomous/agent/claim-review",
    async (req, res) => {
      if (!(await oidc(req, res))) return;
      try {
        const claim = await claimExternalReview(
          getPresidentCycleStore(),
          "president-github-actions-reviewer"
        );
        if (!claim) return res.status(204).end();
        return res.json(claim);
      } catch (error) {
        console.error("[PresidentExternal] claim review failed", error);
        return res.status(409).json({ error: errorMessage(error) });
      }
    }
  );

  app.post(
    "/api/president/autonomous/agent/report-review",
    async (req, res) => {
      if (!(await oidc(req, res))) return;
      try {
        const {
          cycleId,
          missionId,
          leaseToken,
          verdict,
          reasons,
          checks,
        } = req.body ?? {};
        if (
          typeof cycleId !== "string" ||
          typeof missionId !== "string" ||
          typeof leaseToken !== "string" ||
          !["PASS", "FAIL", "BLOCKED"].includes(verdict) ||
          !Array.isArray(reasons) ||
          !Array.isArray(checks)
        )
          return res.status(400).json({ error: "Invalid review report" });
        await reportExternalReview(getPresidentCycleStore(), {
          cycleId,
          missionId,
          leaseToken,
          verdict,
          reasons: reasons.map(String).slice(0, 20),
          checks: checks.slice(0, 30).map((x: any) => ({
            command: String(x.command ?? ""),
            exitCode: Number(x.exitCode ?? -1),
            ok: x.ok === true,
          })),
        });
        return res.json({ ok: true });
      } catch (error) {
        console.error("[PresidentExternal] review report rejected", error);
        return res.status(409).json({ error: errorMessage(error) });
      }
    }
  );

  // Claude Code gateway. GitHub Actions OIDC is the only accepted credential;
  // the real Anthropic key remains server-side and is never returned to CI.
  const proxy = async (req: Request, res: Response) => {
    try {
      try {
        await requirePresidentGithubOidcApiKey(req);
      } catch {
        await requirePresidentGithubOidc(req);
      }
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
      if (!apiKey)
        return res.status(503).json({ error: "Anthropic provider unavailable" });

      const body = { ...(req.body ?? {}) } as Record<string, unknown>;
      const model = typeof body.model === "string" ? body.model : "";
      if (!/^claude-/i.test(model))
        return res.status(400).json({ error: "Claude model required" });
      if (
        typeof body.max_tokens === "number" &&
        (body.max_tokens < 1 || body.max_tokens > 20_000)
      )
        return res.status(400).json({ error: "max_tokens outside President limit" });

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
      const bytes = Buffer.from(await upstream.arrayBuffer());
      return res.send(bytes);
    } catch (error) {
      console.error("[PresidentExternal] model proxy failed", error);
      return res.status(502).json({ error: "President model gateway failed" });
    }
  };

  app.post("/api/president/autonomous/model/v1/messages", proxy);
  app.post("/api/president/autonomous/model/v1/messages/count_tokens", proxy);
}
