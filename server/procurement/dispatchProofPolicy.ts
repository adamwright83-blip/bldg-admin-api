import type { ErrandPurchasePathDecision } from "./errandPurchasePathPolicy";
import type { MandateState } from "./mandateOrchestratorPolicy";
import type { RealWorldExecutionGateDecision } from "./realWorldExecutionGatePolicy";

export type DispatchStatus = "draft" | "ready_for_manual_dispatch" | "dispatch_blocked"
  | "manually_dispatched" | "proof_pending" | "proof_verified" | "cancelled" | "rejected";
export type ProofStatus = "submitted" | "needs_review" | "verified" | "rejected";

export type DispatchProofDecision = {
  allowed: boolean;
  nextDispatchStatus: DispatchStatus;
  readyForManualDispatch: boolean;
  manualDispatchRecorded: boolean;
  completionAllowed: boolean;
  dispatchIntegrationInvoked: false;
  messageSent: false;
  paymentAuthorized: false;
  paymentCaptured: false;
  reasons: string[];
};

function result(input: Omit<DispatchProofDecision, "dispatchIntegrationInvoked" | "messageSent"
  | "paymentAuthorized" | "paymentCaptured" | "reasons"> & { reasons: string[] }): DispatchProofDecision {
  return { ...input, dispatchIntegrationInvoked: false, messageSent: false,
    paymentAuthorized: false, paymentCaptured: false, reasons: Array.from(new Set(input.reasons)) };
}

export function evaluateDispatchReadiness(input: {
  pathType: "vendor_service" | "runner_purchase" | "operator_manual" | "unsupported";
  purchasePath: ErrandPurchasePathDecision;
  executionGate: RealWorldExecutionGateDecision;
  mandateState: MandateState;
  vendorAgreementRequired: boolean;
  vendorAgreementCurrent: boolean;
  providerAcceptanceRequired: boolean;
  providerAcceptanceCurrent: boolean;
}): DispatchProofDecision {
  const reasons: string[] = [];
  if (input.pathType === "unsupported" || input.purchasePath.status === "unsupported"
    || input.purchasePath.status === "infeasible") reasons.push("dispatch_path_unsupported");
  if (input.purchasePath.status.startsWith("blocked_")) reasons.push(input.purchasePath.status);
  if (input.purchasePath.status !== "ready_for_operator_execution_review"
    && input.purchasePath.status !== "requires_operator_confirmation") reasons.push("purchase_path_not_reviewable");
  if (input.executionGate.status !== "gate_approved" || !input.executionGate.operatorExecutionApproved) {
    reasons.push("operator_execution_gate_not_approved");
  }
  if (input.mandateState !== "dispatch_pending") reasons.push("mandate_not_dispatch_pending");
  if (input.vendorAgreementRequired && !input.vendorAgreementCurrent) reasons.push("vendor_agreement_not_current");
  if (input.providerAcceptanceRequired && !input.providerAcceptanceCurrent) reasons.push("provider_acceptance_not_current");
  return result({ allowed: reasons.length === 0,
    nextDispatchStatus: reasons.length === 0 ? "ready_for_manual_dispatch" : "dispatch_blocked",
    readyForManualDispatch: reasons.length === 0, manualDispatchRecorded: false,
    completionAllowed: false, reasons });
}

export function evaluateManualDispatchRecord(currentStatus: DispatchStatus): DispatchProofDecision {
  const allowed = currentStatus === "ready_for_manual_dispatch";
  return result({ allowed, nextDispatchStatus: allowed ? "manually_dispatched" : currentStatus,
    readyForManualDispatch: false, manualDispatchRecorded: allowed, completionAllowed: false,
    reasons: allowed ? ["manual_dispatch_evidence_recorded"] : ["dispatch_not_ready_for_manual_record"] });
}

export function evaluateProofStatus(input: {
  dispatchStatus: DispatchStatus;
  proofStatus: ProofStatus;
}): DispatchProofDecision {
  const dispatchCanHaveProof = input.dispatchStatus === "manually_dispatched"
    || input.dispatchStatus === "proof_pending" || input.dispatchStatus === "proof_verified";
  if (!dispatchCanHaveProof) return result({ allowed: false, nextDispatchStatus: input.dispatchStatus,
    readyForManualDispatch: false, manualDispatchRecorded: false, completionAllowed: false,
    reasons: ["manual_dispatch_record_required_before_proof"] });
  if (input.proofStatus === "verified") return result({ allowed: true, nextDispatchStatus: "proof_verified",
    readyForManualDispatch: false, manualDispatchRecorded: true, completionAllowed: true,
    reasons: ["verified_proof_allows_completion_review"] });
  if (input.proofStatus === "rejected") return result({ allowed: false, nextDispatchStatus: "dispatch_blocked",
    readyForManualDispatch: false, manualDispatchRecorded: true, completionAllowed: false,
    reasons: ["proof_rejected"] });
  return result({ allowed: true, nextDispatchStatus: "proof_pending", readyForManualDispatch: false,
    manualDispatchRecorded: true, completionAllowed: false, reasons: ["verified_proof_required_for_completion"] });
}
