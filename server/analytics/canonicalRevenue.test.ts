import { describe, expect, it } from "vitest";
import { speakBusinessResult } from "../claire/business/businessSpeech";
import { FIXTURE_NOW, FIXTURE_TZ, fixtureCompleteness } from "./businessLedgerFixture";
import { defaultBusinessQuery, runBusinessQuery, type BusinessQueryDeps } from "./businessQuery";
import {
  interpretSourceCoverage,
  readCanonicalRevenue,
  reconcilePaidRevenue,
} from "./canonicalRevenue";
import {
  loadPaidOrderLedger,
  type CleanCloudOrderRow,
  type LedgerLoaders,
  type NativeOrderRow,
  type PaidOrderEvent,
} from "./paidOrderLedger";
import type {
  BusinessSourceCoverage,
  BusinessSourceCoverageSnapshot,
  SourceCoverageStatus,
} from "./sourceCoverage";

const WINDOW = { from: "2026-09-01", to: "2026-09-14" };
const PAID_AT = new Date("2026-09-10T19:00:00.000Z");

function native(id: number, dollars: string, phone: string, extra: Partial<NativeOrderRow> = {}): NativeOrderRow {
  return {
    id,
    paid: true,
    paidAt: PAID_AT,
    total: dollars,
    stripePaymentIntentId: `pi_${id}`,
    serviceType: "wash_fold",
    firstName: "Ada",
    lastName: "Lane",
    phone,
    email: null,
    bldgUserId: null,
    ...extra,
  };
}

function cleancloud(
  id: string,
  cents: number,
  phone: string,
  extra: Partial<CleanCloudOrderRow> = {}
): CleanCloudOrderRow {
  return {
    cleancloudOrderId: id,
    cleancloudCustomerId: null,
    sourceReportType: "orders_sales",
    paymentDateUtc: PAID_AT,
    paidDateUtc: null,
    paid: true,
    totalCents: cents,
    customerName: "Ada Lane",
    customerPhone: phone,
    customerEmail: null,
    ...extra,
  };
}

function loaders(nativeRows: NativeOrderRow[], cleancloudRows: CleanCloudOrderRow[]): LedgerLoaders {
  return {
    laundry_butler: async () => nativeRows,
    cleancloud: async () => cleancloudRows,
  };
}

function source(
  sourceId: "laundry_butler" | "cleancloud",
  status: SourceCoverageStatus,
  held = true
): BusinessSourceCoverage {
  return {
    sourceId,
    name: sourceId === "cleancloud" ? "CleanCloud" : "Laundry Butler",
    type: sourceId === "cleancloud" ? "cleancloud_paid_book" : "native_orders",
    availability: held ? "available" : "not_held",
    includedInCombinedBook: held,
    status,
    lastSuccessfulAssimilationAt: sourceId === "cleancloud" && status === "fresh" ? "2026-09-14T18:00:00.000Z" : null,
    assimilationKind: sourceId === "cleancloud" ? "customer_truth_refreshed" : "not_applicable",
    coveredThrough: sourceId === "cleancloud" && held ? "2026-09-14" : null,
    provenFrom: sourceId === "cleancloud" && held ? "2026-01-01" : null,
    expectedThrough: sourceId === "cleancloud" && held ? "2026-09-14" : null,
    records: "readable",
    supportsExhaustiveCurrentClaim: status === "fresh",
    emptyReadMeansNoRecords: false,
    reason: "fixture",
    provenance: {
      bindingState: held ? "bound" : "absent",
      schedule: sourceId === "cleancloud" ? "gumball_daily_18_america_los_angeles" : "system_of_record",
      coverageBasis: "economic_event",
      receiptProvenance: "test_fixture",
      paymentEventsProven: status === "fresh",
      decidedBy: "deterministic_rules",
    },
  };
}

function coverageSnapshot(input: {
  native?: SourceCoverageStatus;
  cleancloud?: SourceCoverageStatus;
  cleancloudHeld?: boolean;
  exhaustiveCurrent: boolean;
  paymentEventsProven: boolean;
  bookStatus: SourceCoverageStatus;
  span?: { from: string; through: string } | null;
}): BusinessSourceCoverageSnapshot {
  const cleancloudHeld = input.cleancloudHeld !== false;
  const sources = [
    source("laundry_butler", input.native ?? "fresh", true),
    source("cleancloud", input.cleancloud ?? "fresh", cleancloudHeld),
  ];
  return {
    contractVersion: 1,
    tenantId: "tenant-a",
    checkedAt: "2026-09-14T19:00:00.000Z",
    timeZone: "America/Los_Angeles",
    sources,
    book: {
      status: input.bookStatus,
      exhaustiveCurrent: input.exhaustiveCurrent,
      current: input.exhaustiveCurrent,
      scope: {
        native: "system_of_record",
        cleancloudOrdersCreated:
          input.span === undefined
            ? cleancloudHeld
              ? { from: "2026-01-01", through: "2026-09-14" }
              : null
            : input.span,
      },
      paymentEventsProven: input.paymentEventsProven,
      knownRecordsReadable: true,
      interpretEmptyAsNoCustomers: false,
      outsideProvenSpan: "unknown_not_empty",
      allCustomersLicensed: false,
      staleIsZero: false,
      missingIsNoCustomers: false,
    },
    blockingSources: sources
      .filter(item => item.includedInCombinedBook && item.status !== "fresh")
      .map(item => ({ sourceId: item.sourceId, status: item.status, reason: item.reason })),
  };
}

function exactPaymentCoverage(): BusinessSourceCoverageSnapshot {
  return coverageSnapshot({
    exhaustiveCurrent: true,
    paymentEventsProven: true,
    bookStatus: "fresh",
  });
}

function event(partial: Pick<PaidOrderEvent, "source" | "eventKey" | "cents" | "businessDate"> & Partial<PaidOrderEvent>): PaidOrderEvent {
  return {
    occurredAt: PAID_AT,
    serviceType: null,
    customerName: "Ada Lane",
    identity: { phone: "3105550100" },
    ...partial,
  };
}

describe("readCanonicalRevenue", () => {
  it("states a fully proven book as exact", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: exactPaymentCoverage(),
      loaders: loaders([native(1, "12.00", "3105550100")], []),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.exactIncludedCents).toBe(1200);
    expect(result.exactIncludedOrderCount).toBe(1);
    expect(result.provenance.sources).toEqual(["laundry_butler"]);
    expect(result.recordedCents).toBe(1200);
    expect(result.statedExactCents).toBe(1200);
    expect(result.mayStateExact).toBe(true);
    expect(result.precision).toBe("exact");
    expect(result.coverage.coverageAllowsExact).toBe(true);
    expect(result.coverage.cleanCloudFresh).toBe(true);
    expect("exactRevenueLicensed" in result.coverage).toBe(false);
  });

  it("states a proven complete empty period as exact zero", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: exactPaymentCoverage(),
      loaders: loaders([], []),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.recordedCents).toBe(0);
    expect(result.exactIncludedOrderCount).toBe(0);
    expect(result.statedExactCents).toBe(0);
    expect(result.mayStateExact).toBe(true);
    expect(result.precision).toBe("exact");
  });

  it("does not turn an unreadable coverage contract into a zero", async () => {
    const unread = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: null,
      loaders: {
        laundry_butler: async () => {
          throw new Error("down");
        },
        cleancloud: async () => {
          throw new Error("down");
        },
      },
    });
    expect(unread.status).toBe("unavailable");
    if (unread.status !== "unavailable") return;
    expect(unread.exactIncludedCents).toBeNull();
    expect(unread.coverage.coverageAllowsExact).toBe(false);
  });

  it("counts a CleanCloud-only book", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: exactPaymentCoverage(),
      loaders: loaders([], [cleancloud("cc-1", 8000, "3105550199")]),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.exactIncludedCents).toBe(8000);
    expect(result.provenance.sources).toEqual(["cleancloud"]);
    expect(result.definiteDuplicateExclusions.cents).toBe(0);
    expect(result.suspectedWithheld.cents).toBe(0);
    expect(result.statedExactCents).toBe(8000);
    expect(result.mayStateExact).toBe(true);
    expect(result.precision).toBe("exact");
  });

  it("counts a proven CleanCloud sales/revenue twin once and records the exclusion", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: exactPaymentCoverage(),
      loaders: loaders(
        [],
        [
          cleancloud("cc-1", 5000, "3105550100"),
          cleancloud("cc-1", 5000, "3105550100", {
            sourceReportType: "orders_revenue",
            paymentDateUtc: null,
            paidDateUtc: PAID_AT,
          }),
        ]
      ),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.exactIncludedCents).toBe(5000);
    expect(result.exactIncludedCents).not.toBe(10000);
    expect(result.definiteDuplicateExclusions).toMatchObject({ count: 1, cents: 5000 });
    expect(result.suspectedWithheld.cents).toBe(0);
    expect(result.statedExactCents).toBe(5000);
    expect(result.mayStateExact).toBe(true);
    expect(result.precision).toBe("exact");
  });

  it("withholds a suspected cross-source duplicate from the exact total", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: exactPaymentCoverage(),
      loaders: loaders(
        [native(1, "45.00", "3105550100")],
        [cleancloud("cc-1", 4500, "+1 310 555 0100"), cleancloud("cc-2", 9900, "3105550100")]
      ),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.exactIncludedCents).toBe(4500 + 9900);
    expect(result.suspectedWithheld).toMatchObject({ count: 1, cents: 4500 });
    expect(result.exactIncludedCents).not.toBe(4500 + 4500 + 9900);
    expect(result.statedExactCents).toBeNull();
    expect(result.mayStateExact).toBe(false);
    expect(result.precision).toBe("recorded_only");
    expect(result.recordedCents).toBe(4500 + 9900);
  });

  it("counts clearly distinct same-day orders in full", () => {
    const reconciled = reconcilePaidRevenue({
      events: [
        event({ source: "laundry_butler", eventKey: "order:1", cents: 4500, businessDate: "2026-09-10" }),
        event({ source: "cleancloud", eventKey: "cleancloud:y", cents: 9900, businessDate: "2026-09-10" }),
      ],
    });
    expect(reconciled.exactIncludedCents).toBe(14400);
    expect(reconciled.suspectedWithheld.count).toBe(0);
    expect(reconciled.definiteDuplicateExclusions.count).toBe(0);
  });

  it("treats an explicit economic link as a proven duplicate, counted once", () => {
    const reconciled = reconcilePaidRevenue({
      events: [
        event({ source: "laundry_butler", eventKey: "order:1", cents: 4500, businessDate: "2026-09-10" }),
        event({ source: "cleancloud", eventKey: "cleancloud:x", cents: 4500, businessDate: "2026-09-10" }),
      ],
      explicitEconomicLinks: [{ keptEventKey: "order:1", excludedEventKey: "cleancloud:x" }],
    });
    expect(reconciled.exactIncludedCents).toBe(4500);
    expect(reconciled.definiteDuplicateExclusions).toMatchObject({
      count: 1,
      cents: 4500,
      items: [{ reason: "explicit_economic_link" }],
    });
    expect(reconciled.suspectedWithheld.count).toBe(0);
  });

  it("keeps recorded revenue when CleanCloud coverage is stale and does not call it fresh", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: coverageSnapshot({
        cleancloud: "stale",
        bookStatus: "partial",
        exhaustiveCurrent: false,
        paymentEventsProven: false,
      }),
      loaders: loaders([], [cleancloud("cc-1", 8000, "3105550199")]),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.exactIncludedCents).toBe(8000);
    expect(result.exactIncludedCents).not.toBe(0);
    expect(result.coverage.incompleteForWindow).toBe(true);
    expect(result.coverage.cleanCloudFresh).toBe(false);
    expect(result.coverage.affectedSources).toContain("cleancloud");
    expect(result.statedExactCents).toBeNull();
    expect(result.mayStateExact).toBe(false);
    expect(result.coverage.coverageAllowsExact).toBe(false);
    expect(result.coverage.staleIsZero).toBe(false);
    expect(result.precision).toBe("recorded_only");
  });

  it("keeps recorded revenue under partial coverage and when a source fails to load", async () => {
    const partialSeam = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: coverageSnapshot({
        cleancloud: "partial",
        bookStatus: "partial",
        exhaustiveCurrent: false,
        paymentEventsProven: false,
      }),
      loaders: loaders([native(1, "30.00", "3105550100")], [cleancloud("cc-1", 2000, "3105550199")]),
    });
    expect(partialSeam.status).toBe("ok");
    if (partialSeam.status !== "ok") return;
    expect(partialSeam.exactIncludedCents).toBe(5000);
    expect(partialSeam.mayStateExact).toBe(false);
    expect(partialSeam.statedExactCents).toBeNull();
    expect(partialSeam.coverage.incompleteForWindow).toBe(true);
    expect(partialSeam.coverage.cleanCloudFresh).toBe(false);

    const failed = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: null,
      loaders: {
        laundry_butler: async () => [native(1, "30.00", "3105550100")],
        cleancloud: async () => {
          throw new Error("cleancloud unread");
        },
      },
    });
    expect(failed.status).toBe("ok");
    if (failed.status !== "ok") return;
    expect(failed.exactIncludedCents).toBe(3000);
    expect(failed.exactIncludedCents).not.toBe(0);
    expect(failed.statedExactCents).toBeNull();
    expect(failed.mayStateExact).toBe(false);
    expect(failed.coverage.failedSources).toEqual(["cleancloud"]);
    expect(failed.coverage.incompleteForWindow).toBe(true);
    expect(failed.coverage.cleanCloudFresh).toBe(false);
    expect(failed.coverage.snapshotRead).toBe(false);
  });

  it("does not treat an unread book as exact zero", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      loaders: {
        laundry_butler: async () => {
          throw new Error("down");
        },
        cleancloud: async () => {
          throw new Error("down");
        },
      },
    });
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.exactIncludedCents).toBeNull();
  });

  it("isolates tenants", async () => {
    const tenantLoaders: LedgerLoaders = {
      laundry_butler: async window =>
        window.tenantId === "tenant-a" ? [native(1, "11.11", "3105550101")] : [native(2, "22.22", "3105550102")],
      cleancloud: async () => [],
    };
    const [a, b] = await Promise.all([
      readCanonicalRevenue({ tenantId: "tenant-a", ...WINDOW, timeZone: FIXTURE_TZ, coverage: exactPaymentCoverage(), loaders: tenantLoaders }),
      readCanonicalRevenue({ tenantId: "tenant-b", ...WINDOW, timeZone: FIXTURE_TZ, coverage: exactPaymentCoverage(), loaders: tenantLoaders }),
    ]);
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status !== "ok" || b.status !== "ok") return;
    expect(a.exactIncludedCents).toBe(1111);
    expect(b.exactIncludedCents).toBe(2222);
    expect(a.mayStateExact).toBe(true);
    expect(a.statedExactCents).toBe(1111);
    expect(b.mayStateExact).toBe(true);
    expect(b.statedExactCents).toBe(2222);
    expect(a.provenance.includedEventKeys).toEqual(["order:1"]);
    expect(b.provenance.includedEventKeys).toEqual(["order:2"]);
  });

  it("does not state an exact total when payment events are not proven", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: coverageSnapshot({
        bookStatus: "fresh",
        exhaustiveCurrent: true,
        paymentEventsProven: false,
      }),
      loaders: loaders([], [cleancloud("cc-1", 8000, "3105550199")]),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.recordedCents).toBe(8000);
    expect(result.statedExactCents).toBeNull();
    expect(result.mayStateExact).toBe(false);
    expect(result.coverage.paymentEventsProven).toBe(false);
    expect(result.coverage.coverageAllowsExact).toBe(false);
    expect(result.coverage.cleanCloudFresh).toBe(true);
  });

  it("does not call CleanCloud fresh when the coverage contract cannot be read", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: null,
      loaders: loaders([], [cleancloud("cc-1", 8000, "3105550199")]),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.coverage.snapshotRead).toBe(false);
    expect(result.coverage.cleanCloudFresh).toBe(false);
    expect(result.statedExactCents).toBeNull();
    expect(result.mayStateExact).toBe(false);
    expect(result.precision).toBe("recorded_only");
    expect(result.exactIncludedCents).toBe(8000);
  });

  it("does not state exact when the window is outside the proven span", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: coverageSnapshot({
        exhaustiveCurrent: true,
        paymentEventsProven: true,
        bookStatus: "fresh",
        span: { from: "2026-01-01", through: "2026-08-31" },
      }),
      loaders: loaders([], [cleancloud("cc-1", 8000, "3105550199")]),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.recordedCents).toBe(8000);
    expect(result.recordedCents).not.toBe(0);
    expect(result.statedExactCents).toBeNull();
    expect(result.mayStateExact).toBe(false);
    expect(result.precision).toBe("recorded_only");
  });

  it("does not state exact while an unverified native paid row is unresolved", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: exactPaymentCoverage(),
      loaders: loaders(
        [native(1, "12.00", "3105550100"), native(2, "40.00", "3105550101", { stripePaymentIntentId: null })],
        []
      ),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.exactIncludedCents).toBe(1200);
    expect(result.unverifiedNative).toMatchObject({ count: 1, cents: 4000 });
    expect(result.recordedCents).toBe(1200);
    expect(result.recordedCents).not.toBe(0);
    expect(result.statedExactCents).toBeNull();
    expect(result.mayStateExact).toBe(false);
    expect(result.precision).toBe("recorded_only");
  });

  it("does not allow exact when a held source was not read", () => {
    const coverage = interpretSourceCoverage({
      snapshot: exactPaymentCoverage(),
      window: WINDOW,
      loadedSources: ["laundry_butler"],
      failedSources: [],
    });
    expect(coverage.coverageAllowsExact).toBe(false);
    expect(coverage.incompleteForWindow).toBe(true);
    expect(coverage.paymentEventsProven).toBe(true);
  });
});

describe("Claire revenue consumes the canonical read", () => {
  function deps(rows: LedgerLoaders, coverage: BusinessSourceCoverageSnapshot | null = null): BusinessQueryDeps {
    return {
      loadLedger: input => loadPaidOrderLedger(input, rows),
      loadOpenOrders: async () => ({ openTotal: 0, byStatus: {}, awaitingPayment: 0 }),
      loadCompleteness: async () => fixtureCompleteness,
      readSourceCoverage: async () => coverage,
      now: () => FIXTURE_NOW,
      timeZone: () => FIXTURE_TZ,
    };
  }

  it("states the exact included cents and says stale coverage is incomplete without zeroing revenue", async () => {
    const result = await runBusinessQuery(
      "tenant-a",
      defaultBusinessQuery("revenue"),
      deps(
        loaders([], [cleancloud("cc-1", 8000, "3105550199")]),
        coverageSnapshot({
          cleancloud: "stale",
          bookStatus: "partial",
          exhaustiveCurrent: false,
          paymentEventsProven: false,
        })
      )
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok" || result.data.kind !== "totals") throw new Error("unexpected");
    expect(result.data.current.revenueCents).toBe(8000);
    expect(result.coverage?.canonicalRevenue).toMatchObject({
      exactIncludedCents: 8000,
      recordedCents: 8000,
      statedExactCents: null,
      mayStateExact: false,
      incompleteForWindow: true,
      cleanCloudFresh: false,
      contractVersion: 1,
      precision: "recorded_only",
    });
    const spoken = speakBusinessResult(result, {
      surface: "text",
      previous: null,
      refinement: false,
      utterance: "What was revenue?",
      today: "2026-09-14",
      disclosed: [],
      timeZone: FIXTURE_TZ,
    });
    expect(spoken.text).toContain("$80.00");
    expect(spoken.text).toContain("Source coverage does not support an exact total for this window");
    expect(spoken.text).not.toContain("$0.00");
  });

  it("does not speak a suspected duplicate as part of the exact total", async () => {
    const result = await runBusinessQuery(
      "tenant-a",
      defaultBusinessQuery("revenue"),
      deps(
        loaders(
          [native(1, "45.00", "3105550100")],
          [cleancloud("cc-1", 4500, "3105550100")]
        )
      )
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok" || result.data.kind !== "totals") throw new Error("unexpected");
    expect(result.data.current.revenueCents).toBe(4500);
    expect(result.coverage?.canonicalRevenue?.suspectedWithheldCents).toBe(4500);
    const spoken = speakBusinessResult(result, {
      surface: "text",
      previous: null,
      refinement: false,
      utterance: "What was revenue?",
      today: "2026-09-14",
      disclosed: [],
      timeZone: FIXTURE_TZ,
    });
    expect(spoken.text).toContain("$45.00");
    expect(spoken.text).toContain("I withheld");
    expect(spoken.text).not.toContain("$90.00");
  });

  it("speaks a proven book as the canonical cents without denying exactness", async () => {
    const result = await runBusinessQuery(
      "tenant-a",
      defaultBusinessQuery("revenue"),
      deps(loaders([native(1, "12.00", "3105550100")], []), exactPaymentCoverage())
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok" || result.data.kind !== "totals") throw new Error("unexpected");
    expect(result.data.current.revenueCents).toBe(1200);
    expect(result.coverage?.canonicalRevenue).toMatchObject({
      statedExactCents: 1200,
      mayStateExact: true,
      precision: "exact",
    });
    const spoken = speakBusinessResult(result, {
      surface: "text",
      previous: null,
      refinement: false,
      utterance: "What was revenue?",
      today: "2026-09-14",
      disclosed: [],
      timeZone: FIXTURE_TZ,
    });
    expect(spoken.text).toContain("$12.00");
    expect(spoken.text).not.toContain("Source coverage does not support an exact total for this window");
  });

  it("speaks a proven empty period as exact zero", async () => {
    const result = await runBusinessQuery(
      "tenant-a",
      defaultBusinessQuery("revenue"),
      deps(loaders([], []), exactPaymentCoverage())
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok" || result.data.kind !== "totals") throw new Error("unexpected");
    expect(result.data.current.revenueCents).toBe(0);
    expect(result.coverage?.canonicalRevenue?.statedExactCents).toBe(0);
    expect(result.coverage?.canonicalRevenue?.mayStateExact).toBe(true);
    expect(result.coverage?.canonicalRevenue?.precision).toBe("exact");
    const spoken = speakBusinessResult(result, {
      surface: "text",
      previous: null,
      refinement: false,
      utterance: "What was revenue in the last 30 days?",
      today: "2026-09-14",
      disclosed: [],
      timeZone: FIXTURE_TZ,
    });
    expect(spoken.text).toContain("$0.00 across 0 orders");
    expect(spoken.text).not.toContain("Source coverage does not support an exact total for this window");
  });

  it("does not call a narrowed service slice the exact window total", async () => {
    const result = await runBusinessQuery(
      "tenant-a",
      { ...defaultBusinessQuery("revenue"), serviceType: "wash_fold" },
      deps(loaders([native(1, "12.00", "3105550100")], []), exactPaymentCoverage())
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok" || result.data.kind !== "totals") throw new Error("unexpected");
    expect(result.data.current.revenueCents).toBe(1200);
    expect(result.coverage?.canonicalRevenue?.coverageAllowsExact).toBe(true);
    expect(result.coverage?.canonicalRevenue?.mayStateExact).toBe(false);
    expect(result.coverage?.canonicalRevenue?.precision).toBe("recorded_only");
  });
});
