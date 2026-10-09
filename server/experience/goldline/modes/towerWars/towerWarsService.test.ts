import { describe, expect, it } from "vitest";
import {
  compileAuthoritativeEvents,
  type TowerWarsCandidate,
} from "./towerWarsService";

const base: TowerWarsCandidate = {
  sourceKey: "order:1",
  occurredAt: new Date("2026-08-30T17:00:00Z"),
  orderId: 1,
  address: "3545 Wilshire Blvd",
  buildingSlug: "opusla",
  customerName: "Ada Lovelace",
  customerPhone: "3105550100",
  customerIdentity: "customer:ada",
  cents: 7500,
  source: "stripe",
  authoritative: true,
  exclusionReason: null,
  sourceEvidence: {
    economicEventKey: "order:1",
    stripePaymentIntentId: "pi_1",
  },
};

describe("Tower Wars authoritative source compiler", () => {
  it("excludes historical paidAt-shaped rows without payment evidence", () => {
    const result = compileAuthoritativeEvents({
      tenantId: "tenant-a",
      businessDate: "2026-08-30",
      candidates: [
        {
          ...base,
          sourceKey: "order:2",
          source: "local_order_payment",
          authoritative: false,
          exclusionReason:
            "local_paid_at_has_no_authoritative_payment_evidence",
        },
      ],
    });
    expect(result.events).toHaveLength(0);
    expect(result.exclusions[0]?.reason).toContain("authoritative");
  });

  it("collapses explicitly linked duplicate economic evidence", () => {
    const result = compileAuthoritativeEvents({
      tenantId: "tenant-a",
      businessDate: "2026-08-30",
      candidates: [
        base,
        {
          ...base,
          sourceKey: "cleancloud:44",
          source: "cleancloud",
          sourceEvidence: { economicEventKey: "order:1" },
        },
      ],
    });
    expect(result.events).toHaveLength(1);
    expect(result.exclusions).toContainEqual({
      sourceKey: "cleancloud:44",
      reason: "duplicate_economic_event",
    });
  });

  it("holds out an unlinked same-person same-value cross-source collision", () => {
    const result = compileAuthoritativeEvents({
      tenantId: "tenant-a",
      businessDate: "2026-08-30",
      candidates: [
        base,
        {
          ...base,
          sourceKey: "cleancloud:45",
          source: "cleancloud",
          sourceEvidence: { economicEventKey: "cleancloud:45" },
        },
      ],
    });
    expect(result.events.map(event => event.revenueSource)).toEqual(["stripe"]);
    expect(result.exclusions[0]?.reason).toBe(
      "possible_cross_source_duplicate"
    );
  });

  it("awards a stale-slug order to the tower its own address names", () => {
    // 14 paid production orders carry an OPUS slug against a CPE address.
    const result = compileAuthoritativeEvents({
      tenantId: "tenant-a",
      businessDate: "2026-08-30",
      candidates: [
        {
          ...base,
          address: "2170 Century Park East, Los Angeles, CA 90067",
          buildingSlug: "opusla",
        },
      ],
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.buildingId).toBe("century_park_east");
  });

  it("keeps an uncontradicted OPUS order on OPUS", () => {
    const result = compileAuthoritativeEvents({
      tenantId: "tenant-a",
      businessDate: "2026-08-30",
      candidates: [base],
    });
    expect(result.events[0]?.buildingId).toBe("opus_la");
  });

  it("excludes unresolved building evidence instead of guessing", () => {
    const result = compileAuthoritativeEvents({
      tenantId: "tenant-a",
      businessDate: "2026-08-30",
      candidates: [{ ...base, address: "Unknown", buildingSlug: null }],
    });
    expect(result.events).toEqual([]);
    expect(result.exclusions[0]?.reason).toBe("unresolved_building");
  });
});
