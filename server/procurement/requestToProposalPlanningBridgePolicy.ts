import type { ProposalPostDecisionRecordingCommand } from "./vendorProposalPostDecisionNextStepRecordingPolicy";

export type RequestToProposalPlanningCommandStatus =
  | "planning_bridge_not_allowed"
  | "plan_rejected_outcome"
  | "plan_revision_required"
  | "plan_resident_approval_request"
  | "plan_budget_approval_request"
  | "plan_payment_authorization_request_review"
  | "plan_legal_review_request"
  | "plan_operator_pre_execution_review"
  | "plan_waiting_for_clarification";

export type RequestToProposalPlanningCommand = {
  command: RequestToProposalPlanningCommandStatus;
  allowed: boolean;
  workflowId: string | null;
  requestId: string | null;
  mandateId: string | null;
  proposalId: string | null;
  gateId: string | null;
  gateKey: string | null;
  decisionId: string | null;
  decisionKey: string | null;
  sourceRecordingCommandStatus: string | null;
  reasonCodes: string[];
  riskFlags: string[];
  requiredApprovals: string[];
  actorId: string | null;
  actorType: string | null;
  commandKey: string;
  idempotencyKey: string;
  expiresAt: Date | string | null;
  sourceRecordingCommandReference: ProposalPostDecisionRecordingCommand | null;
  requestMandateContextReference: Record<string, unknown> | null;
  proposalReference: Record<string, unknown> | null;
  planningOnlyWarning: "administrative_planning_only_not_orchestration_or_execution";
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
  stateMutated: false;
  residentNotified: false;
  llmCalled: false;
};

const COMMAND_TO_PLAN: Readonly<Record<string, RequestToProposalPlanningCommandStatus>> = {
  record_rejection_outcome: "plan_rejected_outcome",
  record_revision_required: "plan_revision_required",
  record_resident_approval_required: "plan_resident_approval_request",
  record_budget_approval_required: "plan_budget_approval_request",
  record_payment_authorization_request_required: "plan_payment_authorization_request_review",
  record_legal_review_required: "plan_legal_review_request",
  record_operator_pre_execution_review_required: "plan_operator_pre_execution_review",
  record_waiting_for_clarification: "plan_waiting_for_clarification",
};

const FORBIDDEN_CLAIMS = new Set([
  "booked", "accepted", "dispatched", "paid", "captured", "completed", "selectedForExecution",
  "providerAccepted", "bookingVerified", "paymentAuthorized", "paymentCaptured", "invoiceCreated",
  "payableCreated", "outreachSent", "providerMessageCreated", "deliveryVerified", "executionApproved",
  "stateMutated", "residentNotified", "llmCalled", "executionReady", "dispatchReady", "paymentReady",
  "operatorExecutionApproved",
]);
const FORBIDDEN_TEXT = /\b(booked|dispatched|paid|captured|completed|provider[_ ]message[_ ](?:id|created)|delivery[_ ]verified|selected[_ ]for[_ ]execution)\b/i;

const FALSE_OUTCOMES = {
  booked: false, accepted: false, dispatched: false, paid: false, captured: false, completed: false,
  selectedForExecution: false, providerAccepted: false, bookingVerified: false, paymentAuthorized: false,
  paymentCaptured: false, invoiceCreated: false, payableCreated: false, outreachSent: false,
  providerMessageCreated: false, deliveryVerified: false, executionApproved: false, stateMutated: false,
  residentNotified: false, llmCalled: false,
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
    if ((path.startsWith("requestMandate") || path.startsWith("proposal"))
      && typeof child === "string" && FORBIDDEN_TEXT.test(child)) paths.push(`${path}.${key}`);
    paths.push(...forbiddenClaimPaths(child, `${path}.${key}`, seen));
  }
  return paths;
}

export function evaluateRequestToProposalPlanningBridge(input: {
  recordingCommand: ProposalPostDecisionRecordingCommand | null;
  requestMandateContext: { requestId?: string | null; mandateId?: string | null; workflowId?: string | null;
    [key: string]: unknown } | null;
  proposalReference: { proposalId?: string | null; [key: string]: unknown } | null;
  identifiers: { workflowId?: string | null; requestId?: string | null; mandateId?: string | null;
    proposalId?: string | null; gateId?: string | null; gateKey?: string | null;
    decisionId?: string | null; decisionKey?: string | null };
  actor: { actorId?: string | null; actorType?: "operator" | "system" | string };
  idempotencyKeyInput: string;
  now?: Date;
}): RequestToProposalPlanningCommand {
  const source = input.recordingCommand;
  const workflowId = text(input.identifiers?.workflowId) ?? text(source?.workflowId)
    ?? text(input.requestMandateContext?.workflowId);
  const requestId = text(input.identifiers?.requestId) ?? text(source?.requestId)
    ?? text(input.requestMandateContext?.requestId);
  const mandateId = text(input.identifiers?.mandateId) ?? text(input.requestMandateContext?.mandateId);
  const proposalId = text(input.identifiers?.proposalId) ?? text(source?.proposalId)
    ?? text(input.proposalReference?.proposalId);
  const gateId = text(input.identifiers?.gateId) ?? text(source?.gateId);
  const gateKey = text(input.identifiers?.gateKey) ?? text(source?.gateKey);
  const decisionId = text(input.identifiers?.decisionId) ?? text(source?.decisionId);
  const decisionKey = text(input.identifiers?.decisionKey) ?? text(source?.decisionKey);
  const sourceStatus = text(source?.command);
  const actorId = text(input.actor?.actorId);
  const actorType = text(input.actor?.actorType);
  const idempotencyKey = text(input.idempotencyKeyInput) ?? "";
  const expiration = source?.expiresAt ?? null;
  const reasonCodes = [...(source?.reasonCodes ?? [])];
  const riskFlags = [...(source?.riskFlags ?? [])];
  const requiredApprovals = [...(source?.requiredApprovals ?? [])];

  const build = (command: RequestToProposalPlanningCommandStatus, allowed: boolean,
    extraReasons: string[] = []): RequestToProposalPlanningCommand => {
    const commandKey = allowed ? ["request_to_proposal_planning", workflowId, requestId, mandateId,
      proposalId, gateId, decisionId, sourceStatus, idempotencyKey].join(":") : "";
    return { command, allowed, workflowId, requestId, mandateId, proposalId, gateId, gateKey, decisionId,
      decisionKey, sourceRecordingCommandStatus: sourceStatus,
      reasonCodes: Array.from(new Set([...reasonCodes, ...extraReasons])), riskFlags: Array.from(new Set(riskFlags)),
      requiredApprovals: Array.from(new Set(requiredApprovals)), actorId, actorType, commandKey, idempotencyKey,
      expiresAt: expiration, sourceRecordingCommandReference: source,
      requestMandateContextReference: input.requestMandateContext,
      proposalReference: input.proposalReference,
      planningOnlyWarning: "administrative_planning_only_not_orchestration_or_execution", ...FALSE_OUTCOMES };
  };

  if (!source) return build("planning_bridge_not_allowed", false, ["recording_command_missing"]);
  if (!input.requestMandateContext || !text(input.requestMandateContext.requestId)
    || !text(input.requestMandateContext.mandateId)) {
    return build("planning_bridge_not_allowed", false, ["request_mandate_context_missing"]);
  }
  if (!input.proposalReference || !text(input.proposalReference.proposalId)) {
    return build("planning_bridge_not_allowed", false, ["proposal_reference_missing"]);
  }
  if (!workflowId || !requestId || !mandateId || !proposalId || !gateId || !gateKey || !decisionId || !decisionKey) {
    return build("planning_bridge_not_allowed", false, ["planning_bridge_identifiers_missing"]);
  }
  if (!actorId || !actorType || !["operator", "system"].includes(actorType)) {
    return build("planning_bridge_not_allowed", false, ["planning_actor_context_missing_or_invalid"]);
  }
  if (!idempotencyKey) return build("planning_bridge_not_allowed", false, ["idempotency_key_missing"]);
  const expiresAt = parsedDate(expiration);
  const now = input.now ?? new Date();
  if (expiration != null && (!expiresAt || expiresAt.getTime() <= now.getTime())) {
    return build("planning_bridge_not_allowed", false, ["recording_command_expired"]);
  }
  const forbidden = [...forbiddenClaimPaths(source, "recordingCommand"),
    ...forbiddenClaimPaths(input.requestMandateContext, "requestMandate"),
    ...forbiddenClaimPaths(input.proposalReference, "proposal")];
  if (forbidden.length) return build("planning_bridge_not_allowed", false,
    forbidden.map(path => `forbidden_claim:${path}`));
  if (!source.allowed) return build("planning_bridge_not_allowed", false, ["recording_command_not_allowed"]);
  const planCommand = sourceStatus ? COMMAND_TO_PLAN[sourceStatus] : undefined;
  if (!planCommand) return build("planning_bridge_not_allowed", false, ["recording_command_status_unsupported"]);
  return build(planCommand, true);
}
