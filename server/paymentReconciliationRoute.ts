import type express from "express";
import { sdk } from "./_core/sdk";
import { isValidAgentSharedSecret } from "./agents/s2sEndpoint";
import { getPaymentReconciliationDashboard } from "./paymentReconciliation";

async function assertAdminOrAgent(req: express.Request) {
  if (isValidAgentSharedSecret(req.headers["x-agent-shared-secret"])) return;

  let user = null;
  try {
    user = await sdk.authenticateRequest(req);
  } catch {
    user = null;
  }
  if (!user || user.role !== "admin") {
    const err = new Error("Unauthorized");
    (err as any).statusCode = 401;
    throw err;
  }
}

export function registerPaymentReconciliationRoutes(app: express.Express) {
  app.get("/api/admin/payment-reconciliation", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const result = await getPaymentReconciliationDashboard({
        startDate: typeof req.query.startDate === "string" ? req.query.startDate : undefined,
        endDate: typeof req.query.endDate === "string" ? req.query.endDate : undefined,
        processor: req.query.processor === "clearent" || req.query.processor === "stripe" || req.query.processor === "all" ? req.query.processor : "all",
        businessUnit:
          req.query.businessUnit === "laundry_butler" || req.query.businessUnit === "laundry_farm" || req.query.businessUnit === "all"
            ? req.query.businessUnit
            : "all",
        status:
          req.query.status === "matched" ||
          req.query.status === "unmatched" ||
          req.query.status === "possible_duplicate" ||
          req.query.status === "needs_review" ||
          req.query.status === "ignored" ||
          req.query.status === "all"
            ? req.query.status
            : "all",
      });
      return res.status(200).json(result);
    } catch (error) {
      const statusCode = (error as any)?.statusCode === 401 ? 401 : 500;
      return res.status(statusCode).json({
        error: error instanceof Error ? error.message : String(error),
        code: statusCode === 401 ? "PAYMENT_RECONCILIATION_UNAUTHORIZED" : "PAYMENT_RECONCILIATION_FAILED",
      });
    }
  });
}
