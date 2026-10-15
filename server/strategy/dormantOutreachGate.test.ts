import { describe, expect, it } from "vitest";
import { evaluateDormantOutreach } from "./dormantOutreachGate";

const ready = {
  tenantId: "default",
  freshness: "current" as const,
  matched: true,
  inTerritory: true,
  paidOrders: 4,
  capturedCents: 12000,
  lastOrderDate: "2026-06-01",
  dormant: true,
  contradictingRecentOrder: false,
  phoneDigits: "3235550100",
  permission: "opted_in" as const,
  permissionReadable: true,
  lastOutreachOn: null,
  today: "2026-10-15",
};

describe("dormant outreach eligibility", () => {
  it("accepts a current, consented, dormant customer in territory", () => {
    expect(evaluateDormantOutreach(ready)).toEqual({ eligible: true, blocks: [] });
  });

  it("does not treat a phone number as SMS consent", () => {
    const decision = evaluateDormantOutreach({ ...ready, permission: "unknown" });
    expect(decision.eligible).toBe(false);
    expect(decision.blocks).toContain("sms_consent_absent");
  });

  it("blocks opt-out, a recent order, stale evidence, and a short phone", () => {
    expect(evaluateDormantOutreach({ ...ready, permission: "opted_out" }).blocks).toContain("opted_out");
    expect(evaluateDormantOutreach({ ...ready, contradictingRecentOrder: true }).blocks).toContain("recent_order");
    expect(evaluateDormantOutreach({ ...ready, freshness: "stale" }).blocks).toContain("freshness_not_current");
    expect(evaluateDormantOutreach({ ...ready, freshness: "import_failed" }).blocks).toContain("freshness_not_current");
    expect(evaluateDormantOutreach({ ...ready, phoneDigits: "5550100" }).blocks).toContain("phone_missing");
  });

  it("blocks outreach inside the cooldown and a customer with no captured amount", () => {
    const recent = evaluateDormantOutreach({
      ...ready,
      lastOutreachOn: "2026-10-10T18:00:00.000Z",
    });
    expect(recent.blocks).toContain("outreach_frequency");
    const unpaid = evaluateDormantOutreach({ ...ready, paidOrders: 1, capturedCents: 0 });
    expect(unpaid.blocks).toContain("no_paid_history");
    expect(evaluateDormantOutreach({ ...ready, permissionReadable: false }).blocks).toContain(
      "permission_unreadable"
    );
  });
});
