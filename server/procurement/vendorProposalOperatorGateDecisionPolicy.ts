import type { ProposalApprovalGateRecordingCommand } from "./vendorProposalApprovalGateRecordingPolicy";
import type { ProposalApprovalGateDecision } from "./vendorProposalApprovalGatePolicy";

export type ProposalOperatorGateDecisionType =
  | "approved"
  | "rejected"
  | "needs_revision"
  | "requires_resident_approval"
  | "requires_budget_approval"
  | "requires_payment_authorization"
  | "requires_legal_review";

export type ProposalOperatorGateSnapshot = {
  id?: string | number | null;
  gateKey?: string | null;
  workflowId?: string | null;
  requestId?: string | null;
  proposalId?: string | null;
  candidateId?: string | null;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled" | string;
  deadlineAt?: Date | string | null;
  decidedAt?: Date | string | null;
  promptJson?: unknown;
  evidenceJson?: unknown;
};

export type ProposalOperatorDecisionInput = {
  decisionType: ProposalOperatorGateDecisionType | string;
  reasonCodes?: string[];
  riskFlags?: string[];
  operatorNoteSummary?: string | null;
};

export type ProposalOperatorContext = {
  operatorId?: string | null;
  actorType?: "operator" | string;
};

export type ProposalOperatorGateDecisionStatus =
  | "operator_gate_decision_not_allowed"
  | "operator_gate_decision_approved_for_next_step_only"
  | "operator_gate_decision_rejected"
  | "operator_gate_decision_needs_revision"
  | "operator_gate_decision_requires_resident_approval"
  | "operator_gate_decision_requires_budget_approval"
  | "operator_gate_decision_requires_payment_authorization"
  | "operator_gate_decision_requires_legal_review"
  | "operator_gate_decision_expired";

export type ProposalOperatorGateDecisionResult = {
  status: ProposalOperatorGateDecisionStatus;
  decisionAllowed: boolean;
  gateId: string | null;
  gateKey: string | null;
  workflowId: string | null;
  requestId: string | null;
  proposalId: string | null;
  candidateId: string | null;
  decisionType: string | null;
  reasonCodes: string[];
  riskFlags: string[];
  operatorId: string | null;
  operatorNoteSummary: string | null;
  nextRequiredReviewType: "resident_approval" | "budget_approval" | "payment_authorization" | "legal_review" | "proposal_revision" | null;
  sourceGateSnapshotReference: ProposalOperatorGateSnapshot | null;
  proposalApprovalGateResultReference: ProposalApprovalGateDecision | null;
  recordingCommandReference: ProposalApprovalGateRecordingCommand | null;
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

const SUPPORTED_DECISIONS = new Set<ProposalOperatorGateDecisionType>([
  "approved", "rejected", "needs_revision", "requires_resident_approval",
  "requires_budget_approval", "requires_payment_authorization", "requires_legal_review",
]);

const FORBIDDEN_CLAIM_KEYS = new Set([
  "booked", "accepted", "dispatched", "paid", "captured", "completed", "selectedForExecution",
  "providerAccepted", "bookingVerified", "paymentAuthorized", "paymentCaptured", "invoiceCreated",
  "payableCreated", "outreachSent", "providerMessageCreated", "deliveryVerified", "executionReady",
  "dispatchReady", "paymentReady", "operatorExecutionApproved",
]);

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function validDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function forbiddenClaims(value: unknown, path = "source", seen = new Set<object>()): string[] {
  if (!value || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const claims: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_CLAIM_KEYS.has(key) && child !== false && child !== null && child !== undefined) {
      claims.push(`forbidden_claim:${childPath}`);
    }
    claims.push(...forbiddenClaims(child, childPath, seen));
  }
  return claims;
}

const FALSE_OUTCOMES = {
  booked: false, accepted: false, dispatched: false, paid: false, captured: false, completed: false,
  selectedForExecution: false, providerAccepted: false, bookingVerified: false, paymentAuthorized: false,
  paymentCaptured: false, invoiceCreated: false, payableCreated: false, outreachSent: false,
  providerMessageCreated: false, deliveryVerified: false,
} as const;

export function evaluateVendorProposalOperatorGateDecision(input: {
  gate: ProposalOperatorGateSnapshot | null;
  decision: ProposalOperatorDecisionInput;
  proposalApprovalGateResult?: ProposalApprovalGateDecision | null;
  recordingCommandReference?: ProposalApprovalGateRecordingCommand | null;
  actor: ProposalOperatorContext;
  now?: Date;
}): ProposalOperatorGateDecisionResult {
  const gate = input.gate;
  const decisionType = text(input.decision?.decisionType);
  const reasonCodes = [...(input.decision?.reasonCodes ?? [])].filter(value => text(value) !== null);
  const riskFlags = [...(input.decision?.riskFlags ?? [])].filter(value => text(value) !== null);
  const operatorId = text(input.actor?.operatorId);
  const note = text(input.decision?.operatorNoteSummary);
  const sourceReasons: string[] = [];
  const gateId = text(gate?.id);
  const gateKey = text(gate?.gateKey);
  const workflowId = text(gate?.workflowId) ?? text(input.recordingCommandReference?.workflowId);
  const proposalId = text(gate?.proposalId) ?? text(input.recordingCommandReference?.proposalId);
  const candidateId = text(gate?.candidateId) ?? text(input.recordingCommandReference?.candidateId);
  const requestId = text(gate?.requestId);

  const result = (status: ProposalOperatorGateDecisionStatus, allowed: boolean,
    nextRequiredReviewType: ProposalOperatorGateDecisionResult["nextRequiredReviewType"],
    additionalReasons: string[] = []): ProposalOperatorGateDecisionResult => ({
    status, decisionAllowed: allowed, gateId, gateKey, workflowId, requestId, proposalId, candidateId,
    decisionType, reasonCodes: Array.from(new Set([...reasonCodes, ...sourceReasons, ...additionalReasons])),
    riskFlags: Array.from(new Set(riskFlags)), operatorId, operatorNoteSummary: note,
    nextRequiredReviewType, sourceGateSnapshotReference: gate,
    proposalApprovalGateResultReference: input.proposalApprovalGateResult ?? null,
    recordingCommandReference: input.recordingCommandReference ?? null, ...FALSE_OUTCOMES,
  });

  if (!gate) return result("operator_gate_decision_not_allowed", false, null, ["operator_gate_missing"]);
  if (!gateId || !gateKey || !workflowId || !proposalId) {
    return result("operator_gate_decision_not_allowed", false, null, ["operator_gate_identifiers_missing"]);
  }
  if (!operatorId || input.actor?.actorType !== "operator") {
    return result("operator_gate_decision_not_allowed", false, null, ["decision_actor_missing_or_invalid"]);
  }
  const deadline = validDate(gate.deadlineAt);
  const now = input.now ?? new Date();
  if (gate.status === "expired" || (gate.deadlineAt != null && (!deadline || deadline.getTime() <= now.getTime()))) {
    return result("operator_gate_decision_expired", false, null, ["operator_gate_expired"]);
  }
  if (gate.status !== "pending" || gate.decidedAt != null) {
    return result("operator_gate_decision_not_allowed", false, null, ["operator_gate_already_resolved"]);
  }
  if (!decisionType || !SUPPORTED_DECISIONS.has(decisionType as ProposalOperatorGateDecisionType)) {
    return result("operator_gate_decision_not_allowed", false, null, ["operator_decision_type_unsupported"]);
  }
  const claims = [
    ...forbiddenClaims(gate, "gate"),
    ...forbiddenClaims(input.proposalApprovalGateResult, "proposalApprovalGateResult"),
    ...forbiddenClaims(input.recordingCommandReference, "recordingCommandReference"),
  ];
  if (claims.length) return result("operator_gate_decision_not_allowed", false, null, claims);

  switch (decisionType as ProposalOperatorGateDecisionType) {
    case "approved":
      return result("operator_gate_decision_approved_for_next_step_only", true, null,
        ["operator_approval_is_next_step_only_not_execution"]);
    case "rejected": return result("operator_gate_decision_rejected", true, null);
    case "needs_revision": return result("operator_gate_decision_needs_revision", true, "proposal_revision");
    case "requires_resident_approval":
      return result("operator_gate_decision_requires_resident_approval", true, "resident_approval");
    case "requires_budget_approval":
      return result("operator_gate_decision_requires_budget_approval", true, "budget_approval");
    case "requires_payment_authorization":
      return result("operator_gate_decision_requires_payment_authorization", true, "payment_authorization");
    case "requires_legal_review":
      return result("operator_gate_decision_requires_legal_review", true, "legal_review");
  }
}
