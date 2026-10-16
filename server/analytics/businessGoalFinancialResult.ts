import { getDashboardTimeZone, zonedDayStartUtc } from "../dashboardZoned";
import {
  businessToday,
  isValidYmd,
  resolvePeriod,
  type ResolvedPeriod,
} from "./businessPeriods";
import {
  readCanonicalRevenue,
  type CanonicalRevenueResult,
} from "./canonicalRevenue";
import type {
  LedgerLoaders,
  LedgerSource,
  PaidOrderEvent,
} from "./paidOrderLedger";
import type { BusinessSourceCoverageSnapshot } from "./sourceCoverage";

/**
 * Verified figures for a business goal, read from the paid-order ledger.
 *
 * `readCanonicalRevenue` is the only money read. Captured cents come from that
 * ledger. This module does not open `paymentReconciliationMatches`, does not
 * call `reconcileClearentDailySummaries`, and does not store a second sum.
 *
 * Three figures stay separate:
 * - total verified collections: every included captured cent in the window
 * - revenue associated with a goal action: included cents whose event is
 *   explicitly tied to that action
 * - substantiated additional earnings: associated cents that are also proved
 *   to be a new sale, not an order that already existed
 *
 * Paying a normal existing order does not complete "another $500." Collections
 * after the goal starts are not that additional figure. A stored macro goal
 * whose source note is `business_goal_engine:v1` and
 * `comparison=period_increment` is an increment across its horizon. Its
 * `targetValue` is not the trailing-30 `net_sales_per_period` level, and it
 * is not every collection after `startedAt`.
 */

export const BUSINESS_GOAL_FINANCIAL_LEDGER = "paid_order_ledger" as const;

export const WEEKLY_ADDITIONAL_EARNINGS = "weekly_additional_earnings" as const;

export const PERIOD_INCREMENT = "period_increment" as const;

/** Note prefix written by the business-goal engine onto an operator macro goal. */
export const BUSINESS_GOAL_ENGINE_NOTE_PREFIX = "business_goal_engine:v1";

/** Another $500.00 of captured earnings. */
export const ANOTHER_FIVE_HUNDRED_DOLLARS = Object.freeze({
  currency: "usd" as const,
  additionalCents: 50_000,
});

export type UsdAdditionalTarget = {
  currency: "usd";
  additionalCents: number;
};

/**
 * A paid-order event tied to a goal action. The cents are the ledger event's
 * captured cents. This link does not carry an amount.
 */
export type GoalActionRevenueLink = {
  eventKey: string;
  actionEvidenceRef: string;
  relation: "existing_collection" | "additional_earning";
  /** Required before an additional-earning claim counts. */
  substantiationRef?: string | null;
};

export type WeeklyAdditionalEarningsGoal = {
  kind: typeof WEEKLY_ADDITIONAL_EARNINGS;
  tenantId: string;
  target: UsdAdditionalTarget;
  /** Used only to recognize orders that already existed. It does not score collections. */
  startedAt: Date;
  now?: Date;
  timeZone?: string;
  goalActionLinks?: readonly GoalActionRevenueLink[];
};

export type StoredMacroGoalFinancialRequest = {
  kind: "stored_macro_goal";
  tenantId: string;
  metricKey: string;
  /** Stored as the macro-goal number. Not the scoring target. */
  targetValue: number;
  unit: string;
  sourceNote: string;
  targetDate?: string | null;
  now?: Date;
  timeZone?: string;
  goalActionLinks?: readonly GoalActionRevenueLink[];
};

export type BusinessGoalFinancialRequest =
  | WeeklyAdditionalEarningsGoal
  | StoredMacroGoalFinancialRequest;

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

export type BusinessGoalHorizon = {
  start: string;
  end: string;
  observedThrough: string;
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
  goalKind: typeof WEEKLY_ADDITIONAL_EARNINGS | typeof PERIOD_INCREMENT;
  tenantId: string;
  week: BusinessGoalWeek;
  horizon: BusinessGoalHorizon | null;
  countedFrom: string;
  target: UsdAdditionalTarget;
  /** Present when a stored macro goal's targetValue was not used as the score. */
  ignoredTargetValue: number | null;
  totalVerifiedCollectionsCents: number;
  /** Included cents at or after startedAt. Not additional earnings. Null for a stored horizon. */
  collectionsOnOrAfterStartCents: number | null;
  goalActionRevenueCents: number | null;
  substantiatedAdditionalCents: number | null;
  remainingCents: number | null;
  goalActionEventKeys: string[];
  substantiatedEventKeys: string[];
  sources: LedgerSource[];
  precision: "exact" | "recorded_only";
  mayStateExact: boolean;
  met: boolean;
  withheld: BusinessGoalWithheld;
};

export type UnavailableBusinessGoalFinancialResult = {
  status: "unavailable";
  ledger: typeof BUSINESS_GOAL_FINANCIAL_LEDGER;
  goalKind: typeof WEEKLY_ADDITIONAL_EARNINGS | typeof PERIOD_INCREMENT;
  tenantId: string;
  week: BusinessGoalWeek;
  horizon: BusinessGoalHorizon | null;
  countedFrom: string;
  target: UsdAdditionalTarget;
  ignoredTargetValue: number | null;
  totalVerifiedCollectionsCents: null;
  collectionsOnOrAfterStartCents: null;
  goalActionRevenueCents: null;
  substantiatedAdditionalCents: null;
  remainingCents: null;
  met: false;
  precision: "missing";
  reason: "sources_unavailable" | "horizon_not_started";
};

export type NotPeriodIncrementResult = {
  status: "not_period_increment";
  ledger: typeof BUSINESS_GOAL_FINANCIAL_LEDGER;
  tenantId: string;
  metricKey: string;
  targetValue: number;
  met: false;
  reason: "target_value_is_not_a_period_increment";
};

export type BusinessGoalFinancialResult =
  | MeasuredBusinessGoalFinancialResult
  | UnavailableBusinessGoalFinancialResult
  | NotPeriodIncrementResult;

export type PeriodIncrementNote = {
  additionalCents: number;
  horizonStart: string;
  horizonEnd: string;
};

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

/** Reads the engine note. A missing comparison is not a period increment. */
export function readPeriodIncrementNote(
  sourceNote: string
): PeriodIncrementNote | null {
  const text = sourceNote.trim();
  if (!text.startsWith(BUSINESS_GOAL_ENGINE_NOTE_PREFIX)) return null;
  const fields = new Map<string, string>();
  for (const token of text.split(/\s+/).slice(1)) {
    const splitAt = token.indexOf("=");
    if (splitAt <= 0) continue;
    fields.set(token.slice(0, splitAt), token.slice(splitAt + 1));
  }
  if (fields.get("comparison") !== PERIOD_INCREMENT) return null;
  const additionalCents = Number(fields.get("cents"));
  if (!Number.isSafeInteger(additionalCents) || additionalCents <= 0)
    return null;
  const horizon = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(
    fields.get("horizon") ?? ""
  );
  if (!horizon) return null;
  const horizonStart = horizon[1]!;
  const horizonEnd = horizon[2]!;
  if (
    !isValidYmd(horizonStart) ||
    !isValidYmd(horizonEnd) ||
    horizonEnd < horizonStart
  ) {
    return null;
  }
  return { additionalCents, horizonStart, horizonEnd };
}

function withheldFrom(
  revenue: Extract<CanonicalRevenueResult, { status: "ok" }>
): BusinessGoalWithheld {
  return {
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
  };
}

function scoreLinks(input: {
  events: readonly PaidOrderEvent[];
  links: readonly GoalActionRevenueLink[] | undefined;
  additionalCutoff: Date;
}): {
  goalActionRevenueCents: number | null;
  substantiatedAdditionalCents: number | null;
  goalActionEventKeys: string[];
  substantiatedEventKeys: string[];
} {
  const events = new Map(input.events.map(event => [event.eventKey, event]));
  const seen = new Set<string>();
  let associated = 0;
  let additional = 0;
  const goalActionEventKeys: string[] = [];
  const substantiatedEventKeys: string[] = [];
  let considered = false;
  for (const link of input.links ?? []) {
    if (!link.actionEvidenceRef?.trim()) continue;
    considered = true;
    if (seen.has(link.eventKey)) continue;
    seen.add(link.eventKey);
    const event = events.get(link.eventKey);
    if (!event) continue;
    associated += event.cents;
    goalActionEventKeys.push(event.eventKey);
    const provedNewSale =
      link.relation === "additional_earning" &&
      Boolean(link.substantiationRef?.trim()) &&
      Boolean(
        event.placedAt &&
          event.placedAt.getTime() >= input.additionalCutoff.getTime()
      );
    if (!provedNewSale) continue;
    additional += event.cents;
    substantiatedEventKeys.push(event.eventKey);
  }
  if (!considered) {
    return {
      goalActionRevenueCents: null,
      substantiatedAdditionalCents: null,
      goalActionEventKeys,
      substantiatedEventKeys,
    };
  }
  return {
    goalActionRevenueCents: associated,
    substantiatedAdditionalCents: additional,
    goalActionEventKeys,
    substantiatedEventKeys,
  };
}

export function projectBusinessGoalFigures(input: {
  tenantId: string;
  goalKind: MeasuredBusinessGoalFinancialResult["goalKind"];
  target: UsdAdditionalTarget;
  week: BusinessGoalWeek;
  horizon: BusinessGoalHorizon | null;
  countedFrom: string;
  ignoredTargetValue: number | null;
  /** When set, collections at or after this instant are reported and are not the score. */
  startedAt: Date | null;
  /** A sale placed before this instant is not additional earnings. */
  additionalCutoff: Date;
  links?: readonly GoalActionRevenueLink[];
  revenue: CanonicalRevenueResult;
}): BusinessGoalFinancialResult {
  const tenantId = requireTenant(input.tenantId);
  const target = requireTarget(input.target);
  if (
    input.revenue.status === "unavailable" ||
    input.revenue.tenantId !== tenantId
  ) {
    return {
      status: "unavailable",
      ledger: BUSINESS_GOAL_FINANCIAL_LEDGER,
      goalKind: input.goalKind,
      tenantId,
      week: input.week,
      horizon: input.horizon,
      countedFrom: input.countedFrom,
      target,
      ignoredTargetValue: input.ignoredTargetValue,
      totalVerifiedCollectionsCents: null,
      collectionsOnOrAfterStartCents: null,
      goalActionRevenueCents: null,
      substantiatedAdditionalCents: null,
      remainingCents: null,
      met: false,
      precision: "missing",
      reason: "sources_unavailable",
    };
  }

  const revenue = input.revenue;
  const totalVerifiedCollectionsCents = revenue.recordedCents;
  let collectionsOnOrAfterStartCents: number | null = null;
  if (input.startedAt) {
    const startedAt = input.startedAt.getTime();
    const after = revenue.includedEvents
      .filter(event => event.occurredAt.getTime() >= startedAt)
      .reduce((sum, event) => sum + event.cents, 0);
    const before = totalVerifiedCollectionsCents - after;
    if (before + after !== totalVerifiedCollectionsCents) {
      throw new Error("Collections left the paid-order ledger");
    }
    collectionsOnOrAfterStartCents = after;
  }
  const links = scoreLinks({
    events: revenue.includedEvents,
    links: input.links,
    additionalCutoff: input.additionalCutoff,
  });
  if (
    links.goalActionRevenueCents != null &&
    links.goalActionRevenueCents > totalVerifiedCollectionsCents
  ) {
    throw new Error("Goal-action revenue left the paid-order ledger");
  }
  if (
    links.substantiatedAdditionalCents != null &&
    links.goalActionRevenueCents != null &&
    links.substantiatedAdditionalCents > links.goalActionRevenueCents
  ) {
    throw new Error("Additional earnings left the goal-action revenue");
  }
  const mayStateExact = revenue.mayStateExact;
  const substantiated = links.substantiatedAdditionalCents;
  return {
    status: "measured",
    ledger: BUSINESS_GOAL_FINANCIAL_LEDGER,
    goalKind: input.goalKind,
    tenantId,
    week: input.week,
    horizon: input.horizon,
    countedFrom: input.countedFrom,
    target,
    ignoredTargetValue: input.ignoredTargetValue,
    totalVerifiedCollectionsCents,
    collectionsOnOrAfterStartCents,
    goalActionRevenueCents: links.goalActionRevenueCents,
    substantiatedAdditionalCents: substantiated,
    remainingCents:
      substantiated == null
        ? null
        : Math.max(0, target.additionalCents - substantiated),
    goalActionEventKeys: links.goalActionEventKeys,
    substantiatedEventKeys: links.substantiatedEventKeys,
    sources: revenue.provenance.sources,
    precision: mayStateExact ? "exact" : "recorded_only",
    mayStateExact,
    met:
      mayStateExact &&
      substantiated != null &&
      substantiated >= target.additionalCents,
    withheld: withheldFrom(revenue),
  };
}

async function readWindow(input: {
  tenantId: string;
  week: BusinessGoalWeek;
  now: Date;
  timeZone: string;
  deps: BusinessGoalFinancialDeps;
}): Promise<CanonicalRevenueResult> {
  const readRevenue = input.deps.readRevenue ?? readCanonicalRevenue;
  return readRevenue({
    tenantId: input.tenantId,
    from: input.week.start,
    to: input.week.end,
    timeZone: input.timeZone,
    now: input.now,
    coverage: input.deps.coverage,
    loaders: input.deps.loaders,
  });
}

export async function readBusinessGoalFinancialResult(
  goal: BusinessGoalFinancialRequest,
  deps: BusinessGoalFinancialDeps = {}
): Promise<BusinessGoalFinancialResult> {
  if (goal.kind === "stored_macro_goal") {
    const tenantId = requireTenant(goal.tenantId);
    const note = readPeriodIncrementNote(goal.sourceNote);
    if (!note) {
      return {
        status: "not_period_increment",
        ledger: BUSINESS_GOAL_FINANCIAL_LEDGER,
        tenantId,
        metricKey: goal.metricKey,
        targetValue: goal.targetValue,
        met: false,
        reason: "target_value_is_not_a_period_increment",
      };
    }
    const now = requireInstant(goal.now ?? new Date(), "now");
    const timeZone = goal.timeZone ?? getDashboardTimeZone();
    const today = businessToday(now, timeZone);
    const horizon: BusinessGoalHorizon = {
      start: note.horizonStart,
      end: note.horizonEnd,
      observedThrough: today < note.horizonEnd ? today : note.horizonEnd,
    };
    const countedFrom = note.horizonStart;
    const target = requireTarget({
      currency: "usd",
      additionalCents: note.additionalCents,
    });
    if (today < note.horizonStart) {
      return {
        status: "unavailable",
        ledger: BUSINESS_GOAL_FINANCIAL_LEDGER,
        goalKind: PERIOD_INCREMENT,
        tenantId,
        week: {
          start: note.horizonStart,
          end: note.horizonStart,
          timeZone,
          label: "goal horizon",
        },
        horizon,
        countedFrom,
        target,
        ignoredTargetValue: goal.targetValue,
        totalVerifiedCollectionsCents: null,
        collectionsOnOrAfterStartCents: null,
        goalActionRevenueCents: null,
        substantiatedAdditionalCents: null,
        remainingCents: null,
        met: false,
        precision: "missing",
        reason: "horizon_not_started",
      };
    }
    const week: BusinessGoalWeek = {
      start: note.horizonStart,
      end: horizon.observedThrough,
      timeZone,
      label: "goal horizon",
    };
    const revenue = await readWindow({ tenantId, week, now, timeZone, deps });
    return projectBusinessGoalFigures({
      tenantId,
      goalKind: PERIOD_INCREMENT,
      target,
      week,
      horizon,
      countedFrom,
      ignoredTargetValue: goal.targetValue,
      startedAt: null,
      additionalCutoff: zonedDayStartUtc(note.horizonStart, timeZone),
      links: goal.goalActionLinks,
      revenue,
    });
  }

  if (goal.kind !== WEEKLY_ADDITIONAL_EARNINGS) {
    throw new Error("Unsupported business goal");
  }
  const tenantId = requireTenant(goal.tenantId);
  const target = requireTarget(goal.target);
  const startedAt = requireInstant(goal.startedAt, "startedAt");
  const now = requireInstant(goal.now ?? new Date(), "now");
  const timeZone = goal.timeZone ?? getDashboardTimeZone();
  const week = weekOf(resolvePeriod({ kind: "this_week" }, now, timeZone));
  const revenue = await readWindow({ tenantId, week, now, timeZone, deps });
  return projectBusinessGoalFigures({
    tenantId,
    goalKind: WEEKLY_ADDITIONAL_EARNINGS,
    target,
    week,
    horizon: null,
    countedFrom: startedAt.toISOString(),
    ignoredTargetValue: null,
    startedAt,
    additionalCutoff: startedAt,
    links: goal.goalActionLinks,
    revenue,
  });
}
