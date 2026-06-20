import {
  evaluateVendorReputationEvidence,
  toVendorEvidenceSnapshot,
  SOURCE_CONFIDENCE_LEVELS,
  type VendorReputationEvidenceSnapshotView,
} from "./vendorReputationEvidencePolicy";
import {
  matchVendorPreferences,
  type VendorEvidenceSnapshot,
  type VendorMatchCandidate,
  type VendorMatchPreferences,
  type VendorMatchResult,
} from "./vendorPreferenceMatchingPolicy";

export type VendorReputationEvidenceRow = VendorReputationEvidenceSnapshotView & { id: string };

export type VendorEvidenceResolution = {
  candidateId: string;
  snapshot: VendorEvidenceSnapshot | null;
  selectedEvidenceId: string | null;
  reasons: string[];
};

const CONFIDENCE_RANK = new Map(SOURCE_CONFIDENCE_LEVELS.map((level, index) => [level, index]));

function compareUsableRows(a: VendorReputationEvidenceRow, b: VendorReputationEvidenceRow): number {
  const rankDiff = (CONFIDENCE_RANK.get(a.sourceConfidence) ?? Number.MAX_SAFE_INTEGER)
    - (CONFIDENCE_RANK.get(b.sourceConfidence) ?? Number.MAX_SAFE_INTEGER);
  if (rankDiff !== 0) return rankDiff;
  const observedDiff = b.observedAt.getTime() - a.observedAt.getTime();
  if (observedDiff !== 0) return observedDiff;
  const expiresDiff = b.expiresAt.getTime() - a.expiresAt.getTime();
  if (expiresDiff !== 0) return expiresDiff;
  return a.id.localeCompare(b.id);
}

/**
 * Pure resolution over already-fetched evidence rows -- no I/O. Fails closed
 * to a null snapshot unless at least one row survives
 * evaluateVendorReputationEvidence as "usable". Among usable rows, prefers
 * higher source confidence, then more recently observed, then later expiry,
 * then a stable id tie-break -- so the result is deterministic regardless of
 * input row order.
 */
export function resolveCandidateEvidence(
  candidateId: string,
  rows: readonly VendorReputationEvidenceRow[],
  now: Date,
): VendorEvidenceResolution {
  const usableRows = rows
    .filter(row => row.candidateId === candidateId)
    .filter(row => evaluateVendorReputationEvidence(row, now).status === "usable")
    .slice()
    .sort(compareUsableRows);

  if (!usableRows.length) {
    return { candidateId, snapshot: null, selectedEvidenceId: null, reasons: ["no_usable_evidence"] };
  }

  const best = usableRows[0];
  const snapshot = toVendorEvidenceSnapshot(best, now);
  if (!snapshot) {
    return { candidateId, snapshot: null, selectedEvidenceId: null, reasons: ["evidence_conversion_failed"] };
  }
  return { candidateId, snapshot, selectedEvidenceId: best.id, reasons: [] };
}

export type VendorEvidenceMatchCandidateInput = {
  candidateId: string;
  rating: number | null;
  reviewCount: number | null;
  distanceKm: number | null;
  servesRequestedArea: boolean | null;
  estimatedPriceCents: number | null;
  reliabilityScore: number | null;
  evidenceRows: readonly VendorReputationEvidenceRow[];
};

export type VendorEvidenceMatchResult = VendorMatchResult & {
  evidenceResolutions: VendorEvidenceResolution[];
};

/**
 * Bridges durable Slice 24 evidence rows into the Slice 22 preference-matching
 * policy. Resolves the strongest usable evidence per candidate, converts it to
 * the VendorEvidenceSnapshot shape, and defers all eligibility/ranking logic
 * to matchVendorPreferences. Only ever produces a preference-match decision --
 * never a booking, contact, dispatch, or payment determination.
 */
export function resolveVendorPreferenceMatch(input: {
  candidates: readonly VendorEvidenceMatchCandidateInput[];
  preferences: VendorMatchPreferences;
  now: Date;
}): VendorEvidenceMatchResult {
  const evidenceResolutions = input.candidates.map(candidate =>
    resolveCandidateEvidence(candidate.candidateId, candidate.evidenceRows, input.now));

  const matchCandidates: VendorMatchCandidate[] = input.candidates.map((candidate, index) => ({
    candidateId: candidate.candidateId,
    rating: candidate.rating,
    reviewCount: candidate.reviewCount,
    distanceKm: candidate.distanceKm,
    servesRequestedArea: candidate.servesRequestedArea,
    estimatedPriceCents: candidate.estimatedPriceCents,
    reliabilityScore: candidate.reliabilityScore,
    evidence: evidenceResolutions[index].snapshot,
  }));

  const result = matchVendorPreferences({
    candidates: matchCandidates,
    preferences: input.preferences,
    evaluatedAt: input.now.toISOString(),
  });

  return { ...result, evidenceResolutions };
}
