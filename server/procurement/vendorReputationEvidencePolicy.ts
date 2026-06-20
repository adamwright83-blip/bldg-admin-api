import { evaluateSourceConnectorCompliance, type LegalApprovalArtifact } from "./sourceConnectorCompliancePolicy";
import { findProtectedOrProxyFields, type VendorEvidenceSnapshot } from "./vendorPreferenceMatchingPolicy";

export const SOURCE_CONFIDENCE_LEVELS = ["trusted", "medium", "low", "untrusted"] as const;
export type SourceConfidenceLevel = (typeof SOURCE_CONFIDENCE_LEVELS)[number];

export const EVIDENCE_DB_STATUSES = ["recorded", "usable", "quarantined", "rejected"] as const;
export type EvidenceDbStatus = (typeof EVIDENCE_DB_STATUSES)[number];

const CONFIDENCE_SCORE: Record<SourceConfidenceLevel, number> = {
  trusted: 1, medium: 0.85, low: 0.5, untrusted: 0,
};

export type VendorReputationEvidenceComplianceSnapshot = {
  legalApprovalArtifact?: LegalApprovalArtifact | null;
} & Record<string, unknown>;

export type VendorReputationEvidenceSnapshotView = {
  candidateId: string;
  sourceType: string;
  sourceKey: string;
  evidenceStatus: EvidenceDbStatus;
  rating: number | null;
  ratingScaleMin: number;
  ratingScaleMax: number;
  reviewCount: number | null;
  sourceConfidence: SourceConfidenceLevel;
  sourceApproved: boolean;
  observedAt: Date;
  expiresAt: Date;
  evidencePayload: Record<string, unknown>;
  complianceSnapshot: VendorReputationEvidenceComplianceSnapshot;
};

export type VendorReputationEvidenceDecisionStatus = "usable" | "needs_review" | "quarantined" | "blocked";

export type VendorReputationEvidenceDecision = {
  status: VendorReputationEvidenceDecisionStatus;
  reasons: string[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Pure deterministic gate over a vendor reputation evidence snapshot. No I/O, no DB,
 * no fetch, no LLM, no external calls. Mirrors the fail-closed posture of
 * vendorPreferenceMatchingPolicy.ts's inline evidence checks, but operates on the
 * durable row shape so the store can decide what evidence_status to persist.
 */
export function evaluateVendorReputationEvidence(
  snapshot: VendorReputationEvidenceSnapshotView,
  now: Date,
): VendorReputationEvidenceDecision {
  const protectedFields = findProtectedOrProxyFields(snapshot.evidencePayload);
  if (protectedFields.length) {
    return { status: "blocked", reasons: protectedFields.map(field => `protected_or_proxy_field:${field}`) };
  }

  const reasons: string[] = [];

  if (!snapshot.candidateId.trim() || !snapshot.sourceType.trim() || !snapshot.sourceKey.trim()) {
    reasons.push("missing_required_identity");
  }
  if (snapshot.rating !== null
      && (!isFiniteNumber(snapshot.rating)
        || snapshot.rating < snapshot.ratingScaleMin
        || snapshot.rating > snapshot.ratingScaleMax)) {
    reasons.push("rating_out_of_scale");
  }
  if (snapshot.reviewCount !== null
      && (!Number.isInteger(snapshot.reviewCount) || snapshot.reviewCount < 0)) {
    reasons.push("review_count_invalid");
  }
  const observedMs = snapshot.observedAt.getTime();
  const expiresMs = snapshot.expiresAt.getTime();
  const nowMs = now.getTime();
  const timestampsFinite = [observedMs, expiresMs, nowMs].every(Number.isFinite);
  if (!timestampsFinite || expiresMs <= observedMs || observedMs > nowMs) {
    reasons.push("evidence_timestamps_invalid");
  }
  if (reasons.length) return { status: "blocked", reasons };

  if (snapshot.evidenceStatus === "rejected") return { status: "blocked", reasons: ["evidence_status_rejected"] };

  if (snapshot.sourceKey === "reddit") {
    const compliance = evaluateSourceConnectorCompliance({
      sourceKey: "reddit",
      reviewStatus: snapshot.complianceSnapshot.legalApprovalArtifact ? "approved" : "needs_legal_review",
      legalApprovalArtifact: snapshot.complianceSnapshot.legalApprovalArtifact ?? null,
    });
    if (!compliance.candidateEvidenceAllowed) {
      return { status: "quarantined", reasons: ["reddit_quarantined_pending_legal_approval"] };
    }
  }
  if (snapshot.evidenceStatus === "quarantined") return { status: "quarantined", reasons: ["evidence_status_quarantined"] };
  if (snapshot.sourceConfidence === "untrusted") return { status: "quarantined", reasons: ["source_confidence_untrusted"] };

  if (!snapshot.sourceApproved) reasons.push("source_not_approved");
  if (snapshot.evidenceStatus === "recorded") reasons.push("evidence_status_not_yet_usable");
  if (expiresMs < nowMs) reasons.push("evidence_expired");
  if (reasons.length) return { status: "needs_review", reasons };

  return { status: "usable", reasons: [] };
}

/**
 * Converts a durable snapshot into the VendorEvidenceSnapshot shape
 * vendorPreferenceMatchingPolicy.ts consumes, but only when the evidence
 * is usable. Returns null otherwise -- never a partially-trusted snapshot.
 */
export function toVendorEvidenceSnapshot(
  snapshot: VendorReputationEvidenceSnapshotView,
  now: Date,
): VendorEvidenceSnapshot | null {
  const decision = evaluateVendorReputationEvidence(snapshot, now);
  if (decision.status !== "usable") return null;
  return {
    sourceKey: snapshot.sourceKey,
    sourceApproved: snapshot.sourceApproved,
    sourceConfidence: CONFIDENCE_SCORE[snapshot.sourceConfidence],
    observedAt: snapshot.observedAt.toISOString(),
    expiresAt: snapshot.expiresAt.toISOString(),
  };
}

export function resolvePersistedEvidenceStatus(decision: VendorReputationEvidenceDecision): EvidenceDbStatus {
  switch (decision.status) {
    case "usable": return "usable";
    case "quarantined": return "quarantined";
    case "blocked": return "rejected";
    case "needs_review": return "recorded";
  }
}
