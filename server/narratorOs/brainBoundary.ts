import { isVerifiedGoldlineReceipt } from "./verifiedGoldlineReceipt";

/**
 * One-way valve: verified business may inform Narrator eligibility.
 * Narrator fiction must never write Brain business truth or Goldline evidence.
 *
 * REAL BUSINESS → CLAIRE BRAIN → VERIFIED BUSINESS TRUTH → NARRATOR ELIGIBILITY INPUT
 * Never: NARRATOR FICTION → CLAIRE BRAIN BUSINESS TRUTH
 *
 * Structural `{ verificationClass: "VERIFIED" }` is not authority. Brand
 * possession is not authority either. Only an upstream-issued or rehydrated
 * VerifiedGoldlineReceipt satisfies eligibility Goldline evidence.
 */
export const NARRATOR_BRAIN_BOUNDARY = {
  narratorMustNotImportBrainWm: true,
  narratorMustNotWriteGoldlineWorldEvents: true,
  narratorMustNotMintBusinessTruth: true,
  brainMustNotDependOnNarrativeEligibility: true,
} as const;

export function isLegalEligibilityGoldlineEvidence(value: unknown): boolean {
  return isVerifiedGoldlineReceipt(value);
}
