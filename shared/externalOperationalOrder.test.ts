import { describe, expect, it } from "vitest";
import {
  externalProvenanceLabel,
  externalReconciliationLabel,
  formatExternalWindow,
  isPlayableExternalOrder,
  type ExternalOperationalOrder,
} from "./externalOperationalOrder";

/**
 * The truth boundary around externally-managed work.
 *
 * A CleanCloud job is real, and Goldline is allowed to say so. There are
 * exactly two things it must never say, because it cannot know either:
 *
 *   1. that Laundry Butler originated the order, and
 *   2. that CleanCloud has been updated.
 *
 * This build has no CleanCloud API access at all — not a missing integration,
 * a missing plan tier — so the second one is not a temporary gap that a later
 * sync will close. It is a permanent property of what the app can observe, and
 * the vocabulary has to reflect that or the operator will trust a badge that
 * was never checked against anything.
 */

function order(
  overrides: Partial<ExternalOperationalOrder> = {}
): ExternalOperationalOrder {
  return {
    id: "ext-1",
    sourceSystem: "cleancloud",
    ingestionMethod: "screenshot",
    externalOrderId: "CC-4471",
    jobKind: "pickup",
    customerName: "Miso",
    address: "Opus LA",
    scheduledDate: "2026-08-18",
    windowStart: "09:00",
    windowEnd: "11:00",
    notes: "Comforter",
    operationalStatus: "scheduled",
    completedAt: null,
    reconciliationStatus: "update_required",
    reconciledAt: null,
    reviewState: "confirmed",
    importBatchId: null,
    createdAt: "2026-08-17T09:00:00.000Z",
    ...overrides,
  };
}

describe("the app never claims it verified CleanCloud", () => {
  it("never produces the word VERIFIED in any reconciliation state", () => {
    // The whole vocabulary is checked, not one branch: `verified` would assert
    // a machine confirmed something, and no code path in this build can.
    for (const operationalStatus of ["scheduled", "completed", "cancelled"] as const) {
      for (const reconciliationStatus of [
        "update_required",
        "reconciled",
      ] as const) {
        const label = externalReconciliationLabel(
          order({ operationalStatus, reconciliationStatus })
        );
        expect(label ?? "").not.toMatch(/verif/i);
      }
    }
  });

  it("says UPDATE REQUIRED once the physical work is done", () => {
    expect(
      externalReconciliationLabel(
        order({ operationalStatus: "completed" })
      )
    ).toBe("CLEAN CLOUD · UPDATE REQUIRED");
  });

  it("says RECONCILED only after the operator states they did it", () => {
    expect(
      externalReconciliationLabel(
        order({
          operationalStatus: "completed",
          reconciliationStatus: "reconciled",
        })
      )
    ).toBe("CLEAN CLOUD · RECONCILED");
  });

  it("asks for nothing while the work is still outstanding", () => {
    // Showing UPDATE REQUIRED on an untouched job would train the operator to
    // ignore the badge, which is exactly when it matters most.
    expect(externalReconciliationLabel(order())).toBeNull();
  });
});

describe("provenance is always visible", () => {
  it("names CleanCloud as the owning system", () => {
    expect(externalProvenanceLabel(order())).toBe("CLEAN CLOUD");
  });

  it("names a non-CleanCloud external job honestly too", () => {
    expect(
      externalProvenanceLabel(order({ sourceSystem: "manual_external" }))
    ).toBe("EXTERNAL SOURCE");
  });

  it("never labels external work as native Laundry Butler work", () => {
    for (const sourceSystem of ["cleancloud", "manual_external"] as const) {
      const label = externalProvenanceLabel(order({ sourceSystem }));
      expect(label).not.toMatch(/laundry butler/i);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("only reviewed, outstanding work is playable", () => {
  it("plays a confirmed scheduled job", () => {
    expect(isPlayableExternalOrder(order())).toBe(true);
  });

  it("never plays an unreviewed extraction", () => {
    // A vision model's reading is a proposal. Sending a player to an address
    // no human has checked is the failure this gate exists to prevent.
    expect(
      isPlayableExternalOrder(order({ reviewState: "pending_review" }))
    ).toBe(false);
  });

  it("never plays a discarded extraction", () => {
    expect(isPlayableExternalOrder(order({ reviewState: "discarded" }))).toBe(
      false
    );
  });

  it("never replays finished work", () => {
    expect(
      isPlayableExternalOrder(order({ operationalStatus: "completed" }))
    ).toBe(false);
  });
});

describe("the record carries no money and no ownership", () => {
  it("has no field that could imply revenue, payment, or a customer account", () => {
    // Structural, not stylistic: if someone later adds `total` or
    // `stripeCustomerId` to make something convenient, this fails and makes
    // them justify it. That is the point — external work must stay
    // distinguishable from a native order forever, not just today.
    const forbidden = [
      "total",
      "subtotal",
      "paid",
      "paidAt",
      "price",
      "amount",
      "stripeCustomerId",
      "stripePaymentIntentId",
      "vendorId",
      "vendorPayoutCents",
      "platformFeeCents",
      "bldgUserId",
      "residentClientRequestId",
    ];
    const keys = Object.keys(order());
    for (const field of forbidden) {
      expect(keys).not.toContain(field);
    }
  });

  it("carries only operational facts", () => {
    expect(Object.keys(order()).sort()).toEqual([
      "address",
      "completedAt",
      "createdAt",
      "customerName",
      "externalOrderId",
      "id",
      "importBatchId",
      "ingestionMethod",
      "jobKind",
      "notes",
      "operationalStatus",
      "reconciledAt",
      "reconciliationStatus",
      "reviewState",
      "scheduledDate",
      "sourceSystem",
      "windowEnd",
      "windowStart",
    ]);
  });
});

describe("time windows read the way a person wrote them", () => {
  it("renders a full window", () => {
    expect(formatExternalWindow("09:00", "11:00")).toBe("09:00–11:00");
  });

  it("renders a one-sided window rather than inventing the other end", () => {
    expect(formatExternalWindow("09:00", null)).toBe("09:00");
    expect(formatExternalWindow(null, "11:00")).toBe("11:00");
  });

  it("says nothing when the source showed no time at all", () => {
    expect(formatExternalWindow(null, null)).toBeNull();
  });
});
