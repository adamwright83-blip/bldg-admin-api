import { fromZonedTime } from "date-fns-tz";
import {
  ACTIVE_CUSTOMER_DEFINITION,
  getActiveCustomerMetric,
  activeCustomerWindow,
  type ActiveCustomerLoaders,
  type ActiveCustomerMetric,
} from "../claire/activeCustomerMetric";
import {
  interpretSourceCoverage,
  loadRevenueSourceCoverage,
  reconcilePaidRevenue,
} from "../analytics/canonicalRevenue";
import { activeCustomerPopulation } from "../analytics/businessMetrics";
import { resolveCustomerIdentities } from "../analytics/customerIdentityResolution";
import {
  databaseLedgerLoaders,
  loadPaidOrderLedger,
  type LedgerLoaders,
  type PaidOrderEvent,
} from "../analytics/paidOrderLedger";
import { getDashboardTimeZone, zonedDayStartUtc, zonedYmd } from "../dashboardZoned";

export type ProvenanceRecord = {
  sourceService: string;
  queryOrDefinition: string;
  window: string;
  computedAt: string;
};

export type WeeklyTrendPoint = {
  weekIndex: number; // 0 is oldest (8 weeks ago), 7 is current
  weekEndingYmd: string;
  count: number;
};

export type StrategyActiveCustomersResult = {
  count: number;
  definition: string;
  windowStart: string;
  windowEnd: string;
  trend: WeeklyTrendPoint[];
  provenance: ProvenanceRecord;
};

export type UncertainCustomerReason = {
  identityKey: string;
  reason: string;
};

export type StrategyGrowthMetricsResult = {
  period: {
    startYmd: string;
    endYmd: string;
  };
  newPayingCustomers: {
    count: number;
    uncertainCount: number;
    uncertainReasons: UncertainCustomerReason[];
    provenance: ProvenanceRecord;
  };
  reactivatedCustomers: {
    count: number;
    inactivityDaysRule: number;
    provenance: ProvenanceRecord;
  };
  paidOrders: {
    count: number;
    provenance: ProvenanceRecord;
  };
  netSales: {
    amountCents: number;
    isUncertain: boolean;
    uncertaintyReason: string | null;
    provenance: ProvenanceRecord;
  };
  repeatConversion: {
    cohortSize: number;
    repeatCount: number;
    conversionRate: number;
    observationWindowDays: number;
    provenance: ProvenanceRecord;
  };
  netActiveChange: {
    change: number;
    startActiveCount: number;
    endActiveCount: number;
    provenance: ProvenanceRecord;
  };
  computedAt: string;
};

/**
 * Computes active customer count, definition, business-local window,
 * and 8-week trend.
 */
export async function getStrategyActiveCustomers(
  input: {
    tenantId: string;
    now?: Date;
    timeZone?: string;
  },
  loaders: ActiveCustomerLoaders = databaseLedgerLoaders
): Promise<StrategyActiveCustomersResult> {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? getDashboardTimeZone();

  const currentMetric = await getActiveCustomerMetric({ tenantId: input.tenantId, now, timeZone }, loaders);

  // Load ledger covering the last 8 weeks + 30 days rolling
  const eightWeeksMs = 8 * 7 * 86_400_000;
  const rolling30DaysMs = 30 * 86_400_000;
  const historyStartUtc = new Date(now.getTime() - (eightWeeksMs + rolling30DaysMs));

  const ledger = await loadPaidOrderLedger(
    {
      tenantId: input.tenantId,
      startUtc: historyStartUtc,
      endExclusiveUtc: new Date(now.getTime() + 1),
      timeZone,
    },
    loaders
  );

  const trend: WeeklyTrendPoint[] = [];
  for (let i = 7; i >= 0; i--) {
    const weekEndTime = new Date(now.getTime() - i * 7 * 86_400_000);
    const window = activeCustomerWindow(weekEndTime, timeZone);
    const pop = activeCustomerPopulation(
      ledger.events,
      { start: zonedYmd(window.start, timeZone), end: zonedYmd(weekEndTime, timeZone) },
      1
    );
    trend.push({
      weekIndex: 7 - i,
      weekEndingYmd: zonedYmd(weekEndTime, timeZone),
      count: pop.count,
    });
  }

  return {
    count: currentMetric.value ?? 0,
    definition: currentMetric.definition,
    windowStart: currentMetric.windowStart,
    windowEnd: currentMetric.windowEnd,
    trend,
    provenance: {
      sourceService: "server/claire/activeCustomerMetric.ts",
      queryOrDefinition: ACTIVE_CUSTOMER_DEFINITION,
      window: `${currentMetric.windowStart}..${currentMetric.windowEnd}`,
      computedAt: currentMetric.computedAt,
    },
  };
}

/**
 * Computes full canonical growth metrics for a given business-local period.
 */
export async function getStrategyGrowthMetrics(
  input: {
    tenantId: string;
    period: { startYmd: string; endYmd: string };
    now?: Date;
    timeZone?: string;
    inactivityDays?: number;
    mockEvents?: PaidOrderEvent[];
    unverifiedCustomers?: Set<string>;
  },
  loaders: LedgerLoaders = databaseLedgerLoaders
): Promise<StrategyGrowthMetricsResult> {
  const timeZone = input.timeZone ?? getDashboardTimeZone();
  const inactivityDaysRule = input.inactivityDays ?? 30;
  const computedAt = (input.now ?? new Date()).toISOString();

  let events: PaidOrderEvent[];
  if (input.mockEvents) {
    events = input.mockEvents;
  } else {
    // Load full historical paid orders from 2020 through period end
    const startUtc = zonedDayStartUtc("2020-01-01", timeZone);
    const endExclusiveUtc = fromZonedTime(`${input.period.endYmd}T23:59:59.999`, timeZone);
    const ledger = await loadPaidOrderLedger(
      {
        tenantId: input.tenantId,
        startUtc,
        endExclusiveUtc,
        timeZone,
      },
      loaders
    );
    events = ledger.events;
  }

  // Resolve customer identities
  const resolved = resolveCustomerIdentities(events, event => event.identity);

  let newPayingCount = 0;
  let uncertainNewCount = 0;
  const uncertainReasons: UncertainCustomerReason[] = [];
  let reactivatedCount = 0;

  let cohortSize = 0;
  let repeatCount = 0;

  for (const group of resolved.groups) {
    // Sort orders chronologically
    const sorted = [...group.records].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    if (sorted.length === 0) continue;

    const firstOrder = sorted[0]!;
    const isFirstInPeriod =
      firstOrder.businessDate >= input.period.startYmd &&
      firstOrder.businessDate <= input.period.endYmd;

    const isCustomerUncertain = input.unverifiedCustomers?.has(group.id) ?? false;

    if (isFirstInPeriod) {
      if (isCustomerUncertain) {
        uncertainNewCount += 1;
        uncertainReasons.push({
          identityKey: group.id,
          reason: "Customer purchase history is unverified or incomplete at import boundary",
        });
      } else {
        newPayingCount += 1;
        // Cohort tracking for repeat conversion
        cohortSize += 1;
        // Check if placed a second paid order
        if (sorted.length >= 2) {
          repeatCount += 1;
        }
      }
    } else if (firstOrder.businessDate < input.period.startYmd) {
      // First order was before period; check if reactivated in period
      const ordersInPeriod = sorted.filter(
        o => o.businessDate >= input.period.startYmd && o.businessDate <= input.period.endYmd
      );

      if (ordersInPeriod.length > 0) {
        // Find the first order in period
        const periodFirst = ordersInPeriod[0]!;
        // Find the immediately preceding order before periodFirst
        const prevOrders = sorted.filter(o => o.occurredAt.getTime() < periodFirst.occurredAt.getTime());
        if (prevOrders.length > 0) {
          const lastPrev = prevOrders[prevOrders.length - 1]!;
          const gapDays = Math.round(
            (periodFirst.occurredAt.getTime() - lastPrev.occurredAt.getTime()) / 86_400_000
          );
          if (gapDays >= inactivityDaysRule) {
            reactivatedCount += 1;
          }
        }
      }
    }
  }

  // Period paid orders and net sales
  const periodEvents = events.filter(
    e => e.businessDate >= input.period.startYmd && e.businessDate <= input.period.endYmd
  );
  const reconciledSales = reconcilePaidRevenue({ events: periodEvents });
  const paidOrdersCount = reconciledSales.exactIncludedOrderCount;
  const netSalesCents = reconciledSales.exactIncludedCents;
  const coverageSnapshot = await loadRevenueSourceCoverage({ tenantId: input.tenantId });
  const salesCoverage = interpretSourceCoverage({
    snapshot: coverageSnapshot,
    window: { from: input.period.startYmd, to: input.period.endYmd },
    loadedSources: [],
    failedSources: [],
  });

  // Net active customer change (rolling active at endYmd vs rolling active at startYmd)
  const startWindowEnd = fromZonedTime(`${input.period.startYmd}T00:00:00`, timeZone);
  const startWindow = activeCustomerWindow(startWindowEnd, timeZone);
  const startPop = activeCustomerPopulation(
    events,
    { start: zonedYmd(startWindow.start, timeZone), end: zonedYmd(startWindowEnd, timeZone) },
    1
  );

  const endWindowEnd = fromZonedTime(`${input.period.endYmd}T23:59:59`, timeZone);
  const endWindow = activeCustomerWindow(endWindowEnd, timeZone);
  const endPop = activeCustomerPopulation(
    events,
    { start: zonedYmd(endWindow.start, timeZone), end: zonedYmd(endWindowEnd, timeZone) },
    1
  );

  const netChange = endPop.count - startPop.count;

  const repeatRate = cohortSize > 0 ? repeatCount / cohortSize : 0;

  return {
    period: input.period,
    newPayingCustomers: {
      count: newPayingCount,
      uncertainCount: uncertainNewCount,
      uncertainReasons,
      provenance: {
        sourceService: "server/strategy/growthMetrics.ts",
        queryOrDefinition: "First-ever verified paid order falls inside period; duplicate identities unified",
        window: `${input.period.startYmd}..${input.period.endYmd}`,
        computedAt,
      },
    },
    reactivatedCustomers: {
      count: reactivatedCount,
      inactivityDaysRule,
      provenance: {
        sourceService: "server/strategy/growthMetrics.ts",
        queryOrDefinition: `Returning customers with previous order gap >= ${inactivityDaysRule} days; never counted as new`,
        window: `${input.period.startYmd}..${input.period.endYmd}`,
        computedAt,
      },
    },
    paidOrders: {
      count: paidOrdersCount,
      provenance: {
        sourceService: "server/analytics/canonicalRevenue.ts",
        queryOrDefinition: "Exact included orders from the canonical revenue read within the business-local period",
        window: `${input.period.startYmd}..${input.period.endYmd}`,
        computedAt,
      },
    },
    netSales: {
      amountCents: netSalesCents,
      isUncertain: true,
      uncertaintyReason: [
        "Canonical paid order ledger does not record refunds or cancellations for cleancloud/native orders",
        reconciledSales.suspectedWithheld.count > 0
          ? "Suspected cross-source duplicates are withheld from an exact total"
          : null,
        salesCoverage.coverageAllowsExact
          ? null
          : "Source coverage does not support an exact total",
      ]
        .filter((part): part is string => Boolean(part))
        .join(". "),
      provenance: {
        sourceService: "server/analytics/canonicalRevenue.ts",
        queryOrDefinition: "readCanonicalRevenue exact included cents within the business-local period",
        window: `${input.period.startYmd}..${input.period.endYmd}`,
        computedAt,
      },
    },
    repeatConversion: {
      cohortSize,
      repeatCount,
      conversionRate: repeatRate,
      observationWindowDays: Math.round(
        (Date.parse(`${input.period.endYmd}T00:00:00Z`) - Date.parse(`${input.period.startYmd}T00:00:00Z`)) /
          86_400_000
      ),
      provenance: {
        sourceService: "server/strategy/growthMetrics.ts",
        queryOrDefinition: "New customers in cohort period who placed a second verified paid order",
        window: `${input.period.startYmd}..${input.period.endYmd}`,
        computedAt,
      },
    },
    netActiveChange: {
      change: netChange,
      startActiveCount: startPop.count,
      endActiveCount: endPop.count,
      provenance: {
        sourceService: "server/claire/activeCustomerMetric.ts",
        queryOrDefinition: "Net active customer change between period start and end",
        window: `${input.period.startYmd}..${input.period.endYmd}`,
        computedAt,
      },
    },
    computedAt,
  };
}
