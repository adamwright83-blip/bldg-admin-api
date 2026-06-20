export type ProposalSnapshot = {
  id?: string | null;
  status: string;
  allowed?: boolean;
  reasons?: string[];
  riskFlags?: string[];
  selectedTermsId?: string | null;
  proposalDetails?: {
    candidateId: string;
    quotedAmountCents: number | null;
    currency: string | null;
    rateUnit: string | null;
    confidence: "high" | "medium" | "low";
  } | null;
  expiresAt?: Date | string | null;
};

export type MandateRequestContext = {
  workflowId?: string | null;
  serviceType?: string | null;
  accessPattern?: string | null;
  scopeDescription?: string | null;
  scheduledAt?: Date | string | null;
  scopeChanged?: boolean;
  scheduleChangedMaterially?: boolean;
  residentPresenceRequired?: boolean;
};

export type BudgetContext = {
  mandateBudgetLimitCents: number;
  approved?: boolean;
};

export type ResidentApprovalContext = {
  approved?: boolean;
  scopeChanged?: boolean;
  scheduleChangedMaterially?: boolean;
  residentPresenceRequired?: boolean;
};

export type OperatorGateSnapshot = {
  gateKey?: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  deadlineAt?: Date | string | null;
  decidedAt?: Date | string | null;
};

export type PaymentAuthorizationContext = {
  requiresFundsReservation: boolean;
  authorized: boolean;
};

export type LegalReviewContext = {
  unusualLiability?: boolean;
  contractRequired?: boolean;
  cancellationTerms?: boolean;
  minimumCommitment?: boolean;
  nonStandardLegalTerms?: boolean;
  approved?: boolean;
};

export type ProposalApprovalGateInput = {
  proposal: ProposalSnapshot;
  requestContext: MandateRequestContext;
  budgetContext: BudgetContext;
  residentApprovalContext: ResidentApprovalContext;
  operatorGate: OperatorGateSnapshot | null;
  paymentAuthorizationContext?: PaymentAuthorizationContext | null;
  legalReviewContext?: LegalReviewContext | null;
  now?: Date;
};

export type ProposalApprovalGateDecision = {
  status:
    | "proposal_approval_not_allowed"
    | "proposal_requires_operator_review"
    | "proposal_requires_resident_approval"
    | "proposal_requires_budget_approval"
    | "proposal_requires_payment_authorization"
    | "proposal_requires_legal_review"
    | "proposal_approved_for_next_step_only"
    | "proposal_rejected";
  allowed: boolean;
  reasons: string[];
  riskFlags: string[];
  booked: false;
  accepted: false;
  dispatched: false;
  paid: false;
  captured: false;
  completed: false;
  selectedForExecution: false;
  providerAccepted: false;
  bookingVerified: false;
  paymentAuthorized: false;
  paymentCaptured: false;
  invoiceCreated: false;
  payableCreated: false;
};

export function evaluateVendorProposalApprovalGate(
  input: ProposalApprovalGateInput
): ProposalApprovalGateDecision {
  const now = input.now ?? new Date();
  const {
    proposal,
    requestContext,
    budgetContext,
    residentApprovalContext,
    operatorGate,
    paymentAuthorizationContext,
    legalReviewContext,
  } = input;

  const riskFlags = [...(proposal.riskFlags ?? [])];

  const makeDecision = (
    status: ProposalApprovalGateDecision["status"],
    decisionReasons: string[]
  ): ProposalApprovalGateDecision => {
    return {
      status,
      allowed: status === "proposal_approved_for_next_step_only",
      reasons: decisionReasons,
      riskFlags: Array.from(new Set(riskFlags)),
      booked: false,
      accepted: false,
      dispatched: false,
      paid: false,
      captured: false,
      completed: false,
      selectedForExecution: false,
      providerAccepted: false,
      bookingVerified: false,
      paymentAuthorized: false,
      paymentCaptured: false,
      invoiceCreated: false,
      payableCreated: false,
    };
  };

  // 1. Reject if proposal status is not proposal_ready_for_review
  if (proposal.status !== "proposal_ready_for_review") {
    return makeDecision("proposal_approval_not_allowed", [
      `proposal_status_forbidden:${proposal.status}`,
    ]);
  }

  // 2. Reject expired proposal terms
  if (proposal.expiresAt) {
    const expiresAtDate = new Date(proposal.expiresAt);
    if (expiresAtDate.getTime() <= now.getTime()) {
      return makeDecision("proposal_approval_not_allowed", [
        "proposal_terms_expired",
      ]);
    }
  }

  // 3. Check for operator gate rejection
  if (operatorGate) {
    if (
      operatorGate.status === "rejected" ||
      operatorGate.status === "expired" ||
      operatorGate.status === "cancelled"
    ) {
      return makeDecision("proposal_rejected", [
        `operator_gate_status:${operatorGate.status}`,
      ]);
    }
  }

  // 4. Operator Review Gate Checks
  // Must require operator review for risk flags, unclear terms, low confidence, or unsupported constraints.
  const hasRiskFlags = proposal.riskFlags && proposal.riskFlags.length > 0;
  const isLowConfidence =
    proposal.proposalDetails?.confidence === "low";
  const hasUnclearTerms =
    proposal.reasons?.includes("vendor_requested_clarification") ||
    proposal.reasons?.includes("needs_clarification") ||
    proposal.status === "proposal_needs_clarification";
  const hasUnsupportedConstraints =
    proposal.reasons?.includes("vendor_unsupported_request") ||
    proposal.reasons?.includes("unsupported") ||
    proposal.status === "proposal_unsupported";

  const operatorReviewRequired =
    hasRiskFlags ||
    isLowConfidence ||
    hasUnclearTerms ||
    hasUnsupportedConstraints;

  if (operatorReviewRequired) {
    const operatorApproved = operatorGate && operatorGate.status === "approved";
    if (!operatorApproved) {
      const reasonCode = isLowConfidence
        ? "low_confidence_terms"
        : hasRiskFlags
        ? "proposal_risk_flags_present"
        : hasUnclearTerms
        ? "unclear_terms_present"
        : "unsupported_constraints_present";
      return makeDecision("proposal_requires_operator_review", [
        reasonCode,
        ...(operatorGate ? [`operator_gate_status:${operatorGate.status}`] : ["operator_gate_missing"]),
      ]);
    }
  }

  // 5. Legal Review Gate Checks
  // Must require legal review if terms include unusual liability, contract, cancellation, minimum commitment, or non-standard legal terms.
  const legalReviewRequired =
    legalReviewContext?.unusualLiability === true ||
    legalReviewContext?.contractRequired === true ||
    legalReviewContext?.cancellationTerms === true ||
    legalReviewContext?.minimumCommitment === true ||
    legalReviewContext?.nonStandardLegalTerms === true;

  if (legalReviewRequired) {
    const legalApproved = legalReviewContext?.approved === true;
    if (!legalApproved) {
      return makeDecision("proposal_requires_legal_review", [
        "legal_review_pending",
      ]);
    }
  }

  // 6. Resident Approval Gate Checks
  // Must require resident approval if proposal exceeds mandate budget, changes scope, changes schedule materially, or requires resident presence/access.
  const exceedsBudget =
    proposal.proposalDetails?.quotedAmountCents !== undefined &&
    proposal.proposalDetails?.quotedAmountCents !== null &&
    proposal.proposalDetails.quotedAmountCents > budgetContext.mandateBudgetLimitCents;

  const residentAccessPattern =
    requestContext.accessPattern === "resident_present" ||
    requestContext.residentPresenceRequired === true ||
    residentApprovalContext.residentPresenceRequired === true;

  const scopeChanged =
    requestContext.scopeChanged === true ||
    residentApprovalContext.scopeChanged === true;

  const scheduleChanged =
    requestContext.scheduleChangedMaterially === true ||
    residentApprovalContext.scheduleChangedMaterially === true;

  const residentApprovalRequired =
    exceedsBudget || residentAccessPattern || scopeChanged || scheduleChanged;

  if (residentApprovalRequired) {
    const residentApproved = residentApprovalContext.approved === true;
    if (!residentApproved) {
      const residentReasons = [];
      if (exceedsBudget) residentReasons.push("exceeds_mandate_budget");
      if (residentAccessPattern) residentReasons.push("resident_presence_required");
      if (scopeChanged) residentReasons.push("scope_changed");
      if (scheduleChanged) residentReasons.push("schedule_changed_materially");

      return makeDecision("proposal_requires_resident_approval", [
        "resident_approval_pending",
        ...residentReasons,
      ]);
    }
  }

  // 7. Budget Approval Gate Checks
  // Must require budget approval if proposal exceeds mandate budget
  if (exceedsBudget) {
    const budgetApproved = budgetContext.approved === true;
    if (!budgetApproved) {
      return makeDecision("proposal_requires_budget_approval", [
        "budget_approval_pending",
        "exceeds_mandate_budget",
      ]);
    }
  }

  // 8. Payment Authorization Gate Checks
  // Must require payment authorization if proposal requires funds reservation, but must not perform authorization.
  const paymentAuthRequired =
    paymentAuthorizationContext?.requiresFundsReservation === true;

  if (paymentAuthRequired) {
    const paymentAuthorized = paymentAuthorizationContext?.authorized === true;
    if (!paymentAuthorized) {
      return makeDecision("proposal_requires_payment_authorization", [
        "payment_authorization_pending",
      ]);
    }
  }

  // 9. Approved for next step only
  return makeDecision("proposal_approved_for_next_step_only", [
    "all_approval_gates_passed",
  ]);
}
