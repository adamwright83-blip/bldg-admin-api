import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ProposalPostDecisionRecordingCommand } from "./vendorProposalPostDecisionNextStepRecordingPolicy";
import { evaluateRequestToProposalPlanningBridge } from "./requestToProposalPlanningBridgePolicy";

const NOW = new Date("2026-06-20T12:00:00Z");
const falseOutcomes = { booked: false, accepted: false, dispatched: false, paid: false, captured: false,
  completed: false, selectedForExecution: false, providerAccepted: false, bookingVerified: false,
  paymentAuthorized: false, paymentCaptured: false, invoiceCreated: false, payableCreated: false,
  outreachSent: false, providerMessageCreated: false, deliveryVerified: false, executionApproved: false,
  stateMutated: false, residentNotified: false, llmCalled: false } as const;

function recording(command: ProposalPostDecisionRecordingCommand["command"],
  patch: Partial<ProposalPostDecisionRecordingCommand> = {}): ProposalPostDecisionRecordingCommand {
  return { command, allowed: command !== "next_step_recording_not_allowed", workflowId: "42",
    requestId: "request-1", proposalId: "proposal-1", gateId: "gate-41",
    gateKey: "proposal_gate:42:candidate-1", decisionId: "decision-1", decisionKey: "decision-key-1",
    nextStepStatus: "source-next-step", reasonCodes: ["reviewed"], riskFlags: ["quoted_terms"],
    requiredApprovals: [], actorId: "system-40", actorType: "system", commandKey: "source-command-key",
    idempotencyKey: "source-idem", expiresAt: "2026-06-21T12:00:00Z",
    sourceNextStepSnapshotReference: null, nextStepOnlyWarning: "administrative_recording_only_not_execution",
    ...falseOutcomes, ...patch };
}

function evaluate(value: ProposalPostDecisionRecordingCommand | null, patch: Record<string, unknown> = {}) {
  return evaluateRequestToProposalPlanningBridge({ recordingCommand: value,
    requestMandateContext: { workflowId: "42", requestId: "request-1", mandateId: "mandate-1",
      requestType: "guest_readiness" }, proposalReference: { proposalId: "proposal-1", status: "reviewed" },
    identifiers: {}, actor: { actorId: "system-41", actorType: "system" },
    idempotencyKeyInput: "idem-41", now: NOW, ...patch });
}

describe("request-to-proposal planning bridge policy", () => {
  it.each([
    ["record_rejection_outcome", "plan_rejected_outcome"],
    ["record_revision_required", "plan_revision_required"],
    ["record_resident_approval_required", "plan_resident_approval_request"],
    ["record_budget_approval_required", "plan_budget_approval_request"],
    ["record_payment_authorization_request_required", "plan_payment_authorization_request_review"],
    ["record_legal_review_required", "plan_legal_review_request"],
    ["record_operator_pre_execution_review_required", "plan_operator_pre_execution_review"],
    ["record_waiting_for_clarification", "plan_waiting_for_clarification"],
  ] as const)("maps %s to %s as planning only", (sourceStatus, command) => {
    expect(evaluate(recording(sourceStatus))).toMatchObject({ command, allowed: true,
      sourceRecordingCommandStatus: sourceStatus,
      planningOnlyWarning: "administrative_planning_only_not_orchestration_or_execution",
      ...falseOutcomes });
  });

  it("preserves identifiers, metadata, and all source references", () => {
    const source = recording("record_legal_review_required", { requiredApprovals: ["legal_review"] });
    expect(evaluate(source)).toMatchObject({ workflowId: "42", requestId: "request-1", mandateId: "mandate-1",
      proposalId: "proposal-1", gateId: "gate-41", gateKey: "proposal_gate:42:candidate-1",
      decisionId: "decision-1", decisionKey: "decision-key-1", reasonCodes: ["reviewed"],
      riskFlags: ["quoted_terms"], requiredApprovals: ["legal_review"], sourceRecordingCommandReference: source });
  });

  it("generates a deterministic command and idempotency key", () => {
    const source = recording("record_operator_pre_execution_review_required");
    const first = evaluate(source); const second = evaluate(source);
    expect(first).toEqual(second);
    expect(first.idempotencyKey).toBe("idem-41");
    expect(first.commandKey).toBe("request_to_proposal_planning:42:request-1:mandate-1:proposal-1:gate-41:decision-1:record_operator_pre_execution_review_required:idem-41");
  });

  it("fails closed for missing source, identifiers, contexts, actor, idempotency, expiry, and status", () => {
    expect(evaluate(null).command).toBe("planning_bridge_not_allowed");
    expect(evaluate(recording("record_rejection_outcome", { gateKey: null })).reasonCodes)
      .toContain("planning_bridge_identifiers_missing");
    expect(evaluate(recording("record_rejection_outcome"), { requestMandateContext: null }).reasonCodes)
      .toContain("request_mandate_context_missing");
    expect(evaluate(recording("record_rejection_outcome"), { proposalReference: null }).reasonCodes)
      .toContain("proposal_reference_missing");
    expect(evaluate(recording("record_rejection_outcome"), { actor: { actorId: "", actorType: "system" } }).reasonCodes)
      .toContain("planning_actor_context_missing_or_invalid");
    expect(evaluate(recording("record_rejection_outcome"), { idempotencyKeyInput: "" }).reasonCodes)
      .toContain("idempotency_key_missing");
    expect(evaluate(recording("record_rejection_outcome", { expiresAt: NOW })).reasonCodes)
      .toContain("recording_command_expired");
    expect(evaluate(recording("unsupported" as never)).reasonCodes).toContain("recording_command_status_unsupported");
  });

  it.each(["booked", "paymentAuthorized", "dispatched", "outreachSent", "providerMessageCreated",
    "deliveryVerified", "stateMutated", "residentNotified", "llmCalled"] as const)("rejects a true %s claim", key => {
    const source = recording("record_operator_pre_execution_review_required");
    (source as unknown as Record<string, unknown>)[key] = true;
    const result = evaluate(source);
    expect(result.command).toBe("planning_bridge_not_allowed");
    expect(result.reasonCodes.some(reason => reason.startsWith("forbidden_claim:"))).toBe(true);
  });

  it("rejects forbidden claims embedded in request or proposal context", () => {
    expect(evaluate(recording("record_revision_required"), { requestMandateContext: {
      workflowId: "42", requestId: "request-1", mandateId: "mandate-1", summary: "Already dispatched",
    } }).command).toBe("planning_bridge_not_allowed");
    expect(evaluate(recording("record_revision_required"), { proposalReference: {
      proposalId: "proposal-1", providerMessageCreated: true,
    } }).command).toBe("planning_bridge_not_allowed");
  });

  it("contains no I/O, store, DB, route, UI, worker, connector, LLM, or external call", () => {
    const source = readFileSync("server/procurement/requestToProposalPlanningBridgePolicy.ts", "utf8");
    expect(source).not.toMatch(/\b(fetch|axios|execute|query|insert|update|delete)\s*\(/i);
    expect(source).not.toMatch(/\b(Store|Router|worker|connector|stripe|twilio|sendgrid|openai|anthropic)\b/i);
    expect(source).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i);
  });
});
