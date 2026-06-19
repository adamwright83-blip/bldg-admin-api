export const SOURCE_CONNECTOR_KEYS = [
  "google_business_profiles",
  "yelp_business_directory",
  "reddit",
] as const;

export type SourceConnectorKey = (typeof SOURCE_CONNECTOR_KEYS)[number];
export type SourceConnectorReviewStatus =
  | "proposed"
  | "needs_legal_review"
  | "disabled"
  | "prohibited"
  | "approved";

export type LegalApprovalArtifact = {
  artifactId: string;
  approvedAt: Date;
  approvedBy: string;
  scope: "candidate_evidence";
};

export type SourceConnectorComplianceInput = {
  sourceKey: string;
  reviewStatus: SourceConnectorReviewStatus;
  legalApprovalArtifact?: LegalApprovalArtifact | null;
  accessDescription?: string | null;
};

export type SourceConnectorComplianceDecision = {
  knownSource: boolean;
  productionAllowed: boolean;
  candidateEvidenceAllowed: boolean;
  quarantined: boolean;
  reasons: string[];
};

const BUSINESS_DIRECTORY_SOURCES: ReadonlySet<string> = new Set([
  "google_business_profiles",
  "yelp_business_directory",
]);

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "proposed", "needs_legal_review", "disabled", "prohibited", "approved",
]);

function hasValidLegalApprovalArtifact(value: LegalApprovalArtifact | null | undefined): boolean {
  return !!value
    && value.artifactId.trim().length > 0
    && value.approvedBy.trim().length > 0
    && value.scope === "candidate_evidence"
    && value.approvedAt instanceof Date
    && Number.isFinite(value.approvedAt.getTime());
}

/**
 * Models compliance state only. It never performs discovery, fetches a source,
 * or creates candidate evidence.
 */
export function evaluateSourceConnectorCompliance(
  input: SourceConnectorComplianceInput,
): SourceConnectorComplianceDecision {
  const reasons: string[] = [];
  const knownSource = SOURCE_CONNECTOR_KEYS.includes(input.sourceKey as SourceConnectorKey);

  if (!knownSource) {
    return {
      knownSource: false,
      productionAllowed: false,
      candidateEvidenceAllowed: false,
      quarantined: true,
      reasons: ["unknown_source"],
    };
  }

  if (!VALID_STATUSES.has(input.reviewStatus)) reasons.push("invalid_review_status");
  if (input.reviewStatus === "prohibited") reasons.push("source_prohibited");
  if (input.reviewStatus === "disabled") reasons.push("source_disabled");
  if (input.reviewStatus === "proposed") reasons.push("source_only_proposed");
  if (input.reviewStatus === "needs_legal_review") reasons.push("legal_review_required");

  // These source families have no enabled state in this code-only foundation.
  if (BUSINESS_DIRECTORY_SOURCES.has(input.sourceKey) && input.reviewStatus === "approved") {
    reasons.push("business_source_cannot_be_enabled");
  }

  const legalApprovalValid = hasValidLegalApprovalArtifact(input.legalApprovalArtifact);
  if (input.sourceKey === "reddit" && !legalApprovalValid) {
    reasons.push("reddit_quarantined_pending_legal_approval");
  }

  const productionAllowed = input.sourceKey === "reddit"
    && input.reviewStatus === "approved"
    && legalApprovalValid
    && reasons.length === 0;

  return {
    knownSource,
    productionAllowed,
    candidateEvidenceAllowed: productionAllowed,
    quarantined: !productionAllowed,
    reasons: Array.from(new Set(reasons)),
  };
}

export function canProduceCandidateEvidence(input: SourceConnectorComplianceInput): boolean {
  return evaluateSourceConnectorCompliance(input).candidateEvidenceAllowed;
}
