/**
 * Authored narrative-state fact keys used by COMPLETE D.5 beats.
 * These are story-state facts, not Goldline receipts and not world-truth writes.
 */
export const AUTHORED_NARRATIVE_FACTS = {
  reservedCorePreserved: "reserved_core_preserved",
  lot17kPhysicallyInHand: "lot_17k_physically_in_hand",
  chemistNonSupportiveResult: "chemist_non_supportive_result",
} as const;

export const CHEMIST_NON_SUPPORTIVE_RESULTS = [
  "DOES_NOT_SUPPORT",
  "INSUFFICIENT",
] as const;
