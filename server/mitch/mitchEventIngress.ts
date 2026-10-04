import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";
import { z } from "zod";
import { mitchEventSchema, parseMitchComment } from "../../shared/mitchEvents";
import { secureTokenEqual } from "./mitchAgentWake";
import type { MitchEventService } from "./mitchEventService";

export type MitchGithubActorRule = {
  login: string;
  actorIds: string[];
  /** App-bound comments must match the actual GitHub App, not merely the visible login. */
  appSlug?: string | null;
  appId?: number | null;
};

export function isGithubActorAuthorized(
  rules: readonly MitchGithubActorRule[],
  input: {
    login: string;
    app?: { id?: number | null; slug?: string | null } | null;
    actorId: string;
  }
): boolean {
  return rules.some(rule => {
    if (rule.login !== input.login || !rule.actorIds.includes(input.actorId)) return false;
    const appBound = rule.appSlug != null || rule.appId != null;
    if (!appBound) return !input.app;
    if (!input.app) return false;
    if (rule.appSlug != null && input.app.slug !== rule.appSlug) return false;
    if (rule.appId != null && input.app.id !== rule.appId) return false;
    return true;
  });
}

export function validGithubSignature(
  raw: Buffer,
  signature: string | undefined,
  secret: string
): boolean {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature))
    return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

const payloadSchema = z.object({
  action: z.literal("created"),
  repository: z.object({ full_name: z.string() }),
  issue: z.object({
    number: z.number().int().positive(),
    pull_request: z.unknown().optional(),
  }),
  comment: z.object({
    id: z.number().int().positive(),
    body: z.string(),
    user: z.object({ login: z.string() }),
    performed_via_github_app: z
      .object({
        id: z.number().int().positive().optional().nullable(),
        slug: z.string().optional().nullable(),
      })
      .optional()
      .nullable(),
  }),
});

function validateCallbackTokens(tokens: Record<string, string>) {
  const entries = Object.entries(tokens);
  if (!entries.length) throw new Error("Mitch callback actor tokens are required");
  const seen = new Set<string>();
  for (const [actorId, token] of entries) {
    if (!actorId.trim() || !token.trim())
      throw new Error("Each Mitch callback actor token requires actorId and token");
    if (seen.has(token))
      throw new Error("Mitch callback tokens must be unique per actor");
    seen.add(token);
  }
}

export function createMitchEventIngress(config: {
  webhookSecret: string;
  repoFullName: string;
  issueNumber: number;
  githubActorRules: MitchGithubActorRule[];
  /** Actor-scoped credentials: a token can submit only the actor ID it is assigned to. */
  callbackActorTokens: Record<string, string>;
  events: MitchEventService;
}) {
  validateCallbackTokens(config.callbackActorTokens);
  if (!config.webhookSecret || !config.githubActorRules.length)
    throw new Error(
      "Mitch event ingress requires a webhook secret and explicit GitHub integration rules"
    );

  const app = express();
  app.use(express.raw({ type: "application/json", limit: "256kb" }));

  app.post("/webhooks/github", async (req, res) => {
    if (
      !Buffer.isBuffer(req.body) ||
      !validGithubSignature(
        req.body,
        req.get("x-hub-signature-256"),
        config.webhookSecret
      )
    ) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
    if (
      req.get("x-github-event") !== "issue_comment" ||
      !req.get("x-github-delivery")
    ) {
      res.status(400).json({ error: "Expected issue_comment delivery" });
      return;
    }

    try {
      const payload = payloadSchema.parse(JSON.parse(req.body.toString("utf8")));
      if (
        payload.repository.full_name !== config.repoFullName ||
        payload.issue.number !== config.issueNumber ||
        payload.issue.pull_request
      )
        throw new Error("Unrelated issue comment");

      const event = parseMitchComment(payload.comment.body);
      if (
        !isGithubActorAuthorized(config.githubActorRules, {
          login: payload.comment.user.login,
          app: payload.comment.performed_via_github_app ?? null,
          actorId: event.actorId,
        })
      ) {
        res.status(403).json({
          error: "GitHub author/integration cannot use this actor identity",
        });
        return;
      }

      const result = await config.events.receive(
        event,
        req.get("x-github-delivery")
      );
      res.status(202).json(result);
    } catch (error) {
      res.status(422).json({ error: String(error) });
    }
  });

  app.post("/callbacks/mitch", async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body)) throw new Error("Expected JSON body");
      const event = mitchEventSchema.parse(JSON.parse(req.body.toString("utf8")));

      if (event.type === "human_decision") {
        res.status(403).json({
          error: "Human decisions require the authorized GitHub human identity",
        });
        return;
      }

      const expectedToken = config.callbackActorTokens[event.actorId];
      const auth = req.get("authorization") ?? "";
      if (
        !expectedToken ||
        !secureTokenEqual(auth, "Bearer " + expectedToken)
      ) {
        res.status(403).json({
          error: "Callback credential cannot use this actor identity",
        });
        return;
      }

      res.status(202).json(await config.events.receive(event));
    } catch (error) {
      res.status(422).json({ error: String(error) });
    }
  });

  return app;
}
