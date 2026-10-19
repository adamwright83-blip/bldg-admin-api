import type { BusinessDriver } from "./strategicIntelligence";

/**
 * Work Thread identity contract (Phase 2 · Slice A).
 *
 * A Work Thread is one underlying business opportunity a tenant pursues over
 * time ("recover lapsed Silver Lake customers"). It is not a recommendation
 * sentence, an hourly decision, a diagnosis, a customer target, an attempt, an
 * observation window or a goal.
 *
 * Identity is the minted `work_threads.id`. The opportunity key below is only
 * how a newly observed opportunity finds its open thread:
 *  - it is built from structured scope (vertical, lever, population, area, or
 *    the work's durable source id), never from wording, diagnosis ids,
 *    timestamps or goal-cycle occurrence ids;
 *  - a key has at most one open thread. Once that thread closes, the same key
 *    mints a new thread (a new initiative), so the key is never the identity;
 *  - two work items share a thread only when their keys are equal. Sharing a
 *    neighborhood and an action type is not enough: one customer's recovery
 *    and the area-wide recovery program are different keys, and so are two
 *    customers.
 */
export const WORK_THREAD_KEY_VERSION = "v1";

/** Candidate ids for strategy work: stable for the life of the thread. */
export const WORK_THREAD_CANDIDATE_PREFIX = "work_thread:";

/** Who an opportunity is about, independent of how it is worded or which customers it names this hour. */
export const STRATEGY_OPPORTUNITY_POPULATIONS = [
  /** Customers who bought before and stopped. */
  "lapsed_customers",
  /** Customers who have not made a second purchase. */
  "first_purchase_customers",
  /** Customers not yet acquired. */
  "new_customers",
  /** Existing customers buying more often. */
  "current_customers",
  /** A business-wide driver: unit economics, capacity, cash, unexplained performance. */
  "business",
  /** The sales data source itself. */
  "sales_source",
] as const;
export type StrategyOpportunityPopulation = (typeof STRATEGY_OPPORTUNITY_POPULATIONS)[number];

export type StrategyOpportunity = {
  kind: "strategy_opportunity";
  verticalKey: string;
  /** The business lever pursued. A tactic or a revisited hypothesis does not change it. */
  lever: BusinessDriver;
  population: StrategyOpportunityPopulation;
  /** Normalized neighborhood key ("silver_lake"); null when business-wide. */
  area: string | null;
};

export type WorkSubjectOpportunity = {
  kind: "work_subject";
  /**
   * The durable source identity of non-strategy work: the Weekly Growth
   * candidate id, which is built from source ids (follow-up, obligation,
   * customer, campaign, commitment), never from wording or time.
   */
  subjectRef: string;
};

export type WorkThreadOpportunity = StrategyOpportunity | WorkSubjectOpportunity;

/** Pure: a neighborhood label as a key. Spacing, case and punctuation never split a thread. */
export function normalizeAreaKey(label: string | null | undefined): string | null {
  const key = (label ?? "")
    .toLowerCase()
    .replace(/^\s*(?:in|around|near)\s+/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key || null;
}

const segment = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_");

/** Pure: the deterministic matching key for an opportunity. Not an identity. */
export function workThreadOpportunityKey(opportunity: WorkThreadOpportunity): string {
  if (opportunity.kind === "work_subject") {
    const subject = opportunity.subjectRef.trim();
    if (!subject) throw new Error("Work subject opportunity requires a durable subject reference");
    return `work:${WORK_THREAD_KEY_VERSION}:${subject}`;
  }
  const vertical = segment(opportunity.verticalKey);
  if (!vertical) throw new Error("Strategy opportunity requires a vertical");
  return [
    "strategy",
    WORK_THREAD_KEY_VERSION,
    vertical,
    segment(opportunity.lever),
    segment(opportunity.population),
    opportunity.area ? `area=${normalizeAreaKey(opportunity.area)}` : "business",
  ].join(":");
}

export function workThreadCandidateId(threadId: string): string {
  return `${WORK_THREAD_CANDIDATE_PREFIX}${threadId}`;
}

/** The thread a candidate id names, or null for any other id (including pre-thread `diagnosis_…:strategy-…` ids). */
export function workThreadIdFromCandidateId(candidateId: string | null | undefined): string | null {
  if (!candidateId?.startsWith(WORK_THREAD_CANDIDATE_PREFIX)) return null;
  const id = candidateId.slice(WORK_THREAD_CANDIDATE_PREFIX.length).trim();
  return id || null;
}
