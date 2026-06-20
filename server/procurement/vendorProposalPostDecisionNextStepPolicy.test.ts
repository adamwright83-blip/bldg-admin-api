import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ProposalOperatorGateDecisionResult } from "./vendorProposalOperatorGateDecisionPolicy";
import { evaluateVendorProposalPostDecisionNextStep, type RecordedProposalOperatorDecisionSnapshot } from "./vendorProposalPostDecisionNextStepPolicy";

const NOW = new Date("2026-06-20T12:00:00Z");
const falseOutcomes = { booked: false, accepted: false, dispatched: false, paid: false, captured: false,
  completed: false, selectedForExecution: false, providerAccepted: false, bookingVerified: false,
  paymentAuthorized: false, paymentCaptured: false, invoiceCreated: false, payableCreated: false,
  outreachSent: false, providerMessageCreated: false, deliveryVerified: false, executionApproved: false } as const;

function decision(status: ProposalOperatorGateDecisionResult["status"] = "operator_gate_decision_approved_for_next_step_only",
  patch: Partial<RecordedProposalOperatorDecisionSnapshot> = {}): RecordedProposalOperatorDecisionSnapshot {
  return { status, decisionAllowed: true, gateId: "gate-39", gateKey: "proposal_gate:42:candidate-1",
    workflowId: "42", requestId: "request-1", proposalId: "proposal-1", candidateId: "candidate-1",
    decisionType: "approved", decisionId: "decision-1", decisionKey: "decision-key-1",
    reasonCodes: ["manual_review"], riskFlags: ["quoted_terms"], operatorId: "operator-1",
    expiresAt: "2026-06-21T12:00:00Z", ...falseOutcomes, ...patch };
}

function evaluate(value: RecordedProposalOperatorDecisionSnapshot | null, patch: Record<string, unknown> = {}) {
  return evaluateVendorProposalPostDecisionNextStep({ decision: value,
    proposal: { id: "proposal-1", status: "proposal_ready_for_review", reasons: [], riskFlags: [],
      expiresAt: "2026-06-21T12:00:00Z" },
    requestContext: { workflowId: "42", requestId: "request-1" },
    residentApprovalContext: { required: false, approved: false },
    budgetContext: { required: false, approved: false, withinBudget: true },
    paymentAuthorizationReadinessContext: { required: false, approvedForRequest: false },
    legalReviewContext: { required: false, approved: false }, now: NOW, ...patch });
}

describe("vendor proposal post-decision next-step policy", () => {
  it("returns rejected and revision statuses without progressing", () => {
    expect(evaluate(decision("operator_gate_decision_rejected"))).toMatchObject({
      status: "next_step_rejected", nextStepAllowed: false, ...falseOutcomes });
    expect(evaluate(decision("operator_gate_decision_needs_revision"))).toMatchObject({
      status: "next_step_needs_revision", nextStepAllowed: false, ...falseOutcomes });
  });

  it.each([
    ["operator_gate_decision_requires_resident_approval", "residentApprovalContext",
      { required: true, approved: false }, "next_step_requires_resident_approval"],
    ["operator_gate_decision_requires_budget_approval", "budgetContext",
      { required: true, approved: false, withinBudget: false }, "next_step_requires_budget_approval"],
    ["operator_gate_decision_requires_payment_authorization", "paymentAuthorizationReadinessContext",
      { required: true, approvedForRequest: false }, "next_step_requires_payment_authorization_request"],
    ["operator_gate_decision_requires_legal_review", "legalReviewContext",
      { required: true, approved: false }, "next_step_requires_legal_review"],
  ] as const)("maps %s to its missing review", (decisionStatus, contextKey, context, expected) => {
    expect(evaluate(decision(decisionStatus), { [contextKey]: context })).toMatchObject({ status: expected,
      nextStepAllowed: false, paymentAuthorized: false, executionApproved: false });
  });

  it("returns only operator pre-execution review readiness with all prerequisites satisfied", () => {
    expect(evaluate(decision())).toMatchObject({
      status: "next_step_ready_for_operator_pre_execution_review", nextStepAllowed: true,
      workflowId: "42", requestId: "request-1", proposalId: "proposal-1", gateId: "gate-39",
      decisionId: "decision-1", decisionKey: "decision-key-1",
      nextStepOnlyWarning: "operator_pre_execution_review_only_not_execution", ...falseOutcomes,
    });
  });

  it("advances an approval requirement only after its review context is approved", () => {
    const result = evaluate(decision("operator_gate_decision_requires_resident_approval"), {
      residentApprovalContext: { required: true, approved: true },
    });
    expect(result.status).toBe("next_step_ready_for_operator_pre_execution_review");
    expect(result.requiredApprovals).toContain("resident_approval");
  });

  it("waits for clarification instead of progressing", () => {
    expect(evaluate(decision(), { requestContext: { workflowId: "42", requestId: "request-1",
      requiresClarification: true } })).toMatchObject({ status: "next_step_waiting_for_clarification",
      nextStepAllowed: false });
  });

  it("fails closed for missing, expired, or unidentified decisions", () => {
    expect(evaluate(null).status).toBe("next_step_not_allowed");
    expect(evaluate(decision(undefined, { expiresAt: NOW })).reasonCodes).toContain("operator_gate_decision_expired");
    expect(evaluate(decision(undefined, { gateKey: null })).reasonCodes).toContain("post_decision_identifiers_missing");
    expect(evaluate(decision(undefined, { requestId: null }), {
      requestContext: { workflowId: "42", requestId: null } }).reasonCodes).toContain("post_decision_identifiers_missing");
  });

  it.each([
    ["residentApprovalContext", { required: true, approved: false }, "next_step_requires_resident_approval"],
    ["budgetContext", { required: true, approved: false, withinBudget: false }, "next_step_requires_budget_approval"],
    ["legalReviewContext", { required: true, approved: false }, "next_step_requires_legal_review"],
    ["paymentAuthorizationReadinessContext", { required: true, approvedForRequest: false },
      "next_step_requires_payment_authorization_request"],
  ] as const)("fails closed when %s is missing", (key, context, expected) => {
    expect(evaluate(decision(), { [key]: context }).status).toBe(expected);
  });

  it.each(["booked", "paymentAuthorized", "dispatched", "outreachSent", "providerMessageCreated",
    "deliveryVerified"] as const)("rejects a true %s claim", key => {
    const value = decision();
    (value as Record<string, unknown>)[key] = true;
    const result = evaluate(value);
    expect(result.status).toBe("next_step_not_allowed");
    expect(result.reasonCodes.some(reason => reason.startsWith("forbidden_claim:"))).toBe(true);
  });

  it("rejects a forbidden execution claim embedded in the proposal snapshot", () => {
    const result = evaluate(decision(), { proposal: { id: "proposal-1", status: "proposal_ready_for_review",
      summary: "The vendor is booked", expiresAt: "2026-06-21T12:00:00Z" } });
    expect(result.status).toBe("next_step_not_allowed");
    expect(result.reasonCodes).toContain("forbidden_claim:proposal.summary");
  });

  it("contains no I/O, store, DB, route, UI, worker, connector, LLM, or external call", () => {
    const source = readFileSync("server/procurement/vendorProposalPostDecisionNextStepPolicy.ts", "utf8");
    expect(source).not.toMatch(/\b(fetch|axios|execute|query|insert|update|delete)\s*\(/i);
    expect(source).not.toMatch(/\b(Store|Router|worker|connector|stripe|twilio|sendgrid|openai|anthropic)\b/i);
    expect(source).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i);
  });
});
