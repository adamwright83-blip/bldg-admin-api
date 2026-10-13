import { resolveCustomerIdentities } from "../../analytics/customerIdentityResolution";
import {
  databaseLedgerLoaders,
  loadPaidOrderLedger,
  type PaidOrderEvent,
  type LedgerLoaders,
} from "../../analytics/paidOrderLedger";
import { loadBusinessSourceCoverage } from "../../analytics/sourceCoverage";
import { reconcileLedgerSpan } from "../../analytics/canonicalRevenue";
import {
  getDashboardTimeZone,
  zonedDayStartUtc,
  zonedYmd,
} from "../../dashboardZoned";
import { addDaysYmd } from "../../analytics/businessPeriods";
import type { AuthoritativeMetricObservation } from "../../agents/persistentOperator/macroGoalRuns";

/** Fully observed 30-day follow-up, not a cohort that entered yesterday.
 * Cohort entrants were first seen 30–59 business days ago. This is observed
 * first-in-history, not a claim about lifetime behavior without coverage. */
export function deriveMatureRepeatCohort(
  events: PaidOrderEvent[],
  input: { now: Date; timeZone: string }
) {
  const asOf = zonedYmd(input.now, input.timeZone);
  const from = addDaysYmd(asOf, -59);
  const through = addDaysYmd(asOf, -30);
  const groups = resolveCustomerIdentities(
    events.filter(e => e.occurredAt <= input.now),
    e => e.identity
  ).groups;
  let cohort = 0;
  let repeated = 0;
  let unmatched = 0;
  for (const g of groups) {
    const orders = [...g.records].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
    );
    const first = orders[0];
    if (!first || first.businessDate < from || first.businessDate > through)
      continue;
    if (!g.matched) {
      unmatched++;
      continue;
    }
    cohort++;
    const followUpThrough = addDaysYmd(first.businessDate, 30);
    if (orders.slice(1).some(e => e.businessDate <= followUpThrough))
      repeated++;
  }
  return { cohort, repeated, unmatched, from, through, asOf };
}
export async function readLaundryMatureRepeatCohort(
  input: { tenantId: string; asOf?: Date; timeZone?: string },
  loaders: LedgerLoaders = databaseLedgerLoaders
): Promise<{
  cohort: AuthoritativeMetricObservation;
  repeated: AuthoritativeMetricObservation;
}> {
  const now = input.asOf ?? new Date();
  const timeZone = input.timeZone ?? getDashboardTimeZone();
  const asOf = zonedYmd(now, timeZone);
  const [ledger, coverage] = await Promise.all([
    loadPaidOrderLedger(
      {
        tenantId: input.tenantId,
        startUtc: zonedDayStartUtc("2020-01-01", timeZone),
        endExclusiveUtc: now,
        timeZone,
      },
      loaders
    ),
    loadBusinessSourceCoverage({ tenantId: input.tenantId, now }),
  ]);
  const cohort = deriveMatureRepeatCohort(
    reconcileLedgerSpan(ledger, { start: "2020-01-01", end: asOf })
      .includedEvents,
    { now, timeZone }
  );
  const externalHeld = coverage.sources.some(
    s => s.sourceId === "cleancloud" && s.includedInCombinedBook
  );
  const history = coverage.book.scope.cleancloudEconomicEvents;
  const exact =
    coverage.book.exhaustiveCurrent &&
    !ledger.failedSources.length &&
    !ledger.unverifiedNative.length &&
    cohort.unmatched === 0 &&
    (!externalHeld ||
      Boolean(
        history && history.from <= "2020-01-01" && history.through >= asOf
      ));
  const observation = (
    value: number,
    key: string
  ): AuthoritativeMetricObservation => ({
    value,
    observationRef: `strategy.mature_repeat.v1:${input.tenantId}:${cohort.from}:${cohort.through}:${key}:${now.toISOString()}`,
    precision: exact ? "exact" : "recorded_only",
    coverage: exact
      ? "complete"
      : coverage.book.status === "stale"
        ? "stale"
        : "partial",
    observedAt: now.toISOString(),
  });
  return {
    cohort: observation(cohort.cohort, "cohort"),
    repeated: observation(cohort.repeated, "repeated"),
  };
}
