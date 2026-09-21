/**
 * Metacognition: what do we know, how do we know it, and what is still open?
 *
 * This is derived from the evidence bundle, never from a model's self-report. Model
 * confidence is not evidence and has no representation here.
 *
 * The load-bearing rule is Goldline's:
 *
 *   ABSENCE OF EVIDENCE IS NOT EVIDENCE OF ABSENCE.
 *
 * A missing row is not a zero, a failed read is not "none", and an unqueried period is
 * not "nothing happened". `negativeClaimLicensed` is false unless coverage actually
 * proves the domain is complete, so Claire says "I have no verified record of that"
 * rather than "that didn't happen".
 */

import type { EpistemicClass, EpistemicState } from "../contracts/control";
import type { EvidenceItem } from "../contracts/evidence";

function isCurrent(item: EvidenceItem): boolean {
  return item.authoritativeFor.includes("current_business_truth");
}

function isHistorical(item: EvidenceItem): boolean {
  return item.authoritativeFor.includes("historical_observation");
}

function freshnessOf(items: readonly EvidenceItem[]): EpistemicState["freshness"] {
  const withFreshness = items.filter(item => item.freshness);
  if (!withFreshness.length) return "unknown";
  if (withFreshness.some(item => item.freshness?.failedSources.length)) return "stale";
  if (withFreshness.some(item => item.freshness?.completeness && item.freshness.completeness !== "complete")) {
    return "aging";
  }
  return "fresh";
}

function coverageOf(items: readonly EvidenceItem[]): EpistemicState["coverage"] {
  const withCoverage = items.filter(item => item.coverage);
  if (!withCoverage.length) return "unknown";
  return withCoverage.every(item => item.coverage?.complete) ? "complete" : "partial";
}

export function assessEpistemicState(input: {
  evidence: readonly EvidenceItem[];
  unresolvedReferences: string[];
  /** True when a challenged claim was genuinely re-read against the source. */
  priorClaimRechecked: boolean;
  /** Conflicts the monitor found; they change the classification. */
  hasConflict: boolean;
  /** True when the turn asked for something and retrieval was attempted. */
  retrievalAttempted: boolean;
}): EpistemicState {
  const { evidence, unresolvedReferences, priorClaimRechecked, hasConflict, retrievalAttempted } = input;
  const notes: string[] = [];

  const current = evidence.filter(isCurrent);
  const historical = evidence.filter(isHistorical);
  const coverage = coverageOf(evidence);
  const freshness = freshnessOf(evidence);

  let classification: EpistemicClass;
  let sufficiency: EpistemicState["sufficiency"];

  if (hasConflict) {
    classification = "conflicting";
    sufficiency = "incomplete";
    notes.push("sources disagree; the disagreement must be preserved, not averaged away");
  } else if (current.length && coverage === "partial") {
    classification = "partial_current";
    sufficiency = "incomplete";
    notes.push("current evidence exists but coverage is not exhaustive");
  } else if (current.length && freshness === "stale") {
    classification = "stale";
    sufficiency = "incomplete";
    notes.push("a source failed to load; what we have may be out of date");
  } else if (current.length) {
    classification = "known_current";
    sufficiency = "sufficient";
  } else if (historical.length) {
    classification = "known_historical";
    sufficiency = "incomplete";
    notes.push("only historical observation; this cannot speak for the present");
  } else if (retrievalAttempted) {
    classification = "unknown";
    sufficiency = "unavailable";
    notes.push("retrieval ran and returned nothing — that is not the same as zero");
  } else {
    classification = "unknown";
    sufficiency = "unavailable";
    notes.push("nothing was retrieved for this turn");
  }

  if (unresolvedReferences.length) {
    notes.push(`unresolved: ${unresolvedReferences.join(", ")}`);
  }

  /**
   * A negative claim needs proven-complete coverage over current truth. Anything less
   * and the honest answer is "no verified record", not "it did not happen".
   */
  const negativeClaimLicensed =
    classification === "known_current" && coverage === "complete" && freshness !== "stale" && !hasConflict;
  if (!negativeClaimLicensed) {
    notes.push("negative claims are not licensed: absence of evidence is not evidence of absence");
  }

  return {
    classification,
    sufficiency,
    coverage,
    freshness,
    unresolvedReferences,
    negativeClaimLicensed,
    priorClaimRechecked,
    notes,
  };
}

/**
 * How Claire should frame an answer given what she actually knows.
 * Wording belongs to the renderer; this fixes the epistemic hedge it must preserve.
 */
export function epistemicQualifier(state: EpistemicState): string | null {
  switch (state.classification) {
    case "known_current":
      return null;
    case "partial_current":
      return "From the sources I can verify";
    case "known_historical":
      return "From what was recorded at the time";
    case "conflicting":
      return "I have records that don't agree";
    case "stale":
      return "A source didn't load, so this may be out of date";
    case "unverifiable":
      return "I couldn't verify that just now";
    case "unknown":
    default:
      return "I don't have enough verified information";
  }
}
