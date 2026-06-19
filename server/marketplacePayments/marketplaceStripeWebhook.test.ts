import { afterEach, describe, expect, it, vi } from "vitest";
import { processMarketplaceStripeWebhookEvent } from "./marketplaceStripeWebhook";

const ORIGINAL_ENABLED = process.env.MARKETPLACE_PAYMENTS_ENABLED;
const ORIGINAL_SECRET = process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET;

afterEach(() => {
  if (ORIGINAL_ENABLED === undefined) delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
  else process.env.MARKETPLACE_PAYMENTS_ENABLED = ORIGINAL_ENABLED;
  if (ORIGINAL_SECRET === undefined) delete process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET;
  else process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

function makeStoreStub() {
  return {
    recordStripeEvent: vi.fn().mockResolvedValue({ isNewEvent: true }),
    markStripeEventProcessed: vi.fn().mockResolvedValue(true),
  };
}

function makeStripeStub(eventOrError: unknown) {
  const constructEvent = vi.fn(() => {
    if (eventOrError instanceof Error) throw eventOrError;
    return eventOrError;
  });
  return { stub: { webhooks: { constructEvent } }, constructEvent };
}

const sampleEvent = {
  id: "evt_123",
  type: "payment_intent.succeeded",
  livemode: false,
  data: { object: { id: "pi_123", metadata: { marketplaceAuthorizationId: "auth-1" } } },
};

describe("processMarketplaceStripeWebhookEvent — disabled by default", () => {
  it("returns disabled and never calls Stripe or writes to the DB when MARKETPLACE_PAYMENTS_ENABLED is unset", async () => {
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET = "whsec_test";
    const store = makeStoreStub();
    const getStripe = vi.fn();
    const result = await processMarketplaceStripeWebhookEvent({
      rawBody: "{}", signatureHeader: "t=1,v1=abc", store: store as never, getStripe,
    });
    expect(result).toEqual({ status: "disabled", reason: "marketplace_payments_disabled" });
    expect(getStripe).not.toHaveBeenCalled();
    expect(store.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("fails closed (disabled) when the webhook secret is missing even though the flag is enabled", async () => {
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "true";
    delete process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET;
    const store = makeStoreStub();
    const getStripe = vi.fn();
    const result = await processMarketplaceStripeWebhookEvent({
      rawBody: "{}", signatureHeader: "t=1,v1=abc", store: store as never, getStripe,
    });
    expect(result).toEqual({ status: "disabled", reason: "missing_webhook_secret" });
    expect(getStripe).not.toHaveBeenCalled();
    expect(store.recordStripeEvent).not.toHaveBeenCalled();
  });
});

describe("processMarketplaceStripeWebhookEvent — enabled", () => {
  it("fails closed on an invalid signature without writing to the DB", async () => {
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "true";
    process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET = "whsec_test";
    const store = makeStoreStub();
    const { stub } = makeStripeStub(new Error("signature mismatch"));
    const result = await processMarketplaceStripeWebhookEvent({
      rawBody: "{}", signatureHeader: "t=1,v1=bad", store: store as never, getStripe: () => stub as never,
    });
    expect(result).toEqual({ status: "failed", reason: "invalid_signature" });
    expect(store.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("records a new recognized event and marks it processed", async () => {
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "true";
    process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET = "whsec_test";
    const store = makeStoreStub();
    const { stub } = makeStripeStub(sampleEvent);
    const result = await processMarketplaceStripeWebhookEvent({
      rawBody: "{}", signatureHeader: "t=1,v1=good", store: store as never, getStripe: () => stub as never,
    });
    expect(result).toEqual({ status: "processed", stripeEventId: "evt_123", eventType: "payment_intent.succeeded" });
    expect(store.recordStripeEvent).toHaveBeenCalledWith(expect.objectContaining({
      stripeEventId: "evt_123", eventType: "payment_intent.succeeded", relatedAuthorizationId: "auth-1",
    }));
    expect(store.markStripeEventProcessed).toHaveBeenCalledWith("evt_123", "processed", null);
  });

  it("records a new unrecognized event and marks it ignored", async () => {
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "true";
    process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET = "whsec_test";
    const store = makeStoreStub();
    const unrecognized = { ...sampleEvent, type: "customer.created" };
    const { stub } = makeStripeStub(unrecognized);
    const result = await processMarketplaceStripeWebhookEvent({
      rawBody: "{}", signatureHeader: "t=1,v1=good", store: store as never, getStripe: () => stub as never,
    });
    expect(result).toEqual({ status: "ignored", reason: "unrecognized_event_type", stripeEventId: "evt_123" });
    expect(store.markStripeEventProcessed).toHaveBeenCalledWith("evt_123", "ignored", "unrecognized_event_type");
  });

  it("treats a duplicate stripe_event_id as idempotent and never re-processes it", async () => {
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "true";
    process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET = "whsec_test";
    const store = makeStoreStub();
    store.recordStripeEvent.mockResolvedValue({ isNewEvent: false });
    const { stub } = makeStripeStub(sampleEvent);
    const result = await processMarketplaceStripeWebhookEvent({
      rawBody: "{}", signatureHeader: "t=1,v1=good", store: store as never, getStripe: () => stub as never,
    });
    expect(result).toEqual({ status: "ignored", reason: "duplicate_event", stripeEventId: "evt_123" });
    expect(store.markStripeEventProcessed).not.toHaveBeenCalled();
  });

  it("marks the ledger row failed if the post-dedupe ledger update itself throws", async () => {
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "true";
    process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET = "whsec_test";
    const store = makeStoreStub();
    store.markStripeEventProcessed
      .mockRejectedValueOnce(new Error("db unavailable"))
      .mockResolvedValueOnce(true);
    const { stub } = makeStripeStub(sampleEvent);
    const result = await processMarketplaceStripeWebhookEvent({
      rawBody: "{}", signatureHeader: "t=1,v1=good", store: store as never, getStripe: () => stub as never,
    });
    expect(result).toEqual({ status: "failed", reason: "ledger_update_failed", stripeEventId: "evt_123" });
    expect(store.markStripeEventProcessed).toHaveBeenLastCalledWith("evt_123", "failed", "db unavailable");
  });
});

describe("Slice 8 production-safety invariants", () => {
  const repoRoot = `${__dirname}/../..`;
  const read = async (relativePath: string) => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    return fs.readFileSync(path.resolve(repoRoot, relativePath), "utf8");
  };

  it("the webhook module never imports capture/transfer/refund/payout execution functions", async () => {
    const source = await read("server/marketplacePayments/marketplaceStripeWebhook.ts");
    const importLines = source.split("\n").filter(line => line.trim().startsWith("import"));
    expect(importLines.join("\n")).not.toMatch(
      /createAuthorizationPaymentIntent|captureAuthorizedPaymentIntent|createVendorTransfer|MarketplacePaymentOrchestrator/,
    );
    expect(source).not.toMatch(/store\.createCapture|store\.createVendorPayable|store\.createAuthorization\(/);
  });

  it("does not use a legacy Stripe webhook path", async () => {
    const routersSource = await read("server/routers.ts");
    expect(routersSource).not.toMatch(/stripe-signature|constructEvent/);
  });

  it("never registers a marketplace step handler in the existing procurement worker", async () => {
    expect(await read("server/procurement/worker.ts")).not.toMatch(/marketplace/i);
    expect(await read("server/procurement/workerMain.ts")).not.toMatch(/marketplace/i);
  });

  it("does not modify the legacy chargeCard / orders / Stripe destination-charge flow", async () => {
    const routersSource = await read("server/routers.ts");
    expect(routersSource).toMatch(/transfer_data:\s*{\s*destination:\s*vendorAccountId!\s*}/);
    expect(routersSource).toMatch(/application_fee_amount:\s*platformFeeCents/);
  });

  it("does not introduce any resident-facing UI code", async () => {
    const source = await read("server/marketplacePayments/marketplaceStripeWebhook.ts");
    expect(source).not.toMatch(/from ["']react["']|useState|useEffect/);
  });
});
