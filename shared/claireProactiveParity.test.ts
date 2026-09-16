import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCTRINE,
  isDormantEligible,
  proposeRecoveryObligation,
  supersedeIfReordered,
  type CustomerEvidence,
} from "./claireProactive";

function customer(overrides: Partial<CustomerEvidence> = {}): CustomerEvidence {
  return {
    identityKey: "customer-1",
    displayName: "High Value Customer",
    paidOrderCount: 18,
    lifetimeRevenueCents: 250_000,
    lastPaidOn: "2026-09-14",
    daysSinceLastPaid: 1,
    expectedCadenceDays: 14,
    openOrderCount: 0,
    openOrderCoverage: "complete",
    lastOutreachOn: null,
    attestedOutreachOn: null,
    outreachCoverage: "known",
    ...overrides,
  };
}

describe("Claire customer-truth parity", () => {
  it("does not call an active high-spending customer dormant", () => {
    const result = isDormantEligible(customer(), DEFAULT_DOCTRINE, "2026-09-15", []);
    expect(result.eligible).toBe(false);
    expect(result.why).toMatch(/last ordered 1 days ago|threshold/i);
  });

  it("qualifies a genuinely quiet prior customer from real evidence, not spend rank", () => {
    const result = isDormantEligible(
      customer({
        displayName: "Quiet Regular",
        lastPaidOn: "2026-07-01",
        daysSinceLastPaid: 76,
        paidOrderCount: 8,
        lifetimeRevenueCents: 96_000,
      }),
      DEFAULT_DOCTRINE,
      "2026-09-15",
      []
    );
    expect(result.eligible).toBe(true);
    expect(result.why).toMatch(/76 days since the last paid order/i);
  });

  it("a newer real paid order makes old future recovery work obsolete without deleting history", () => {
    const stale = customer({
      displayName: "Returned Customer",
      lastPaidOn: "2026-07-01",
      daysSinceLastPaid: 76,
      paidOrderCount: 8,
    });
    const eligible = isDormantEligible(stale, DEFAULT_DOCTRINE, "2026-09-15", []);
    expect(eligible.eligible).toBe(true);
    const obligation = proposeRecoveryObligation(stale, "2026-09-16", eligible.why, "Draft only");

    const refreshed = customer({
      displayName: "Returned Customer",
      lastPaidOn: "2026-09-15",
      daysSinceLastPaid: 0,
      paidOrderCount: 9,
    });
    expect(isDormantEligible(refreshed, DEFAULT_DOCTRINE, "2026-09-15", [obligation]).eligible).toBe(false);
    const superseded = supersedeIfReordered(obligation, refreshed.lastPaidOn);
    expect(superseded.status).toBe("superseded");
    expect(superseded.historyIntact).toBe(true);
  });
});
