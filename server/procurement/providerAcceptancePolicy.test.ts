import { describe, expect, it, vi } from "vitest";
import {
  hasProviderAcceptance,
  hasVerifiedBooking,
  paymentCaptureTruthCheck,
  type AcceptanceStatus,
  type ProviderAcceptancePolicyView,
} from "./providerAcceptancePolicy";
import { ProviderAcceptanceStore } from "./providerAcceptanceStore";

const now = new Date("2026-06-19T12:00:00.000Z");
const planDeadlineAt = new Date("2026-06-22T12:00:00.000Z");
const budgetCapCents = 30_000;

const acceptance = (patch: Partial<ProviderAcceptancePolicyView> = {}): ProviderAcceptancePolicyView => ({
  acceptanceType: "provider_accepted",
  acceptanceStatus: "accepted",
  expiresAt: new Date("2026-06-21T12:00:00.000Z"),
  serviceWindowStart: new Date("2026-06-20T10:00:00.000Z"),
  serviceWindowEnd: new Date("2026-06-20T12:00:00.000Z"),
  acceptedPriceCents: 5_000,
  ...patch,
});

const check = (patch: Partial<ProviderAcceptancePolicyView> = {}) =>
  paymentCaptureTruthCheck({ acceptance: acceptance(patch), budgetCapCents, planDeadlineAt, now });

describe("Provider acceptance / booking truth policy", () => {
  it("accepted provider allows future capture truth check", () => {
    const result = check();
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it.each<AcceptanceStatus>(["draft", "offered", "declined", "countered", "expired", "cancelled"])(
    "denies capture for status %s",
    status => {
      const result = check({ acceptanceStatus: status });
      expect(result.allowed).toBe(false);
      expect(result.reasons.length).toBeGreaterThan(0);
    },
  );

  it("denies capture when accepted price is missing", () => {
    const result = check({ acceptedPriceCents: null });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("accepted_price_unknown");
  });

  it("denies capture when service window is after the plan deadline", () => {
    const result = check({ serviceWindowEnd: new Date("2026-06-23T12:00:00.000Z") });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("service_window_after_deadline");
  });

  it("denies capture when accepted price exceeds budget", () => {
    const result = check({ acceptedPriceCents: 31_000 });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("accepted_price_over_budget");
  });

  it("operator_verified allows truth check when all constraints pass", () => {
    const result = check({ acceptanceType: "operator_verified", acceptanceStatus: "operator_verified" });
    expect(result.allowed).toBe(true);
    expect(hasVerifiedBooking(acceptance({ acceptanceType: "operator_verified", acceptanceStatus: "operator_verified" }))).toBe(true);
  });

  it("verified_existing_booking with accepted status counts as verified booking", () => {
    const view = acceptance({ acceptanceType: "verified_existing_booking", acceptanceStatus: "accepted" });
    expect(hasVerifiedBooking(view)).toBe(true);
    expect(hasProviderAcceptance(view)).toBe(false);
  });

  it("provider_accepted with accepted status counts as provider acceptance", () => {
    const view = acceptance();
    expect(hasProviderAcceptance(view)).toBe(true);
    expect(hasVerifiedBooking(view)).toBe(false);
  });

  it("expired acceptance denies capture even if status was accepted", () => {
    const result = check({ expiresAt: new Date("2026-06-18T00:00:00.000Z") });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("acceptance_expired");
  });

  it("records an append-only audit/truth event without mutating prior events", async () => {
    const connection = {
      beginTransaction: vi.fn(),
      execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
    };
    const store = new ProviderAcceptanceStore({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    const decision = check();
    await store.recordCaptureTruthCheck({
      acceptanceId: "acceptance-1",
      guestReadinessPlanItemId: "item-1",
      decision,
    });
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.execute).toHaveBeenCalledTimes(2);
    for (const call of connection.execute.mock.calls) {
      expect(String(call[0])).toMatch(/^INSERT INTO guest_readiness_booking_truth_events/);
      expect(String(call[0])).not.toMatch(/UPDATE|DELETE/i);
    }
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it("produces no payment, Stripe, or vendor outreach side effects", async () => {
    const connection = {
      beginTransaction: vi.fn(),
      execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
    };
    const store = new ProviderAcceptanceStore({ getConnection: vi.fn().mockResolvedValue(connection) } as never);
    await store.createOffer({
      id: "acceptance-1",
      guestReadinessPlanItemId: "item-1",
      tenantId: "default",
      bldgUserId: 1,
      buildingSlug: "opusla",
      vendorSourceType: "manual",
      acceptanceType: "provider_accepted",
      decisionEvidence: { reasons: [] },
    });
    expect(connection.execute.mock.calls.flat().join(" ")).not.toMatch(/stripe|payment_intent|charge|vendor_outreach/i);
  });
});
