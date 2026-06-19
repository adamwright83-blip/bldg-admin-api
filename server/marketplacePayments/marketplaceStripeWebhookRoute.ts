import express from "express";
import { createProcurementPool } from "../procurement/migrations";
import { MarketplacePaymentStore } from "./marketplacePaymentStore";
import { processMarketplaceStripeWebhookEvent } from "./marketplaceStripeWebhook";

type StoreDeps = { store?: MarketplacePaymentStore };

let lazyStore: MarketplacePaymentStore | null = null;
function resolveStore(deps: StoreDeps): MarketplacePaymentStore {
  if (deps.store) return deps.store;
  if (!lazyStore) {
    lazyStore = new MarketplacePaymentStore(createProcurementPool());
  }
  return lazyStore;
}

function statusCodeFor(result: { status: string; reason?: string }): number {
  if (result.status === "failed" && result.reason === "invalid_signature") return 400;
  if (result.status === "failed") return 500;
  return 200;
}

/**
 * Stripe webhook intake for marketplace payment events, namespaced under
 * `/api/marketplace-payments/` (distinct from `/api/internal/...`, since
 * this is called by Stripe itself, not an admin/agent caller — trust here
 * comes from the Stripe signature, not the Slice 6 admin-or-agent guard).
 *
 * Mounted with its own `express.raw()` body parser scoped to this exact
 * path, so Stripe signature verification always sees the true raw bytes
 * regardless of any other body-parsing middleware mounted elsewhere.
 *
 * No production webhook is registered in Stripe for this endpoint, and it
 * remains fully inert (see marketplaceStripeWebhook.ts) until both
 * MARKETPLACE_PAYMENTS_ENABLED and MARKETPLACE_STRIPE_WEBHOOK_SECRET are
 * explicitly set in a future slice.
 */
export function registerMarketplaceStripeWebhookRoutes(app: express.Express, deps: StoreDeps = {}) {
  app.post(
    "/api/marketplace-payments/stripe-webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      try {
        const store = resolveStore(deps);
        const result = await processMarketplaceStripeWebhookEvent({
          rawBody: req.body,
          signatureHeader: req.headers["stripe-signature"],
          store,
        });
        return res.status(statusCodeFor(result)).json(result);
      } catch (error) {
        return res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
          code: "MARKETPLACE_STRIPE_WEBHOOK_FAILED",
        });
      }
    },
  );
}
