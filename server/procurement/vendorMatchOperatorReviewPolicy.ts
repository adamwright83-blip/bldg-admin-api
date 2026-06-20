import type {
  VendorMatchEvaluationCandidateStatus,
  VendorMatchEvaluationStatus,
} from "./vendorMatchEvaluationPolicy";

export const VENDOR_MATCH_REVIEW_GATE_PREFIX = "vendor_match_review";

export type VendorMatchOperatorReviewGateStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export type VendorMatchOperatorReviewGateView = {
  gateKey: string;
  status: VendorMatchOperatorReviewGateStatus;
  deadlineAt: Date | null;
  decidedAt: Date | null;
};

export type VendorMatchOperatorReviewCandidateInput = {
  evaluationRunId: string | null;
  candidateId: string | null;
  matchStatus: VendorMatchEvaluationCandidateStatus | null;
};

export type VendorMatchOperatorReviewStatus =
  | "review_not_allowed"
  | "review_required"
  | "awaiting_operator_review"
  | "operator_approved_for_draft_only"
  | "operator_rejected";

export type VendorMatchOperatorReviewDecision = {
  status: VendorMatchOperatorReviewStatus;
  reviewAllowed: boolean;
  gateRequired: boolean;
  requiredGateKey: string | null;
  operatorApprovedForDraftOnly: boolean;
  outreachSent: false;
  vendorSelectedForExecution: false;
  booked: false;
  accepted: false;
  dispatched: false;
  paid: false;
  captured: false;
  completed: false;
  contacted: false;
  reasons: string[];
  riskFlags: string[];
};

export function vendorMatchReviewGateKey(input: { evaluationRunId: string; candidateId: string }): string {
  return `${VENDOR_MATCH_REVIEW_GATE_PREFIX}:${input.evaluationRunId}:${input.candidateId}`;
}

function result(input: {
  status: VendorMatchOperatorReviewStatus;
  reviewAllowed: boolean;
  gateRequired: boolean;
  requiredGateKey: string | null;
  operatorApprovedForDraftOnly?: boolean;
  reasons: string[];
  riskFlags?: string[];
}): VendorMatchOperatorReviewDecision {
  return {
    status: input.status,
    reviewAllowed: input.reviewAllowed,
    gateRequired: input.gateRequired,
    requiredGateKey: input.requiredGateKey,
    operatorApprovedForDraftOnly: input.operatorApprovedForDraftOnly ?? false,
    outreachSent: false,
    vendorSelectedForExecution: false,
    booked: false,
    accepted: false,
    dispatched: false,
    paid: false,
    captured: false,
    completed: false,
    contacted: false,
    reasons: Array.from(new Set(input.reasons)),
    riskFlags: Array.from(new Set(input.riskFlags ?? [])),
  };
}

function blocked(reasons: string[], riskFlags: string[] = []): VendorMatchOperatorReviewDecision {
  return result({ status: "review_not_allowed", reviewAllowed: false, gateRequired: false,
    requiredGateKey: null, reasons, riskFlags });
}

/**
 * Pure, deterministic. Decides only whether a vendor match evaluation
 * candidate may request operator review, and -- if a gate already exists --
 * what that gate's decision permits next. Approval here is review/draft-only:
 * it never means a vendor was contacted, selected for execution, booked,
 * accepted, dispatched, paid, captured, or completed.
 */
export function evaluateVendorMatchOperatorReview(input: {
  evaluationRunStatus: VendorMatchEvaluationStatus | "draft" | "cancelled" | null;
  candidate: VendorMatchOperatorReviewCandidateInput;
  gate: VendorMatchOperatorReviewGateView | null;
  now?: Date;
}): VendorMatchOperatorReviewDecision {
  const now = input.now ?? new Date();
  const { candidate } = input;

  if (!candidate || typeof candidate !== "object") {
    return blocked(["malformed_candidate"]);
  }
  if (!candidate.evaluationRunId) {
    return blocked(["missing_evaluation_run_id"]);
  }
  if (!candidate.candidateId) {
    return blocked(["missing_candidate_id"]);
  }
  if (input.evaluationRunStatus === null) {
    return blocked(["evaluation_run_missing"]);
  }
  if (input.evaluationRunStatus === "cancelled") {
    return blocked(["evaluation_run_cancelled"]);
  }
  if (input.evaluationRunStatus === "blocked") {
    return blocked(["evaluation_run_blocked"]);
  }
  if (input.evaluationRunStatus !== "evaluated" && input.evaluationRunStatus !== "needs_operator_review"
    && input.evaluationRunStatus !== "draft") {
    return blocked([`evaluation_run_status_forbidden:${String(input.evaluationRunStatus)}`]);
  }

  const matchStatus = candidate.matchStatus;
  if (matchStatus === "blocked") {
    return blocked(["candidate_match_status_blocked"], ["match_blocked"]);
  }
  if (matchStatus === "not_matched") {
    return blocked(["candidate_not_matched"]);
  }
  if (matchStatus !== "matched" && matchStatus !== "needs_review") {
    return blocked([`candidate_match_status_forbidden:${String(matchStatus)}`]);
  }

  const requiredGateKey = vendorMatchReviewGateKey({
    evaluationRunId: candidate.evaluationRunId, candidateId: candidate.candidateId,
  });

  if (matchStatus === "needs_review") {
    if (!input.gate) {
      return result({ status: "review_required", reviewAllowed: true, gateRequired: true,
        requiredGateKey, reasons: ["candidate_needs_review"] });
    }
    return result({ status: "awaiting_operator_review", reviewAllowed: true, gateRequired: true,
      requiredGateKey, reasons: ["candidate_needs_review", `operator_gate_${input.gate.status}`] });
  }

  if (!input.gate) {
    return result({ status: "review_required", reviewAllowed: true, gateRequired: true,
      requiredGateKey, reasons: ["matched_candidate_eligible_for_operator_review"] });
  }

  if (input.gate.gateKey !== requiredGateKey) {
    return blocked(["operator_gate_key_mismatch"]);
  }
  if (input.gate.deadlineAt && input.gate.deadlineAt.getTime() <= now.getTime()) {
    return blocked(["operator_gate_stale"]);
  }
  if (input.gate.status === "pending") {
    return result({ status: "awaiting_operator_review", reviewAllowed: true, gateRequired: true,
      requiredGateKey, reasons: ["operator_gate_pending"] });
  }
  if (input.gate.status === "rejected" || input.gate.status === "expired" || input.gate.status === "cancelled") {
    return result({ status: "operator_rejected", reviewAllowed: true, gateRequired: true,
      requiredGateKey, reasons: [`operator_gate_${input.gate.status}`] });
  }
  if (input.gate.status !== "approved") {
    return blocked([`operator_gate_status_forbidden:${String(input.gate.status)}`]);
  }
  if (!(input.gate.decidedAt instanceof Date) || !Number.isFinite(input.gate.decidedAt.getTime())
    || input.gate.decidedAt.getTime() > now.getTime()) {
    return blocked(["operator_gate_decision_invalid"]);
  }

  return result({ status: "operator_approved_for_draft_only", reviewAllowed: true, gateRequired: true,
    requiredGateKey, operatorApprovedForDraftOnly: true,
    reasons: ["operator_approved_review_draft_only_not_execution"] });
}
