import type { ProposalApprovalGateDecision } from "./vendorProposalApprovalGatePolicy";

export type ProposalIdentifiers = {
  workflowId: string;
  proposalId: string;
  candidateId: string;
};

export type ProposalSnapshotForRecording = {
  status: string;
  expiresAt?: Date | string | null;
  [key: string]: any;
};

export type RecordingBridgeInput = {
  gateDecision: ProposalApprovalGateDecision;
  identifiers: ProposalIdentifiers;
  operatorReviewContext?: Record<string, unknown> | null;
  residentApprovalContext?: Record<string, unknown> | null;
  budgetApprovalContext?: Record<string, unknown> | null;
  paymentAuthorizationContext?: Record<string, unknown> | null;
  legalReviewContext?: Record<string, unknown> | null;
  idempotencyKeyInput: string;
  proposalSnapshot: ProposalSnapshotForRecording;
  now?: Date;
};

export type ProposalApprovalGateRecordingCommand = {
  command:
    | "record_operator_review_required"
    | "record_resident_approval_required"
    | "record_budget_approval_required"
    | "record_payment_authorization_required"
    | "record_legal_review_required"
    | "record_next_step_only_approval"
    | "record_rejection"
    | "recording_not_allowed";
  allowed: boolean;
  gateKey: string;
  commandKey: string;
  idempotencyKey: string;
  workflowId: string | null;
  proposalId: string | null;
  candidateId: string | null;
  payload: {
    approvalType: string;
    reasonCodes: string[];
    riskFlags: string[];
    expiresAt: Date | string | null;
    proposalSnapshotReference: Record<string, any>;
    contexts: {
      operatorReview?: Record<string, any> | null;
      residentApproval?: Record<string, any> | null;
      budgetApproval?: Record<string, any> | null;
      paymentAuthorization?: Record<string, any> | null;
      legalReview?: Record<string, any> | null;
    };
  } | null;
  // Hardcoded false/no values for execution/booking/payment/delivery/outreach
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
  outreachSent: false;
  providerMessageCreated: false;
  deliveryVerified: false;
};

export function evaluateVendorProposalApprovalGateRecording(
  input: RecordingBridgeInput
): ProposalApprovalGateRecordingCommand {
  const now = input.now ?? new Date();
  const {
    gateDecision,
    identifiers,
    operatorReviewContext,
    residentApprovalContext,
    budgetApprovalContext,
    paymentAuthorizationContext,
    legalReviewContext,
    idempotencyKeyInput,
    proposalSnapshot,
  } = input;

  const makeFailClosed = (reason: string): ProposalApprovalGateRecordingCommand => {
    return {
      command: "recording_not_allowed",
      allowed: false,
      gateKey: "",
      commandKey: "",
      idempotencyKey: idempotencyKeyInput,
      workflowId: identifiers?.workflowId ?? null,
      proposalId: identifiers?.proposalId ?? null,
      candidateId: identifiers?.candidateId ?? null,
      payload: null,
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
      outreachSent: false,
      providerMessageCreated: false,
      deliveryVerified: false,
    };
  };

  // 1. Missing identifiers -> fail closed
  if (
    !identifiers ||
    !identifiers.workflowId ||
    !identifiers.proposalId ||
    !identifiers.candidateId
  ) {
    return makeFailClosed("missing_identifiers");
  }

  // 2. Proposal expired -> fail closed
  if (proposalSnapshot.expiresAt) {
    const expiresAtDate = new Date(proposalSnapshot.expiresAt);
    if (expiresAtDate.getTime() <= now.getTime()) {
      return makeFailClosed("proposal_expired");
    }
  }

  // 3. Proposal not ready / unsupported -> fail closed
  if (proposalSnapshot.status !== "proposal_ready_for_review") {
    return makeFailClosed("proposal_not_ready_for_review");
  }

  // 4. Map Slice 34 gate result to recording command
  let command: ProposalApprovalGateRecordingCommand["command"];
  switch (gateDecision.status) {
    case "proposal_requires_operator_review":
      command = "record_operator_review_required";
      break;
    case "proposal_requires_resident_approval":
      command = "record_resident_approval_required";
      break;
    case "proposal_requires_budget_approval":
      command = "record_budget_approval_required";
      break;
    case "proposal_requires_payment_authorization":
      command = "record_payment_authorization_required";
      break;
    case "proposal_requires_legal_review":
      command = "record_legal_review_required";
      break;
    case "proposal_approved_for_next_step_only":
      command = "record_next_step_only_approval";
      break;
    case "proposal_rejected":
      command = "record_rejection";
      break;
    case "proposal_approval_not_allowed":
      command = "recording_not_allowed";
      break;
    default:
      // Unknown status -> fail closed
      return makeFailClosed(`unsupported_gate_status:${gateDecision.status}`);
  }

  const allowed = command === "record_next_step_only_approval" || command !== "recording_not_allowed";

  // Deterministic command and gate keys
  const commandKey = `proposal_recording:${identifiers.workflowId}:${identifiers.proposalId}:${idempotencyKeyInput}`;
  const gateKey = `proposal_gate:${identifiers.workflowId}:${identifiers.candidateId}`;

  return {
    command,
    allowed,
    gateKey,
    commandKey,
    idempotencyKey: idempotencyKeyInput,
    workflowId: identifiers.workflowId,
    proposalId: identifiers.proposalId,
    candidateId: identifiers.candidateId,
    payload: {
      approvalType: gateDecision.status,
      reasonCodes: gateDecision.reasons ?? [],
      riskFlags: gateDecision.riskFlags ?? [],
      expiresAt: proposalSnapshot.expiresAt ? new Date(proposalSnapshot.expiresAt).toISOString() : null,
      proposalSnapshotReference: proposalSnapshot,
      contexts: {
        operatorReview: operatorReviewContext ?? null,
        residentApproval: residentApprovalContext ?? null,
        budgetApproval: budgetApprovalContext ?? null,
        paymentAuthorization: paymentAuthorizationContext ?? null,
        legalReview: legalReviewContext ?? null,
      },
    },
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
    outreachSent: false,
    providerMessageCreated: false,
    deliveryVerified: false,
  };
}
