export const GOLDLINE_EVIDENCE_CLASSES = [
  "authoritative_external",
  "operator_attested",
  "derived",
  "game_projection",
] as const;

export type GoldlineEvidenceClass = (typeof GOLDLINE_EVIDENCE_CLASSES)[number];

export type GoldlineEvidenceRef = {
  sourceType: string;
  sourceReference: string;
  classification: GoldlineEvidenceClass;
  observedAt: string | null;
};

/**
 * Business truth may only be promoted by evidence that came from the real
 * world: an authoritative external system or an explicit human attestation.
 * Derived intelligence can recommend; game projection can present. Neither can
 * create the fact they are describing.
 */
export function canSupportBusinessTruth(evidence: GoldlineEvidenceRef): boolean {
  return (
    evidence.classification === "authoritative_external" ||
    evidence.classification === "operator_attested"
  );
}

export function hasBusinessTruthEvidence(
  evidence: readonly GoldlineEvidenceRef[]
): boolean {
  return evidence.some(canSupportBusinessTruth);
}

export function assertBusinessTruthEvidence(
  evidence: readonly GoldlineEvidenceRef[],
  claim = "business truth"
): void {
  if (!hasBusinessTruthEvidence(evidence)) {
    throw new Error(
      `${claim} requires authoritative external or operator-attested evidence`
    );
  }
}

export function assertGameProjectionDoesNotPromoteTruth(input: {
  source: GoldlineEvidenceClass;
  target: GoldlineEvidenceClass;
}): void {
  if (
    input.source === "game_projection" &&
    (input.target === "authoritative_external" ||
      input.target === "operator_attested")
  ) {
    throw new Error("Game projection cannot create business truth");
  }
}

export const GOLDLINE_TRUTH_LAWS = {
  oneIdentity: "A real entity exists once; product surfaces are projections of it.",
  evidenceBeforeOutcome:
    "A business outcome requires authoritative external or operator-attested evidence.",
  actionIsNotOutcome:
    "Effort, contact, outreach, gameplay, and attempted work do not imply success.",
  uncertaintyStaysUncertain:
    "Unknown or unresolved reality stays unresolved until new evidence arrives.",
  gameCannotWriteReality:
    "Game projection may represent business truth but may never manufacture it.",
} as const;
