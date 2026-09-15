import { getDashboardTimeZone, zonedDayStartUtc } from "../dashboardZoned";
import {
  getDataCompleteness,
  getOpenOrderStats,
  type DataCompleteness,
  type OpenOrderStats,
} from "./analyticsQueries";
import {
  activeCustomerPopulation,
  compareTotals,
  dormantCustomerPopulation,
  eventsInSpan,
  findCustomersByName,
  newCustomerPopulation,
  summarizeTotals,
  topCustomers,
  type CustomerPopulation,
  type CustomerSummary,
  type RevenueTotals,
  type TotalsComparison,
} from "./businessMetrics";
import {
  addDaysYmd,
  previousPeriod,
  resolvePeriod,
  type PeriodSpec,
  type ResolvedPeriod,
} from "./businessPeriods";
import {
  detectCrossSourceOverlap,
  loadPaidOrderLedger,
  type LedgerCompleteness,
  type LedgerSource,
  type OverlapProbe,
  type ServiceType,
} from "./paidOrderLedger";

/**
 * One deterministic business question → one structured, truth-bearing
 * result. Claire speaks it; Admin analytics charts it. Neither may add a
 * number that is not in here.
 */

export type BusinessMetric =
  | "revenue"
  | "orders"
  | "aov"
  | "revenue_drivers"
  | "open_orders"
  | "active_customers"
  | "new_customers"
  | "dormant_customers"
  | "top_customers"
  | "customer_history"
  | "profit"
  | "data_coverage";

export const BUSINESS_METRICS: readonly BusinessMetric[] = [
  "revenue",
  "orders",
  "aov",
  "revenue_drivers",
  "open_orders",
  "active_customers",
  "new_customers",
  "dormant_customers",
  "top_customers",
  "customer_history",
  "profit",
  "data_coverage",
];

export type BusinessQuery = {
  metric: BusinessMetric;
  period: PeriodSpec;
  /** "previous" = the comparable period right before `period`. */
  comparison: "previous" | PeriodSpec | null;
  serviceType: ServiceType | null;
  minOrders: number;
  limit: number;
  customerName: string | null;
  listMembers: boolean;
};

export const CUSTOMER_LOOKBACK_DAYS = 365;

export function defaultBusinessQuery(metric: BusinessMetric): BusinessQuery {
  const period: PeriodSpec =
    metric === "dormant_customers"
      ? { kind: "trailing_days", days: 60 }
      : metric === "top_customers"
        ? { kind: "trailing_days", days: 90 }
        : metric === "customer_history"
          ? { kind: "this_year" }
          : { kind: "trailing_days", days: 30 };
  return {
    metric,
    period,
    comparison: metric === "revenue_drivers" ? "previous" : null,
    serviceType: null,
    minOrders: 1,
    limit: 5,
    customerName: null,
    listMembers: false,
  };
}

export type BusinessCoverage = {
  completeness: LedgerCompleteness;
  loadedSources: LedgerSource[];
  failedSources: LedgerSource[];
  unverifiedNativeCount: number;
  unverifiedNativeCents: number;
  overlap: OverlapProbe;
  /** A service filter was applied while CleanCloud orders (no service type) were in scope. */
  serviceFilterExcludedCleanCloud: boolean;
};

export type BusinessResultData =
  | {
      kind: "totals";
      current: RevenueTotals;
      previous: RevenueTotals | null;
      comparison: TotalsComparison | null;
    }
  | { kind: "open_orders"; openTotal: number; awaitingPayment: number }
  | {
      kind: "customers";
      population: CustomerPopulation;
      activeCount: number | null;
      lookbackStart: string | null;
    }
  | { kind: "top_customers"; members: CustomerSummary[] }
  | { kind: "customer_history"; matches: CustomerSummary[] }
  | { kind: "profit"; revenue: RevenueTotals; missing: DataCompleteness["missing"] }
  | { kind: "data_coverage"; completeness: DataCompleteness };

export type BusinessQueryResult =
  | {
      status: "unavailable";
      query: BusinessQuery;
      period: ResolvedPeriod;
      comparisonPeriod: ResolvedPeriod | null;
      reason: string;
    }
  | {
      status: "ok";
      query: BusinessQuery;
      period: ResolvedPeriod;
      comparisonPeriod: ResolvedPeriod | null;
      coverage: BusinessCoverage | null;
      data: BusinessResultData;
    };

export type BusinessQueryDeps = {
  loadLedger: typeof loadPaidOrderLedger;
  loadOpenOrders: (tenantId: string) => Promise<OpenOrderStats>;
  loadCompleteness: (tenantId: string) => Promise<DataCompleteness>;
  now: () => Date;
  timeZone: () => string;
};

export const defaultBusinessQueryDeps: BusinessQueryDeps = {
  loadLedger: loadPaidOrderLedger,
  loadOpenOrders: getOpenOrderStats,
  loadCompleteness: getDataCompleteness,
  now: () => new Date(),
  timeZone: getDashboardTimeZone,
};

const LEDGER_METRICS = new Set<BusinessMetric>([
  "revenue",
  "orders",
  "aov",
  "revenue_drivers",
  "active_customers",
  "new_customers",
  "dormant_customers",
  "top_customers",
  "customer_history",
  "profit",
]);

export async function runBusinessQuery(
  tenantId: string,
  query: BusinessQuery,
  deps: BusinessQueryDeps = defaultBusinessQueryDeps
): Promise<BusinessQueryResult> {
  const now = deps.now();
  const timeZone = deps.timeZone();
  const period = resolvePeriod(query.period, now, timeZone);
  const comparisonPeriod =
    query.comparison === "previous"
      ? previousPeriod(period, now)
      : query.comparison
        ? resolvePeriod(query.comparison, now, timeZone)
        : null;
  const unavailable = (reason: string): BusinessQueryResult => ({
    status: "unavailable",
    query,
    period,
    comparisonPeriod,
    reason,
  });

  try {
    if (query.metric === "open_orders") {
      const stats = await deps.loadOpenOrders(tenantId);
      return {
        status: "ok",
        query,
        period,
        comparisonPeriod: null,
        coverage: null,
        data: { kind: "open_orders", openTotal: stats.openTotal, awaitingPayment: stats.awaitingPayment },
      };
    }
    if (query.metric === "data_coverage") {
      return {
        status: "ok",
        query,
        period,
        comparisonPeriod: null,
        coverage: null,
        data: { kind: "data_coverage", completeness: await deps.loadCompleteness(tenantId) },
      };
    }
    if (!LEDGER_METRICS.has(query.metric)) return unavailable("unsupported_metric");

    const needsLookback = query.metric === "new_customers" || query.metric === "dormant_customers";
    const lookbackStart = needsLookback ? addDaysYmd(period.start, -CUSTOMER_LOOKBACK_DAYS) : null;
    const windowStart = [period.start, comparisonPeriod?.start, lookbackStart]
      .filter((value): value is string => Boolean(value))
      .sort()[0]!;
    const endExclusiveUtc = new Date(
      Math.max(period.endExclusiveUtc.getTime(), comparisonPeriod?.endExclusiveUtc.getTime() ?? 0)
    );
    const ledger = await deps.loadLedger({
      tenantId,
      startUtc: zonedDayStartUtc(windowStart, timeZone),
      endExclusiveUtc,
      timeZone,
    });
    if (ledger.completeness === "unavailable") return unavailable("sources_unavailable");

    const spans = [period, comparisonPeriod].filter((span): span is ResolvedPeriod => Boolean(span));
    const inScope = (date: string) => spans.some(span => date >= span.start && date <= span.end);
    const scopedEvents = ledger.events.filter(event => inScope(event.businessDate));
    const unverified = ledger.unverifiedNative.filter(order => inScope(order.businessDate));
    const coverage: BusinessCoverage = {
      completeness: ledger.completeness,
      loadedSources: ledger.loadedSources,
      failedSources: ledger.failedSources,
      unverifiedNativeCount: unverified.length,
      unverifiedNativeCents: unverified.reduce((sum, order) => sum + order.cents, 0),
      overlap: detectCrossSourceOverlap(scopedEvents),
      serviceFilterExcludedCleanCloud:
        Boolean(query.serviceType) && scopedEvents.some(event => event.source === "cleancloud"),
    };
    const history = query.serviceType
      ? ledger.events.filter(event => event.serviceType === query.serviceType)
      : ledger.events;
    const ok = (data: BusinessResultData): BusinessQueryResult => ({
      status: "ok",
      query,
      period,
      comparisonPeriod,
      coverage,
      data,
    });

    switch (query.metric) {
      case "revenue":
      case "orders":
      case "aov":
      case "revenue_drivers": {
        const current = summarizeTotals(eventsInSpan(history, period));
        const previous = comparisonPeriod ? summarizeTotals(eventsInSpan(history, comparisonPeriod)) : null;
        return ok({
          kind: "totals",
          current,
          previous,
          comparison: previous ? compareTotals(current, previous) : null,
        });
      }
      case "profit": {
        let missing: DataCompleteness["missing"] = [];
        try {
          missing = (await deps.loadCompleteness(tenantId)).missing;
        } catch (error) {
          console.warn("[Analytics] completeness lookup failed", error);
        }
        return ok({ kind: "profit", revenue: summarizeTotals(eventsInSpan(history, period)), missing });
      }
      case "active_customers":
        return ok({
          kind: "customers",
          population: activeCustomerPopulation(history, period, query.minOrders),
          activeCount: null,
          lookbackStart: null,
        });
      case "new_customers": {
        const result = newCustomerPopulation(history, period, lookbackStart!, query.minOrders);
        return ok({ kind: "customers", population: result, activeCount: result.activeCount, lookbackStart });
      }
      case "dormant_customers":
        return ok({
          kind: "customers",
          population: dormantCustomerPopulation(history, period, lookbackStart!),
          activeCount: null,
          lookbackStart,
        });
      case "top_customers":
        return ok({ kind: "top_customers", members: topCustomers(history, period, query.limit) });
      case "customer_history":
        return ok({
          kind: "customer_history",
          matches: findCustomersByName(history, period, query.customerName ?? ""),
        });
      default:
        return unavailable("unsupported_metric");
    }
  } catch (error) {
    console.warn("[Analytics] business query failed", {
      metric: query.metric,
      error: error instanceof Error ? error.message : String(error),
    });
    return unavailable("query_failed");
  }
}
