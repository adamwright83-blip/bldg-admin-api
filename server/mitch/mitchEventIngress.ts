import { createHmac, timingSafeEqual } from "node:crypto";
import express from "express";
import { z } from "zod";
import { parseMitchComment } from "../../shared/mitchEvents";
import type { MitchEventService } from "./mitchEventService";

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
  }),
});
export function createMitchEventIngress(config: {
  webhookSecret: string;
  callbackToken: string;
  repoFullName: string;
  issueNumber: number;
  /** Exact GitHub login -> permitted internal actor IDs. Never infer authority from comment prose. */
  actors: Record<string, string[]>;
  events: MitchEventService;
}) {
  if (
    !config.webhookSecret ||
    !config.callbackToken ||
    !Object.keys(config.actors).length
  )
    throw new Error(
      "Mitch event ingress requires secrets and an explicit actor allowlist"
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
      const payload = payloadSchema.parse(
        JSON.parse(req.body.toString("utf8"))
      );
      if (
        payload.repository.full_name !== config.repoFullName ||
        payload.issue.number !== config.issueNumber ||
        payload.issue.pull_request
      )
        throw new Error("Unrelated issue comment");
      const event = parseMitchComment(payload.comment.body);
      if (!config.actors[payload.comment.user.login]?.includes(event.actorId)) {
        res
          .status(403)
          .json({ error: "Comment author cannot use this actor identity" });
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
    const actual = Buffer.from(req.get("authorization") ?? "");
    const expected = Buffer.from("Bearer " + config.callbackToken);
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      res.status(401).end();
      return;
    }
    try {
      if (!Buffer.isBuffer(req.body)) throw new Error("Expected JSON body");
      const event = JSON.parse(req.body.toString("utf8"));
      // Internal executor credential cannot impersonate the human decision pathway.
      if (event.type === "human_decision") {
        res
          .status(403)
          .json({
            error: "Human decisions require the authorized GitHub author",
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
