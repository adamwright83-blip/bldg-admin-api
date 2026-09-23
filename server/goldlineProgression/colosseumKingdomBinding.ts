/**
 * Server-authoritative real-world side of `kingdom_binding.level.colosseum`.
 *
 * This is the existing Colosseum evidence predicate previously private as
 * `isColosseumComplete` in `server/goldlineKingdoms/kingdomUnlocks.ts`.
 * It reads recorded open-channel Day 1 outcome keys for the Greystar
 * Koreatown lead hunt (`greystar-koreatown-five`). It does not resolve
 * `level.colosseum`, own `companion.rook`, or complete `kingdom.brass_republic`.
 * A stored kingdom row named `kingdom-1-colosseum` is not this binding.
 */
import { leadHuntDefinitionForCampaign } from "../campaignLibrary/leadHuntRoundTrip";

export const COLOSSEUM_KINGDOM_BINDING_ID = "kingdom_binding.level.colosseum" as const;

export const COLOSSEUM_KINGDOM_BINDING_FUNCTION = "colosseumKingdomBindingSatisfied" as const;

const COLOSSEUM_LEGACY_REF = { leadHuntId: "greystar-koreatown-five" } as const;

export function colosseumLeadHuntDefinition() {
  return leadHuntDefinitionForCampaign({
    legacyContract: "lead_hunt",
    legacyContractRef: COLOSSEUM_LEGACY_REF,
  });
}

/**
 * True only when every authoritative Colosseum lead-hunt target id has a
 * recorded outcome key. Outcome kind is not re-interpreted here: this matches
 * the predicate `deriveKingdomStatuses` already uses for its legacy lantern
 * status, and nothing else.
 */
export function colosseumKingdomBindingSatisfied(outcomes: Record<string, unknown>): boolean {
  const definition = colosseumLeadHuntDefinition();
  if (!definition) return false;
  const recorded = new Set(Object.keys(outcomes));
  return definition.targetIds.every(id => recorded.has(id));
}
