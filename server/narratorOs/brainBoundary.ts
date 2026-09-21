/**
 * One-way valve: verified business may inform Narrator eligibility.
 * Narrator fiction must never write Brain business truth or Goldline evidence.
 *
 * REAL BUSINESS → CLAIRE BRAIN → VERIFIED BUSINESS TRUTH → NARRATOR ELIGIBILITY INPUT
 * Never: NARRATOR FICTION → CLAIRE BRAIN BUSINESS TRUTH
 */
export const NARRATOR_BRAIN_BOUNDARY = {
  narratorMustNotImportBrainWm: true,
  narratorMustNotWriteGoldlineWorldEvents: true,
  narratorMustNotMintBusinessTruth: true,
  brainMustNotDependOnNarrativeEligibility: true,
} as const;

export function isLegalEligibilityGoldlineEvidence(input: {
  verificationClass: string;
  evidenceClass: string;
}): boolean {
  return (
    input.verificationClass === "VERIFIED" &&
    (input.evidenceClass === "authoritative_external" ||
      input.evidenceClass === "operator_attested")
  );
}
