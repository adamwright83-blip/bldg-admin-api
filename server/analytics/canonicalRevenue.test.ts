import { describe, expect, it } from "vitest";
import { speakBusinessResult } from "../claire/business/businessSpeech";
import { FIXTURE_NOW, FIXTURE_TZ, fixtureCompleteness } from "./businessLedgerFixture";
import { defaultBusinessQuery, runBusinessQuery, type BusinessQueryDeps } from "./businessQuery";
import {
  readCanonicalRevenue,
  reconcilePaidRevenue,
  type BusinessSourceCoverageSeam,
} from "./canonicalRevenue";
import {
  loadPaidOrderLedger,
  type CleanCloudOrderRow,
  type LedgerLoaders,
  type NativeOrderRow,
  type PaidOrderEvent,
} from "./paidOrderLedger";

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

function freshCoverage(): BusinessSourceCoverageSeam {
  return {
    sources: [
      { source: "laundry_butler", coverageStatus: "fresh", lastSuccessfulAssimilation: "2026-09-14T18:00:00.000Z", provenance: "b1-seam" },
      { source: "cleancloud", coverageStatus: "fresh", lastSuccessfulAssimilation: "2026-09-14T18:00:00.000Z", provenance: "b1-seam" },
    ],
  };
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
  it("counts a native-only book", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: freshCoverage(),
      loaders: loaders([native(1, "12.00", "3105550100")], []),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.exactIncludedCents).toBe(1200);
    expect(result.exactIncludedOrderCount).toBe(1);
    expect(result.provenance.sources).toEqual(["laundry_butler"]);
    expect(result.precision).toBe("definitive");
    expect(result.coverage.cleanCloudFresh).toBe(true);
  });

  it("counts a CleanCloud-only book", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: freshCoverage(),
      loaders: loaders([], [cleancloud("cc-1", 8000, "3105550199")]),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.exactIncludedCents).toBe(8000);
    expect(result.provenance.sources).toEqual(["cleancloud"]);
    expect(result.definiteDuplicateExclusions.cents).toBe(0);
    expect(result.suspectedWithheld.cents).toBe(0);
  });

  it("counts a proven CleanCloud sales/revenue twin once and records the exclusion", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: freshCoverage(),
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
  });

  it("withholds a suspected cross-source duplicate from the exact total", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: freshCoverage(),
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
    expect(result.precision).toBe("exact_for_included_records");
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
      coverage: {
        sources: [
          { source: "laundry_butler", coverageStatus: "fresh", lastSuccessfulAssimilation: null, provenance: "b1-seam" },
          { source: "cleancloud", coverageStatus: "stale", lastSuccessfulAssimilation: "2026-09-01T00:00:00.000Z", provenance: "b1-seam" },
        ],
      },
      loaders: loaders([], [cleancloud("cc-1", 8000, "3105550199")]),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.exactIncludedCents).toBe(8000);
    expect(result.exactIncludedCents).not.toBe(0);
    expect(result.coverage.incompleteForWindow).toBe(true);
    expect(result.coverage.cleanCloudFresh).toBe(false);
    expect(result.coverage.affectedSources).toContain("cleancloud");
    expect(result.precision).toBe("exact_for_included_records");
  });

  it("keeps recorded revenue under partial coverage and when a source fails to load", async () => {
    const partialSeam = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      coverage: {
        sources: [
          { source: "laundry_butler", coverageStatus: "fresh", lastSuccessfulAssimilation: null, provenance: "b1-seam" },
          { source: "cleancloud", coverageStatus: "partial", lastSuccessfulAssimilation: null, provenance: "b1-seam" },
        ],
      },
      loaders: loaders([native(1, "30.00", "3105550100")], [cleancloud("cc-1", 2000, "3105550199")]),
    });
    expect(partialSeam.status).toBe("ok");
    if (partialSeam.status !== "ok") return;
    expect(partialSeam.exactIncludedCents).toBe(5000);
    expect(partialSeam.coverage.incompleteForWindow).toBe(true);
    expect(partialSeam.coverage.cleanCloudFresh).toBe(false);

    const failed = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
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
    expect(failed.coverage.failedSources).toEqual(["cleancloud"]);
    expect(failed.coverage.incompleteForWindow).toBe(true);
    expect(failed.coverage.cleanCloudFresh).toBe(false);
    expect(failed.coverage.contract).toBe("uncontracted");
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
      readCanonicalRevenue({ tenantId: "tenant-a", ...WINDOW, timeZone: FIXTURE_TZ, coverage: freshCoverage(), loaders: tenantLoaders }),
      readCanonicalRevenue({ tenantId: "tenant-b", ...WINDOW, timeZone: FIXTURE_TZ, coverage: freshCoverage(), loaders: tenantLoaders }),
    ]);
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ok");
    if (a.status !== "ok" || b.status !== "ok") return;
    expect(a.exactIncludedCents).toBe(1111);
    expect(b.exactIncludedCents).toBe(2222);
    expect(a.provenance.includedEventKeys).toEqual(["order:1"]);
    expect(b.provenance.includedEventKeys).toEqual(["order:2"]);
  });

  it("does not call CleanCloud fresh when B1 has not supplied coverage", async () => {
    const result = await readCanonicalRevenue({
      tenantId: "tenant-a",
      ...WINDOW,
      timeZone: FIXTURE_TZ,
      loaders: loaders([], [cleancloud("cc-1", 8000, "3105550199")]),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.coverage.contract).toBe("uncontracted");
    expect(result.coverage.cleanCloudFresh).toBe(false);
    expect(result.precision).toBe("exact_for_included_records");
    expect(result.exactIncludedCents).toBe(8000);
  });
});

describe("Claire revenue consumes the canonical read", () => {
  function deps(rows: LedgerLoaders, coverage: BusinessSourceCoverageSeam | null = null): BusinessQueryDeps {
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
      deps(loaders([], [cleancloud("cc-1", 8000, "3105550199")]), {
        sources: [
          { source: "laundry_butler", coverageStatus: "fresh", lastSuccessfulAssimilation: null, provenance: "b1-seam" },
          { source: "cleancloud", coverageStatus: "stale", lastSuccessfulAssimilation: "2026-09-01T00:00:00.000Z", provenance: "b1-seam" },
        ],
      })
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok" || result.data.kind !== "totals") throw new Error("unexpected");
    expect(result.data.current.revenueCents).toBe(8000);
    expect(result.coverage?.canonicalRevenue).toMatchObject({
      exactIncludedCents: 8000,
      incompleteForWindow: true,
      cleanCloudFresh: false,
      contract: "supplied",
      precision: "exact_for_included_records",
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
    expect(spoken.text).toContain("Source coverage is incomplete for this window");
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
});
