import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateVendorProposalOperatorGateDecision, type ProposalOperatorGateSnapshot } from "./vendorProposalOperatorGateDecisionPolicy";

const now = new Date("2026-06-20T12:00:00Z");
const gate = (patch: Partial<ProposalOperatorGateSnapshot> = {}): ProposalOperatorGateSnapshot => ({
  id: "gate-37", gateKey: "proposal_gate:42:candidate-1", workflowId: "42", requestId: "request-1",
  proposalId: "proposal-1", candidateId: "candidate-1", status: "pending",
  deadlineAt: new Date("2026-06-21T12:00:00Z"), decidedAt: null,
  promptJson: { reasonCodes: ["operator_review_required"] }, evidenceJson: { proposalId: "proposal-1" }, ...patch,
});
const evaluate = (decisionType: string, overrides: Record<string, unknown> = {}) =>
  evaluateVendorProposalOperatorGateDecision({ gate: gate(), decision: { decisionType,
    reasonCodes: ["manual_review"], riskFlags: ["quoted_terms"], operatorNoteSummary: "Reviewed manually" },
    actor: { operatorId: "operator-1", actorType: "operator" }, now, ...overrides });

const falseOutcomes = {
  booked: false, accepted: false, dispatched: false, paid: false, captured: false, completed: false,
  selectedForExecution: false, providerAccepted: false, bookingVerified: false, paymentAuthorized: false,
  paymentCaptured: false, invoiceCreated: false, payableCreated: false, outreachSent: false,
  providerMessageCreated: false, deliveryVerified: false,
};

describe("vendor proposal operator gate decision policy", () => {
  it("approves only the next controlled step and preserves audit context", () => {
    expect(evaluate("approved")).toMatchObject({
      status: "operator_gate_decision_approved_for_next_step_only", decisionAllowed: true,
      gateId: "gate-37", gateKey: "proposal_gate:42:candidate-1", workflowId: "42",
      requestId: "request-1", proposalId: "proposal-1", candidateId: "candidate-1",
      decisionType: "approved", reasonCodes: ["manual_review", "operator_approval_is_next_step_only_not_execution"],
      riskFlags: ["quoted_terms"], operatorId: "operator-1", operatorNoteSummary: "Reviewed manually",
      nextRequiredReviewType: null, ...falseOutcomes,
    });
  });

  it.each([
    ["rejected", "operator_gate_decision_rejected", null],
    ["needs_revision", "operator_gate_decision_needs_revision", "proposal_revision"],
    ["requires_resident_approval", "operator_gate_decision_requires_resident_approval", "resident_approval"],
    ["requires_budget_approval", "operator_gate_decision_requires_budget_approval", "budget_approval"],
    ["requires_payment_authorization", "operator_gate_decision_requires_payment_authorization", "payment_authorization"],
    ["requires_legal_review", "operator_gate_decision_requires_legal_review", "legal_review"],
  ] as const)("maps %s without executing anything", (decisionType, status, nextRequiredReviewType) => {
    expect(evaluate(decisionType)).toMatchObject({ status, decisionAllowed: true, nextRequiredReviewType,
      ...falseOutcomes });
  });

  it("fails closed for a missing or malformed gate and missing actor", () => {
    expect(evaluate("approved", { gate: null }).status).toBe("operator_gate_decision_not_allowed");
    expect(evaluate("approved", { gate: gate({ id: null }) }).reasonCodes).toContain("operator_gate_identifiers_missing");
    expect(evaluate("approved", { gate: gate({ gateKey: "" }) }).reasonCodes).toContain("operator_gate_identifiers_missing");
    expect(evaluate("approved", { gate: gate({ workflowId: null }) }).reasonCodes).toContain("operator_gate_identifiers_missing");
    expect(evaluate("approved", { gate: gate({ proposalId: null }) }).reasonCodes).toContain("operator_gate_identifiers_missing");
    expect(evaluate("approved", { actor: { operatorId: "", actorType: "operator" } }).reasonCodes)
      .toContain("decision_actor_missing_or_invalid");
  });

  it("fails closed for expired and already resolved gates", () => {
    expect(evaluate("approved", { gate: gate({ deadlineAt: now }) }).status)
      .toBe("operator_gate_decision_expired");
    expect(evaluate("approved", { gate: gate({ status: "approved", decidedAt: now }) }).reasonCodes)
      .toContain("operator_gate_already_resolved");
  });

  it("fails closed for unsupported decisions", () => {
    expect(evaluate("execute_now")).toMatchObject({ status: "operator_gate_decision_not_allowed",
      decisionAllowed: false, reasonCodes: expect.arrayContaining(["operator_decision_type_unsupported"]) });
  });

  it.each([
    ["gate", { gate: gate({ promptJson: { booked: true } }) }],
    ["proposal result", { proposalApprovalGateResult: { status: "proposal_approved_for_next_step_only",
      allowed: true, reasons: [], riskFlags: [], booked: true } }],
    ["recording command", { recordingCommandReference: { command: "record_next_step_only_approval",
      allowed: true, booked: false, paymentAuthorized: true } }],
  ])("rejects forbidden execution, booking, dispatch, or payment claims in %s", (_name, overrides) => {
    const result = evaluate("approved", overrides as Record<string, unknown>);
    expect(result.status).toBe("operator_gate_decision_not_allowed");
    expect(result.reasonCodes.some(reason => reason.startsWith("forbidden_claim:"))).toBe(true);
  });

  it("always hardcodes every execution and external outcome false", () => {
    for (const decisionType of ["approved", "rejected", "needs_revision", "requires_resident_approval",
      "requires_budget_approval", "requires_payment_authorization", "requires_legal_review"]) {
      expect(evaluate(decisionType)).toMatchObject(falseOutcomes);
    }
  });

  it("contains no I/O, store, route, UI, worker, SQL, connector, LLM, or external call", () => {
    const source = readFileSync("server/procurement/vendorProposalOperatorGateDecisionPolicy.ts", "utf8");
    expect(source).not.toMatch(/\b(fetch|axios|execute|query|insert|update|delete)\s*\(/i);
    expect(source).not.toMatch(/\b(Store|Router|worker|connector|stripe|twilio|sendgrid|openai|anthropic)\b/i);
    expect(source).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i);
  });
});
