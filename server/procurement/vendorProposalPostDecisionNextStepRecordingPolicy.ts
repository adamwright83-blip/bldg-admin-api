import type { ProposalPostDecisionNextStepResult } from "./vendorProposalPostDecisionNextStepPolicy";

export type ProposalPostDecisionRecordingCommandStatus =
  | "next_step_recording_not_allowed"
  | "record_rejection_outcome"
  | "record_revision_required"
  | "record_resident_approval_required"
  | "record_budget_approval_required"
  | "record_payment_authorization_request_required"
  | "record_legal_review_required"
  | "record_operator_pre_execution_review_required"
  | "record_waiting_for_clarification";

export type ProposalPostDecisionRecordingCommand = {
  command: ProposalPostDecisionRecordingCommandStatus;
  allowed: boolean;
  workflowId: string | null;
  requestId: string | null;
  proposalId: string | null;
  gateId: string | null;
  gateKey: string | null;
  decisionId: string | null;
  decisionKey: string | null;
  nextStepStatus: string | null;
  reasonCodes: string[];
  riskFlags: string[];
  requiredApprovals: string[];
  actorId: string | null;
  actorType: string | null;
  commandKey: string;
  idempotencyKey: string;
  expiresAt: Date | string | null;
  sourceNextStepSnapshotReference: ProposalPostDecisionNextStepResult | null;
  nextStepOnlyWarning: "administrative_recording_only_not_execution";
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
};

const STATUS_TO_COMMAND: Readonly<Record<string, ProposalPostDecisionRecordingCommandStatus>> = {
  next_step_rejected: "record_rejection_outcome",
  next_step_needs_revision: "record_revision_required",
  next_step_requires_resident_approval: "record_resident_approval_required",
  next_step_requires_budget_approval: "record_budget_approval_required",
  next_step_requires_payment_authorization_request: "record_payment_authorization_request_required",
  next_step_requires_legal_review: "record_legal_review_required",
  next_step_ready_for_operator_pre_execution_review: "record_operator_pre_execution_review_required",
  next_step_waiting_for_clarification: "record_waiting_for_clarification",
};

const FORBIDDEN_CLAIMS = new Set([
  "booked", "accepted", "dispatched", "paid", "captured", "completed", "selectedForExecution",
  "providerAccepted", "bookingVerified", "paymentAuthorized", "paymentCaptured", "invoiceCreated",
  "payableCreated", "outreachSent", "providerMessageCreated", "deliveryVerified", "executionApproved",
  "stateMutated", "executionReady", "dispatchReady", "paymentReady", "operatorExecutionApproved",
]);

const FALSE_OUTCOMES = {
  booked: false, accepted: false, dispatched: false, paid: false, captured: false, completed: false,
  selectedForExecution: false, providerAccepted: false, bookingVerified: false, paymentAuthorized: false,
  paymentCaptured: false, invoiceCreated: false, payableCreated: false, outreachSent: false,
  providerMessageCreated: false, deliveryVerified: false, executionApproved: false, stateMutated: false,
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

function forbiddenClaimPaths(value: unknown, path = "nextStep", seen = new Set<object>()): string[] {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_CLAIMS.has(key) && child !== false && child != null) paths.push(`${path}.${key}`);
    paths.push(...forbiddenClaimPaths(child, `${path}.${key}`, seen));
  }
  return paths;
}

export function evaluateVendorProposalPostDecisionNextStepRecording(input: {
  nextStep: ProposalPostDecisionNextStepResult | null;
  identifiers: { workflowId?: string | null; requestId?: string | null; proposalId?: string | null;
    gateId?: string | null; gateKey?: string | null; decisionId?: string | null; decisionKey?: string | null };
  actor: { actorId?: string | null; actorType?: "operator" | "system" | string };
  idempotencyKeyInput: string;
  now?: Date;
}): ProposalPostDecisionRecordingCommand {
  const snapshot = input.nextStep;
  const workflowId = text(input.identifiers?.workflowId) ?? text(snapshot?.workflowId);
  const requestId = text(input.identifiers?.requestId) ?? text(snapshot?.requestId);
  const proposalId = text(input.identifiers?.proposalId) ?? text(snapshot?.proposalId);
  const gateId = text(input.identifiers?.gateId) ?? text(snapshot?.gateId);
  const gateKey = text(input.identifiers?.gateKey) ?? text(snapshot?.gateKey);
  const decisionId = text(input.identifiers?.decisionId) ?? text(snapshot?.decisionId);
  const decisionKey = text(input.identifiers?.decisionKey) ?? text(snapshot?.decisionKey);
  const nextStepStatus = text(snapshot?.status);
  const actorId = text(input.actor?.actorId);
  const actorType = text(input.actor?.actorType);
  const idempotencyKey = text(input.idempotencyKeyInput) ?? "";
  const reasonCodes = [...(snapshot?.reasonCodes ?? [])];
  const riskFlags = [...(snapshot?.riskFlags ?? [])];
  const requiredApprovals = [...(snapshot?.requiredApprovals ?? [])];
  const expiration = snapshot?.expiresAt ?? null;

  const build = (command: ProposalPostDecisionRecordingCommandStatus, allowed: boolean,
    extraReasons: string[] = []): ProposalPostDecisionRecordingCommand => {
    const commandKey = allowed
      ? ["proposal_post_decision_recording", workflowId, requestId, proposalId, gateId, decisionId,
        nextStepStatus, idempotencyKey].join(":") : "";
    return { command, allowed, workflowId, requestId, proposalId, gateId, gateKey, decisionId, decisionKey,
      nextStepStatus, reasonCodes: Array.from(new Set([...reasonCodes, ...extraReasons])),
      riskFlags: Array.from(new Set(riskFlags)), requiredApprovals: Array.from(new Set(requiredApprovals)),
      actorId, actorType, commandKey, idempotencyKey, expiresAt: expiration,
      sourceNextStepSnapshotReference: snapshot,
      nextStepOnlyWarning: "administrative_recording_only_not_execution", ...FALSE_OUTCOMES };
  };

  if (!snapshot) return build("next_step_recording_not_allowed", false, ["next_step_result_missing"]);
  if (!workflowId || !requestId || !proposalId || !gateId || !gateKey || !decisionId || !decisionKey) {
    return build("next_step_recording_not_allowed", false, ["next_step_recording_identifiers_missing"]);
  }
  if (!actorId || !actorType || !["operator", "system"].includes(actorType)) {
    return build("next_step_recording_not_allowed", false, ["recording_actor_context_missing_or_invalid"]);
  }
  if (!idempotencyKey) return build("next_step_recording_not_allowed", false, ["idempotency_key_missing"]);
  const expiresAt = parsedDate(expiration);
  const now = input.now ?? new Date();
  if (expiration != null && (!expiresAt || expiresAt.getTime() <= now.getTime())) {
    return build("next_step_recording_not_allowed", false, ["next_step_result_expired"]);
  }
  const forbidden = forbiddenClaimPaths(snapshot);
  if (forbidden.length) return build("next_step_recording_not_allowed", false,
    forbidden.map(path => `forbidden_claim:${path}`));
  const command = nextStepStatus ? STATUS_TO_COMMAND[nextStepStatus] : undefined;
  if (!command) return build("next_step_recording_not_allowed", false, ["next_step_status_unsupported"]);
  return build(command, true);
}
