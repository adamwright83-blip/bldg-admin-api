import {
  EPISTEMIC_STATUSES,
  OUTCOME_IMPACT_CLASSES,
  type EpistemicStatus,
  type OutcomeImpactClass,
} from "./outcomeStore";

/**
 * The one reading of a goal-cycle outcome that learning, the proof scoreboard
 * and the strategic diagnosis all share, so they can never disagree about
 * whether a result went for or against the work that produced it.
 *
 * - `contradicted`: an authoritative rejection, or an outcome that says the
 *   work failed, was blocked, or that its hypothesis was contradicted. It must
 *   never be rewarded.
 * - `supported`: a verified revenue or conversion result on the work's own
 *   objective. This is consistent with the approach, not proof that it caused
 *   the result (docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md §2.3: no causal
 *   claim from observational data).
 * - `inconclusive`: verified, but says nothing either way about the hypothesis
 *   (a completed visit, a delivered message).
 * - `unresolved`: not yet settled (unverified or disputed); nothing may learn from it.
 */
export type OutcomeInterpretation = "supported" | "contradicted" | "inconclusive" | "unresolved";

export type OutcomeInterpretationBasis =
  | "unsettled_evidence"
  | "authoritative_rejection"
  | "outcome_reports_contradiction"
  | "verified_revenue"
  | "verified_conversion"
  | "execution_only"
  | "no_result_signal";

/** Outcome kinds that report the work failed, was blocked, or its hypothesis was contradicted. */
const CONTRADICTING_OUTCOME_KIND = /failed|blocked|contradicted/;

/** Verified conversions. Commercial `won` is a conversion, not paid revenue. */
export const CONVERSION_OUTCOME_KINDS: ReadonlySet<string> = new Set([
  "account_won",
  "customer_reactivated",
  "paid_order",
  "cleancloud_order_paid",
]);

export function interpretGoalCycleOutcome(outcome: {
  outcomeKind: string;
  impactClass: OutcomeImpactClass;
  epistemicStatus: EpistemicStatus;
  monetaryValueCents: number | null;
}): { result: OutcomeInterpretation; basis: OutcomeInterpretationBasis } {
  if (outcome.epistemicStatus === "unverified" || outcome.epistemicStatus === "disputed") {
    return { result: "unresolved", basis: "unsettled_evidence" };
  }
  if (outcome.epistemicStatus === "rejected") {
    return { result: "contradicted", basis: "authoritative_rejection" };
  }
  if (CONTRADICTING_OUTCOME_KIND.test(outcome.outcomeKind)) {
    return { result: "contradicted", basis: "outcome_reports_contradiction" };
  }
  if (outcome.impactClass === "commercial_revenue" && (outcome.monetaryValueCents ?? 0) > 0) {
    return { result: "supported", basis: "verified_revenue" };
  }
  if (CONVERSION_OUTCOME_KINDS.has(outcome.outcomeKind)) {
    return { result: "supported", basis: "verified_conversion" };
  }
  if (outcome.impactClass === "action_verification") {
    return { result: "inconclusive", basis: "execution_only" };
  }
  return { result: "inconclusive", basis: "no_result_signal" };
}

/** For raw `goal_cycle_outcomes` rows. An unknown status reads as unsettled, never as verified. */
export function interpretStoredOutcome(row: {
  outcomeKind: string;
  impactClass: string;
  epistemicStatus: string;
  monetaryValueCents: number | null;
}): { result: OutcomeInterpretation; basis: OutcomeInterpretationBasis } {
  return interpretGoalCycleOutcome({
    outcomeKind: row.outcomeKind,
    impactClass: ((OUTCOME_IMPACT_CLASSES as readonly string[]).includes(row.impactClass)
      ? row.impactClass
      : "operational_result") as OutcomeImpactClass,
    epistemicStatus: ((EPISTEMIC_STATUSES as readonly string[]).includes(row.epistemicStatus)
      ? row.epistemicStatus
      : "unverified") as EpistemicStatus,
    monetaryValueCents: row.monetaryValueCents,
  });
}
