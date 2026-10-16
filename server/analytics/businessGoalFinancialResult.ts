import { getDashboardTimeZone } from "../dashboardZoned";
import { resolvePeriod, type ResolvedPeriod } from "./businessPeriods";
import {
  readCanonicalRevenue,
  type CanonicalRevenueResult,
} from "./canonicalRevenue";
import type { LedgerLoaders, LedgerSource } from "./paidOrderLedger";
import type { BusinessSourceCoverageSnapshot } from "./sourceCoverage";

/**
 * Verified progress for a business goal, read from the paid-order ledger.
 *
 * `readCanonicalRevenue` is the only money read. It already reconciles
 * receipt-admitted native captures and CleanCloud paid observations, including
 * the sales-reconciliation decisions stored on that ledger. This module does
 * not open `paymentReconciliationMatches`, does not call
 * `reconcileClearentDailySummaries`, and does not store a second sum.
 *
 * The first goal is weekly additional earnings: "another $500 this week" is
 * `{ currency: "usd", additionalCents: 50000 }` counted from `startedAt`
 * through the current business week. Captured cents before `startedAt` stay
 * in the week book and do not count as progress. A goal is met only when that
 * ledger may state the week as exact and the progress cents reach the target.
 * Recorded-only and unreadable books do not complete a goal. An unreadable
 * book is not zero.
 */

export const BUSINESS_GOAL_FINANCIAL_LEDGER = "paid_order_ledger" as const;

export const WEEKLY_ADDITIONAL_EARNINGS = "weekly_additional_earnings" as const;

/** Another $500.00 of captured earnings. */
export const ANOTHER_FIVE_HUNDRED_DOLLARS = Object.freeze({
  currency: "usd" as const,
  additionalCents: 50_000,
});

export type UsdAdditionalTarget = {
  currency: "usd";
  additionalCents: number;
};

export type WeeklyAdditionalEarningsGoal = {
  kind: typeof WEEKLY_ADDITIONAL_EARNINGS;
  tenantId: string;
  target: UsdAdditionalTarget;
  /** Earnings at or after this instant count. Earlier earnings in the same week do not. */
  startedAt: Date;
  now?: Date;
  timeZone?: string;
};

export type BusinessGoalFinancialRequest = WeeklyAdditionalEarningsGoal;

export type BusinessGoalFinancialDeps = {
  coverage?: BusinessSourceCoverageSnapshot | null;
  loaders?: LedgerLoaders;
  readRevenue?: typeof readCanonicalRevenue;
};

export type BusinessGoalWeek = {
  start: string;
  end: string;
  timeZone: string;
  label: string;
};

export type BusinessGoalWithheld = {
  suspectedCount: number;
  suspectedCents: number;
  unverifiedNativeCount: number;
  unverifiedNativeCents: number;
  unverifiedPaymentAuthorityCount: number;
  unverifiedPaymentAuthorityCents: number;
  undatedAdjustmentCount: number;
  undatedAdjustmentCents: number;
};

export type MeasuredBusinessGoalFinancialResult = {
  status: "measured";
  ledger: typeof BUSINESS_GOAL_FINANCIAL_LEDGER;
  goalKind: typeof WEEKLY_ADDITIONAL_EARNINGS;
  tenantId: string;
  week: BusinessGoalWeek;
  countedFrom: string;
  target: UsdAdditionalTarget;
  verifiedProgressCents: number;
  alreadyEarnedBeforeGoalCents: number;
  weekRecordedCents: number;
  remainingCents: number;
  orderCount: number;
  includedEventKeys: string[];
  sources: LedgerSource[];
  precision: "exact" | "recorded_only";
  mayStateExact: boolean;
  met: boolean;
  withheld: BusinessGoalWithheld;
};

export type UnavailableBusinessGoalFinancialResult = {
  status: "unavailable";
  ledger: typeof BUSINESS_GOAL_FINANCIAL_LEDGER;
  goalKind: typeof WEEKLY_ADDITIONAL_EARNINGS;
  tenantId: string;
  week: BusinessGoalWeek;
  countedFrom: string;
  target: UsdAdditionalTarget;
  verifiedProgressCents: null;
  remainingCents: null;
  met: false;
  precision: "missing";
  reason: "sources_unavailable";
};

export type BusinessGoalFinancialResult =
  | MeasuredBusinessGoalFinancialResult
  | UnavailableBusinessGoalFinancialResult;

function requireTenant(tenantId: string): string {
  const trimmed = tenantId.trim();
  if (!trimmed)
    throw new Error("Business goal financial result requires tenantId");
  return trimmed;
}

function requireTarget(target: UsdAdditionalTarget): UsdAdditionalTarget {
  if (target?.currency !== "usd") {
    throw new Error("Weekly additional earnings are USD captured cents");
  }
  if (
    !Number.isSafeInteger(target.additionalCents) ||
    target.additionalCents <= 0
  ) {
    throw new Error(
      "Weekly additional earnings require a positive whole-cent target"
    );
  }
  return { currency: "usd", additionalCents: target.additionalCents };
}

function requireInstant(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid instant`);
  }
  return value;
}

function weekOf(period: ResolvedPeriod): BusinessGoalWeek {
  return {
    start: period.start,
    end: period.end,
    timeZone: period.timeZone,
    label: period.label,
  };
}

export function projectWeeklyAdditionalEarnings(input: {
  tenantId: string;
  target: UsdAdditionalTarget;
  startedAt: Date;
  week: BusinessGoalWeek;
  revenue: CanonicalRevenueResult;
}): BusinessGoalFinancialResult {
  const tenantId = requireTenant(input.tenantId);
  const target = requireTarget(input.target);
  const startedAt = requireInstant(input.startedAt, "startedAt");
  const countedFrom = startedAt.toISOString();
  if (
    input.revenue.status === "unavailable" ||
    input.revenue.tenantId !== tenantId
  ) {
    return {
      status: "unavailable",
      ledger: BUSINESS_GOAL_FINANCIAL_LEDGER,
      goalKind: WEEKLY_ADDITIONAL_EARNINGS,
      tenantId,
      week: input.week,
      countedFrom,
      target,
      verifiedProgressCents: null,
      remainingCents: null,
      met: false,
      precision: "missing",
      reason: "sources_unavailable",
    };
  }

  const revenue = input.revenue;
  const before = revenue.includedEvents.filter(
    event => event.occurredAt.getTime() < startedAt.getTime()
  );
  const after = revenue.includedEvents.filter(
    event => event.occurredAt.getTime() >= startedAt.getTime()
  );
  const alreadyEarnedBeforeGoalCents = before.reduce(
    (sum, event) => sum + event.cents,
    0
  );
  const verifiedProgressCents = after.reduce(
    (sum, event) => sum + event.cents,
    0
  );
  if (
    alreadyEarnedBeforeGoalCents + verifiedProgressCents !==
    revenue.recordedCents
  ) {
    throw new Error("Weekly earnings progress left the paid-order ledger");
  }

  const mayStateExact = revenue.mayStateExact;
  return {
    status: "measured",
    ledger: BUSINESS_GOAL_FINANCIAL_LEDGER,
    goalKind: WEEKLY_ADDITIONAL_EARNINGS,
    tenantId,
    week: input.week,
    countedFrom,
    target,
    verifiedProgressCents,
    alreadyEarnedBeforeGoalCents,
    weekRecordedCents: revenue.recordedCents,
    remainingCents: Math.max(0, target.additionalCents - verifiedProgressCents),
    orderCount: after.length,
    includedEventKeys: after.map(event => event.eventKey),
    sources: revenue.provenance.sources,
    precision: mayStateExact ? "exact" : "recorded_only",
    mayStateExact,
    met: mayStateExact && verifiedProgressCents >= target.additionalCents,
    withheld: {
      suspectedCount: revenue.suspectedWithheld.count,
      suspectedCents: revenue.suspectedWithheld.cents,
      unverifiedNativeCount: revenue.unverifiedNative.count,
      unverifiedNativeCents: revenue.unverifiedNative.cents,
      unverifiedPaymentAuthorityCount:
        revenue.unverifiedPaymentAuthority?.count ?? 0,
      unverifiedPaymentAuthorityCents:
        revenue.unverifiedPaymentAuthority?.cents ?? 0,
      undatedAdjustmentCount: revenue.undatedAdjustments?.count ?? 0,
      undatedAdjustmentCents: revenue.undatedAdjustments?.cents ?? 0,
    },
  };
}

export async function readBusinessGoalFinancialResult(
  goal: BusinessGoalFinancialRequest,
  deps: BusinessGoalFinancialDeps = {}
): Promise<BusinessGoalFinancialResult> {
  if (goal.kind !== WEEKLY_ADDITIONAL_EARNINGS) {
    throw new Error("Unsupported business goal");
  }
  const tenantId = requireTenant(goal.tenantId);
  const target = requireTarget(goal.target);
  const startedAt = requireInstant(goal.startedAt, "startedAt");
  const now = requireInstant(goal.now ?? new Date(), "now");
  const timeZone = goal.timeZone ?? getDashboardTimeZone();
  const week = weekOf(resolvePeriod({ kind: "this_week" }, now, timeZone));
  const readRevenue = deps.readRevenue ?? readCanonicalRevenue;
  const revenue = await readRevenue({
    tenantId,
    from: week.start,
    to: week.end,
    timeZone,
    now,
    coverage: deps.coverage,
    loaders: deps.loaders,
  });
  return projectWeeklyAdditionalEarnings({
    tenantId,
    target,
    startedAt,
    week,
    revenue,
  });
}
