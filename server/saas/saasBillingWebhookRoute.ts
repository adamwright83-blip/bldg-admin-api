import express from "express";
import { processDayforgeBillingWebhook } from "./saasBilling";

export function registerDayforgeBillingWebhookRoute(app: express.Express) {
  app.post(
    "/api/dayforge/billing/stripe-webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    async (req, res) => {
      try {
        const result = await processDayforgeBillingWebhook({
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
