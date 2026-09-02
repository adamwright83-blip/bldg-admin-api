/**
 * Which dormant customer the lever deals.
 *
 * The lever is a carnival machine: you pull it, and one real dormant customer
 * drops out as a mission. The temptation is to make that random, which would be
 * wrong twice over — it invites reroll behaviour (pull, dislike the customer,
 * refresh, pull again) and it throws away the ranking Goldline already computed
 * from real order history.
 *
 * So selection is DETERMINISTIC. Same world, same pull, same customer. The only
 * thing that changes who you get is reality changing.
 *
 * Pure functions on already-scored snapshots — no database, no scoring of its
 * own. `scoreCustomerChurn` in shared/customerChurn.ts already weighs lateness
 * against expected cadence, monthly impact, history depth and poundage trend,
 * and suppresses anyone with an active order. This module only chooses.
 */

/** The lever's two directions, as printed on the machine. Shared with the
 * client so the UI cannot offer a pull the server would reject. */
export { LEVER_PULLS, type LeverPull } from "../../shared/hustlerLever";
import type { LeverPull } from "../../shared/hustlerLever";

/**
 * The fields of a churn snapshot this module needs. Deliberately a structural
 * subset so the selector can be tested without constructing a full snapshot,
 * and so a snapshot gaining fields cannot silently change who gets dealt.
 */
export type LeverCandidate = {
  id: string;
  score: number;
  activeOrderCount: number;
  historyOrderCount: number;
  daysSinceLastOrder: number | null;
  estimatedMonthlyImpactCents: number | null;
};

/**
 * The eligibility floor, matching `createCustomerRecoveryIntervention`. Dealing
 * a customer the service would then refuse to accept would be a lever that
 * hands out missions it cannot start.
 */
export const LEVER_MIN_SCORE = 40;

/**
 * A customer can only be dealt if the recovery service would actually accept
 * them. These are the service's own preconditions, restated here so the lever
 * fails at the machine rather than at the mutation.
 */
export function isDealable(candidate: LeverCandidate): boolean {
  return (
    candidate.score >= LEVER_MIN_SCORE &&
    candidate.activeOrderCount === 0 &&
    candidate.historyOrderCount >= 2
  );
}

/**
 * Ranks candidates for one lever direction.
 *
 * Both directions draw from the SAME pool — they are a sort preference, not two
 * separate populations. Splitting the pool would let a customer be permanently
 * invisible to one side of the machine.
 *
 *   warm       favours a real relationship worth rekindling: order history
 *              first, then how overdue they are. The easier, higher-odds pull.
 *   big_swing  favours money: estimated monthly impact first. Harder to win
 *              back, worth more if you do.
 *
 * Ties break on score, then on id, so the ordering is total and stable. Without
 * that final id tiebreak two equally-ranked customers could swap places between
 * pulls and the "no rerolls" promise would quietly break.
 */
export function rankCandidates(
  candidates: readonly LeverCandidate[],
  pull: LeverPull
): LeverCandidate[] {
  const dealable = candidates.filter(isDealable);
  return [...dealable].sort((a, b) => {
    if (pull === "big_swing") {
      const impact =
        (b.estimatedMonthlyImpactCents ?? 0) - (a.estimatedMonthlyImpactCents ?? 0);
      if (impact !== 0) return impact;
    } else {
      const history = b.historyOrderCount - a.historyOrderCount;
      if (history !== 0) return history;
      const overdue = (b.daysSinceLastOrder ?? 0) - (a.daysSinceLastOrder ?? 0);
      if (overdue !== 0) return overdue;
    }
    if (b.score !== a.score) return b.score - a.score;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The customer this pull deals, or null when the machine has nothing to give.
 *
 * `excludeIds` carries customers who already have an open mission. They are not
 * skipped because they are unworthy — they are skipped because they are ALREADY
 * your mission, and the service enforces one open mission per customer with a
 * unique index. Dealing them again would either collide or silently hand back a
 * mission you have already started, which reads as the machine repeating itself.
 */
export function selectLeverCandidate(
  candidates: readonly LeverCandidate[],
  pull: LeverPull,
  excludeIds: readonly string[] = []
): LeverCandidate | null {
  const excluded = new Set(excludeIds);
  return rankCandidates(candidates, pull).find(c => !excluded.has(c.id)) ?? null;
}

/**
 * Why the machine came up empty, in terms the operator can act on.
 *
 * "Nothing to deal" has several very different causes and they need different
 * responses — running a scan, waiting for cadence to lapse, or finishing the
 * mission already on the table. Collapsing them into one shrug is the same
 * mistake the CleanCloud importer made when a provider failure and an
 * unreadable screenshot shared a sentence.
 */
export type EmptyReason =
  | "no_scan"
  | "all_active"
  | "all_engaged"
  | "all_in_progress";

export function explainEmpty(
  candidates: readonly LeverCandidate[],
  excludeIds: readonly string[] = []
): EmptyReason {
  if (candidates.length === 0) return "no_scan";
  const dealable = candidates.filter(isDealable);
  if (dealable.length === 0) {
    // Distinguish "they are all still ordering" from "none are overdue enough".
    return candidates.some(c => c.activeOrderCount > 0) ? "all_active" : "all_engaged";
  }
  if (excludeIds.length > 0) return "all_in_progress";
  return "all_engaged";
}
