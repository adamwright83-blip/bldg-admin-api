import { getDashboardTimeZone, zonedDayStartUtc } from "../dashboardZoned";
import {
  getDataCompleteness,
  getOpenOrderStats,
  type DataCompleteness,
  type OpenOrderStats,
} from "./analyticsQueries";
import {
  applyLineageFilters,
  lineageBreakdown,
  unionOfSlices,
  type LedgerFilters,
  type LineageBreakdown,
} from "./businessLineage";
import {
  activeCustomerPopulation,
  compareTotals,
  customerDetailFor,
  customerGroupsForKeys,
  customerGroupsMatchingName,
  customerRevenueMovers,
  dormantCustomerPopulation,
  earliestOrders,
  eventsForCustomerKeys,
  eventsInSpan,
  findCustomersByName,
  groupEvents,
  largestOrders,
  latestOrders,
  mostFrequentCustomers,
  newCustomerPopulation,
  summarizeTotals,
  topCustomers,
  type CustomerDetail,
  type CustomerMover,
  type CustomerPopulation,
  type CustomerSummary,
  type GroupRow,
  type OrderBrief,
  type RevenueTotals,
  type TotalsComparison,
} from "./businessMetrics";
import {
  addDaysYmd,
  businessToday,
  previousPeriod,
  resolvePeriod,
  type PeriodSpec,
  type ResolvedPeriod,
} from "./businessPeriods";
import { loadDataFreshness, type DataFreshness } from "./dataFreshness";
import {
  detectCrossSourceOverlap,
  loadPaidOrderLedger,
  type LedgerCompleteness,
  type LedgerSource,
  type OverlapProbe,
  type PaidOrderEvent,
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
  | "frequent_customers"
  | "customer_history"
  | "customer_share"
  | "composition"
  | "latest_sales"
  | "biggest_orders"
  | "period_ranking"
  | "data_freshness"
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
  "frequent_customers",
  "customer_history",
  "customer_share",
  "composition",
  "latest_sales",
  "biggest_orders",
  "period_ranking",
  "data_freshness",
  "profit",
  "data_coverage",
];

export type BusinessQuery = {
  metric: BusinessMetric;
  period: PeriodSpec;
  /** "previous" = the comparable period right before `period`. */
  comparison: "previous" | PeriodSpec | null;
  serviceType: ServiceType | null;
  /** Active/new: minimum orders in the period. Dormant: minimum orders before it. */
  minOrders: number;
  limit: number;
  customerName: string | null;
  listMembers: boolean;
  /** Business line, processor, source, building, address, or customer scope. */
  filters?: LedgerFilters | null;
  /** An order counts once if it matches any of these slices ("add them together"). */
  filterUnion?: LedgerFilters[] | null;
  /** period_ranking: which calendar bucket. */
  groupBy?: "month" | "week" | "day" | null;
  /** period_ranking: best/worst first. latest_sales: "earliest" returns the first orders on record. */
  rank?: "best" | "worst" | "earliest" | null;
};

export const CUSTOMER_LOOKBACK_DAYS = 365;

export function defaultBusinessQuery(metric: BusinessMetric): BusinessQuery {
  const period: PeriodSpec =
    metric === "dormant_customers"
      ? { kind: "trailing_days", days: 60 }
      : metric === "top_customers" || metric === "frequent_customers"
        ? { kind: "trailing_days", days: 90 }
        : metric === "customer_history" || metric === "latest_sales" || metric === "biggest_orders"
          ? { kind: "all_time" }
          : metric === "period_ranking" || metric === "customer_share"
            ? { kind: "this_year" }
            : { kind: "trailing_days", days: 30 };
  return {
    metric,
    period,
    comparison: metric === "revenue_drivers" ? "previous" : null,
    serviceType: null,
    minOrders: 1,
    limit: metric === "latest_sales" || metric === "biggest_orders" ? 1 : 5,
    customerName: null,
    listMembers: false,
    filters: null,
    filterUnion: null,
    groupBy: metric === "period_ranking" ? "month" : null,
    rank: metric === "period_ranking" ? "best" : null,
  };
}

export type BusinessCoverage = {
  completeness: LedgerCompleteness;
  loadedSources: LedgerSource[];
  failedSources: LedgerSource[];
  unverifiedNativeCount: number;
  unverifiedNativeCents: number;
  overlap: OverlapProbe;
  /** A service filter was applied while some in-scope CleanCloud orders could not be classified by service. */
  serviceFilterUnclassified: { orders: number; cents: number } | null;
  /** Composition of the current period's result (after filters). */
  lineage: LineageBreakdown | null;
  /** When slices were combined: orders that matched more than one slice (counted once). */
  union: { overlapOrders: number; overlapCents: number } | null;
};

export type BusinessResultData =
  | {
      kind: "totals";
      current: RevenueTotals;
      previous: RevenueTotals | null;
      comparison: TotalsComparison | null;
      /** revenue_drivers only: which customer identities moved revenue most. */
      movers: CustomerMover[] | null;
    }
  | { kind: "open_orders"; openTotal: number; awaitingPayment: number }
  | {
      kind: "customers";
      population: CustomerPopulation;
      activeCount: number | null;
      lookbackStart: string | null;
    }
  | { kind: "top_customers"; members: CustomerSummary[]; rankedBy: "revenue" | "orders" }
  | { kind: "customer_history"; matches: CustomerSummary[]; details: CustomerDetail[] }
  | { kind: "customer_share"; top: CustomerSummary[]; topCents: number; totalCents: number; sharePct: number | null }
  | { kind: "composition"; breakdown: LineageBreakdown }
  | { kind: "orders"; ordering: "latest" | "earliest" | "largest"; orders: OrderBrief[] }
  | { kind: "period_ranking"; groupBy: "month" | "week" | "day"; rows: GroupRow[] }
  | { kind: "freshness"; freshness: DataFreshness }
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

/**
 * Would this result be spoken as "nothing"? Only ledger-derived metrics are considered: a
 * question ABOUT source health (freshness, coverage) must still answer even when sources are
 * unbound, or Claire could never explain why she is blind.
 */
export function businessResultIsEmpty(result: BusinessQueryResult): boolean {
  if (result.status !== "ok") return false;
  const data = result.data;
  switch (data.kind) {
    case "totals":
      return data.current.revenueCents === 0 && data.current.orderCount === 0;
    case "orders":
      return data.orders.length === 0;
    case "customers":
      return data.population.count === 0;
    case "top_customers":
      return data.members.length === 0;
    case "customer_history":
      return data.details.length === 0 && data.matches.length === 0;
    case "customer_share":
      return data.totalCents === 0;
    case "period_ranking":
      return data.rows.length === 0;
    default:
      // open_orders, freshness, composition, profit, data_coverage: not ledger-window zeros.
      return false;
  }
}

export type BusinessQueryDeps = {
  loadLedger: typeof loadPaidOrderLedger;
  loadOpenOrders: (tenantId: string) => Promise<OpenOrderStats>;
  loadCompleteness: (tenantId: string) => Promise<DataCompleteness>;
  loadFreshness?: (input: { tenantId: string; now: Date; timeZone: string }) => Promise<DataFreshness>;
  now: () => Date;
  timeZone: () => string;
};

export const defaultBusinessQueryDeps: BusinessQueryDeps = {
  loadLedger: loadPaidOrderLedger,
  loadOpenOrders: getOpenOrderStats,
  loadCompleteness: getDataCompleteness,
  loadFreshness: loadDataFreshness,
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
  "frequent_customers",
  "customer_history",
  "customer_share",
  "composition",
  "latest_sales",
  "biggest_orders",
  "period_ranking",
  "profit",
]);

/** Apply lineage filters; a customer scope expands to that customer's whole resolved identity. */
export function scopeEvents(
  events: readonly PaidOrderEvent[],
  filters: LedgerFilters | null | undefined,
  filterUnion?: readonly LedgerFilters[] | null
): PaidOrderEvent[] {
  const { customerKeys, ...rest } = filters ?? {};
  let scoped = customerKeys?.length ? eventsForCustomerKeys(events, customerKeys) : [...events];
  scoped = applyLineageFilters(scoped, rest);
  if (filterUnion?.length) {
    scoped = unionOfSlices(scoped, filterUnion.map(slice => ({ filters: slice, label: "" }))).events;
  }
  return scoped;
}

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
    if (query.metric === "data_freshness") {
      const loader = deps.loadFreshness ?? loadDataFreshness;
      return {
        status: "ok",
        query,
        period,
        comparisonPeriod: null,
        coverage: null,
        data: { kind: "freshness", freshness: await loader({ tenantId, now, timeZone }) },
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
    const filtered = scopeEvents(ledger.events, query.filters, query.filterUnion);
    const scopedEvents = filtered.filter(event => inScope(event.businessDate));
    const unverified = ledger.unverifiedNative.filter(order => inScope(order.businessDate));
    const unclassified = query.serviceType
      ? scopedEvents.filter(event => event.source === "cleancloud" && !event.serviceType)
      : [];
    const history = query.serviceType ? filtered.filter(event => event.serviceType === query.serviceType) : filtered;
    let union: BusinessCoverage["union"] = null;
    if (query.filterUnion?.length) {
      const base = scopeEvents(ledger.events, query.filters).filter(event => inScope(event.businessDate));
      const combined = unionOfSlices(base, query.filterUnion.map(slice => ({ filters: slice, label: "" })));
      union = { overlapOrders: combined.overlapOrders, overlapCents: combined.overlapCents };
    }
    const coverage: BusinessCoverage = {
      completeness: ledger.completeness,
      loadedSources: ledger.loadedSources,
      failedSources: ledger.failedSources,
      unverifiedNativeCount: unverified.length,
      unverifiedNativeCents: unverified.reduce((sum, order) => sum + order.cents, 0),
      overlap: detectCrossSourceOverlap(scopedEvents),
      serviceFilterUnclassified: unclassified.length
        ? { orders: unclassified.length, cents: unclassified.reduce((sum, event) => sum + event.cents, 0) }
        : null,
      lineage: lineageBreakdown(eventsInSpan(history, period)),
      union,
    };
    const ok = (data: BusinessResultData): BusinessQueryResult => ({
      status: "ok",
      query,
      period,
      comparisonPeriod,
      coverage,
      data,
    });
    const today = businessToday(now, timeZone);

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
          movers:
            query.metric === "revenue_drivers" && comparisonPeriod
              ? customerRevenueMovers(history, period, comparisonPeriod, 3)
              : null,
        });
      }
      case "composition":
        return ok({ kind: "composition", breakdown: lineageBreakdown(eventsInSpan(history, period)) });
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
          population: dormantCustomerPopulation(history, period, lookbackStart!, query.minOrders),
          activeCount: null,
          lookbackStart,
        });
      case "top_customers":
        return ok({ kind: "top_customers", members: topCustomers(history, period, query.limit), rankedBy: "revenue" });
      case "frequent_customers":
        return ok({ kind: "top_customers", members: mostFrequentCustomers(history, period, query.limit), rankedBy: "orders" });
      case "customer_share": {
        const population = activeCustomerPopulation(history, period, 1).members;
        const top = population.slice(0, Math.max(1, query.limit));
        const topCents = top.reduce((sum, member) => sum + member.revenueCents, 0);
        const totalCents = population.reduce((sum, member) => sum + member.revenueCents, 0);
        return ok({
          kind: "customer_share",
          top,
          topCents,
          totalCents,
          sharePct: totalCents > 0 ? Math.round((topCents / totalCents) * 1000) / 10 : null,
        });
      }
      case "customer_history": {
        const byKeys = Boolean(query.filters?.customerKeys?.length);
        const groups = byKeys
          ? customerGroupsForKeys(history, query.filters!.customerKeys!)
          : customerGroupsMatchingName(history, query.customerName ?? "");
        const details = groups
          .map(group => customerDetailFor(group, period, today))
          .sort((a, b) => b.revenueCents - a.revenueCents || a.displayName.localeCompare(b.displayName));
        const summaries: CustomerSummary[] = details.map(detail => ({
          identityId: detail.identityId,
          displayName: detail.displayName,
          matched: detail.matched,
          orderCount: detail.orderCount,
          revenueCents: detail.revenueCents,
          firstOrderDate: detail.firstOrderDate,
          lastOrderDate: detail.lastOrderDate,
          sources: detail.sources,
        }));
        const matches = byKeys
          ? summaries
          : findCustomersByName(history, period, query.customerName ?? "").filter(match =>
              details.some(detail => detail.identityId === match.identityId)
            );
        return ok({ kind: "customer_history", matches: matches.length ? matches : summaries, details });
      }
      case "latest_sales": {
        const inPeriod = eventsInSpan(history, period);
        return query.rank === "earliest"
          ? ok({ kind: "orders", ordering: "earliest", orders: earliestOrders(inPeriod, query.limit) })
          : ok({ kind: "orders", ordering: "latest", orders: latestOrders(inPeriod, query.limit) });
      }
      case "biggest_orders":
        return ok({ kind: "orders", ordering: "largest", orders: largestOrders(eventsInSpan(history, period), query.limit) });
      case "period_ranking": {
        const groupBy = query.groupBy ?? "month";
        const rows = groupEvents(eventsInSpan(history, period), groupBy).sort((a, b) =>
          query.rank === "worst"
            ? a.revenueCents - b.revenueCents || a.key.localeCompare(b.key)
            : b.revenueCents - a.revenueCents || a.key.localeCompare(b.key)
        );
        return ok({ kind: "period_ranking", groupBy, rows });
      }
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
