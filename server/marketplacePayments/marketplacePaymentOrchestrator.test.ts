import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthorityGrantPolicyView } from "../procurement/authorityPolicy";
import type { ProviderAcceptancePolicyView } from "../procurement/providerAcceptancePolicy";
import { MarketplacePaymentOrchestrator } from "./marketplacePaymentOrchestrator";
import { MarketplacePaymentStore } from "./marketplacePaymentStore";

const ORIGINAL_ENABLED = process.env.MARKETPLACE_PAYMENTS_ENABLED;
const ORIGINAL_WORKER_ENABLED = process.env.MARKETPLACE_PAYMENTS_WORKER_ENABLED;

afterEach(() => {
  if (ORIGINAL_ENABLED === undefined) delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
  else process.env.MARKETPLACE_PAYMENTS_ENABLED = ORIGINAL_ENABLED;
  if (ORIGINAL_WORKER_ENABLED === undefined) delete process.env.MARKETPLACE_PAYMENTS_WORKER_ENABLED;
  else process.env.MARKETPLACE_PAYMENTS_WORKER_ENABLED = ORIGINAL_WORKER_ENABLED;
});

function makeConnection() {
  return {
    beginTransaction: vi.fn(),
    execute: vi.fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT IGNORE idempotency key
      .mockResolvedValueOnce([[{ idempotency_key: "k", stripe_response_json: null }]]) // SELECT
      .mockResolvedValueOnce([{ affectedRows: 1 }]), // INSERT row
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
}

function makeStore() {
  const connection = makeConnection();
  const pool = { getConnection: vi.fn().mockResolvedValue(connection) };
  const store = new MarketplacePaymentStore(pool as never);
  return { store, connection, pool };
}

const now = new Date("2026-06-19T12:00:00.000Z");

const authority = (patch: Partial<AuthorityGrantPolicyView> = {}): AuthorityGrantPolicyView => ({
  authorityType: "guest_readiness",
  status: "active",
  budgetCapCents: 30_000,
  deadlineAt: new Date("2026-06-22T12:00:00.000Z"),
  expiresAt: new Date("2026-06-22T12:00:00.000Z"),
  revokedAt: null,
  allowedRiskCategories: ["low", "medium"],
  disallowedCategories: [],
  accessConstraints: { allowedPatterns: ["no_entry", "resident_present"] },
  ...patch,
});

const action = (patch: Partial<{
  category: string; spendCents: number; scheduledAt: Date;
  accessPattern: "no_entry" | "resident_present" | "building_or_operator_approved" | "unattended_entry";
}> = {}) => ({
  authorityType: "guest_readiness" as const,
  category: "flowers",
  spendCents: 5_000,
  scheduledAt: new Date("2026-06-20T12:00:00.000Z"),
  accessPattern: "no_entry" as const,
  ...patch,
});

const baseAuthorizationInput = {
  guestReadinessPlanItemId: "item-1",
  authorityGrantId: "grant-1",
  tenantId: "default",
  bldgUserId: 1,
  buildingSlug: "opusla",
  residentApprovalGranted: false,
  now,
};

describe("MarketplacePaymentOrchestrator — authorization", () => {
  it("allows and persists an authorization_required record for an active grant within budget", async () => {
    const { store, connection } = makeStore();
    const orchestrator = new MarketplacePaymentOrchestrator(store);
    const result = await orchestrator.evaluateAndCreateAuthorization({
      ...baseAuthorizationInput, authority: authority(), action: action(),
    });
    expect(result.decision.allowed).toBe(true);
    expect(result.decision.state).toBe("authorization_required");
    expect(result.authorizationId).toBeTruthy();
    const insertCall = connection.execute.mock.calls.find(call =>
      String(call[0]).match(/INSERT INTO marketplace_payment_authorizations/));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain("authorization_required");
  });

  it("returns disabled live-execution status when MARKETPLACE_PAYMENTS_ENABLED is unset", async () => {
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    const { store } = makeStore();
    const orchestrator = new MarketplacePaymentOrchestrator(store);
    const result = await orchestrator.evaluateAndCreateAuthorization({
      ...baseAuthorizationInput, authority: authority(), action: action(),
    });
    expect(result.liveExecutionStatus).toBe("disabled");
  });

  it("reports not_applicable live-execution status for a zero-amount (no_payment_required) item", async () => {
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "true";
    const { store } = makeStore();
    const orchestrator = new MarketplacePaymentOrchestrator(store);
    const result = await orchestrator.evaluateAndCreateAuthorization({
      ...baseAuthorizationInput, authority: authority(), action: action({ spendCents: 0 }),
    });
    expect(result.decision.state).toBe("no_payment_required");
    expect(result.liveExecutionStatus).toBe("not_applicable");
  });

  it("denies and still persists a cancelled audit record when authority is revoked", async () => {
    const { store, connection } = makeStore();
    const orchestrator = new MarketplacePaymentOrchestrator(store);
    const result = await orchestrator.evaluateAndCreateAuthorization({
      ...baseAuthorizationInput, authority: authority({ status: "revoked", revokedAt: now }), action: action(),
    });
    expect(result.decision.allowed).toBe(false);
    expect(result.decision.reasons).toContain("authority_not_active");
    expect(result.decision.state).toBe("cancelled");
    expect(result.liveExecutionStatus).toBe("not_applicable");
    const insertCall = connection.execute.mock.calls.find(call =>
      String(call[0]).match(/INSERT INTO marketplace_payment_authorizations/));
    expect(insertCall![1]).toContain("cancelled");
  });

  it("denies when the amount is unknown", async () => {
    const { store } = makeStore();
    const orchestrator = new MarketplacePaymentOrchestrator(store);
    const result = await orchestrator.evaluateAndCreateAuthorization({
      ...baseAuthorizationInput, authority: authority(), action: action({ spendCents: Number.NaN }),
    });
    expect(result.decision.allowed).toBe(false);
    expect(result.decision.reasons).toContain("amount_unknown");
  });

  it("denies when over budget", async () => {
    const { store } = makeStore();
    const orchestrator = new MarketplacePaymentOrchestrator(store);
    const result = await orchestrator.evaluateAndCreateAuthorization({
      ...baseAuthorizationInput, authority: authority({ budgetCapCents: 1_000 }), action: action({ spendCents: 5_000 }),
    });
    expect(result.decision.allowed).toBe(false);
    expect(result.decision.reasons).toContain("budget_cap_exceeded");
  });

  it("denies for an unsupported category", async () => {
    const { store } = makeStore();
    const orchestrator = new MarketplacePaymentOrchestrator(store);
    const result = await orchestrator.evaluateAndCreateAuthorization({
      ...baseAuthorizationInput, authority: authority(), action: action({ category: "llm_invented" }),
    });
    expect(result.decision.allowed).toBe(false);
    expect(result.decision.reasons).toContain("unknown_category");
  });
});

const acceptance = (patch: Partial<ProviderAcceptancePolicyView> = {}): ProviderAcceptancePolicyView => ({
  acceptanceType: "provider_accepted",
  acceptanceStatus: "accepted",
  expiresAt: new Date("2026-06-21T12:00:00.000Z"),
  serviceWindowStart: new Date("2026-06-20T10:00:00.000Z"),
  serviceWindowEnd: new Date("2026-06-20T12:00:00.000Z"),
  acceptedPriceCents: 5_000,
  ...patch,
});

const baseCaptureInput = {
  authorizationId: "auth-1",
  budgetCapCents: 30_000,
  planDeadlineAt: new Date("2026-06-22T12:00:00.000Z"),
  now,
};

describe("MarketplacePaymentOrchestrator — capture", () => {
  it("allows and persists a capture_pending record when authorization is authorized and acceptance is current", async () => {
    const { store, connection } = makeStore();
    const orchestrator = new MarketplacePaymentOrchestrator(store);
    const result = await orchestrator.evaluateAndCreateCapture({
      ...baseCaptureInput, authorizationState: "authorized", acceptance: acceptance(),
    });
    expect(result.decision.allowed).toBe(true);
    expect(result.captureId).toBeTruthy();
    const insertCall = connection.execute.mock.calls.find(call =>
      String(call[0]).match(/INSERT INTO marketplace_payment_captures/));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain("capture_pending");
  });

  it("refuses to create a capture record when authorization is not authorized", async () => {
    const { store, connection } = makeStore();
    const orchestrator = new MarketplacePaymentOrchestrator(store);
    const result = await orchestrator.evaluateAndCreateCapture({
      ...baseCaptureInput, authorizationState: "authorization_pending", acceptance: acceptance(),
    });
    expect(result.decision.allowed).toBe(false);
    expect(result.captureId).toBeNull();
    expect(result.decision.reasons).toContain("authorization_not_in_authorized_state");
    const insertCall = connection.execute.mock.calls.find(call =>
      String(call[0]).match(/INSERT INTO marketplace_payment_captures/));
    expect(insertCall).toBeUndefined();
  });

  it("refuses to create a capture record without provider acceptance or verified booking", async () => {
    const { store } = makeStore();
    const orchestrator = new MarketplacePaymentOrchestrator(store);
    const result = await orchestrator.evaluateAndCreateCapture({
      ...baseCaptureInput, authorizationState: "authorized", acceptance: acceptance({ acceptanceStatus: "offered" }),
    });
    expect(result.decision.allowed).toBe(false);
    expect(result.captureId).toBeNull();
  });

  it("refuses to create a capture record when acceptance is declined", async () => {
    const { store } = makeStore();
    const orchestrator = new MarketplacePaymentOrchestrator(store);
    const result = await orchestrator.evaluateAndCreateCapture({
      ...baseCaptureInput, authorizationState: "authorized", acceptance: acceptance({ acceptanceStatus: "declined" }),
    });
    expect(result.decision.allowed).toBe(false);
    expect(result.decision.reasons).toContain("acceptance_declined");
    expect(result.captureId).toBeNull();
  });

  it("allows capture for an operator_verified booking when all constraints pass", async () => {
    const { store } = makeStore();
    const orchestrator = new MarketplacePaymentOrchestrator(store);
    const result = await orchestrator.evaluateAndCreateCapture({
      ...baseCaptureInput, authorizationState: "authorized",
      acceptance: acceptance({ acceptanceType: "operator_verified", acceptanceStatus: "operator_verified" }),
    });
    expect(result.decision.allowed).toBe(true);
    expect(result.captureId).toBeTruthy();
  });

  it("reports disabled live-execution status for an allowed capture when the flag is unset", async () => {
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    const { store } = makeStore();
    const orchestrator = new MarketplacePaymentOrchestrator(store);
    const result = await orchestrator.evaluateAndCreateCapture({
      ...baseCaptureInput, authorizationState: "authorized", acceptance: acceptance(),
    });
    expect(result.liveExecutionStatus).toBe("disabled");
  });
});

describe("MarketplacePaymentOrchestrator — optional workflow enqueue", () => {
  it("enqueues an internal workflow step with no external side effects when a workflowStore is provided", async () => {
    const { store } = makeStore();
    const createWorkflowWithStep = vi.fn().mockResolvedValue({ workflowId: "wf-1", stepId: "step-1" });
    const orchestrator = new MarketplacePaymentOrchestrator(store, { createWorkflowWithStep } as never);
    const result = await orchestrator.enqueueAuthorizationWorkflowStep({
      authorizationId: "auth-1", guestReadinessPlanItemId: "item-1",
    });
    expect(result).toEqual({ workflowId: "wf-1", stepId: "step-1" });
    expect(createWorkflowWithStep).toHaveBeenCalledWith(
      expect.objectContaining({ stepType: "marketplace_payment_authorization_pending" }),
    );
  });

  it("throws rather than silently no-op when constructed without a workflowStore", async () => {
    const { store } = makeStore();
    const orchestrator = new MarketplacePaymentOrchestrator(store);
    await expect(
      orchestrator.enqueueAuthorizationWorkflowStep({ authorizationId: "auth-1", guestReadinessPlanItemId: "item-1" }),
    ).rejects.toThrow(/without a workflowStore/);
  });
});

describe("Slice 5 production-safety invariants", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const read = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

  it("the orchestrator never imports live-Stripe-calling functions, only the feature-flag readers", () => {
    const source = read("server/marketplacePayments/marketplacePaymentOrchestrator.ts");
    expect(source).not.toMatch(/createAuthorizationPaymentIntent|captureAuthorizedPaymentIntent|createVendorTransfer/);
    expect(source).toMatch(/marketplacePaymentsEnabled/);
  });

  it("never registers a marketplace step handler in the existing procurement worker", () => {
    expect(read("server/procurement/worker.ts")).not.toMatch(/marketplace/i);
    expect(read("server/procurement/workerMain.ts")).not.toMatch(/marketplace/i);
  });

  it("does not modify the legacy chargeCard / orders / Stripe destination-charge flow", () => {
    const routersSource = read("server/routers.ts");
    expect(routersSource).toMatch(/transfer_data:\s*{\s*destination:\s*vendorAccountId!\s*}/);
    expect(routersSource).toMatch(/application_fee_amount:\s*platformFeeCents/);
  });

  it("does not introduce any resident-facing UI files", () => {
    const source = read("server/marketplacePayments/marketplacePaymentOrchestrator.ts");
    expect(source).not.toMatch(/from ["']react["']|useState|useEffect|export default function.*Props/);
  });
});
