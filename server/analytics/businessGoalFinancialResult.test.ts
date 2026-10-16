import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { withFixturePaymentAuthority } from "./businessLedgerFixture";
import {
  ANOTHER_FIVE_HUNDRED_DOLLARS,
  readBusinessGoalFinancialResult,
  type BusinessGoalFinancialResult,
} from "./businessGoalFinancialResult";
import type {
  CleanCloudOrderRow,
  LedgerLoaders,
  NativeOrderRow,
} from "./paidOrderLedger";
import type {
  BusinessSourceCoverage,
  BusinessSourceCoverageSnapshot,
  SourceCoverageStatus,
} from "./sourceCoverage";

const TIME_ZONE = "America/Los_Angeles";
/** Friday 16 October 2026, 13:00 in Los Angeles. The business week is Mon 12–Fri 16. */
const NOW = new Date("2026-10-16T20:00:00.000Z");
/** Wednesday 14 October 2026, 15:00 in Los Angeles. "Another $500" starts here. */
const GOAL_START = new Date("2026-10-14T22:00:00.000Z");
const TENANT = "tenant-goal";

const at = (iso: string) => new Date(iso);

function native(
  id: number,
  paidAt: string,
  total: string,
  stripe = `pi_${id}`,
  extra: Partial<NativeOrderRow> = {}
): NativeOrderRow {
  return {
    id,
    paid: true,
    paidAt: at(paidAt),
    total,
    stripePaymentIntentId: stripe,
    serviceType: "wash_fold",
    firstName: "Ada",
    lastName: "Lane",
    phone: "3105550101",
    email: null,
    bldgUserId: null,
    ...extra,
  };
}

function cleancloud(
  id: string,
  paidAt: string,
  totalCents: number
): CleanCloudOrderRow {
  return {
    cleancloudOrderId: id,
    cleancloudCustomerId: null,
    sourceReportType: "orders_sales",
    paymentDateUtc: at(paidAt),
    paidDateUtc: null,
    paid: true,
    totalCents,
    customerName: "Bea Moss",
    customerPhone: "3105550188",
    customerEmail: null,
  };
}

function loaders(
  nativeRows: NativeOrderRow[],
  cleancloudRows: CleanCloudOrderRow[]
): LedgerLoaders {
  return withFixturePaymentAuthority({
    laundry_butler: async () => nativeRows,
    cleancloud: async () => cleancloudRows,
  });
}

function source(
  sourceId: "laundry_butler" | "cleancloud",
  status: SourceCoverageStatus
): BusinessSourceCoverage {
  return {
    sourceId,
    name: sourceId === "cleancloud" ? "CleanCloud" : "Laundry Butler",
    type: sourceId === "cleancloud" ? "cleancloud_paid_book" : "native_orders",
    availability: "available",
    includedInCombinedBook: true,
    status,
    lastSuccessfulAssimilationAt:
      sourceId === "cleancloud" && status === "fresh"
        ? "2026-10-16T18:00:00.000Z"
        : null,
    assimilationKind:
      sourceId === "cleancloud" ? "customer_truth_refreshed" : "not_applicable",
    coveredThrough: sourceId === "cleancloud" ? "2026-10-16" : null,
    provenFrom: sourceId === "cleancloud" ? "2026-01-01" : null,
    expectedThrough: sourceId === "cleancloud" ? "2026-10-16" : null,
    records: "readable",
    supportsExhaustiveCurrentClaim: status === "fresh",
    emptyReadMeansNoRecords: false,
    reason: "fixture",
    provenance: {
      bindingState: "bound",
      schedule:
        sourceId === "cleancloud"
          ? "gumball_daily_18_america_los_angeles"
          : "system_of_record",
      coverageBasis: "economic_event",
      receiptProvenance: "test_fixture",
      paymentEventsProven: status === "fresh",
      decidedBy: "deterministic_rules",
    },
  };
}

function coverage(input: {
  exhaustiveCurrent: boolean;
  paymentEventsProven: boolean;
  bookStatus: SourceCoverageStatus;
  native?: SourceCoverageStatus;
  cleancloud?: SourceCoverageStatus;
}): BusinessSourceCoverageSnapshot {
  const sources = [
    source("laundry_butler", input.native ?? "fresh"),
    source("cleancloud", input.cleancloud ?? "fresh"),
  ];
  const span = input.paymentEventsProven
    ? { from: "2026-01-01", through: "2026-10-16" }
    : null;
  return {
    contractVersion: 1,
    tenantId: TENANT,
    checkedAt: NOW.toISOString(),
    timeZone: TIME_ZONE,
    sources,
    book: {
      status: input.bookStatus,
      exhaustiveCurrent: input.exhaustiveCurrent,
      current: input.exhaustiveCurrent,
      scope: {
        native: "system_of_record",
        cleancloudOrdersCreated: span,
        cleancloudEconomicEvents: span,
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
      .map(item => ({
        sourceId: item.sourceId,
        status: item.status,
        reason: item.reason,
      })),
  };
}

const exactBook = coverage({
  exhaustiveCurrent: true,
  paymentEventsProven: true,
  bookStatus: "fresh",
});

/** Week money before Wednesday 15:00. It is in the book and is not progress. */
const beforeGoal = [
  native(1, "2026-10-12T19:00:00.000Z", "120.00"),
  native(2, "2026-10-14T17:00:00.000Z", "80.00"),
];

/** Captured after the goal started. 200 + 150 + 100 + 50 = $500.00. */
const afterGoal = [
  native(3, "2026-10-14T23:00:00.000Z", "200.00"),
  native(4, "2026-10-15T19:00:00.000Z", "150.00"),
  native(5, "2026-10-16T19:00:00.000Z", "50.00"),
];
const afterGoalCleanCloud = [
  cleancloud("cc-9", "2026-10-15T20:00:00.000Z", 10_000),
];

function readGoal(
  rows: { nativeRows: NativeOrderRow[]; cleancloudRows: CleanCloudOrderRow[] },
  book: BusinessSourceCoverageSnapshot | null,
  target = ANOTHER_FIVE_HUNDRED_DOLLARS,
  goalLoaders = loaders(rows.nativeRows, rows.cleancloudRows)
) {
  return readBusinessGoalFinancialResult(
    {
      kind: "weekly_additional_earnings",
      tenantId: TENANT,
      target,
      startedAt: GOAL_START,
      now: NOW,
      timeZone: TIME_ZONE,
    },
    { coverage: book, loaders: goalLoaders }
  );
}

function measured(result: BusinessGoalFinancialResult) {
  expect(result.status).toBe("measured");
  if (result.status !== "measured")
    throw new Error("expected a measured result");
  return result;
}

const weekRows = {
  nativeRows: [...beforeGoal, ...afterGoal],
  cleancloudRows: afterGoalCleanCloud,
};

describe("weekly additional earnings from the paid-order ledger", () => {
  it("keeps $500.00 collected after the goal starts out of additional earnings", async () => {
    const result = measured(await readGoal(weekRows, exactBook));
    expect(result.ledger).toBe("paid_order_ledger");
    expect(result.week).toEqual({
      start: "2026-10-12",
      end: "2026-10-16",
      timeZone: TIME_ZONE,
      label: "this week so far",
    });
    expect(result.countedFrom).toBe("2026-10-14T22:00:00.000Z");
    expect(result.target).toEqual({ currency: "usd", additionalCents: 50_000 });
    expect(result.totalVerifiedCollectionsCents).toBe(70_000);
    expect(result.collectionsOnOrAfterStartCents).toBe(50_000);
    expect(result.goalActionRevenueCents).toBeNull();
    expect(result.substantiatedAdditionalCents).toBeNull();
    expect(result.remainingCents).toBeNull();
    expect(result.sources).toEqual(["cleancloud", "laundry_butler"]);
    expect(result.precision).toBe("exact");
    expect(result.mayStateExact).toBe(true);
    expect(result.met).toBe(false);
    expect(result.withheld).toEqual({
      suspectedCount: 0,
      suspectedCents: 0,
      unverifiedNativeCount: 0,
      unverifiedNativeCents: 0,
      unverifiedPaymentAuthorityCount: 0,
      unverifiedPaymentAuthorityCents: 0,
      undatedAdjustmentCount: 0,
      undatedAdjustmentCents: 0,
    });
  });

  it("does not meet the goal when exact collections after the start are $450.00", async () => {
    const result = measured(
      await readGoal(
        {
          nativeRows: [...beforeGoal, afterGoal[0]!, afterGoal[1]!],
          cleancloudRows: afterGoalCleanCloud,
        },
        exactBook
      )
    );
    expect(result.totalVerifiedCollectionsCents).toBe(65_000);
    expect(result.collectionsOnOrAfterStartCents).toBe(45_000);
    expect(result.substantiatedAdditionalCents).toBeNull();
    expect(result.remainingCents).toBeNull();
    expect(result.met).toBe(false);
    expect(result.precision).toBe("exact");
  });

  it("uses the captured cents, so a $500.00 order total captured at $120.00 is $120.00", async () => {
    const quoted = native(8, "2026-10-16T19:00:00.000Z", "500.00", "pi_8", {
      createdAt: at("2026-10-16T19:00:00.000Z"),
    });
    const base = loaders([quoted], []);
    const capturedLoaders = {
      ...base,
      paymentAuthority: async (input: {
        tenantId: string;
        expectations: Parameters<
          NonNullable<LedgerLoaders["paymentAuthority"]>
        >[0]["expectations"];
      }) => {
        const receipts = await base.paymentAuthority!(input);
        return receipts.map(receipt => ({
          ...receipt,
          metadata: {
            ...receipt.metadata,
            captureEvidence: "stripe_amount_received_v1",
            capturedCurrency: "usd",
            capturedAmountCents: 12_000,
          },
        }));
      },
    };
    const result = measured(
      await readBusinessGoalFinancialResult(
        {
          kind: "weekly_additional_earnings",
          tenantId: TENANT,
          target: ANOTHER_FIVE_HUNDRED_DOLLARS,
          startedAt: GOAL_START,
          now: NOW,
          timeZone: TIME_ZONE,
          goalActionLinks: [
            {
              eventKey: "order:8",
              actionEvidenceRef: "goal-action:collect-8",
              relation: "additional_earning",
              substantiationRef: "new-sale:8",
            },
          ],
        },
        { coverage: exactBook, loaders: capturedLoaders }
      )
    );
    expect(result.totalVerifiedCollectionsCents).toBe(12_000);
    expect(result.goalActionRevenueCents).toBe(12_000);
    expect(result.substantiatedAdditionalCents).toBe(12_000);
    expect(result.remainingCents).toBe(38_000);
    expect(result.met).toBe(false);
    expect(result.precision).toBe("exact");
  });

  it("counts a new sale as additional earnings only when the action substantiates it", async () => {
    const fresh = native(7, "2026-10-16T19:30:00.000Z", "500.00", "pi_7", {
      createdAt: at("2026-10-16T19:30:00.000Z"),
    });
    const result = measured(
      await readBusinessGoalFinancialResult(
        {
          kind: "weekly_additional_earnings",
          tenantId: TENANT,
          target: ANOTHER_FIVE_HUNDRED_DOLLARS,
          startedAt: GOAL_START,
          now: NOW,
          timeZone: TIME_ZONE,
          goalActionLinks: [
            {
              eventKey: "order:3",
              actionEvidenceRef: "goal-action:collect-existing",
              relation: "existing_collection",
            },
            {
              eventKey: "order:7",
              actionEvidenceRef: "goal-action:new-sale",
              relation: "additional_earning",
              substantiationRef: "new-sale:7",
            },
          ],
        },
        {
          coverage: exactBook,
          loaders: loaders(
            [...weekRows.nativeRows, fresh],
            weekRows.cleancloudRows
          ),
        }
      )
    );
    expect(result.totalVerifiedCollectionsCents).toBe(120_000);
    expect(result.collectionsOnOrAfterStartCents).toBe(100_000);
    expect(result.goalActionRevenueCents).toBe(70_000);
    expect(result.goalActionEventKeys).toEqual(["order:3", "order:7"]);
    expect(result.substantiatedAdditionalCents).toBe(50_000);
    expect(result.substantiatedEventKeys).toEqual(["order:7"]);
    expect(result.remainingCents).toBe(0);
    expect(result.met).toBe(true);
  });

  it("does not treat a paid order that already existed as additional earnings", async () => {
    const existing = native(6, "2026-10-16T19:00:00.000Z", "500.00", "pi_6", {
      createdAt: at("2026-10-13T19:00:00.000Z"),
    });
    const result = measured(
      await readBusinessGoalFinancialResult(
        {
          kind: "weekly_additional_earnings",
          tenantId: TENANT,
          target: ANOTHER_FIVE_HUNDRED_DOLLARS,
          startedAt: GOAL_START,
          now: NOW,
          timeZone: TIME_ZONE,
          goalActionLinks: [
            {
              eventKey: "order:6",
              actionEvidenceRef: "goal-action:collect-6",
              relation: "additional_earning",
              substantiationRef: "claimed-new-sale:6",
            },
          ],
        },
        { coverage: exactBook, loaders: loaders([existing], []) }
      )
    );
    expect(result.totalVerifiedCollectionsCents).toBe(50_000);
    expect(result.goalActionRevenueCents).toBe(50_000);
    expect(result.substantiatedAdditionalCents).toBe(0);
    expect(result.remainingCents).toBe(50_000);
    expect(result.met).toBe(false);
  });

  it("does not complete another $500 when a paid row has no payment receipt", async () => {
    const unmarked = native(9, "2026-10-16T18:00:00.000Z", "70.00", "");
    const result = measured(
      await readGoal(
        {
          nativeRows: [...beforeGoal, ...afterGoal, unmarked],
          cleancloudRows: afterGoalCleanCloud,
        },
        exactBook
      )
    );
    expect(result.totalVerifiedCollectionsCents).toBe(70_000);
    expect(result.collectionsOnOrAfterStartCents).toBe(50_000);
    expect(result.substantiatedAdditionalCents).toBeNull();
    expect(result.withheld.unverifiedNativeCents).toBe(7_000);
    expect(result.mayStateExact).toBe(false);
    expect(result.precision).toBe("recorded_only");
    expect(result.met).toBe(false);
  });

  it("does not complete a stale book that has recorded the collections", async () => {
    const result = measured(
      await readGoal(
        weekRows,
        coverage({
          exhaustiveCurrent: false,
          paymentEventsProven: false,
          bookStatus: "stale",
          cleancloud: "stale",
        })
      )
    );
    expect(result.totalVerifiedCollectionsCents).toBe(70_000);
    expect(result.collectionsOnOrAfterStartCents).toBe(50_000);
    expect(result.substantiatedAdditionalCents).toBeNull();
    expect(result.precision).toBe("recorded_only");
    expect(result.mayStateExact).toBe(false);
    expect(result.met).toBe(false);
    expect(result.remainingCents).toBeNull();
  });

  it("reports an unreadable book as unavailable rather than zero earned", async () => {
    const result = await readGoal(
      { nativeRows: [], cleancloudRows: [] },
      null,
      ANOTHER_FIVE_HUNDRED_DOLLARS,
      {
        laundry_butler: async () => {
          throw new Error("native unread");
        },
        cleancloud: async () => {
          throw new Error("cleancloud unread");
        },
      }
    );
    expect(result).toMatchObject({
      status: "unavailable",
      ledger: "paid_order_ledger",
      totalVerifiedCollectionsCents: null,
      goalActionRevenueCents: null,
      substantiatedAdditionalCents: null,
      remainingCents: null,
      met: false,
      precision: "missing",
      reason: "sources_unavailable",
      target: { currency: "usd", additionalCents: 50_000 },
    });
  });

  it("scores a period_increment note across its horizon and ignores the trailing-30 targetValue", async () => {
    const readRevenue = vi.fn(async () => {
      throw new Error("trailing-30 reader must not be used");
    });
    const refused = await readBusinessGoalFinancialResult(
      {
        kind: "stored_macro_goal",
        tenantId: TENANT,
        metricKey: "net_sales_per_period",
        targetValue: 1874.16,
        unit: "USD",
        sourceNote: "Operator attested trailing thirty day sales",
        now: NOW,
        timeZone: TIME_ZONE,
      },
      { readRevenue }
    );
    expect(refused).toEqual({
      status: "not_period_increment",
      ledger: "paid_order_ledger",
      tenantId: TENANT,
      metricKey: "net_sales_per_period",
      targetValue: 1874.16,
      met: false,
      reason: "target_value_is_not_a_period_increment",
    });
    expect(readRevenue).not.toHaveBeenCalled();

    const result = measured(
      await readBusinessGoalFinancialResult(
        {
          kind: "stored_macro_goal",
          tenantId: TENANT,
          metricKey: "net_sales_per_period",
          targetValue: 500,
          unit: "USD",
          sourceNote:
            "business_goal_engine:v1 kind=incremental_earnings comparison=period_increment cents=50000 horizon=2026-10-12..2026-10-18 marker=another",
          targetDate: "2026-10-18",
          now: NOW,
          timeZone: TIME_ZONE,
        },
        {
          coverage: exactBook,
          loaders: loaders(weekRows.nativeRows, weekRows.cleancloudRows),
        }
      )
    );
    expect(result.goalKind).toBe("period_increment");
    expect(result.ignoredTargetValue).toBe(500);
    expect(result.target).toEqual({ currency: "usd", additionalCents: 50_000 });
    expect(result.horizon).toEqual({
      start: "2026-10-12",
      end: "2026-10-18",
      observedThrough: "2026-10-16",
    });
    expect(result.week.end).toBe("2026-10-16");
    expect(result.totalVerifiedCollectionsCents).toBe(70_000);
    expect(result.collectionsOnOrAfterStartCents).toBeNull();
    expect(result.goalActionRevenueCents).toBeNull();
    expect(result.substantiatedAdditionalCents).toBeNull();
    expect(result.met).toBe(false);
  });

  it("does not meet a period increment when the only proof is an existing order that got paid", async () => {
    const existing = native(6, "2026-10-16T19:00:00.000Z", "500.00", "pi_6", {
      createdAt: at("2026-10-11T19:00:00.000Z"),
    });
    const result = measured(
      await readBusinessGoalFinancialResult(
        {
          kind: "stored_macro_goal",
          tenantId: TENANT,
          metricKey: "net_sales_per_period",
          targetValue: 500,
          unit: "USD",
          sourceNote:
            "business_goal_engine:v1 kind=incremental_earnings comparison=period_increment cents=50000 horizon=2026-10-12..2026-10-18 marker=another",
          now: NOW,
          timeZone: TIME_ZONE,
          goalActionLinks: [
            {
              eventKey: "order:6",
              actionEvidenceRef: "goal-action:collect-6",
              relation: "additional_earning",
              substantiationRef: "claimed-new-sale:6",
            },
          ],
        },
        { coverage: exactBook, loaders: loaders([existing], []) }
      )
    );
    expect(result.totalVerifiedCollectionsCents).toBe(50_000);
    expect(result.goalActionRevenueCents).toBe(50_000);
    expect(result.substantiatedAdditionalCents).toBe(0);
    expect(result.met).toBe(false);
  });

  it("does not read the Clearent match table or invent a stored earnings ledger", () => {
    const sourceText = readFileSync(
      new URL("./businessGoalFinancialResult.ts", import.meta.url),
      "utf8"
    );
    const code = sourceText
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("paymentReconciliation");
    expect(code).not.toContain("reconcileClearentDailySummaries");
    expect(code).not.toContain("getPaymentReconciliationDashboard");
    expect(code).not.toContain("insert(");
    expect(code).not.toContain("stripe.");
  });
});
