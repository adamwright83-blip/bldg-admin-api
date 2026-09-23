/**
 * Authored consequence of the Clockhead finale.
 *
 * Canon: LEVEL COMPLETE, then Rook on the line, then he joins the party.
 * That is companion.rook. It is not kingdom.brass_republic completion and
 * it is not capability.rook.contact.
 *
 * Five recorded Colosseum visits satisfy kingdom_binding.level.colosseum.
 * They are not this consequence. A client flag named rookOwned is not either.
 */
export const COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE =
  "clockhead_finale.rook_joined_the_party" as const;

export type ColosseumAuthoredFinaleConsequence =
  typeof COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE;
