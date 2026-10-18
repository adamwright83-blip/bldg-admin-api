/**
 * Canonical Weekly Growth Candidate contract.
 *
 * Project B owns this type. Server assembly lives in `server/weeklyGrowthCandidates/`.
 * Do not fork a second candidate type under Claire, Mission Director, or weekly mission.
 *
 * A candidate is a real growth motion the business already supports. It is not a
 * weekday assignment, a primary, a WeeklyIntent, or a projected outcome.
 */

export const WEEKLY_GROWTH_SOURCE_KINDS = [
  "unfinished_growth_work",
  "commercial_follow_up",
  "proactive_obligation",
  "customer_recovery",
  "campaign_library",
  "strategy_diagnosis",
] as const;
export type WeeklyGrowthSourceKind = (typeof WEEKLY_GROWTH_SOURCE_KINDS)[number];

export const WEEKLY_GROWTH_MOTIONS = [
  "continue_existing",
  "commercial_follow_up",
  "customer_recovery",
  "account_acquisition",
  "territory_expansion",
  "relationship_capital",
  "reputation",
  "retention",
  "digital_presence",
  "alliance",
  "investigation",
] as const;
export type WeeklyGrowthMotion = (typeof WEEKLY_GROWTH_MOTIONS)[number];

export const WEEKLY_GROWTH_RANK_REASONS = [
  "CONTINUE_EXISTING_WORK",
  "FOLLOW_UP_DUE",
  "FOLLOW_UP_OVERDUE",
  "PROACTIVE_OBLIGATION_ACTIVE",
  "HIGH_CHURN_PRIORITY",
  "STRONG_CUSTOMER_HISTORY",
  "MACRO_GOAL_ALIGNED",
  "CAMPAIGN_ENABLED",
  "PREP_REQUIRED",
  "INSUFFICIENT_PREP",
  "LOW_CONFIDENCE_ASSUMPTION",
] as const;
export type WeeklyGrowthRankReason = (typeof WEEKLY_GROWTH_RANK_REASONS)[number];

export const WEEKLY_GROWTH_POCKET_KINDS = [
  "between_stops",
  "open_ended",
  "pre_route",
  "post_route",
  "any",
] as const;
export type WeeklyGrowthPocketKind = (typeof WEEKLY_GROWTH_POCKET_KINDS)[number];

/** Legacy presentation-cap values. Discovery does not apply them to the rankable universe. */
export const WEEKLY_GROWTH_CAPS = {
  total: 15,
  followUp: 5,
  recovery: 3,
  campaign: 8,
} as const;

export const WEEKLY_GROWTH_SOURCE_REPORT_KEYS = [
  ...WEEKLY_GROWTH_SOURCE_KINDS,
  "macro_goal",
] as const;
export type WeeklyGrowthSourceReportKey = (typeof WEEKLY_GROWTH_SOURCE_REPORT_KEYS)[number];

export type WeeklyGrowthSourceRef = {
  sourceKind: WeeklyGrowthSourceKind;
  sourceType: string;
  sourceId: string;
};

export type WeeklyGrowthProvenance = {
  reader: string;
  sourceType: string;
  sourceIds: string[];
  /** Read time. Excluded from the semantic fingerprint. */
  observedAt: string;
};

export type WeeklyGrowthPrep = {
  leadDays: number;
  condition: string | null;
  feasibleWithinHorizon: boolean;
};

export type WeeklyGrowthFit = {
  pocketKind: WeeklyGrowthPocketKind | null;
  minimumMinutes: number | null;
};

/** Facts the source already recorded. Not estimates and not assumptions. */
export type WeeklyGrowthObservedSignal = {
  label: string;
  value: string;
  source: string;
  sourceIds: string[];
};

/**
 * Guidance the source already stored as an assumption.
 * Confidence and evidence class stay null when the source did not record them.
 */
export type WeeklyGrowthAssumption = {
  text: string;
  source: string;
  recordedAt: string;
  confidence: "low" | "medium" | "high" | null;
  evidenceClass: string | null;
};

export type WeeklyGrowthCandidate = {
  id: string;
  sourceKind: WeeklyGrowthSourceKind;
  motion: WeeklyGrowthMotion;
  title: string;
  objective: string;
  alreadyInFlight: boolean;
  /** Execution type recorded when the work was approved; never re-derived from text. */
  storedExecutionType?: "mission" | "challenge";
  /** Observed due date from the source. Not a recommended business date. */
  observedDueDate: string | null;
  sourceRefs: WeeklyGrowthSourceRef[];
  provenance: WeeklyGrowthProvenance;
  prep: WeeklyGrowthPrep;
  fit: WeeklyGrowthFit;
  observedSignals: WeeklyGrowthObservedSignal[];
  assumptions: WeeklyGrowthAssumption[];
  confidence: "low" | "medium" | "high";
  /**
   * Legacy descriptive tags retained for compatibility. They are not ordering
   * authority; Mission Director owns all priority effects.
   */
  rankReasons: WeeklyGrowthRankReason[];
  /**
   * The durable Work Thread this work already belongs to: strategy work from
   * its diagnosis, approved work from the commitment that carries it. Absent
   * when the source names none; the goal cycle then resolves one from `id`.
   */
  workThreadId?: string;
  /** Records grouped into this candidate named different threads; no thread is guessed. */
  conflictingWorkThreadIds?: string[];
  /**
   * The neighborhood this work is in (a normalized area key), when its source
   * scopes it. Work without one is never credited to a goal limited to an area.
   */
  scopeArea?: string;
};

export type WeeklyGrowthSourceReport =
  | {
      status: "available";
      /** Rows the reader returned, before the growth filter. */
      observedCount: number;
      /** Rows that passed the filter, before dedupe. */
      eligibleCount: number;
      /** Candidates of this winning source after dedupe, before caps. */
      rankedCount: number;
      /** Candidates of this winning source present in the feed. */
      shownCount: number;
    }
  | {
      status: "unavailable";
      reason: string;
    };

export type WeeklyGrowthCandidateFeed = {
  tenantId: string;
  operatorUserId: string;
  dayDirectorActorId: string;
  /** Read time. Excluded from the semantic fingerprint. */
  generatedAt: string;
  fingerprint: string;
  candidates: WeeklyGrowthCandidate[];
  sources: Record<WeeklyGrowthSourceReportKey, WeeklyGrowthSourceReport>;
  /**
   * Legacy presentation caps are retained as metadata only. Candidate discovery
   * never hides rankable work before Mission Director.
   */
  caps: typeof WEEKLY_GROWTH_CAPS;
  capsApplied: false;
};

export type LoadWeeklyGrowthCandidatesInput = {
  tenantId: string;
  operatorUserId: string;
  operatorUserIds?: readonly string[];
  dayDirectorActorId: string;
  dayDirectorActorIds?: readonly string[];
  /** Remaining business dates. Used only to judge prep feasibility. */
  remainingDates: readonly string[];
  /** Planning-date override. Prevents future-date planning from borrowing the wall clock date. */
  businessDate?: string;
  now: Date;
  timeZone: string;
};

const ACQUISITION_METRICS = new Set(["new_paying_customers", "active_customers"]);
const VOLUME_METRICS = new Set(["paid_orders_per_period", "net_sales_per_period"]);

/**
 * Macro-goal alignment raises relevance of motions the goal already names.
 * It never creates a candidate. Reputation, digital presence, and alliance
 * stay unaligned for an acquisition or volume goal.
 */
export function motionAlignsWithMacroGoal(metricKey: string, motion: WeeklyGrowthMotion): boolean {
  const known = ACQUISITION_METRICS.has(metricKey) || VOLUME_METRICS.has(metricKey);
  if (!known) return false;
  switch (motion) {
    case "account_acquisition":
    case "territory_expansion":
    case "relationship_capital":
    case "commercial_follow_up":
    case "customer_recovery":
    case "retention":
      return true;
    case "continue_existing":
    case "reputation":
    case "digital_presence":
    case "alliance":
    case "investigation":
      return false;
  }
}

/** Bump when the contribution table changes, so stored Mission Director plans recompute. */
export const GOAL_CONTRIBUTION_POLICY_VERSION = "goal-contribution-v1";

export type GoalContributionTier = "direct_fast" | "direct_slow" | "protects" | "indirect" | "none";

const GOAL_CONTRIBUTION_EFFECT: Record<GoalContributionTier, number> = {
  direct_fast: 180,
  direct_slow: 140,
  protects: 90,
  indirect: 50,
  none: 0,
};

/**
 * How directly a kind of work moves the operator's goal metric, and how soon.
 * A ranking policy judgment that never forecasts revenue or customers. Replaces
 * the flat bonus every "aligned" motion used to get, so that for an
 * active-customers goal, winning back a lapsed regular outranks a referral ask.
 */
export function goalContribution(
  metricKey: string,
  motion: WeeklyGrowthMotion
): { tier: GoalContributionTier; effect: number; reason: string } {
  const pick = (tier: GoalContributionTier, reason: string) => ({ tier, effect: GOAL_CONTRIBUTION_EFFECT[tier], reason });
  if (!motionAlignsWithMacroGoal(metricKey, motion)) return pick("none", "does not move this goal metric");
  if (metricKey === "active_customers") {
    switch (motion) {
      case "customer_recovery": return pick("direct_fast", "a lapsed customer who orders again counts as active right away");
      case "account_acquisition":
      case "territory_expansion":
      case "commercial_follow_up": return pick("direct_slow", "adds active customers, after a longer sales cycle");
      case "retention": return pick("protects", "keeps current customers from dropping out of the count");
      default: return pick("indirect", "can lead to new customers through other people");
    }
  }
  if (metricKey === "new_paying_customers") {
    switch (motion) {
      case "account_acquisition":
      case "territory_expansion": return pick("direct_slow", "brings in customers who have never paid");
      case "commercial_follow_up": return pick("direct_fast", "advances an account already in conversation");
      case "relationship_capital": return pick("indirect", "can lead to new customers through referrals");
      default: return pick("indirect", "returning customers are not new customers");
    }
  }
  // Volume goals (paid orders, net sales).
  switch (motion) {
    case "customer_recovery":
    case "retention": return pick("direct_fast", "known customers order again soonest");
    case "commercial_follow_up":
    case "account_acquisition":
    case "territory_expansion": return pick("direct_slow", "new accounts add volume after a longer cycle");
    default: return pick("indirect", "can lead to more orders through other people");
  }
}

export function addCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year!, (month ?? 1) - 1, (day ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

/**
 * Prep feasibility is a fact about the horizon. It does not choose a date.
 * Work already in flight is feasible: the lead time has already been spent.
 */
export function prepFeasibleWithinHorizon(input: {
  leadDays: number;
  today: string;
  remainingDates: readonly string[];
  alreadyInFlight: boolean;
}): boolean {
  if (input.alreadyInFlight) return true;
  const horizon = input.remainingDates.filter(date => date >= input.today);
  if (horizon.length === 0) return false;
  if (input.leadDays <= 0) return true;
  const earliest = addCalendarDays(input.today, input.leadDays);
  return horizon.some(date => date >= earliest);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (key === "generatedAt" || key === "observedAt" || key === "fingerprint") continue;
      out[key] = stableValue(record[key]);
    }
    return out;
  }
  return value;
}

/**
 * Canonical JSON for the semantic fingerprint.
 * `generatedAt`, provenance `observedAt`, object key order, and the previous
 * fingerprint are omitted. Candidate order is preserved because it is content.
 */
export function canonicalWeeklyGrowthFeed(feed: WeeklyGrowthCandidateFeed | Omit<WeeklyGrowthCandidateFeed, "fingerprint">): string {
  return JSON.stringify(stableValue(feed));
}
