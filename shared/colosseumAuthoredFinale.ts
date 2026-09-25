/**
 * Authored consequence of the Clockhead finale.
 *
 * Canon: LEVEL COMPLETE, then Rook is heard on the line and the hunt begins.
 * Colosseum resolves level.colosseum only. It does NOT own companion.rook,
 * grant capability.rook.contact, or complete kingdom.brass_republic.
 *
 * Durable companion ownership now belongs to the authored Coastal Market
 * stealing/catch beat after the server has already recorded the Colosseum.
 */
export const COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE =
  "clockhead_finale.rook_revealed_on_the_line" as const;

export const COASTAL_MARKET_ROOK_CATCH_CONSEQUENCE =
  "coastal_market.rook_caught_stealing" as const;

export type ColosseumAuthoredFinaleConsequence =
  typeof COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE;

export type CoastalMarketRookCatchConsequence =
  typeof COASTAL_MARKET_ROOK_CATCH_CONSEQUENCE;
