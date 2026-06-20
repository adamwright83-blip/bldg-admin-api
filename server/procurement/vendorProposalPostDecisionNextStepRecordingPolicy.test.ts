import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ProposalPostDecisionNextStepResult } from "./vendorProposalPostDecisionNextStepPolicy";
import { evaluateVendorProposalPostDecisionNextStepRecording } from "./vendorProposalPostDecisionNextStepRecordingPolicy";

const NOW = new Date("2026-06-20T12:00:00Z");
const falseOutcomes = { booked: false, accepted: false, dispatched: false, paid: false, captured: false,
  completed: false, selectedForExecution: false, providerAccepted: false, bookingVerified: false,
  paymentAuthorized: false, paymentCaptured: false, invoiceCreated: false, payableCreated: false,
  outreachSent: false, providerMessageCreated: false, deliveryVerified: false, executionApproved: false,
  stateMutated: false } as const;

function nextStep(status: ProposalPostDecisionNextStepResult["status"],
  patch: Partial<ProposalPostDecisionNextStepResult> = {}): ProposalPostDecisionNextStepResult {
  return { status, nextStepAllowed: status === "next_step_ready_for_operator_pre_execution_review",
    workflowId: "42", requestId: "request-1", proposalId: "proposal-1", gateId: "gate-40",
    gateKey: "proposal_gate:42:candidate-1", decisionId: "decision-1", decisionKey: "decision-key-1",
    reasonCodes: ["reviewed"], riskFlags: ["quoted_terms"], requiredApprovals: [],
    sourceDecisionSnapshotReference: null, expiresAt: "2026-06-21T12:00:00Z",
    nextStepOnlyWarning: "operator_pre_execution_review_only_not_execution", ...falseOutcomes, ...patch };
}

function evaluate(value: ProposalPostDecisionNextStepResult | null, patch: Record<string, unknown> = {}) {
  return evaluateVendorProposalPostDecisionNextStepRecording({ nextStep: value, identifiers: {},
    actor: { actorId: "system-1", actorType: "system" }, idempotencyKeyInput: "idem-40", now: NOW, ...patch });
}

describe("vendor proposal post-decision next-step recording policy", () => {
  it.each([
    ["next_step_rejected", "record_rejection_outcome"],
    ["next_step_needs_revision", "record_revision_required"],
    ["next_step_requires_resident_approval", "record_resident_approval_required"],
    ["next_step_requires_budget_approval", "record_budget_approval_required"],
    ["next_step_requires_payment_authorization_request", "record_payment_authorization_request_required"],
    ["next_step_requires_legal_review", "record_legal_review_required"],
    ["next_step_ready_for_operator_pre_execution_review", "record_operator_pre_execution_review_required"],
    ["next_step_waiting_for_clarification", "record_waiting_for_clarification"],
  ] as const)("maps %s to %s administratively only", (status, command) => {
    expect(evaluate(nextStep(status))).toMatchObject({ command, allowed: true,
      nextStepStatus: status, nextStepOnlyWarning: "administrative_recording_only_not_execution",
      ...falseOutcomes });
  });

  it("preserves identifiers, review metadata, and source snapshot", () => {
    const source = nextStep("next_step_requires_legal_review", { requiredApprovals: ["legal_review"] });
    expect(evaluate(source)).toMatchObject({ workflowId: "42", requestId: "request-1", proposalId: "proposal-1",
      gateId: "gate-40", gateKey: "proposal_gate:42:candidate-1", decisionId: "decision-1",
      decisionKey: "decision-key-1", reasonCodes: ["reviewed"], riskFlags: ["quoted_terms"],
      requiredApprovals: ["legal_review"], sourceNextStepSnapshotReference: source });
  });

  it("generates deterministic idempotency and command keys", () => {
    const source = nextStep("next_step_ready_for_operator_pre_execution_review");
    const first = evaluate(source); const second = evaluate(source);
    expect(first).toEqual(second);
    expect(first.idempotencyKey).toBe("idem-40");
    expect(first.commandKey).toBe("proposal_post_decision_recording:42:request-1:proposal-1:gate-40:decision-1:next_step_ready_for_operator_pre_execution_review:idem-40");
  });

  it("fails closed for missing result, identifiers, actor, idempotency, expiry, and unsupported status", () => {
    expect(evaluate(null).command).toBe("next_step_recording_not_allowed");
    expect(evaluate(nextStep("next_step_rejected", { gateId: null })).reasonCodes)
      .toContain("next_step_recording_identifiers_missing");
    expect(evaluate(nextStep("next_step_rejected"), { actor: { actorId: "", actorType: "system" } }).reasonCodes)
      .toContain("recording_actor_context_missing_or_invalid");
    expect(evaluate(nextStep("next_step_rejected"), { idempotencyKeyInput: "" }).reasonCodes)
      .toContain("idempotency_key_missing");
    expect(evaluate(nextStep("next_step_rejected", { expiresAt: NOW })).reasonCodes)
      .toContain("next_step_result_expired");
    expect(evaluate(nextStep("unsupported" as never)).reasonCodes).toContain("next_step_status_unsupported");
  });

  it.each(["booked", "paymentAuthorized", "dispatched", "outreachSent", "providerMessageCreated",
    "deliveryVerified", "stateMutated"] as const)("rejects a true %s claim", key => {
    const source = nextStep("next_step_ready_for_operator_pre_execution_review");
    (source as unknown as Record<string, unknown>)[key] = true;
    const result = evaluate(source);
    expect(result.command).toBe("next_step_recording_not_allowed");
    expect(result.allowed).toBe(false);
    expect(result.reasonCodes.some(reason => reason.startsWith("forbidden_claim:"))).toBe(true);
  });

  it("contains no I/O, store, DB, route, UI, worker, connector, LLM, or external call", () => {
    const source = readFileSync("server/procurement/vendorProposalPostDecisionNextStepRecordingPolicy.ts", "utf8");
    expect(source).not.toMatch(/\b(fetch|axios|execute|query|insert|update|delete)\s*\(/i);
    expect(source).not.toMatch(/\b(Store|Router|worker|connector|stripe|twilio|sendgrid|openai|anthropic)\b/i);
    expect(source).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i);
  });
});
