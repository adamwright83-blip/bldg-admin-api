import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDashboardTimeZone, zonedDayStartUtc } from "../dashboardZoned";
import { getDb } from "../db";
import { orders, cleancloudPaidOrders, clearentTransactions } from "../../drizzle/schema";
import {
  activeCustomerPopulation,
  bucketSeries,
  compareTotals,
  summarizeTotals,
  topCustomers,
} from "./businessMetrics";
import { ALL_TIME_START, addDaysYmd, daysInclusive, isValidYmd } from "./businessPeriods";
import {
  interpretSourceCoverage,
  loadRevenueSourceCoverage,
  reconcileLedgerSpan,
  revenueMayStateExact,
} from "./canonicalRevenue";
import {
  AnalyticsUnavailableError,
  loadPaidOrderLedger,
  type LedgerCompleteness,
  type LedgerSource,
  type PaidOrderLedger,
} from "./paidOrderLedger";

export { AnalyticsUnavailableError };

export type DateRange = { start: string; end: string }; // business-local YYYY-MM-DD, inclusive

export type AnalyticsCoverage = {
  completeness: LedgerCompleteness;
  loadedSources: LedgerSource[];
  failedSources: LedgerSource[];
  unverifiedNativeCount: number;
  unverifiedNativeCents: number;
};

export type RevenuePoint = { bucket: string; revenue: number; orderCount: number };

export type RevenueSummary = {
  totalRevenue: number;
  orderCount: number;
  avgOrderValue: number;
  series: RevenuePoint[];
  coverage?: AnalyticsCoverage;
  /**
   * `totalRevenue` is recorded included dollars. `statedExactRevenue` is set
   * only when B1 coverage and reconciliation both allow an exact total.
   */
  statedExactRevenue?: number | null;
  reconciliation?: {
    exactIncludedCents: number;
    statedExactCents: number | null;
    mayStateExact: boolean;
    definiteDuplicateExclusionCents: number;
    suspectedWithheldCents: number;
    unverifiedNativeCents: number;
    coverageAllowsExact: boolean;
    paymentEventsProven: boolean;
    exhaustiveCurrent: boolean;
  };
};

export type OrderStats = {
  totalOrders: number;
  byStatus: Record<string, number>;
  byServiceType: Record<string, number>;
  totalWeightLbs: number;
  avgOrderValue: number;
};

export type OpenOrderStats = {
  openTotal: number;
  byStatus: Record<string, number>;
  awaitingPayment: number;
};

export type RepeatCustomerStats = {
  totalCustomers: number;
  repeatCustomers: number;
  oneTimeCustomers: number;
  repeatRate: number;
  coverage?: AnalyticsCoverage;
};

export type CustomerRevenueRow = {
  customerName: string;
  phone: string;
  revenue: number;
  orderCount: number;
  avgOrderValue: number;
};

export type CustomerRevenueWindow = CustomerRevenueRow & {
  label: string;
  range: DateRange;
};

export type CustomerRevenueStats = {
  customers: CustomerRevenueRow[];
  windows?: CustomerRevenueWindow[];
  coverage?: AnalyticsCoverage;
};

export type MetricUnit = "currency" | "count" | "weight_lbs";

export type MetricComparison = {
  unit: MetricUnit;
  current: number;
  previous: number;
  absChange: number;
  pctChange: number;
  // Revenue-specific bridge fields (zero for non-revenue metrics)
  currentOrders: number;
  previousOrders: number;
  currentAov: number;
  previousAov: number;
  volumeEffect: number;
  aovEffect: number;
  driversByServiceType: Array<{ key: string; cur: number; prev: number; delta: number }>;
  coverage?: AnalyticsCoverage;
};

export type DataCompleteness = {
  connected: Array<{ source: string; description: string }>;
  missing: Array<{ source: string; prevents: string }>;
};

export type AnalyticsQueryDeps = {
  loadLedger: typeof loadPaidOrderLedger;
  timeZone: () => string;
};

const defaultDeps: AnalyticsQueryDeps = {
  loadLedger: loadPaidOrderLedger,
  timeZone: getDashboardTimeZone,
};

const dollars = (cents: number) => Math.round(cents) / 100;

function boundedRange(range: DateRange): DateRange {
  let start = isValidYmd(range.start) ? range.start : range.end;
  let end = isValidYmd(range.end) ? range.end : start;
  if (start > end) [start, end] = [end, start];
  if (start < ALL_TIME_START) start = ALL_TIME_START;
  return { start, end };
}

/**
 * Paid revenue for analytics comes only from the shared paid-order ledger
 * (native Stripe-verified orders + deduplicated CleanCloud orders). When no
 * source can be read this throws — an outage is never reported as $0.
 */
async function ledgerFor(
  tenantId: string,
  ranges: DateRange[],
  deps: AnalyticsQueryDeps
): Promise<PaidOrderLedger> {
  const timeZone = deps.timeZone();
  const bounded = ranges.map(boundedRange);
  const start = bounded.map(r => r.start).sort()[0]!;
  const end = bounded.map(r => r.end).sort().reverse()[0]!;
  const ledger = await deps.loadLedger({
    tenantId,
    startUtc: zonedDayStartUtc(start, timeZone),
    endExclusiveUtc: zonedDayStartUtc(addDaysYmd(end, 1), timeZone),
    timeZone,
  });
  if (ledger.completeness === "unavailable") {
    throw new AnalyticsUnavailableError("No paid-order source could be read");
  }
  return ledger;
}

function coverageOf(ledger: PaidOrderLedger, ranges: DateRange[]): AnalyticsCoverage {
  const bounded = ranges.map(boundedRange);
  const unverified = ledger.unverifiedNative.filter(order =>
    bounded.some(range => order.businessDate >= range.start && order.businessDate <= range.end)
  );
  return {
    completeness: ledger.completeness,
    loadedSources: ledger.loadedSources,
    failedSources: ledger.failedSources,
    unverifiedNativeCount: unverified.length,
    unverifiedNativeCents: unverified.reduce((sum, order) => sum + order.cents, 0),
  };
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new AnalyticsUnavailableError("Database not available");
  return db;
}

/**
 * Paid revenue totals + business-local time series. The stated total is
 * `readCanonicalRevenue` / `reconcileLedgerSpan` (exact included cents).
 * `basis` is accepted for older callers but revenue stays payment-dated.
 */
export async function getRevenueSummary(
  tenantId: string,
  params: {
    range: DateRange;
    groupBy: "day" | "week" | "month";
    basis?: "paidAt" | "createdAt";
  },
  deps: AnalyticsQueryDeps = defaultDeps
): Promise<RevenueSummary> {
  const ledger = await ledgerFor(tenantId, [params.range], deps);
  const range = boundedRange(params.range);
  const reconciled = reconcileLedgerSpan(ledger, range);
  const totals = summarizeTotals(reconciled.includedEvents);
  const snapshot = await loadRevenueSourceCoverage({ tenantId });
  const revenueCoverage = interpretSourceCoverage({
    snapshot,
    window: { from: range.start, to: range.end },
    loadedSources: ledger.loadedSources,
    failedSources: ledger.failedSources,
  });
  const mayStateExact = revenueMayStateExact({ coverage: revenueCoverage, reconciled });
  return {
    totalRevenue: dollars(totals.revenueCents),
    statedExactRevenue: mayStateExact ? dollars(totals.revenueCents) : null,
    orderCount: totals.orderCount,
    avgOrderValue: totals.aovCents == null ? 0 : dollars(totals.aovCents),
    series: bucketSeries(reconciled.includedEvents, params.groupBy).map(point => ({
      bucket: point.bucket,
      revenue: dollars(point.revenueCents),
      orderCount: point.orderCount,
    })),
    coverage: coverageOf(ledger, [params.range]),
    reconciliation: {
      exactIncludedCents: reconciled.exactIncludedCents,
      statedExactCents: mayStateExact ? reconciled.exactIncludedCents : null,
      mayStateExact,
      definiteDuplicateExclusionCents: reconciled.definiteDuplicateExclusions.cents,
      suspectedWithheldCents: reconciled.suspectedWithheld.cents,
      unverifiedNativeCents: reconciled.unverifiedNative.cents,
      coverageAllowsExact: revenueCoverage.coverageAllowsExact,
      paymentEventsProven: revenueCoverage.paymentEventsProven,
      exhaustiveCurrent: revenueCoverage.exhaustiveCurrent,
    },
  };
}

/**
 * Operational order volume, status mix, service mix and lbs for native
 * Goldline orders created in the business-local range (paid or not).
 */
export async function getOrderStats(
  tenantId: string,
  params: {
    range: DateRange;
    serviceType?: "wash_fold" | "dry_cleaning";
    status?: string;
  },
  deps: AnalyticsQueryDeps = defaultDeps
): Promise<OrderStats> {
  const db = await requireDb();
  const timeZone = deps.timeZone();
  const range = boundedRange(params.range);
  const conditions = [
    sql`COALESCE(${orders.tenantId}, 'default') = ${tenantId}`,
    gte(orders.createdAt, zonedDayStartUtc(range.start, timeZone)),
    lt(orders.createdAt, zonedDayStartUtc(addDaysYmd(range.end, 1), timeZone)),
  ];
  if (params.serviceType) conditions.push(eq(orders.serviceType, params.serviceType));
  if (params.status) conditions.push(sql`${orders.status} = ${params.status}`);

  const rows = await db
    .select({
      status: orders.status,
      serviceType: orders.serviceType,
      total: orders.total,
      weightLbs: orders.weightLbs,
    })
    .from(orders)
    .where(and(...conditions));

  const byStatus: Record<string, number> = {};
  const byServiceType: Record<string, number> = {};
  let totalWeightLbs = 0;
  let totalRevenue = 0;

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    byServiceType[row.serviceType] = (byServiceType[row.serviceType] ?? 0) + 1;
    if (row.weightLbs != null) totalWeightLbs += Number(row.weightLbs);
    totalRevenue += Number(row.total ?? 0);
  }

  return {
    totalOrders: rows.length,
    byStatus,
    byServiceType,
    totalWeightLbs: Math.round(totalWeightLbs * 10) / 10,
    avgOrderValue: rows.length > 0 ? Math.round((totalRevenue / rows.length) * 100) / 100 : 0,
  };
}

/** Active native orders snapshot (not delivered / not cancelled). */
export async function getOpenOrderStats(tenantId: string): Promise<OpenOrderStats> {
  const db = await requireDb();
  const rows = await db
    .select({ status: orders.status, paid: orders.paid })
    .from(orders)
    .where(
      and(
        sql`COALESCE(${orders.tenantId}, 'default') = ${tenantId}`,
        sql`${orders.status} NOT IN ('delivered', 'cancelled')`
      )
    );

  const byStatus: Record<string, number> = {};
  let awaitingPayment = 0;

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    if (!row.paid && ["collected", "processing", "ready"].includes(row.status)) {
      awaitingPayment++;
    }
  }

  return { openTotal: rows.length, byStatus, awaitingPayment };
}

/** Customer identities with paid orders in the range: repeat (≥2) vs one-time. */
export async function getRepeatCustomerStats(
  tenantId: string,
  params: { range: DateRange },
  deps: AnalyticsQueryDeps = defaultDeps
): Promise<RepeatCustomerStats> {
  const ledger = await ledgerFor(tenantId, [params.range], deps);
  // Canonical active customer computation is defined in server/claire/activeCustomerMetric.ts
  const population = activeCustomerPopulation(ledger.events, boundedRange(params.range), 1);
  const totalCustomers = population.count;
  const repeatCustomers = population.members.filter(member => member.orderCount >= 2).length;
  return {
    totalCustomers,
    repeatCustomers,
    oneTimeCustomers: totalCustomers - repeatCustomers,
    repeatRate: totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 100) / 100 : 0,
    coverage: coverageOf(ledger, [params.range]),
  };
}

/** Paid revenue grouped by customer identity, highest grossing first. */
export async function getTopCustomersByRevenue(
  tenantId: string,
  params: { range: DateRange; limit?: number },
  deps: AnalyticsQueryDeps = defaultDeps
): Promise<CustomerRevenueStats> {
  const ledger = await ledgerFor(tenantId, [params.range], deps);
  return {
    customers: topCustomers(ledger.events, boundedRange(params.range), params.limit ?? 5).map(member => ({
      customerName: member.displayName,
      phone: "",
      revenue: dollars(member.revenueCents),
      orderCount: member.orderCount,
      avgOrderValue: member.orderCount ? dollars(Math.round(member.revenueCents / member.orderCount)) : 0,
    })),
    coverage: coverageOf(ledger, [params.range]),
  };
}

/**
 * Metric-aware comparison: compares currentRange vs comparisonRange for the given metricId.
 * comparisonRange defaults to the equal-length period immediately preceding currentRange.
 *
 * Bridge identities (revenue only):
 *   volumeEffect  = (orders_cur - orders_prev) * aov_prev
 *   aovEffect     = (aov_cur - aov_prev) * orders_cur
 */
export async function getMetricComparison(
  tenantId: string,
  params: {
    metricId: string;
    currentRange: DateRange;
    comparisonRange?: DateRange;
    groupBy: "day" | "week" | "month";
    basis?: "paidAt" | "createdAt";
  },
  deps: AnalyticsQueryDeps = defaultDeps
): Promise<MetricComparison> {
  const emptyResult = (unit: MetricUnit): MetricComparison => ({
    unit, current: 0, previous: 0, absChange: 0, pctChange: 0,
    currentOrders: 0, previousOrders: 0, currentAov: 0, previousAov: 0,
    volumeEffect: 0, aovEffect: 0, driversByServiceType: [],
  });

  const currentRange = boundedRange(params.currentRange);
  const compRange = params.comparisonRange ? boundedRange(params.comparisonRange) : previousEqualPeriod(currentRange);
  const computePct = (cur: number, prev: number) =>
    prev > 0 ? Math.round(((cur - prev) / prev) * 10000) / 100 : 0;
  const r2 = (n: number) => Math.round(n * 100) / 100;

  switch (params.metricId) {
    case "revenue_paid_stripe":
    case "orders_paid":
    case "avg_order_value": {
      const ledger = await ledgerFor(tenantId, [currentRange, compRange], deps);
      const curReconciled = reconcileLedgerSpan(ledger, currentRange);
      const prevReconciled = reconcileLedgerSpan(ledger, compRange);
      const curEvents = curReconciled.includedEvents;
      const prevEvents = prevReconciled.includedEvents;
      const bridge = compareTotals(summarizeTotals(curEvents), summarizeTotals(prevEvents));
      const coverage = coverageOf(ledger, [currentRange, compRange]);
      const curAov = bridge.current.aovCents == null ? 0 : dollars(bridge.current.aovCents);
      const prevAov = bridge.previous.aovCents == null ? 0 : dollars(bridge.previous.aovCents);
      if (params.metricId === "orders_paid") {
        return {
          ...emptyResult("count"),
          current: bridge.current.orderCount,
          previous: bridge.previous.orderCount,
          absChange: bridge.orderChange,
          pctChange: computePct(bridge.current.orderCount, bridge.previous.orderCount),
          coverage,
        };
      }
      if (params.metricId === "avg_order_value") {
        return {
          ...emptyResult("currency"),
          current: curAov,
          previous: prevAov,
          absChange: r2(curAov - prevAov),
          pctChange: computePct(curAov, prevAov),
          coverage,
        };
      }
      const serviceCounts = (events: typeof curEvents) =>
        events.reduce<Record<string, number>>((acc, event) => {
          if (event.serviceType) acc[event.serviceType] = (acc[event.serviceType] ?? 0) + 1;
          return acc;
        }, {});
      const cur = serviceCounts(curEvents);
      const prev = serviceCounts(prevEvents);
      const keys = Array.from(new Set([...Object.keys(cur), ...Object.keys(prev)]));
      return {
        unit: "currency",
        current: dollars(bridge.current.revenueCents),
        previous: dollars(bridge.previous.revenueCents),
        absChange: dollars(bridge.revenueChangeCents),
        pctChange: computePct(bridge.current.revenueCents, bridge.previous.revenueCents),
        currentOrders: bridge.current.orderCount,
        previousOrders: bridge.previous.orderCount,
        currentAov: curAov,
        previousAov: prevAov,
        volumeEffect: dollars(bridge.volumeEffectCents ?? 0),
        aovEffect: dollars(bridge.aovEffectCents ?? 0),
        driversByServiceType: keys.map(key => ({
          key,
          cur: cur[key] ?? 0,
          prev: prev[key] ?? 0,
          delta: (cur[key] ?? 0) - (prev[key] ?? 0),
        })),
        coverage,
      };
    }

    case "orders_created": {
      const [curStats, prevStats] = await Promise.all([
        getOrderStats(tenantId, { range: currentRange }, deps),
        getOrderStats(tenantId, { range: compRange }, deps),
      ]);
      return {
        ...emptyResult("count"),
        current: curStats.totalOrders,
        previous: prevStats.totalOrders,
        absChange: curStats.totalOrders - prevStats.totalOrders,
        pctChange: computePct(curStats.totalOrders, prevStats.totalOrders),
      };
    }

    case "wash_fold_weight": {
      const [curStats, prevStats] = await Promise.all([
        getOrderStats(tenantId, { range: currentRange, serviceType: "wash_fold" }, deps),
        getOrderStats(tenantId, { range: compRange, serviceType: "wash_fold" }, deps),
      ]);
      return {
        ...emptyResult("weight_lbs"),
        current: curStats.totalWeightLbs,
        previous: prevStats.totalWeightLbs,
        absChange: r2(curStats.totalWeightLbs - prevStats.totalWeightLbs),
        pctChange: computePct(curStats.totalWeightLbs, prevStats.totalWeightLbs),
      };
    }

    default:
      return getMetricComparison(tenantId, { ...params, metricId: "revenue_paid_stripe" }, deps);
  }
}

export function previousEqualPeriod(range: DateRange): DateRange {
  const days = daysInclusive(range.start, range.end);
  const end = addDaysYmd(range.start, -1);
  return { start: addDaysYmd(end, -(days - 1)), end };
}

/** Categories Goldline has never connected for any tenant. */
export const ALWAYS_MISSING_SOURCES: DataCompleteness["missing"] = [
  { source: "Payroll / labor", prevents: "cannot calculate labor margin or labor-cost percentage" },
  { source: "Machine revenue (coin-op)", prevents: "cannot calculate full store revenue" },
  { source: "Cash drawer / POS", prevents: "cannot reconcile total daily sales across all payment types" },
  { source: "Supply costs (detergent, bags, hangers)", prevents: "cannot calculate true gross profit" },
];

/**
 * Brutally honest data-completeness report.
 * Connected = we have actual rows for this tenant.
 * Missing   = what absence prevents (upsell lever).
 * Throws when the database cannot be read, rather than implying nothing is connected.
 */
export async function getDataCompleteness(tenantId: string): Promise<DataCompleteness> {
  const db = await requireDb();

  const connected: DataCompleteness["connected"] = [];
  const missing: DataCompleteness["missing"] = [];

  const [paidRow] = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(orders)
    .where(
      and(
        sql`COALESCE(${orders.tenantId}, 'default') = ${tenantId}`,
        sql`${orders.paid} = true`,
        sql`${orders.stripePaymentIntentId} IS NOT NULL`
      )
    );
  if (Number(paidRow?.cnt ?? 0) > 0) {
    connected.push({ source: "Stripe-paid orders", description: "Native Goldline orders with Stripe payment evidence" });
  } else {
    missing.push({ source: "Stripe-paid orders", prevents: "no native paid orders with payment evidence yet" });
  }

  const [ccRow] = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(cleancloudPaidOrders)
    .where(eq(cleancloudPaidOrders.tenantId, tenantId));
  if (Number(ccRow?.cnt ?? 0) > 0) {
    connected.push({ source: "CleanCloud import", description: "Paid CleanCloud orders, counted once per order" });
  }

  // Clearent / XplorPay — clearentTransactions has no tenantId column, so global rows
  // cannot prove this tenant's connection. Only mark connected for the internal default
  // tenant (platform-level data); all other tenants get the not-tenant-confirmed entry.
  if (tenantId === "default") {
    const [clearRow] = await db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(clearentTransactions);
    if (Number(clearRow?.cnt ?? 0) > 0) {
      connected.push({ source: "Clearent / XplorPay", description: "Card-reader transactions imported (platform-level, reconciliation only)" });
    }
  } else {
    missing.push({
      source: "Clearent / XplorPay",
      prevents: "platform import exists but tenant-specific connection is not confirmed — clearentTransactions is not tenant-scoped",
    });
  }

  missing.push(...ALWAYS_MISSING_SOURCES);
  return { connected, missing };
}
