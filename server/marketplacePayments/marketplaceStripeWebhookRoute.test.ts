import type express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerMarketplaceStripeWebhookRoutes } from "./marketplaceStripeWebhookRoute";

const ORIGINAL_ENABLED = process.env.MARKETPLACE_PAYMENTS_ENABLED;
const ORIGINAL_SECRET = process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET;

afterEach(() => {
  if (ORIGINAL_ENABLED === undefined) delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
  else process.env.MARKETPLACE_PAYMENTS_ENABLED = ORIGINAL_ENABLED;
  if (ORIGINAL_SECRET === undefined) delete process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET;
  else process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

function makeFakeApp() {
  const handlers = new Map<string, express.RequestHandler>();
  const app = {
    post: (path: string, ...middlewareAndHandler: express.RequestHandler[]) => {
      // The route is registered as app.post(path, express.raw(...), handler) —
      // capture only the final handler; express.raw() itself is well-tested
      // library code we don't need to re-test here.
      handlers.set(path, middlewareAndHandler[middlewareAndHandler.length - 1]);
    },
  };
  return { app: app as unknown as express.Express, handlers };
}

function makeReqRes(body: unknown, headers: Record<string, string> = {}) {
  const req = { body, headers } as unknown as express.Request;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status } as unknown as express.Response;
  return { req, res, status, json };
}

function makeStoreStub() {
  return {
    recordStripeEvent: vi.fn().mockResolvedValue({ isNewEvent: true }),
    markStripeEventProcessed: vi.fn().mockResolvedValue(true),
  };
}

describe("Marketplace Stripe webhook route", () => {
  it("returns disabled with 200 when MARKETPLACE_PAYMENTS_ENABLED is unset, and never touches the store", async () => {
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    const store = makeStoreStub();
    const { app, handlers } = makeFakeApp();
    registerMarketplaceStripeWebhookRoutes(app, { store: store as never });
    const { req, res, status, json } = makeReqRes(Buffer.from("{}"), { "stripe-signature": "t=1,v1=abc" });
    await handlers.get("/api/marketplace-payments/stripe-webhook")!(req, res, vi.fn());
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ status: "disabled", reason: "marketplace_payments_disabled" });
    expect(store.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("is namespaced under /api/marketplace-payments/, distinct from the admin-guarded /api/internal/ routes", async () => {
    const { app, handlers } = makeFakeApp();
    registerMarketplaceStripeWebhookRoutes(app, { store: makeStoreStub() as never });
    expect(handlers.has("/api/marketplace-payments/stripe-webhook")).toBe(true);
    expect([...handlers.keys()].every(path => !path.startsWith("/api/internal/"))).toBe(true);
  });
});

describe("Slice 8 route safety", () => {
  it("the route module never imports the orchestrator or live-call adapter functions", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "marketplaceStripeWebhookRoute.ts"), "utf8",
    );
    expect(source).not.toMatch(/MarketplacePaymentOrchestrator|createAuthorizationPaymentIntent|captureAuthorizedPaymentIntent|createVendorTransfer/);
  });
});
