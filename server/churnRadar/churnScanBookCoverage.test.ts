import { describe, expect, it } from "vitest";
import type { BusinessSourceCoverageSnapshot } from "../analytics/sourceCoverage";
import { churnScanBookCoverage } from "./customerChurnService";

function snapshot(input: {
  cleanCloudHeld: boolean;
  bookStatus?: "fresh" | "stale" | "partial" | "unavailable";
}): BusinessSourceCoverageSnapshot {
  const bookStatus = input.bookStatus ?? "fresh";
  const current = bookStatus === "fresh";
  return {
    contractVersion: 1,
    tenantId: "tenant-a",
    checkedAt: "2026-09-24T20:00:00.000Z",
    timeZone: "America/Los_Angeles",
    sources: [
      {
        sourceId: "laundry_butler",
        name: "Laundry Butler",
        type: "native_orders",
        availability: "available",
        includedInCombinedBook: true,
        status: "fresh",
        lastSuccessfulAssimilationAt: null,
        assimilationKind: "not_applicable",
        coveredThrough: null,
        provenFrom: null,
        expectedThrough: null,
        records: "readable",
        supportsExhaustiveCurrentClaim: true,
        emptyReadMeansNoRecords: false,
        reason: "system of record",
        provenance: {
          bindingState: "bound",
          schedule: "system_of_record",
          coverageBasis: null,
          receiptProvenance: null,
          paymentEventsProven: false,
          decidedBy: "deterministic_rules",
        },
      },
      {
        sourceId: "cleancloud",
        name: "CleanCloud",
        type: "cleancloud_paid_book",
        availability: input.cleanCloudHeld ? "available" : "not_held",
        includedInCombinedBook: input.cleanCloudHeld,
        status: input.cleanCloudHeld ? bookStatus : "unavailable",
        lastSuccessfulAssimilationAt: current ? "2026-09-24T18:00:00.000Z" : null,
        assimilationKind: current ? "customer_truth_refreshed" : "never",
        coveredThrough: current ? "2026-09-24" : null,
        provenFrom: current ? "2026-09-01" : null,
        expectedThrough: input.cleanCloudHeld ? "2026-09-24" : null,
        records: input.cleanCloudHeld ? "readable" : "unknown",
        supportsExhaustiveCurrentClaim: input.cleanCloudHeld && current,
        emptyReadMeansNoRecords: false,
        reason: input.cleanCloudHeld ? "held" : "not held",
        provenance: {
          bindingState: input.cleanCloudHeld ? "bound" : "absent",
          schedule: input.cleanCloudHeld
            ? "gumball_daily_18_america_los_angeles"
            : "none",
          coverageBasis: input.cleanCloudHeld ? "orders_created" : null,
          receiptProvenance: input.cleanCloudHeld ? "browser_sync_receipt" : null,
          paymentEventsProven: input.cleanCloudHeld && current,
          decidedBy: "deterministic_rules",
        },
      },
    ],
    book: {
      status: bookStatus,
      exhaustiveCurrent: current,
      current,
      scope: {
        native: "system_of_record",
        cleancloudOrdersCreated: input.cleanCloudHeld && current
          ? { from: "2026-09-01", through: "2026-09-24" }
          : null,
        cleancloudEconomicEvents: null,
      },
      paymentEventsProven: false,
      knownRecordsReadable: true,
      interpretEmptyAsNoCustomers: false,
      outsideProvenSpan: "unknown_not_empty",
      allCustomersLicensed: false,
      staleIsZero: false,
      missingIsNoCustomers: false,
    },
    blockingSources:
      input.cleanCloudHeld && !current
        ? [{ sourceId: "cleancloud", status: bookStatus, reason: "behind" }]
        : [],
  };
}

describe("Churn Radar customer-book scope", () => {
  it("never calls a native-only scan the whole book when CleanCloud is held", () => {
    const result = churnScanBookCoverage(
      snapshot({ cleanCloudHeld: true, bookStatus: "fresh" })
    );
    expect(result.wholeBookCurrent).toBe(false);
    expect(result.claim).toBe("known_native_candidates");
    expect(result.cleanCloudHeld).toBe(true);
  });

  it("surfaces stale CleanCloud rather than calling missing history zero", () => {
    const result = churnScanBookCoverage(
      snapshot({ cleanCloudHeld: true, bookStatus: "stale" })
    );
    expect(result.wholeBookCurrent).toBe(false);
    expect(result.bookStatus).toBe("stale");
    expect(result.blockingSources).toEqual([
      expect.objectContaining({ sourceId: "cleancloud", status: "stale" }),
    ]);
  });

  it("can call the scan current only when native is the sole held source", () => {
    const result = churnScanBookCoverage(
      snapshot({ cleanCloudHeld: false, bookStatus: "fresh" })
    );
    expect(result.wholeBookCurrent).toBe(true);
    expect(result.claim).toBe("current_native_book");
    expect(result.cleanCloudStatus).toBe("not_held");
  });

  it("fails closed when coverage cannot be read", () => {
    expect(churnScanBookCoverage(null)).toMatchObject({
      wholeBookCurrent: false,
      claim: "known_native_candidates",
      bookStatus: null,
    });
  });
});
