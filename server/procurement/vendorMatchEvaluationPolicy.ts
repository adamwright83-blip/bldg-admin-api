import {
  evaluateVendorReputationEvidence,
  type SourceConfidenceLevel,
  type VendorReputationEvidenceDecisionStatus,
} from "./vendorReputationEvidencePolicy";
import { resolveCandidateEvidence, type VendorReputationEvidenceRow } from "./vendorEvidenceResolverPolicy";
import {
  evaluateVendorPreferenceCandidate,
  findProtectedOrProxyFields,
  type VendorMatchCandidate,
  type VendorMatchPreferences,
} from "./vendorPreferenceMatchingPolicy";

export type VendorMatchEvaluationCandidateInput = {
  candidateId: string;
  rating: number | null;
  reviewCount: number | null;
  distanceKm: number | null;
  servesRequestedArea: boolean | null;
  estimatedPriceCents: number | null;
  reliabilityScore: number | null;
  evidenceRows: readonly VendorReputationEvidenceRow[];
};

export type VendorMatchEvaluationCandidateStatus = "matched" | "not_matched" | "needs_review" | "blocked";

export type VendorMatchEvaluationEvidenceSummary = {
  selectedEvidenceId: string | null;
  evidenceStatus: VendorReputationEvidenceDecisionStatus | "missing";
  sourceKey: string | null;
  sourceConfidence: SourceConfidenceLevel | null;
};

export type VendorMatchEvaluationCandidateDecision = {
  candidateId: string;
  matchStatus: VendorMatchEvaluationCandidateStatus;
  rankOrder: number | null;
  score: number | null;
  decisionReasons: string[];
  riskFlags: string[];
  evidenceSummary: VendorMatchEvaluationEvidenceSummary;
};

export type VendorMatchEvaluationStatus = "evaluated" | "needs_operator_review" | "blocked";

export type VendorMatchEvaluationResult = {
  evaluationStatus: VendorMatchEvaluationStatus;
  decisions: VendorMatchEvaluationCandidateDecision[];
  reasons: string[];
};

const EVIDENCE_SEVERITY: Record<VendorReputationEvidenceDecisionStatus, number> = {
  blocked: 3, quarantined: 2, needs_review: 1, usable: 0,
};

const STATUS_RANK: Record<VendorMatchEvaluationCandidateStatus, number> = {
  matched: 0, needs_review: 1, not_matched: 2, blocked: 2,
};

function isFiniteRating(rating: number | null): rating is number {
  return rating !== null && Number.isFinite(rating);
}

function diagnoseUnusableEvidence(
  candidateId: string,
  rows: readonly VendorReputationEvidenceRow[],
  now: Date,
): { status: VendorReputationEvidenceDecisionStatus | "missing"; reasons: string[];
     sourceKey: string | null; sourceConfidence: SourceConfidenceLevel | null } {
  const ownRows = rows.filter(row => row.candidateId === candidateId);
  if (!ownRows.length) {
    return { status: "missing", reasons: ["no_evidence_rows"], sourceKey: null, sourceConfidence: null };
  }
  const unusable = ownRows
    .map(row => ({ row, decision: evaluateVendorReputationEvidence(row, now) }))
    .filter(item => item.decision.status !== "usable")
    .sort((a, b) => EVIDENCE_SEVERITY[b.decision.status] - EVIDENCE_SEVERITY[a.decision.status]
      || a.row.id.localeCompare(b.row.id));
  const worst = unusable[0];
  if (!worst) return { status: "missing", reasons: ["no_evidence_rows"], sourceKey: null, sourceConfidence: null };
  return {
    status: worst.decision.status, reasons: worst.decision.reasons,
    sourceKey: worst.row.sourceKey, sourceConfidence: worst.row.sourceConfidence,
  };
}

function evidenceRiskFlags(status: VendorReputationEvidenceDecisionStatus | "missing", reasons: string[]): string[] {
  const flags = new Set<string>();
  if (status === "missing") flags.add("evidence_missing");
  if (status === "needs_review") flags.add("evidence_needs_review");
  if (status === "quarantined") flags.add("evidence_quarantined");
  if (status === "blocked") flags.add("evidence_blocked");
  for (const reason of reasons) {
    if (reason.startsWith("protected_or_proxy_field")) flags.add("protected_or_proxy_field");
    if (reason === "reddit_quarantined_pending_legal_approval") flags.add("reddit_without_legal_approval");
    if (reason === "source_confidence_untrusted") flags.add("source_confidence_untrusted");
    if (reason === "evidence_expired") flags.add("evidence_expired");
    if (reason === "source_not_approved") flags.add("source_not_approved");
  }
  return [...flags];
}

/**
 * Pure per-candidate evaluation. Never returns a status implying contact,
 * booking, dispatch, or payment -- only matched/not_matched/needs_review/blocked
 * for this audit-only record.
 */
export function evaluateVendorMatchEvaluationCandidate(
  input: VendorMatchEvaluationCandidateInput,
  preferences: VendorMatchPreferences,
  now: Date,
): VendorMatchEvaluationCandidateDecision {
  const inputProtectedFields = findProtectedOrProxyFields({ candidate: input, preferences });
  const score = isFiniteRating(input.rating) ? Math.round(input.rating * 20 * 1000) / 1000 : null;

  if (inputProtectedFields.length) {
    return {
      candidateId: input.candidateId, matchStatus: "blocked", rankOrder: null, score: null,
      decisionReasons: inputProtectedFields.map(field => `protected_or_proxy_field:${field}`),
      riskFlags: ["protected_or_proxy_field"],
      evidenceSummary: { selectedEvidenceId: null, evidenceStatus: "missing", sourceKey: null, sourceConfidence: null },
    };
  }

  const resolved = resolveCandidateEvidence(input.candidateId, input.evidenceRows, now);

  if (!resolved.snapshot) {
    const diagnosis = diagnoseUnusableEvidence(input.candidateId, input.evidenceRows, now);
    const matchStatus: VendorMatchEvaluationCandidateStatus =
      diagnosis.status === "blocked" || diagnosis.status === "quarantined" ? "blocked" : "needs_review";
    return {
      candidateId: input.candidateId, matchStatus, rankOrder: null, score,
      decisionReasons: diagnosis.reasons,
      riskFlags: evidenceRiskFlags(diagnosis.status, diagnosis.reasons),
      evidenceSummary: { selectedEvidenceId: null, evidenceStatus: diagnosis.status,
        sourceKey: diagnosis.sourceKey, sourceConfidence: diagnosis.sourceConfidence },
    };
  }

  const selectedRow = input.evidenceRows.find(row => row.id === resolved.selectedEvidenceId) ?? null;
  const matchCandidate: VendorMatchCandidate = {
    candidateId: input.candidateId, rating: input.rating, reviewCount: input.reviewCount,
    distanceKm: input.distanceKm, servesRequestedArea: input.servesRequestedArea,
    estimatedPriceCents: input.estimatedPriceCents, reliabilityScore: input.reliabilityScore,
    evidence: resolved.snapshot,
  };
  const decision = evaluateVendorPreferenceCandidate(matchCandidate, preferences, now.toISOString());
  const hasProtectedReason = decision.reasons.some(reason => reason.startsWith("protected_or_proxy_field"));
  const matchStatus: VendorMatchEvaluationCandidateStatus =
    decision.status === "eligible" ? "matched"
      : decision.status === "needs_review" ? "needs_review"
      : hasProtectedReason ? "blocked" : "not_matched";

  return {
    candidateId: input.candidateId, matchStatus, rankOrder: null, score,
    decisionReasons: decision.reasons.length ? decision.reasons : ["eligible"],
    riskFlags: hasProtectedReason ? ["protected_or_proxy_field"] : [],
    evidenceSummary: { selectedEvidenceId: resolved.selectedEvidenceId, evidenceStatus: "usable",
      sourceKey: resolved.snapshot.sourceKey, sourceConfidence: selectedRow?.sourceConfidence ?? null },
  };
}

function compareDecisions(
  a: VendorMatchEvaluationCandidateDecision,
  b: VendorMatchEvaluationCandidateDecision,
  ratingById: Map<string, number | null>,
  reviewCountById: Map<string, number | null>,
): number {
  const rankDiff = STATUS_RANK[a.matchStatus] - STATUS_RANK[b.matchStatus];
  if (rankDiff !== 0) return rankDiff;
  const scoreDiff = (b.score ?? -1) - (a.score ?? -1);
  if (scoreDiff !== 0) return scoreDiff;
  const ratingDiff = (ratingById.get(b.candidateId) ?? -1) - (ratingById.get(a.candidateId) ?? -1);
  if (ratingDiff !== 0) return ratingDiff;
  const reviewDiff = (reviewCountById.get(b.candidateId) ?? -1) - (reviewCountById.get(a.candidateId) ?? -1);
  if (reviewDiff !== 0) return reviewDiff;
  return a.candidateId.localeCompare(b.candidateId);
}

/**
 * Pure, deterministic, no I/O. Produces an inert audit/evaluation record of
 * how candidates compare against a preference request -- never an
 * authorization to contact, book, dispatch, or pay any vendor.
 */
export function evaluateVendorMatchEvaluation(input: {
  requestContext: Record<string, unknown>;
  candidates: readonly VendorMatchEvaluationCandidateInput[];
  preferences: VendorMatchPreferences;
  now: Date;
}): VendorMatchEvaluationResult {
  const topLevelProtectedFields = findProtectedOrProxyFields({
    requestContext: input.requestContext, preferences: input.preferences,
  });
  if (topLevelProtectedFields.length) {
    return { evaluationStatus: "blocked", decisions: [],
      reasons: topLevelProtectedFields.map(field => `protected_or_proxy_field:${field}`) };
  }
  if (!Number.isFinite(input.preferences.minimumRating) || input.preferences.minimumRating < 0
      || input.preferences.minimumRating > 5) {
    return { evaluationStatus: "blocked", decisions: [], reasons: ["minimum_rating_invalid"] };
  }

  const decisions = input.candidates.map(candidate =>
    evaluateVendorMatchEvaluationCandidate(candidate, input.preferences, input.now));

  const ratingById = new Map(input.candidates.map(c => [c.candidateId, c.rating]));
  const reviewCountById = new Map(input.candidates.map(c => [c.candidateId, c.reviewCount]));
  const ordered = decisions.slice().sort((a, b) => compareDecisions(a, b, ratingById, reviewCountById));

  let rank = 0;
  const rankedById = new Map<string, number>();
  for (const decision of ordered) {
    if (decision.matchStatus !== "matched") continue;
    rank += 1;
    rankedById.set(decision.candidateId, rank);
  }
  const rankedDecisions = decisions.map(decision => ({
    ...decision, rankOrder: rankedById.get(decision.candidateId) ?? null,
  }));

  const anyMatched = rankedDecisions.some(decision => decision.matchStatus === "matched");
  const anyNeedsReview = rankedDecisions.some(decision => decision.matchStatus === "needs_review");
  const allBlocked = rankedDecisions.length > 0 && rankedDecisions.every(decision => decision.matchStatus === "blocked");

  const evaluationStatus: VendorMatchEvaluationStatus =
    anyMatched ? "evaluated" : allBlocked ? "blocked" : anyNeedsReview ? "needs_operator_review" : "evaluated";
  const reasons = anyMatched ? []
    : allBlocked ? ["all_candidates_blocked"]
    : anyNeedsReview ? ["candidate_evidence_needs_review"]
    : ["no_candidate_matched"];

  return { evaluationStatus, decisions: rankedDecisions, reasons };
}
