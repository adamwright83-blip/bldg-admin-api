import type { ProposalOperatorGateDecisionResult } from "./vendorProposalOperatorGateDecisionPolicy";

export type RecordedProposalOperatorDecisionSnapshot = Partial<ProposalOperatorGateDecisionResult> & {
  decisionId?: string | null;
  decisionKey?: string | null;
  decisionStatus?: string | null;
  decidedAt?: Date | string | null;
  expiresAt?: Date | string | null;
};

export type ProposalPostDecisionNextStepStatus =
  | "next_step_not_allowed"
  | "next_step_rejected"
  | "next_step_needs_revision"
  | "next_step_requires_resident_approval"
  | "next_step_requires_budget_approval"
  | "next_step_requires_payment_authorization_request"
  | "next_step_requires_legal_review"
  | "next_step_ready_for_operator_pre_execution_review"
  | "next_step_waiting_for_clarification";

export type ProposalPostDecisionNextStepResult = {
  status: ProposalPostDecisionNextStepStatus;
  nextStepAllowed: boolean;
  workflowId: string | null;
  requestId: string | null;
  proposalId: string | null;
  gateId: string | null;
  gateKey: string | null;
  decisionId: string | null;
  decisionKey: string | null;
  reasonCodes: string[];
  riskFlags: string[];
  requiredApprovals: Array<"resident_approval" | "budget_approval" | "payment_authorization_request" | "legal_review">;
  sourceDecisionSnapshotReference: RecordedProposalOperatorDecisionSnapshot | null;
  expiresAt: Date | string | null;
  nextStepOnlyWarning: "operator_pre_execution_review_only_not_execution";
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
  executionApproved: false;
};

const FORBIDDEN_CLAIMS = new Set([
  "booked", "accepted", "dispatched", "paid", "captured", "completed", "selectedForExecution",
  "providerAccepted", "bookingVerified", "paymentAuthorized", "paymentCaptured", "invoiceCreated",
  "payableCreated", "outreachSent", "providerMessageCreated", "deliveryVerified", "executionApproved",
  "executionReady", "dispatchReady", "paymentReady", "operatorExecutionApproved",
]);
const FORBIDDEN_PROPOSAL_TEXT = /\b(booked|dispatched|paid|captured|completed|provider[_ ]message[_ ](?:id|created)|delivery[_ ]verified|selected[_ ]for[_ ]execution)\b/i;

const FALSE_OUTCOMES = {
  booked: false, accepted: false, dispatched: false, paid: false, captured: false, completed: false,
  selectedForExecution: false, providerAccepted: false, bookingVerified: false, paymentAuthorized: false,
  paymentCaptured: false, invoiceCreated: false, payableCreated: false, outreachSent: false,
  providerMessageCreated: false, deliveryVerified: false, executionApproved: false,
} as const;

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function parsedDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function forbiddenClaimPaths(value: unknown, path: string, seen = new Set<object>()): string[] {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_CLAIMS.has(key) && child !== false && child != null) paths.push(`${path}.${key}`);
    if (path.startsWith("proposal") && typeof child === "string" && FORBIDDEN_PROPOSAL_TEXT.test(child)) {
      paths.push(`${path}.${key}`);
    }
    paths.push(...forbiddenClaimPaths(child, `${path}.${key}`, seen));
  }
  return paths;
}

export function evaluateVendorProposalPostDecisionNextStep(input: {
  decision: RecordedProposalOperatorDecisionSnapshot | null;
  proposal: { id?: string | null; status: string; reasons?: string[]; riskFlags?: string[];
    expiresAt?: Date | string | null; [key: string]: unknown };
  requestContext: { workflowId?: string | null; requestId?: string | null; requiresClarification?: boolean };
  residentApprovalContext: { required: boolean; approved: boolean };
  budgetContext: { required: boolean; approved: boolean; withinBudget: boolean };
  paymentAuthorizationReadinessContext: { required: boolean; approvedForRequest: boolean };
  legalReviewContext: { required: boolean; approved: boolean };
  now?: Date;
}): ProposalPostDecisionNextStepResult {
  const decision = input.decision;
  const status = text(decision?.status) ?? text(decision?.decisionStatus);
  const workflowId = text(decision?.workflowId) ?? text(input.requestContext?.workflowId);
  const requestId = text(decision?.requestId) ?? text(input.requestContext?.requestId);
  const proposalId = text(decision?.proposalId) ?? text(input.proposal?.id);
  const gateId = text(decision?.gateId);
  const gateKey = text(decision?.gateKey);
  const decisionId = text(decision?.decisionId);
  const decisionKey = text(decision?.decisionKey);
  const expiration = decision?.expiresAt ?? decision?.sourceGateSnapshotReference?.deadlineAt
    ?? input.proposal?.expiresAt ?? null;
  const reasonCodes = [...(decision?.reasonCodes ?? [])];
  const riskFlags = Array.from(new Set([...(decision?.riskFlags ?? []), ...(input.proposal?.riskFlags ?? [])]));
  const requiredApprovals: ProposalPostDecisionNextStepResult["requiredApprovals"] = [];
  if (input.residentApprovalContext?.required) requiredApprovals.push("resident_approval");
  if (input.budgetContext?.required || !input.budgetContext?.withinBudget) requiredApprovals.push("budget_approval");
  if (input.paymentAuthorizationReadinessContext?.required) requiredApprovals.push("payment_authorization_request");
  if (input.legalReviewContext?.required) requiredApprovals.push("legal_review");

  const result = (nextStatus: ProposalPostDecisionNextStepStatus, allowed: boolean,
    extraReasons: string[] = []): ProposalPostDecisionNextStepResult => ({
    status: nextStatus, nextStepAllowed: allowed, workflowId, requestId, proposalId, gateId, gateKey,
    decisionId, decisionKey, reasonCodes: Array.from(new Set([...reasonCodes, ...extraReasons])), riskFlags,
    requiredApprovals: Array.from(new Set(requiredApprovals)), sourceDecisionSnapshotReference: decision,
    expiresAt: expiration, nextStepOnlyWarning: "operator_pre_execution_review_only_not_execution",
    ...FALSE_OUTCOMES,
  });

  if (!decision) return result("next_step_not_allowed", false, ["operator_gate_decision_missing"]);
  if (!workflowId || !requestId || !proposalId || !gateId || !gateKey) {
    return result("next_step_not_allowed", false, ["post_decision_identifiers_missing"]);
  }
  const expiresAt = parsedDate(expiration);
  const now = input.now ?? new Date();
  if (expiration != null && (!expiresAt || expiresAt.getTime() <= now.getTime())) {
    return result("next_step_not_allowed", false, ["operator_gate_decision_expired"]);
  }
  const forbidden = [...forbiddenClaimPaths(decision, "decision"),
    ...forbiddenClaimPaths(input.proposal, "proposal")];
  if (forbidden.length) return result("next_step_not_allowed", false,
    forbidden.map(path => `forbidden_claim:${path}`));
  if (status === "operator_gate_decision_rejected") {
    return result("next_step_rejected", false, ["operator_decision_rejected"]);
  }
  if (status === "operator_gate_decision_needs_revision") {
    return result("next_step_needs_revision", false, ["proposal_revision_required"]);
  }
  if (!status || ![
    "operator_gate_decision_approved_for_next_step_only",
    "operator_gate_decision_requires_resident_approval",
    "operator_gate_decision_requires_budget_approval",
    "operator_gate_decision_requires_payment_authorization",
    "operator_gate_decision_requires_legal_review",
  ].includes(status)) return result("next_step_not_allowed", false, ["operator_decision_status_not_supported"]);

  const residentRequired = status === "operator_gate_decision_requires_resident_approval"
    || input.residentApprovalContext?.required;
  if (residentRequired && !input.residentApprovalContext?.approved) {
    if (!requiredApprovals.includes("resident_approval")) requiredApprovals.push("resident_approval");
    return result("next_step_requires_resident_approval", false, ["resident_approval_missing"]);
  }
  const budgetRequired = status === "operator_gate_decision_requires_budget_approval"
    || input.budgetContext?.required || !input.budgetContext?.withinBudget;
  if (budgetRequired && !input.budgetContext?.approved) {
    if (!requiredApprovals.includes("budget_approval")) requiredApprovals.push("budget_approval");
    return result("next_step_requires_budget_approval", false, ["budget_approval_missing"]);
  }
  const legalRequired = status === "operator_gate_decision_requires_legal_review" || input.legalReviewContext?.required;
  if (legalRequired && !input.legalReviewContext?.approved) {
    if (!requiredApprovals.includes("legal_review")) requiredApprovals.push("legal_review");
    return result("next_step_requires_legal_review", false, ["legal_review_missing"]);
  }
  const paymentRequestRequired = status === "operator_gate_decision_requires_payment_authorization"
    || input.paymentAuthorizationReadinessContext?.required;
  if (paymentRequestRequired && !input.paymentAuthorizationReadinessContext?.approvedForRequest) {
    if (!requiredApprovals.includes("payment_authorization_request")) requiredApprovals.push("payment_authorization_request");
    return result("next_step_requires_payment_authorization_request", false,
      ["payment_authorization_request_approval_missing"]);
  }
  if (input.requestContext?.requiresClarification || input.proposal.status === "proposal_needs_clarification"
    || input.proposal.reasons?.includes("needs_clarification")) {
    return result("next_step_waiting_for_clarification", false, ["proposal_clarification_required"]);
  }
  if (input.proposal.status !== "proposal_ready_for_review") {
    return result("next_step_not_allowed", false, [`proposal_status_not_reviewable:${input.proposal.status}`]);
  }
  return result("next_step_ready_for_operator_pre_execution_review", true,
    ["ready_for_internal_operator_pre_execution_review_only"]);
}
