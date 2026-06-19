import { describe, expect, it, vi } from "vitest";
import { MarketplacePaymentStore } from "./marketplacePaymentStore";

function makeConnection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    beginTransaction: vi.fn(),
    execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    ...overrides,
  };
}

describe("MarketplacePaymentStore", () => {
  it("reserves an idempotency key before inserting an authorization row", async () => {
    const connection = makeConnection({
      execute: vi.fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT IGNORE idempotency key
        .mockResolvedValueOnce([[{ idempotency_key: "auth-key-1", stripe_response_json: null }]]) // SELECT
        .mockResolvedValueOnce([{ affectedRows: 1 }]), // INSERT authorization
    });
    const store = new MarketplacePaymentStore({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    await store.createAuthorization({
      id: "auth-1", guestReadinessPlanItemId: "item-1", authorityGrantId: "grant-1",
      tenantId: "default", bldgUserId: 1, buildingSlug: "opusla", amountCents: 5_000,
      state: "authorization_required", policyDecision: { allowed: true, reasons: [] },
      idempotencyKey: "auth-key-1",
    });
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    const calls = connection.execute.mock.calls.map(call => String(call[0]));
    expect(calls[0]).toMatch(/INSERT IGNORE INTO marketplace_payment_idempotency_keys/);
    expect(calls[2]).toMatch(/INSERT INTO marketplace_payment_authorizations/);
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it("enforces single capture per authorization via a transactional insert", async () => {
    const connection = makeConnection({
      execute: vi.fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ idempotency_key: "cap-key-1", stripe_response_json: null }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]),
    });
    const store = new MarketplacePaymentStore({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    await store.createCapture({
      id: "capture-1", authorizationId: "auth-1", state: "capture_pending",
      truthCheckDecision: { allowed: true, reasons: [] }, idempotencyKey: "cap-key-1",
    });
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    const calls = connection.execute.mock.calls.map(call => String(call[0]));
    expect(calls.some(sql => sql.match(/INSERT INTO marketplace_payment_captures/))).toBe(true);
  });

  it("rolls back the transaction if the authorization insert fails", async () => {
    const connection = makeConnection({
      execute: vi.fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ idempotency_key: "auth-key-2", stripe_response_json: null }]])
        .mockRejectedValueOnce(new Error("duplicate key")),
    });
    const store = new MarketplacePaymentStore({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    await expect(store.createAuthorization({
      id: "auth-2", guestReadinessPlanItemId: "item-1", authorityGrantId: "grant-1",
      tenantId: "default", bldgUserId: 1, buildingSlug: "opusla", amountCents: 5_000,
      state: "authorization_required", policyDecision: {}, idempotencyKey: "auth-key-2",
    })).rejects.toThrow("duplicate key");
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("treats a repeated Stripe webhook event as idempotent by stripe_event_id", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // first delivery: newly inserted
      .mockResolvedValueOnce([{ affectedRows: 0 }]); // duplicate delivery: INSERT IGNORE no-ops
    const store = new MarketplacePaymentStore({ execute } as never);
    const first = await store.recordStripeEvent({
      stripeEventId: "evt_123", eventType: "payment_intent.succeeded", livemode: false, payload: {},
    });
    const second = await store.recordStripeEvent({
      stripeEventId: "evt_123", eventType: "payment_intent.succeeded", livemode: false, payload: {},
    });
    expect(first.isNewEvent).toBe(true);
    expect(second.isNewEvent).toBe(false);
    expect(execute.mock.calls[0][0]).toMatch(/INSERT IGNORE INTO marketplace_stripe_events/);
  });

  it("produces no calls referencing Stripe, charges, or vendor outreach in any SQL", async () => {
    const connection = makeConnection({
      execute: vi.fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        .mockResolvedValueOnce([[{ idempotency_key: "auth-key-3", stripe_response_json: null }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]),
    });
    const store = new MarketplacePaymentStore({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    await store.createAuthorization({
      id: "auth-3", guestReadinessPlanItemId: "item-1", authorityGrantId: "grant-1",
      tenantId: "default", bldgUserId: 1, buildingSlug: "opusla", amountCents: 5_000,
      state: "authorization_required", policyDecision: {}, idempotencyKey: "auth-key-3",
    });
    const sql = connection.execute.mock.calls.map(call => String(call[0])).join(" ");
    expect(sql).not.toMatch(/stripe\.|vendor_outreach|chargeCard|\borders\b/i);
  });
});
