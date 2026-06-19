import { isRegisteredSourceType } from "./vendorSourcingPolicy";

export const VENDOR_SCORING_VERSION = "vendor-objective-v1";
export const VENDOR_OUTREACH_GATE_PREFIX = "vendor_outreach_approval:";

export type CandidateScoringStatus =
  | "discovered" | "enriched" | "pending_scoring" | "pending_operator_review"
  | "approved_for_outreach" | "rejected" | "archived";

export type VendorScoringInput = {
  sourceType: string;
  sourceCompliancePresent: boolean;
  candidateStatus: CandidateScoringStatus;
  categoryMatch: boolean | null;
  geographicCoverage: boolean | null;
  hasPublicContact: boolean;
  hasPricingSignal: boolean;
  hasBookingMechanism: boolean;
  reviewSignal: "positive" | "neutral" | "negative" | "unknown";
};

export type VendorScoringDecision = {
  allowed: boolean;
  decision: "pass_to_operator_review" | "reject" | "needs_more_evidence";
  reasons: string[];
  scores: {
    categoryMatch: number;
    geographicFit: number;
    contactability: number;
    pricingSignal: number;
    bookingSignal: number;
    reviewSignal: number;
    overall: number;
  };
};

const ELIGIBLE_STATUSES: CandidateScoringStatus[] = ["discovered", "enriched", "pending_scoring"];

export function outreachGateKey(candidateId: string) {
  return `${VENDOR_OUTREACH_GATE_PREFIX}${candidateId}`;
}

export function evaluateVendorCandidate(input: VendorScoringInput): VendorScoringDecision {
  const reasons: string[] = [];
  if (!input.sourceCompliancePresent) reasons.push("source_compliance_missing");
  if (!isRegisteredSourceType(input.sourceType)) reasons.push("source_type_unsupported");
  if (!ELIGIBLE_STATUSES.includes(input.candidateStatus)) reasons.push("candidate_status_not_eligible");
  if (input.categoryMatch === false) reasons.push("category_mismatch");
  if (input.categoryMatch === null) reasons.push("category_match_unknown");
  if (input.geographicCoverage === false) reasons.push("geographic_coverage_mismatch");
  if (input.geographicCoverage === null) reasons.push("geographic_coverage_unknown");
  if (!input.hasPublicContact) reasons.push("public_contact_missing");

  const scores = {
    categoryMatch: input.categoryMatch === true ? 25 : 0,
    geographicFit: input.geographicCoverage === true ? 20 : 0,
    contactability: input.hasPublicContact ? 15 : 0,
    pricingSignal: input.hasPricingSignal ? 15 : 0,
    bookingSignal: input.hasBookingMechanism ? 15 : 0,
    reviewSignal: input.reviewSignal === "positive" ? 10 : input.reviewSignal === "neutral" ? 5 : 0,
    overall: 0,
  };
  scores.overall = scores.categoryMatch + scores.geographicFit + scores.contactability
    + scores.pricingSignal + scores.bookingSignal + scores.reviewSignal;

  const hardReject = reasons.some(reason => [
    "source_type_unsupported", "candidate_status_not_eligible", "category_mismatch",
    "geographic_coverage_mismatch",
  ].includes(reason));
  const missingEvidence = reasons.some(reason => [
    "source_compliance_missing", "category_match_unknown", "geographic_coverage_unknown",
    "public_contact_missing",
  ].includes(reason));
  const baseScore = scores.overall - scores.reviewSignal;
  const passesThreshold = baseScore >= 70 || (baseScore >= 60 && scores.overall >= 70);

  if (hardReject) return { allowed: false, decision: "reject", reasons, scores };
  if (missingEvidence || !passesThreshold) {
    if (!passesThreshold) reasons.push("objective_score_below_threshold");
    return { allowed: false, decision: "needs_more_evidence", reasons, scores };
  }
  return { allowed: true, decision: "pass_to_operator_review", reasons, scores };
}

export function canApproveForOutreach(input: {
  candidateStatus: CandidateScoringStatus;
  gateStatus: string | null;
  gateKey: string | null;
  candidateId: string;
}) {
  const reasons: string[] = [];
  if (input.candidateStatus !== "pending_operator_review") reasons.push("candidate_not_pending_operator_review");
  if (input.gateKey !== outreachGateKey(input.candidateId)) reasons.push("operator_gate_mismatch");
  if (input.gateStatus !== "approved") reasons.push("operator_gate_not_approved");
  return { allowed: reasons.length === 0, reasons };
}
