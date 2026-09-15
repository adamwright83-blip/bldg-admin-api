import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));

import { getDb } from "../db";
import {
  ALWAYS_MISSING_SOURCES,
  AnalyticsUnavailableError,
  getDataCompleteness,
  getMetricComparison,
  getOpenOrderStats,
  getOrderStats,
  getRepeatCustomerStats,
  getRevenueSummary,
  getTopCustomersByRevenue,
  previousEqualPeriod,
  type AnalyticsQueryDeps,
} from "./analyticsQueries";
import { normalizeRange } from "./composerAgent";
import {
  loadPaidOrderLedger,
  type CleanCloudOrderRow,
  type LedgerLoaders,
  type NativeOrderRow,
} from "./paidOrderLedger";

const TZ = "America/Los_Angeles";

function native(overrides: Partial<NativeOrderRow> & { id: number; paidAt: Date; total: string }): NativeOrderRow {
  return {
    paid: true,
    stripePaymentIntentId: `pi_${overrides.id}`,
    serviceType: "wash_fold",
    firstName: "Ava",
    lastName: "Stone",
    phone: "3105550100",
    email: null,
    bldgUserId: null,
    ...overrides,
  };
}

function cleancloud(overrides: Partial<CleanCloudOrderRow> & { cleancloudOrderId: string }): CleanCloudOrderRow {
  return {
    cleancloudCustomerId: null,
    sourceReportType: "orders_sales",
    paymentDateUtc: new Date("2026-09-10T20:00:00Z"),
    paidDateUtc: null,
    paid: true,
    totalCents: 2500,
    customerName: "Ben Ortiz",
    customerPhone: "3105550199",
    customerEmail: null,
    ...overrides,
  };
}

function depsWith(loaders: LedgerLoaders): AnalyticsQueryDeps {
  return {
    loadLedger: input => loadPaidOrderLedger(input, loaders),
    timeZone: () => TZ,
  };
}

const failing: LedgerLoaders = {
  laundry_butler: async () => {
    throw new Error("down");
  },
  cleancloud: async () => {
    throw new Error("down");
  },
};

const empty: LedgerLoaders = { laundry_butler: async () => [], cleancloud: async () => [] };

beforeEach(() => {
  vi.mocked(getDb).mockResolvedValue(null);
});

describe("unavailable is never zero", () => {
  it("revenue throws AnalyticsUnavailableError when no paid-order source can be read", async () => {
    await expect(
      getRevenueSummary("tenant_a", { range: { start: "2026-09-01", end: "2026-09-10" }, groupBy: "day" }, depsWith(failing))
    ).rejects.toBeInstanceOf(AnalyticsUnavailableError);
  });

  it("revenue with the real database loaders and no database also throws", async () => {
    await expect(
      getRevenueSummary("tenant_a", { range: { start: "2026-09-01", end: "2026-09-10" }, groupBy: "day" })
    ).rejects.toBeInstanceOf(AnalyticsUnavailableError);
  });

  it("order stats, open orders, repeat customers, comparison and completeness all refuse without a database", async () => {
    await expect(getOrderStats("tenant_a", { range: { start: "2026-09-01", end: "2026-09-10" } })).rejects.toBeInstanceOf(AnalyticsUnavailableError);
    await expect(getOpenOrderStats("tenant_a")).rejects.toBeInstanceOf(AnalyticsUnavailableError);
    await expect(getRepeatCustomerStats("tenant_a", { range: { start: "2026-09-01", end: "2026-09-10" } }, depsWith(failing))).rejects.toBeInstanceOf(AnalyticsUnavailableError);
    await expect(
      getMetricComparison("tenant_a", { metricId: "revenue_paid_stripe", currentRange: { start: "2026-09-01", end: "2026-09-10" }, groupBy: "day" }, depsWith(failing))
    ).rejects.toBeInstanceOf(AnalyticsUnavailableError);
    await expect(getDataCompleteness("tenant_a")).rejects.toBeInstanceOf(AnalyticsUnavailableError);
  });

  it("a legitimate empty period stays a real zero with complete coverage", async () => {
    const result = await getRevenueSummary(
      "tenant_a",
      { range: { start: "2026-09-01", end: "2026-09-10" }, groupBy: "day" },
      depsWith(empty)
    );
    expect(result).toMatchObject({ totalRevenue: 0, orderCount: 0, series: [] });
    expect(result.coverage?.completeness).toBe("complete");
  });
});

describe("ledger-backed revenue", () => {
  const loaders: LedgerLoaders = {
    laundry_butler: async () => [
      native({ id: 1, paidAt: new Date("2026-09-10T18:00:00Z"), total: "40.00" }),
      native({ id: 2, paidAt: new Date("2026-09-10T19:00:00Z"), total: "99.00", stripePaymentIntentId: null }),
    ],
    cleancloud: async () => [
      cleancloud({ cleancloudOrderId: "cc-1" }),
      cleancloud({ cleancloudOrderId: "cc-1", sourceReportType: "orders_revenue", paymentDateUtc: null, paidDateUtc: new Date("2026-09-10T21:00:00Z") }),
    ],
  };

  it("counts Stripe-verified native orders and each CleanCloud order once, and reports unverified native orders", async () => {
    const result = await getRevenueSummary(
      "tenant_a",
      { range: { start: "2026-09-10", end: "2026-09-10" }, groupBy: "day" },
      depsWith(loaders)
    );
    expect(result.totalRevenue).toBe(65);
    expect(result.orderCount).toBe(2);
    expect(result.coverage).toMatchObject({ unverifiedNativeCount: 1, unverifiedNativeCents: 9900, completeness: "complete" });
  });

  it("buckets by business-local date, not UTC date", async () => {
    const lateEvening: LedgerLoaders = {
      laundry_butler: async () => [native({ id: 3, paidAt: new Date("2026-09-11T05:30:00Z"), total: "10.00" })],
      cleancloud: async () => [],
    };
    const result = await getRevenueSummary(
      "tenant_a",
      { range: { start: "2026-09-10", end: "2026-09-10" }, groupBy: "day" },
      depsWith(lateEvening)
    );
    expect(result.series).toEqual([{ bucket: "2026-09-10", revenue: 10, orderCount: 1 }]);
  });

  it("repeat customers and top customers share the same identity grouping", async () => {
    const shared: LedgerLoaders = {
      laundry_butler: async () => [
        native({ id: 10, paidAt: new Date("2026-09-05T18:00:00Z"), total: "30.00", phone: "+1 (310) 555-0100", email: "ava@example.com" }),
      ],
      cleancloud: async () => [
        cleancloud({ cleancloudOrderId: "cc-9", customerName: "Ava Stone", customerPhone: null, customerEmail: "AVA@example.com", totalCents: 4500 }),
      ],
    };
    const range = { start: "2026-09-01", end: "2026-09-14" };
    const repeat = await getRepeatCustomerStats("tenant_a", { range }, depsWith(shared));
    const top = await getTopCustomersByRevenue("tenant_a", { range, limit: 5 }, depsWith(shared));
    expect(repeat).toMatchObject({ totalCustomers: 1, repeatCustomers: 1 });
    expect(top.customers).toEqual([{ customerName: "Ava Stone", phone: "", revenue: 75, orderCount: 2, avgOrderValue: 37.5 }]);
  });

  it("comparison bridge uses the same ledger for both periods", async () => {
    const twoPeriods: LedgerLoaders = {
      laundry_butler: async () => [
        native({ id: 20, paidAt: new Date("2026-09-12T18:00:00Z"), total: "50.00" }),
        native({ id: 21, paidAt: new Date("2026-09-13T18:00:00Z"), total: "50.00" }),
        native({ id: 22, paidAt: new Date("2026-09-05T18:00:00Z"), total: "40.00" }),
      ],
      cleancloud: async () => [],
    };
    const result = await getMetricComparison(
      "tenant_a",
      { metricId: "revenue_paid_stripe", currentRange: { start: "2026-09-08", end: "2026-09-14" }, groupBy: "day" },
      depsWith(twoPeriods)
    );
    expect(result).toMatchObject({ unit: "currency", current: 100, previous: 40, currentOrders: 2, previousOrders: 1, volumeEffect: 40, aovEffect: 20 });
  });
});

describe("getDataCompleteness", () => {
  function fakeDb(count: number) {
    return {
      select: () => ({
        from: () => ({
          where: async () => [{ cnt: count }],
          then: (resolve: (rows: Array<{ cnt: number }>) => unknown) => resolve([{ cnt: count }]),
        }),
      }),
    };
  }

  it("always includes the four always-missing categories", () => {
    expect(ALWAYS_MISSING_SOURCES.map(m => m.source)).toEqual([
      "Payroll / labor",
      "Machine revenue (coin-op)",
      "Cash drawer / POS",
      "Supply costs (detergent, bags, hangers)",
    ]);
  });

  // Patch 4 (MANDATORY): Clearent global-scope leak — a non-default tenant must never
  // appear Clearent-connected based on global clearentTransactions rows.
  it("Clearent is never connected for a non-default tenant and explains why", async () => {
    vi.mocked(getDb).mockResolvedValue(fakeDb(5) as never);
    const result = await getDataCompleteness("some_other_laundromat_tenant");
    expect(result.connected.map(c => c.source)).not.toContain("Clearent / XplorPay");
    expect(result.missing.find(m => m.source === "Clearent / XplorPay")?.prevents).toContain("not tenant-scoped");
    expect(result.missing.map(m => m.source)).toContain("Supply costs (detergent, bags, hangers)");
  });
});

describe("date ranges", () => {
  it("previous equal period is the same length immediately before", () => {
    expect(previousEqualPeriod({ start: "2026-08-17", end: "2026-09-15" })).toEqual({ start: "2026-07-18", end: "2026-08-16" });
  });

  it("normalizeRange returns last 7 days for invalid date strings", () => {
    const result = normalizeRange({ start: "not-a-date", end: "also-bad" });
    const spanDays = (Date.parse(result.end) - Date.parse(result.start)) / 864e5;
    expect(spanDays).toBeCloseTo(6, 0);
  });

  it("normalizeRange swaps reversed start/end", () => {
    expect(normalizeRange({ start: "2025-06-29", end: "2025-06-01" })).toEqual({ start: "2025-06-01", end: "2025-06-29" });
  });

  it("normalizeRange clamps spans > 366 days", () => {
    const result = normalizeRange({ start: "2023-01-01", end: "2025-06-29" });
    expect((Date.parse(result.end) - Date.parse(result.start)) / 864e5).toBeLessThanOrEqual(366);
  });

  it("normalizeRange passes valid ISO dates unchanged", () => {
    expect(normalizeRange({ start: "2025-06-01", end: "2025-06-30" })).toEqual({ start: "2025-06-01", end: "2025-06-30" });
  });
});
