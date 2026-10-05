import type { Express, Request } from "express";
import {
  presidentExecutionHandbackSchema,
  presidentIndependentReviewSchema,
} from "../../shared/presidentOperatingSystem";
import { authorizePresidentCallback } from "./agentRuntime";
import { getPresidentRuntime, presidentRuntimeConfig } from "./runtime";
import { registerPresidentCycleHttpRoutes } from "./cycle/httpRuntime";

function authorization(req: Request): string | undefined {
  const value = req.headers.authorization;
  return Array.isArray(value) ? value[0] : value;
}

export function registerPresidentAgentRoutes(
  app: Express,
  dependencies = {
    config: presidentRuntimeConfig,
    runtime: getPresidentRuntime,
  }
): void {
  app.post("/api/president/agent/execution", async (req, res) => {
    const parsed = presidentExecutionHandbackSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "Invalid President execution handback" });
    let config: ReturnType<typeof presidentRuntimeConfig>;
    try {
      config = dependencies.config();
    } catch {
      return res
        .status(503)
        .json({ error: "President callback configuration unavailable" });
    }
    if (
      !authorizePresidentCallback(
        parsed.data.executorId,
        authorization(req),
        config.callbackTokens
      )
    )
      return res
        .status(401)
        .json({ error: "Unauthorized President executor callback" });
    try {
      const result = await dependencies
        .runtime()
        .coordinator.receiveExecution(parsed.data);
      return res.status(200).json({ ok: true, reused: result.reused });
    } catch (error) {
      console.error("[President] execution callback failed", error);
      return res
        .status(409)
        .json({ error: "President execution callback rejected" });
    }
  });

  app.post("/api/president/agent/review", async (req, res) => {
    const parsed = presidentIndependentReviewSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "Invalid President independent review" });
    let config: ReturnType<typeof presidentRuntimeConfig>;
    try {
      config = dependencies.config();
    } catch {
      return res
        .status(503)
        .json({ error: "President callback configuration unavailable" });
    }
    if (
      !authorizePresidentCallback(
        parsed.data.reviewerId,
        authorization(req),
        config.callbackTokens
      )
    )
      return res
        .status(401)
        .json({ error: "Unauthorized President reviewer callback" });
    try {
      const result = await dependencies
        .runtime()
        .coordinator.receiveReview(parsed.data);
      return res.status(200).json({ ok: true, reused: result.reused });
    } catch (error) {
      console.error("[President] review callback failed", error);
      return res
        .status(409)
        .json({ error: "President review callback rejected" });
    }
  });

  // Autonomous improvement-cycle surface. This does not depend on the legacy
  // external-agent transport being configured; it has its own readiness gate.
  registerPresidentCycleHttpRoutes(app);
}
