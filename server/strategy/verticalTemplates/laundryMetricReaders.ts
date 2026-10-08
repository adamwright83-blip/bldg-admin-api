import { getActiveCustomerMetric } from "../../claire/activeCustomerMetric";
import { readCanonicalRevenue } from "../../analytics/canonicalRevenue";
import { addDaysYmd } from "../../analytics/businessPeriods";
import { loadBusinessSourceCoverage } from "../../analytics/sourceCoverage";
import { getDashboardTimeZone, zonedYmd } from "../../dashboardZoned";
import { getStrategyGrowthMetrics } from "../growthMetrics";
import type { AuthoritativeMetricObservation } from "../../agents/persistentOperator/macroGoalRuns";
import type { MetricReader } from "./registry";

function trailingThirtyDayPeriod(asOf: Date, timeZone: string) {
  const endYmd = zonedYmd(asOf, timeZone);
  return {
    startYmd: addDaysYmd(endYmd, -29),
    endYmd,
  };
}

function coverageQuality(
  snapshot: Awaited<ReturnType<typeof loadBusinessSourceCoverage>>
): AuthoritativeMetricObservation["coverage"] {
  if (snapshot.book.exhaustiveCurrent) return "complete";
  if (snapshot.book.status === "stale") return "stale";
  if (snapshot.book.status === "unavailable") return "unavailable";
  return "partial";
}

export const laundryActiveCustomersMetricReader: MetricReader<AuthoritativeMetricObservation> =
  async ({ tenantId, asOf }) => {
    const now = asOf ?? new Date();
    const timeZone = getDashboardTimeZone();
    const [metric, sourceCoverage] = await Promise.all([
      getActiveCustomerMetric({ tenantId, now, timeZone }),
      loadBusinessSourceCoverage({ tenantId, now }),
    ]);
    const coverage = coverageQuality(sourceCoverage);
    const cleancloud = sourceCoverage.sources.find(source => source.sourceId === "cleancloud");
    const cleancloudHeld = Boolean(cleancloud?.includedInCombinedBook);
    const economicSpan = sourceCoverage.book.scope.cleancloudEconomicEvents;
    const windowStartYmd = zonedYmd(new Date(metric.windowStart), timeZone);
    const windowEndYmd = zonedYmd(new Date(metric.windowEnd), timeZone);
    const paidWindowCovered =
      !cleancloudHeld ||
      Boolean(
        economicSpan &&
          economicSpan.from <= windowStartYmd &&
          economicSpan.through >= windowEndYmd
      );
    const exact =
      metric.completeness === "complete" &&
      coverage === "complete" &&
      paidWindowCovered &&
      metric.unmatchedCount === 0;
    const scopedCoverage =
      metric.value === null || metric.completeness === "unavailable"
        ? "unavailable"
        : exact
          ? "complete"
          : coverage === "complete"
            ? "partial"
            : coverage;
    return {
      value: metric.value,
      observationRef:
        metric.value === null
          ? null
          : `strategy.active_customers.v1:${tenantId}:${metric.windowStart}:${metric.windowEnd}:${metric.computedAt}`,
      precision: metric.value === null ? "missing" : exact ? "exact" : "recorded_only",
      coverage: scopedCoverage,
      observedAt: metric.computedAt,
    };
  };

export const laundryNewPayingCustomersMetricReader: MetricReader<AuthoritativeMetricObservation> =
  async ({ tenantId, asOf }) => {
    const now = asOf ?? new Date();
    const timeZone = getDashboardTimeZone();
    const period = trailingThirtyDayPeriod(now, timeZone);
    const [metrics, sourceCoverage] = await Promise.all([
      getStrategyGrowthMetrics({ tenantId, period, now, timeZone }),
      loadBusinessSourceCoverage({ tenantId, now }),
    ]);
    const cleancloud = sourceCoverage.sources.find(source => source.sourceId === "cleancloud");
    const cleancloudHeld = Boolean(cleancloud?.includedInCombinedBook);
    const economicSpan = sourceCoverage.book.scope.cleancloudEconomicEvents;
    const fullPaidHistoryCovered =
      !cleancloudHeld ||
      Boolean(
        economicSpan &&
          economicSpan.from <= "2020-01-01" &&
          economicSpan.through >= period.endYmd
      );
    const exact =
      sourceCoverage.book.exhaustiveCurrent &&
      fullPaidHistoryCovered &&
      metrics.newPayingCustomers.uncertainCount === 0;
    const baseCoverage = coverageQuality(sourceCoverage);
    const scopedCoverage =
      exact ? "complete" : baseCoverage === "complete" ? "partial" : baseCoverage;
    return {
      value: metrics.newPayingCustomers.count,
      observationRef: `strategy.new_paying_customers.v1:${tenantId}:${period.startYmd}:${period.endYmd}:${metrics.computedAt}`,
      precision: exact ? "exact" : "recorded_only",
      coverage: scopedCoverage,
      observedAt: metrics.computedAt,
    };
  };

export const laundryPaidOrdersMetricReader: MetricReader<AuthoritativeMetricObservation> =
  async ({ tenantId, asOf }) => {
    const now = asOf ?? new Date();
    const timeZone = getDashboardTimeZone();
    const period = trailingThirtyDayPeriod(now, timeZone);
    const result = await readCanonicalRevenue({
      tenantId,
      from: period.startYmd,
      to: period.endYmd,
      timeZone,
      now,
    });
    if (result.status === "unavailable") {
      return {
        value: null,
        observationRef: null,
        precision: "missing",
        coverage: "unavailable",
        observedAt: now.toISOString(),
      };
    }
    return {
      value: result.exactIncludedOrderCount,
      observationRef: `strategy.paid_orders_per_period.v1:${tenantId}:${period.startYmd}:${period.endYmd}:${now.toISOString()}`,
      precision: result.mayStateExact ? "exact" : "recorded_only",
      coverage: result.mayStateExact ? "complete" : result.coverage.bookStatus === "stale" ? "stale" : "partial",
      observedAt: now.toISOString(),
    };
  };

export const laundryNetSalesMetricReader: MetricReader<AuthoritativeMetricObservation> =
  async ({ tenantId, asOf }) => {
    const now = asOf ?? new Date();
    const timeZone = getDashboardTimeZone();
    const period = trailingThirtyDayPeriod(now, timeZone);
    const result = await readCanonicalRevenue({
      tenantId,
      from: period.startYmd,
      to: period.endYmd,
      timeZone,
      now,
    });
    if (result.status === "unavailable") {
      return {
        value: null,
        observationRef: null,
        precision: "missing",
        coverage: "unavailable",
        observedAt: now.toISOString(),
      };
    }
    return {
      value: result.recordedCents / 100,
      observationRef: `strategy.net_sales_per_period.v1:${tenantId}:${period.startYmd}:${period.endYmd}:${now.toISOString()}`,
      precision: result.mayStateExact ? "exact" : "recorded_only",
      coverage: result.mayStateExact ? "complete" : result.coverage.bookStatus === "stale" ? "stale" : "partial",
      observedAt: now.toISOString(),
    };
  };
