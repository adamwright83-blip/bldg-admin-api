import type { DaphneRelationship } from "../agents/daphne/relationshipModel";

export type DaphneNarrativeRelationshipContext = {
  readonly agentId: string;
  readonly stanceHints: readonly string[];
  readonly unresolvedRuptureCount: number;
  readonly sourceObservationIds: readonly string[];
  readonly mayAuthorizeBeat: false;
  readonly mayAuthorizeDisclosure: false;
  readonly mayCreateNarrativeFact: false;
};

/**
 * Read-only bridge from Daphne's dyadic relationship history into presentation
 * context. This object is deliberately incapable of satisfying Narrator OS
 * eligibility, knowledge, occurrence, or disclosure gates.
 */
export function daphneRelationshipContextForNarrator(
  relationship: DaphneRelationship | null
): DaphneNarrativeRelationshipContext | null {
  if (!relationship) return null;
  const hints: string[] = [];
  if (relationship.unresolvedRuptures.length) {
    hints.push("relationship_repair_priority");
  }
  if (relationship.boundaries.length) {
    hints.push("honor_recorded_boundaries");
  }
  if (relationship.corrections.length) {
    hints.push("avoid_repeating_corrected_interaction_pattern");
  }
  return Object.freeze({
    agentId: relationship.agentId,
    stanceHints: Object.freeze(hints),
    unresolvedRuptureCount: relationship.unresolvedRuptures.length,
    sourceObservationIds: Object.freeze([...relationship.sourceObservationIds]),
    mayAuthorizeBeat: false as const,
    mayAuthorizeDisclosure: false as const,
    mayCreateNarrativeFact: false as const,
  });
}
