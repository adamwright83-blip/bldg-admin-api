import type { AuthorityGrantPolicyView } from "./authorityPolicy";
import type { LegalDocumentPolicyView } from "./legalTemplatePolicy";
import type { VendorAgreementPolicyView } from "./vendorAgreementPolicy";
import { evaluateErrandPurchasePath, type ErrandPurchasePathInput } from "./errandPurchasePathPolicy";
import { evaluateRealWorldExecutionGate, realWorldExecutionGateKey } from "./realWorldExecutionGatePolicy";
import { evaluateMandateTransition, type MandateState } from "./mandateOrchestratorPolicy";
import { evaluateDispatchReadiness, evaluateProofStatus } from "./dispatchProofPolicy";

export const MANDATE_SIMULATION_SCENARIOS = [
  "mom_arrives_guest_readiness_with_budget",
  "vendor_missing_agreement_blocks",
  "high_risk_requires_operator_gate",
  "proof_missing_blocks_completion",
  "payment_required_blocks_when_not_authorized",
] as const;
export type MandateSimulationScenario = typeof MANDATE_SIMULATION_SCENARIOS[number];

export type MandateSimulationReport = {
  scenario: MandateSimulationScenario;
  constraints: { budgetCapCents: number; spendCents: number; dogAllergy: boolean; accessWindow: string };
  stages: Array<{ stage: string; status: string; reasons: string[] }>;
  finalStatus: "blocked" | "ready_for_manual_dispatch_review" | "completed_with_verified_proof";
  completed: boolean;
  sideEffects: { databaseWrites: false; externalCalls: false; vendorContacted: false; outreachSent: false;
    dispatched: false; paymentAuthorized: false; paymentCaptured: false };
};

const now = new Date("2026-06-19T12:00:00Z");
const termsHash = "a".repeat(64);
const bodyHash = "b".repeat(64);
const authority: AuthorityGrantPolicyView = { authorityType: "guest_readiness", status: "active",
  budgetCapCents: 50_000, deadlineAt: new Date("2026-06-22T00:00:00Z"),
  expiresAt: new Date("2026-06-23T00:00:00Z"), revokedAt: null,
  allowedRiskCategories: ["low", "medium"], disallowedCategories: [],
  accessConstraints: { allowedPatterns: ["resident_present"] } };
const legal: LegalDocumentPolicyView = { documentKey: "vendor_agreement", version: "v1", status: "approved",
  bodyHash, termsHash, approvedAt: new Date("2026-06-01T00:00:00Z"),
  effectiveAt: new Date("2026-06-02T00:00:00Z"), retiredAt: null };
const agreement: VendorAgreementPolicyView = { status: "signed", legalDocumentKey: "vendor_agreement",
  legalDocumentVersion: "v1", termsVersion: "terms-v1", termsHash, bodyHash,
  renderedAgreementHash: "c".repeat(64), signedAt: new Date("2026-06-18T00:00:00Z"), revokedAt: null,
  expiresAt: new Date("2026-07-01T00:00:00Z") };

function pathInput(scenario: MandateSimulationScenario): ErrandPurchasePathInput {
  const highRisk = scenario === "high_risk_requires_operator_gate";
  return { pathType: "service", authority,
    action: { authorityType: "guest_readiness", category: highRisk ? "childcare" : "laundry",
      spendCents: 12_000, scheduledAt: new Date("2026-06-20T16:00:00Z"), accessPattern: "resident_present" },
    planItem: { feasibilityClassification: highRisk ? "feasible_with_risk" : "feasible",
      itemState: highRisk ? "needs_operator_review" : "sourcing_required", riskCategory: highRisk ? "high" : "low",
      operatorReviewRequired: highRisk, residentApprovalRequired: false }, residentApprovalGranted: false,
    providerAcceptanceRequired: false, providerAcceptance: null, vendorInvolved: true,
    vendorAgreement: scenario === "vendor_missing_agreement_blocks" ? null : agreement, legalDocument: legal,
    paymentRequired: scenario === "payment_required_blocks_when_not_authorized",
    authorizationState: scenario === "payment_required_blocks_when_not_authorized" ? "authorization_pending" : "authorized",
    operatorConfirmationGranted: highRisk, now };
}

export function simulateMandateScenario(scenario: MandateSimulationScenario, options: { unsupported?: boolean } = {}): MandateSimulationReport {
  const input = pathInput(scenario);
  if (options.unsupported) input.pathType = "unsupported";
  const path = evaluateErrandPurchasePath(input);
  const gateKey = realWorldExecutionGateKey({ workflowKey: "simulation:guest-readiness", subjectType: "guest_readiness_plan_item", subjectId: "item-1" });
  const gate = evaluateRealWorldExecutionGate({ readiness: path, workflowKey: "simulation:guest-readiness",
    subjectType: "guest_readiness_plan_item", subjectId: "item-1", authorityCurrent: true,
    vendorAgreementRequired: true, vendorAgreementCurrent: Boolean(input.vendorAgreement),
    providerAcceptanceRequired: false, providerAcceptanceCurrent: true, paymentRequired: input.paymentRequired,
    paymentAuthorized: input.authorizationState === "authorized", riskConfirmationRequired: input.planItem.riskCategory === "high",
    gate: path.status.startsWith("blocked_") ? null : { gateKey, workflowKey: "simulation:guest-readiness",
      subjectType: "guest_readiness_plan_item", subjectId: "item-1", status: "approved",
      deadlineAt: new Date("2026-06-21T00:00:00Z"), decidedAt: new Date("2026-06-19T11:00:00Z") }, now });
  const transition = evaluateMandateTransition({ state: "purchase_path_review", eventType: "execution_gate_required",
    purchasePathDecision: path });
  const mandateState: MandateState = transition.nextState === "operator_execution_review" && gate.operatorExecutionApproved
    ? "dispatch_pending" : transition.nextState;
  const dispatch = evaluateDispatchReadiness({ pathType: "vendor_service", purchasePath: path, executionGate: gate,
    mandateState, vendorAgreementRequired: true, vendorAgreementCurrent: Boolean(input.vendorAgreement),
    providerAcceptanceRequired: false, providerAcceptanceCurrent: true });
  const proof = evaluateProofStatus({ dispatchStatus: dispatch.readyForManualDispatch ? "manually_dispatched" : "dispatch_blocked",
    proofStatus: scenario === "mom_arrives_guest_readiness_with_budget" ? "verified" : "needs_review" });
  const completed = proof.completionAllowed && scenario === "mom_arrives_guest_readiness_with_budget";
  return { scenario, constraints: { budgetCapCents: authority.budgetCapCents, spendCents: input.action.spendCents,
      dogAllergy: true, accessWindow: "2026-06-20T16:00:00Z/2026-06-20T18:00:00Z" },
    stages: [
      { stage: "authority_and_guest_readiness", status: path.status, reasons: path.reasons },
      { stage: "sourcing_scoring", status: "simulated_candidate_review_only", reasons: ["dog_allergy_and_access_window_preserved"] },
      { stage: "outreach_and_agreement", status: input.vendorAgreement ? "review_prerequisites_satisfied" : "blocked", reasons: input.vendorAgreement ? [] : ["signed_vendor_agreement_required"] },
      { stage: "execution_gate", status: gate.status, reasons: gate.reasons },
      { stage: "dispatch_and_proof", status: proof.nextDispatchStatus, reasons: proof.reasons },
    ], finalStatus: completed ? "completed_with_verified_proof" : dispatch.readyForManualDispatch
      ? "ready_for_manual_dispatch_review" : "blocked", completed,
    sideEffects: { databaseWrites: false, externalCalls: false, vendorContacted: false, outreachSent: false,
      dispatched: false, paymentAuthorized: false, paymentCaptured: false } };
}
