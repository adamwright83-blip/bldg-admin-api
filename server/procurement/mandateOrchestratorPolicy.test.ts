import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ErrandPurchasePathDecision, ErrandPurchasePathStatus } from "./errandPurchasePathPolicy";
import type { RealWorldExecutionGateDecision, RealWorldExecutionGateStatus } from "./realWorldExecutionGatePolicy";
import { createMandateState, evaluateMandateTransition } from "./mandateOrchestratorPolicy";

const path = (status: ErrandPurchasePathStatus): ErrandPurchasePathDecision => ({
  status, reviewReady: status === "ready_for_operator_execution_review", executionReady: false,
  dispatchReady: false, paymentReady: false, reasons: [],
});
const gate = (status: RealWorldExecutionGateStatus = "gate_approved"): RealWorldExecutionGateDecision => ({
  status, gateRequired: true, requiredGateKey: "real_world_execution_approval:guest_readiness_plan_item:item-1",
  operatorExecutionApproved: status === "gate_approved", executionReady: false, dispatchReady: false,
  paymentReady: false, booked: false, completed: false, reasons: [],
});

describe("mandate orchestrator policy", () => {
  it("begins every mandate at mandate_created", () => {
    expect(createMandateState()).toBe("mandate_created");
  });

  it("moves from planning to sourcing or purchase review according to need", () => {
    expect(evaluateMandateTransition({ state: "mandate_created", eventType: "plan_created" }).nextState).toBe("planning");
    expect(evaluateMandateTransition({ state: "planning", eventType: "sourcing_required",
      planningNeedsSourcing: true }).nextState).toBe("sourcing");
    expect(evaluateMandateTransition({ state: "planning", eventType: "purchase_path_ready",
      planningNeedsSourcing: false }).nextState).toBe("purchase_path_review");
  });

  it("moves sourcing to candidate review only with candidate prerequisites", () => {
    expect(evaluateMandateTransition({ state: "sourcing", eventType: "candidate_ready",
      candidatePrerequisitesSatisfied: true }).nextState).toBe("candidate_review");
    expect(evaluateMandateTransition({ state: "sourcing", eventType: "candidate_ready",
      candidatePrerequisitesSatisfied: false }).allowed).toBe(false);
  });

  it("requires both candidate and outreach prerequisites before outreach review", () => {
    expect(evaluateMandateTransition({ state: "candidate_review", eventType: "outreach_draft_ready",
      candidatePrerequisitesSatisfied: true, outreachPrerequisitesSatisfied: true }).nextState).toBe("outreach_review");
    expect(evaluateMandateTransition({ state: "candidate_review", eventType: "outreach_draft_ready",
      candidatePrerequisitesSatisfied: true, outreachPrerequisitesSatisfied: false }).allowed).toBe(false);
  });

  it("requires a signed vendor agreement before advancing agreement review", () => {
    expect(evaluateMandateTransition({ state: "vendor_response_waiting", eventType: "agreement_signed",
      vendorAgreementRequired: true, vendorAgreementSigned: false }).allowed).toBe(false);
    expect(evaluateMandateTransition({ state: "vendor_response_waiting", eventType: "agreement_signed",
      vendorAgreementRequired: true, vendorAgreementSigned: true }).nextState).toBe("agreement_review");
    expect(evaluateMandateTransition({ state: "agreement_review", eventType: "purchase_path_ready",
      vendorAgreementRequired: true, vendorAgreementSigned: true }).nextState).toBe("purchase_path_review");
  });

  it.each(["unsupported", "infeasible", "blocked_missing_authority",
    "blocked_missing_vendor_agreement", "blocked_missing_provider_acceptance",
    "blocked_payment_not_authorized"] as const)("blocks purchase-path status %s", status => {
    expect(evaluateMandateTransition({ state: "purchase_path_review", eventType: "execution_gate_required",
      purchasePathDecision: path(status) })).toMatchObject({ allowed: true, nextState: "blocked" });
  });

  it.each(["ready_for_operator_execution_review", "requires_operator_confirmation"] as const)(
    "routes purchase-path status %s to operator review", status => {
      expect(evaluateMandateTransition({ state: "purchase_path_review", eventType: "execution_gate_required",
        purchasePathDecision: path(status) }).nextState).toBe("operator_execution_review");
    });

  it("records gate approval without implying dispatch, payment, booking, or completion", () => {
    expect(evaluateMandateTransition({ state: "operator_execution_review", eventType: "execution_gate_approved",
      executionGateDecision: gate() })).toEqual(expect.objectContaining({
        allowed: true, nextState: "operator_execution_review", operatorExecutionApproved: true,
        dispatched: false, paymentAuthorized: false, paymentCaptured: false, booked: false, completed: false,
      }));
  });

  it("requires explicit operator approval before dispatch_pending", () => {
    expect(evaluateMandateTransition({ state: "operator_execution_review", eventType: "dispatch_requested",
      executionGateDecision: gate(), operatorExecutionApprovalExplicit: false }).allowed).toBe(false);
    expect(evaluateMandateTransition({ state: "operator_execution_review", eventType: "dispatch_requested",
      executionGateDecision: gate(), operatorExecutionApprovalExplicit: true })).toMatchObject({
        allowed: true, nextState: "dispatch_pending", dispatched: false,
      });
  });

  it("requires proof evidence and review before completion", () => {
    expect(evaluateMandateTransition({ state: "dispatch_pending", eventType: "proof_recorded",
      proofRecorded: false }).allowed).toBe(false);
    expect(evaluateMandateTransition({ state: "dispatch_pending", eventType: "proof_recorded",
      proofRecorded: true }).nextState).toBe("proof_pending");
    expect(evaluateMandateTransition({ state: "proof_pending", eventType: "proof_recorded",
      proofRecorded: false }).allowed).toBe(false);
    expect(evaluateMandateTransition({ state: "proof_pending", eventType: "proof_recorded",
      proofRecorded: true }).nextState).toBe("completed");
  });

  it("fails closed for wrong-order events", () => {
    expect(evaluateMandateTransition({ state: "planning", eventType: "dispatch_requested",
      operatorExecutionApprovalExplicit: true, executionGateDecision: gate() })).toMatchObject({
        allowed: false, nextState: "planning",
      });
  });

  it("keeps blocked and terminal states closed unless reopening is explicit", () => {
    expect(evaluateMandateTransition({ state: "blocked", eventType: "plan_created" }).allowed).toBe(false);
    expect(evaluateMandateTransition({ state: "blocked", eventType: "plan_created",
      reopeningAuthorized: true }).nextState).toBe("planning");
    expect(evaluateMandateTransition({ state: "cancelled", eventType: "plan_created",
      reopeningAuthorized: true }).allowed).toBe(false);
    expect(evaluateMandateTransition({ state: "completed", eventType: "plan_created",
      reopeningAuthorized: true }).allowed).toBe(false);
  });

  it("has no I/O, contact, send, dispatch, or payment side effects", async () => {
    const source = await readFile(new URL("./mandateOrchestratorPolicy.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(fetch|axios|execute|query|insert|update|delete)\s*\(/i);
    expect(source).not.toMatch(/twilio|sendgrid|stripe|nodemailer|Store\b|LLM/i);
    expect(source).not.toMatch(/dispatched:\s*true|paymentAuthorized:\s*true|paymentCaptured:\s*true|outreachSent:\s*true/);
  });
});
