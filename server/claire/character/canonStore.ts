import { CLAIRE_CANON } from "./characterDefinition";
import type { CanonFragment, ClaireDisclosureTier, ClaireMode } from "./types";

/**
 * Retrieval gate (Slice 10). Order is fixed and must not be reordered:
 *   1. character is fixed by caller (CLAIRE_CANON)
 *   2. operator relationship state -> disclosure tier (supplied by caller)
 *   3. topic/mode eligibility
 *   4. only THEN retrieve
 * Never "retrieve everything and tell the model not to say some of it" —
 * permanently_private fragments carry no fact text (enforced in
 * characterDefinition.ts) and are additionally hard-excluded here as a
 * second, structural line of defense.
 */

export type CanonRetrievalInput = {
  disclosureTier: ClaireDisclosureTier;
  mode: ClaireMode;
  /** True for field-operations modes (pre_drive/post_stop) where personal canon must not surface. */
  fieldOverride: boolean;
  /** Set only when the operator has directly and unambiguously asked about this exact topic. */
  explicitlyRequestedTopic?: string;
};

export function retrieveEligibleClaireCanon(
  input: CanonRetrievalInput
): CanonFragment[] {
  return CLAIRE_CANON.filter(fragment => {
    // Fail closed #1: permanently private material never leaves this filter.
    if (fragment.accessClass === "permanently_private") return false;
    if (!fragment.fact) return false;

    // Fail closed #2: field mode suppresses all personal canon outright,
    // regardless of tier — field-mode brevity/usefulness outranks depth.
    if (input.fieldOverride && fragment.accessClass !== "core") return false;

    // Fail closed #3: tier gate.
    if (input.disclosureTier < fragment.minTier) return false;

    if (fragment.accessClass === "never_volunteer") {
      // Only eligible if the operator explicitly asked about this exact topic.
      if (input.explicitlyRequestedTopic !== fragment.topic) return false;
    }

    return true;
  });
}

/** Convenience: eligible fragments as short strings ready to inject into a prompt. */
export function eligibleClaireCanonFacts(input: CanonRetrievalInput): string[] {
  return retrieveEligibleClaireCanon(input).map(fragment => fragment.fact);
}
