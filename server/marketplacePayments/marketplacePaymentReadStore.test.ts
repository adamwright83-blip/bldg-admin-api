import { describe, expect, it, vi } from "vitest";
import { MarketplacePaymentReadStore, MAX_LIST_LIMIT, clampLimit, clampOffset } from "./marketplacePaymentReadStore";

function makePool(rows: unknown[] = []) {
  const execute = vi.fn().mockResolvedValue([rows]);
  const query = vi.fn().mockResolvedValue([rows]);
  return { execute, query, pool: { execute, query } };
}

describe("pagination clamping", () => {
  it("defaults limit to 50 and offset to 0 when unset", () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampOffset(undefined)).toBe(0);
  });
  it("clamps an oversized limit to MAX_LIST_LIMIT", () => {
    expect(clampLimit(10_000)).toBe(MAX_LIST_LIMIT);
  });
  it("clamps a negative offset to 0 and a non-positive limit to 1", () => {
    expect(clampOffset(-50)).toBe(0);
    expect(clampLimit(-5)).toBe(1);
  });
  it("clamps NaN to the defaults", () => {
    expect(clampLimit(Number.NaN)).toBe(50);
    expect(clampOffset(Number.NaN)).toBe(0);
  });
});

describe("MarketplacePaymentReadStore", () => {
  it("getAuthorizationById maps a row and parses the policy_decision_json", async () => {
    const row = {
      id: "auth-1", guest_readiness_plan_item_id: "item-1", provider_acceptance_id: null,
      authority_grant_id: "grant-1", tenant_id: "default", bldg_user_id: 1, building_slug: "opusla",
      vendor_id: null, vendor_connect_account_id_snapshot: null, amount_cents: 5000, currency: "usd",
      state: "authorization_required", stripe_customer_id: null, stripe_payment_method_id: null,
      stripe_payment_intent_id: null, policy_decision_json: JSON.stringify({ allowed: true, reasons: [] }),
      idempotency_key: "k1", expires_at: null, authorized_at: null, cancelled_at: null,
      created_at: new Date("2026-06-19T00:00:00.000Z"), updated_at: new Date("2026-06-19T00:00:00.000Z"),
    };
    const { execute, pool } = makePool([row]);
    const store = new MarketplacePaymentReadStore(pool as never);
    const result = await store.getAuthorizationById("auth-1");
    expect(result).toMatchObject({ id: "auth-1", policyDecision: { allowed: true, reasons: [] } });
    expect(String(execute.mock.calls[0][0])).toMatch(/^SELECT \* FROM marketplace_payment_authorizations WHERE id = \?$/);
  });

  it("getAuthorizationById returns null when no row is found", async () => {
    const { pool } = makePool([]);
    const store = new MarketplacePaymentReadStore(pool as never);
    expect(await store.getAuthorizationById("missing")).toBeNull();
  });

  it("listAuthorizations builds a parameterized WHERE clause from provided filters", async () => {
    const { query, pool } = makePool([]);
    const store = new MarketplacePaymentReadStore(pool as never);
    await store.listAuthorizations({ tenantId: "default", bldgUserId: 1, state: "authorized", limit: 10, offset: 5 });
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toMatch(/WHERE tenant_id = \? AND bldg_user_id = \? AND state = \?/);
    expect(params).toEqual(["default", 1, "authorized", 10, 5]);
  });

  it("listAuthorizations issues no WHERE clause when no filters are provided, but still bounds limit/offset", async () => {
    const { query, pool } = makePool([]);
    const store = new MarketplacePaymentReadStore(pool as never);
    const result = await store.listAuthorizations({});
    expect(String(query.mock.calls[0][0])).not.toMatch(/WHERE/);
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  it("listCapturesByAuthorization scopes strictly to the given authorization id", async () => {
    const { query, pool } = makePool([]);
    const store = new MarketplacePaymentReadStore(pool as never);
    await store.listCapturesByAuthorization("auth-1");
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toMatch(/WHERE authorization_id = \?/);
    expect(params[0]).toBe("auth-1");
  });

  it("listVendorPayables filters by vendorId and state together", async () => {
    const { query, pool } = makePool([]);
    const store = new MarketplacePaymentReadStore(pool as never);
    await store.listVendorPayables({ vendorId: 7, state: "transfer_pending" });
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toMatch(/WHERE vendor_id = \? AND state = \?/);
    expect(params).toEqual([7, "transfer_pending", 50, 0]);
  });

  it("listStripeEvents filters by relatedAuthorizationId and processingStatus", async () => {
    const { query, pool } = makePool([]);
    const store = new MarketplacePaymentReadStore(pool as never);
    await store.listStripeEvents({ relatedAuthorizationId: "auth-1", processingStatus: "received" });
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toMatch(/WHERE related_authorization_id = \? AND processing_status = \?/);
    expect(params).toEqual(["auth-1", "received", 50, 0]);
  });

  it("listRefundsByCapture and listDisputesByCapture both scope to capture_id", async () => {
    const refunds = makePool([]);
    const disputes = makePool([]);
    const refundStore = new MarketplacePaymentReadStore(refunds.pool as never);
    const disputeStore = new MarketplacePaymentReadStore(disputes.pool as never);
    await refundStore.listRefundsByCapture("capture-1");
    await disputeStore.listDisputesByCapture("capture-1");
    expect(String(refunds.query.mock.calls[0][0])).toMatch(/FROM marketplace_refunds WHERE capture_id = \?/);
    expect(String(disputes.query.mock.calls[0][0])).toMatch(/FROM marketplace_disputes WHERE capture_id = \?/);
  });

  it("getIdempotencyKeyMetadata exposes only a boolean for whether a Stripe response was recorded, never the raw payload", async () => {
    const row = {
      idempotency_key: "key-1", operation_type: "marketplace_authorization", request_payload_hash: "key-1",
      stripe_response_json: JSON.stringify({ id: "pi_secret_object" }), created_at: new Date("2026-06-19T00:00:00.000Z"),
    };
    const { pool } = makePool([row]);
    const store = new MarketplacePaymentReadStore(pool as never);
    const result = await store.getIdempotencyKeyMetadata("key-1");
    expect(result).toEqual({
      idempotencyKey: "key-1", operationType: "marketplace_authorization", requestPayloadHash: "key-1",
      hasStripeResponse: true, createdAt: row.created_at,
    });
    expect(JSON.stringify(result)).not.toMatch(/pi_secret_object/);
  });

  it("never issues an INSERT, UPDATE, or DELETE statement across any method", async () => {
    const { execute, query, pool } = makePool([]);
    const store = new MarketplacePaymentReadStore(pool as never);
    await store.getAuthorizationById("a");
    await store.listAuthorizations({});
    await store.getCaptureById("c");
    await store.listCapturesByAuthorization("a");
    await store.listVendorPayables({});
    await store.listStripeEvents({});
    await store.listRefundsByCapture("c");
    await store.listDisputesByCapture("c");
    await store.getIdempotencyKeyMetadata("k");
    const allSql = [...execute.mock.calls, ...query.mock.calls].map(call => String(call[0])).join(" ");
    expect(allSql).not.toMatch(/INSERT|UPDATE|DELETE/i);
    expect(allSql.match(/SELECT/gi)?.length).toBeGreaterThan(0);
  });
});
