import express from "express";
import { createProcurementPool } from "./migrations";
import { processAgentMailVendorReplyWebhook } from "./agentMailVendorReplyWebhook";
import { VendorContactAttemptStore } from "./vendorContactAttemptStore";

type StoreDeps = { store?: VendorContactAttemptStore };

let lazyStore: VendorContactAttemptStore | null = null;
function resolveStore(deps: StoreDeps): VendorContactAttemptStore {
  if (deps.store) return deps.store;
  if (!lazyStore) {
    lazyStore = new VendorContactAttemptStore(createProcurementPool());
  }
  return lazyStore;
}

function statusCodeFor(status: string): number {
  if (status === "unauthorized") return 401;
  if (status === "invalid_payload") return 400;
  return 200;
}

/**
 * AgentMail inbound reply webhook, namespaced under `/api/webhooks/...`
 * (called by AgentMail itself, not an admin/agent caller -- trust here
 * comes from the shared-secret header, not the admin-procedure guard).
 *
 * This handler never sends outbound email, never calls AgentMail's send
 * API, and never creates a new vendor_contact_attempts row -- it only
 * updates an existing row it can confidently correlate via
 * provider_attempt_id. The response body is minimal and never echoes the
 * raw inbound email body, sender PII beyond what was already stored, or
 * the configured webhook secret.
 */
export function registerAgentMailVendorReplyWebhookRoutes(app: express.Express, deps: StoreDeps = {}) {
  app.post(
    "/api/webhooks/agentmail/vendor-replies",
    express.raw({ type: "*/*" }),
    async (req, res) => {
      try {
        const store = resolveStore(deps);
        const result = await processAgentMailVendorReplyWebhook({
          rawBody: req.body,
          providedSecret: req.headers["x-agentmail-vendor-webhook-secret"],
          store,
        });
        return res.status(statusCodeFor(result.status)).json({ status: result.status });
      } catch {
        // Never echo internal error details to an external caller.
        return res.status(500).json({ status: "internal_error" });
      }
    },
  );
}
