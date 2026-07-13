import { timingSafeEqual } from "node:crypto";
import type express from "express";
import { z } from "zod";
import {
  MAX_DAYFORGE_RETENTION_BATCH,
  runDayforgeRetentionWithDatabase,
} from "./retentionService";

function header(req: express.Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
function matches(candidate: string | undefined, expected: string | undefined) {
  if (!candidate || !expected) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function authorizeRetentionRequest(
  headers: express.Request["headers"],
  expected = process.env.DAYFORGE_RETENTION_SECRET
): "authorized" | "not_configured" | "forbidden" {
  if (!expected) return "not_configured";
  const bearerRaw = Array.isArray(headers.authorization)
    ? headers.authorization[0]
    : headers.authorization;
  const bearer = bearerRaw?.startsWith("Bearer ")
    ? bearerRaw.slice("Bearer ".length)
    : undefined;
  const directRaw = headers["x-dayforge-retention-secret"];
  const direct = Array.isArray(directRaw) ? directRaw[0] : directRaw;
  return matches(bearer, expected) || matches(direct, expected)
    ? "authorized"
    : "forbidden";
}

const requestSchema = z
  .object({
    dryRun: z.boolean().optional().default(false),
    batchLimit: z
      .number()
      .int()
      .min(1)
      .max(MAX_DAYFORGE_RETENTION_BATCH)
      .optional(),
  })
  .strict();

export function registerDayforgeRetentionRoute(app: express.Express) {
  app.post("/api/internal/dayforge/retention/run", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const authorization = authorizeRetentionRequest(req.headers);
    if (authorization === "not_configured") {
      return res.status(503).json({ error: "DayForge retention is not configured" });
    }
    if (authorization === "forbidden") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const parsed = requestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid retention request" });
    }
    try {
      const result = await runDayforgeRetentionWithDatabase(parsed.data);
      return res.status(200).json(result);
    } catch (error) {
      console.error("[DayForgeRetention] cleanup failed", error);
      return res.status(503).json({ error: "DayForge retention is unavailable" });
    }
  });
}
