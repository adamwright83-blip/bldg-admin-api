/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import express from "express";
import { processLegacyDayforgeBillingWebhook } from "./saasBilling";

export function registerLegacyDayforgeBillingWebhookRoute(app: express.Express) {
  app.post(
    "/api/dayforge/billing/stripe-webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req, res) => {
      try {
        const result = await processLegacyDayforgeBillingWebhook({
          rawBody: req.body,
          signature: req.headers["stripe-signature"],
        });
        const statusCode =
          result.status === "failed" && result.reason === "invalid_signature"
            ? 400
            : result.status === "failed"
              ? 500
              : 200;
        return res.status(statusCode).json(result);
      } catch (error) {
        console.error("[DayForge Billing] Webhook intake failed", error);
        return res.status(500).json({
          status: "failed",
          reason: "webhook_intake_failed",
        });
      }
    }
  );
}
