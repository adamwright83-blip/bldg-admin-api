import type { ErrandPurchasePathDecision } from "./errandPurchasePathPolicy";
import type { RealWorldExecutionGateDecision } from "./realWorldExecutionGatePolicy";

export type MandateState =
  | "mandate_created" | "planning" | "sourcing" | "candidate_review" | "outreach_review"
  | "vendor_response_waiting" | "agreement_review" | "purchase_path_review"
  | "operator_execution_review" | "dispatch_pending" | "proof_pending"
  | "completed" | "cancelled" | "blocked";

export type MandateEventType =
  | "plan_created" | "sourcing_required" | "candidate_ready" | "outreach_draft_ready"
  | "vendor_response_recorded" | "agreement_signed" | "purchase_path_ready"
  | "execution_gate_required" | "execution_gate_approved" | "dispatch_requested"
  | "proof_recorded" | "block_detected" | "cancelled";

export type MandateTransitionDecision = {
  allowed: boolean;
  previousState: MandateState;
  nextState: MandateState;
  eventType: MandateEventType;
  eventRecorded: boolean;
  operatorExecutionApproved: boolean;
  dispatched: false;
  paymentAuthorized: false;
  paymentCaptured: false;
  vendorContacted: false;
  outreachSent: false;
  booked: false;
  completed: boolean;
  reasons: string[];
};

export function createMandateState(): MandateState {
  return "mandate_created";
}

function transition(input: {
  previousState: MandateState;
  nextState?: MandateState;
  eventType: MandateEventType;
  allowed: boolean;
  operatorExecutionApproved?: boolean;
  reasons: string[];
}): MandateTransitionDecision {
  const nextState = input.allowed ? (input.nextState ?? input.previousState) : input.previousState;
  return {
    allowed: input.allowed,
    previousState: input.previousState,
    nextState,
    eventType: input.eventType,
    eventRecorded: input.allowed,
    operatorExecutionApproved: input.operatorExecutionApproved ?? false,
    dispatched: false,
    paymentAuthorized: false,
    paymentCaptured: false,
    vendorContacted: false,
    outreachSent: false,
    booked: false,
    completed: nextState === "completed",
    reasons: Array.from(new Set(input.reasons)),
  };
}

export function evaluateMandateTransition(input: {
  state: MandateState;
  eventType: MandateEventType;
  planningNeedsSourcing?: boolean;
  candidatePrerequisitesSatisfied?: boolean;
  outreachPrerequisitesSatisfied?: boolean;
  vendorAgreementRequired?: boolean;
  vendorAgreementSigned?: boolean;
  purchasePathDecision?: ErrandPurchasePathDecision | null;
  executionGateDecision?: RealWorldExecutionGateDecision | null;
  operatorExecutionApprovalExplicit?: boolean;
  proofRecorded?: boolean;
  reopeningAuthorized?: boolean;
  blockingReasons?: string[];
}): MandateTransitionDecision {
  const deny = (...reasons: string[]) => transition({ previousState: input.state,
    eventType: input.eventType, allowed: false, reasons });
  const allow = (nextState: MandateState, ...reasons: string[]) => transition({ previousState: input.state,
    nextState, eventType: input.eventType, allowed: true, reasons });

  if (input.state === "completed" || input.state === "cancelled") {
    return deny("terminal_mandate_cannot_transition");
  }
  if (input.state === "blocked") {
    if (input.eventType === "cancelled") return allow("cancelled", "blocked_mandate_cancelled");
    if (input.eventType === "plan_created" && input.reopeningAuthorized) {
      return allow("planning", "blocked_mandate_reopened_for_planning");
    }
    return deny("blocked_mandate_requires_explicit_reopening");
  }
  if (input.eventType === "block_detected") {
    return allow("blocked", ...(input.blockingReasons?.length ? input.blockingReasons : ["blocking_condition_detected"]));
  }
  if (input.eventType === "cancelled") return allow("cancelled", "mandate_cancelled");

  if (input.state === "mandate_created" && input.eventType === "plan_created") {
    return allow("planning", "plan_created");
  }
  if (input.state === "planning" && input.eventType === "sourcing_required") {
    return input.planningNeedsSourcing
      ? allow("sourcing", "planning_requires_sourcing")
      : deny("sourcing_not_required");
  }
  if (input.state === "planning" && input.eventType === "purchase_path_ready") {
    return input.planningNeedsSourcing === false
      ? allow("purchase_path_review", "planning_ready_for_purchase_path_review")
      : deny("sourcing_must_complete_before_purchase_path_review");
  }
  if (input.state === "sourcing" && input.eventType === "candidate_ready") {
    return input.candidatePrerequisitesSatisfied
      ? allow("candidate_review", "candidate_ready_for_review")
      : deny("candidate_prerequisites_missing");
  }
  if (input.state === "candidate_review" && input.eventType === "outreach_draft_ready") {
    return input.candidatePrerequisitesSatisfied && input.outreachPrerequisitesSatisfied
      ? allow("outreach_review", "outreach_draft_ready_for_review")
      : deny("candidate_or_outreach_prerequisites_missing");
  }
  if (input.state === "outreach_review" && input.eventType === "vendor_response_recorded") {
    return allow("vendor_response_waiting", "vendor_response_evidence_recorded");
  }
  if (input.state === "vendor_response_waiting" && input.eventType === "agreement_signed") {
    if (input.vendorAgreementRequired !== false && !input.vendorAgreementSigned) {
      return deny("signed_vendor_agreement_required");
    }
    return allow("agreement_review", "signed_vendor_agreement_recorded");
  }
  if (input.state === "agreement_review" && input.eventType === "purchase_path_ready") {
    if (input.vendorAgreementRequired !== false && !input.vendorAgreementSigned) {
      return deny("signed_vendor_agreement_required");
    }
    return allow("purchase_path_review", "agreement_review_complete");
  }
  if (input.state === "purchase_path_review" && input.eventType === "execution_gate_required") {
    const path = input.purchasePathDecision;
    if (!path) return deny("purchase_path_decision_required");
    if (path.status === "unsupported" || path.status === "infeasible" || path.status.startsWith("blocked_")) {
      return transition({ previousState: input.state, nextState: "blocked", eventType: input.eventType,
        allowed: true, reasons: [`purchase_path_${path.status}`] });
    }
    if (path.status !== "ready_for_operator_execution_review"
      && path.status !== "requires_operator_confirmation") return deny("purchase_path_not_reviewable");
    return allow("operator_execution_review", "operator_execution_gate_required");
  }
  if (input.state === "operator_execution_review" && input.eventType === "execution_gate_approved") {
    const gate = input.executionGateDecision;
    if (!gate || gate.status !== "gate_approved" || !gate.operatorExecutionApproved) {
      return deny("operator_execution_gate_not_approved");
    }
    return transition({ previousState: input.state, eventType: input.eventType, allowed: true,
      operatorExecutionApproved: true, reasons: ["operator_execution_approval_recorded"] });
  }
  if (input.state === "operator_execution_review" && input.eventType === "dispatch_requested") {
    const gate = input.executionGateDecision;
    if (!input.operatorExecutionApprovalExplicit || !gate
      || gate.status !== "gate_approved" || !gate.operatorExecutionApproved) {
      return deny("explicit_operator_execution_approval_required");
    }
    return allow("dispatch_pending", "dispatch_request_recorded_for_future_controlled_execution");
  }
  if (input.state === "dispatch_pending" && input.eventType === "proof_recorded") {
    return input.proofRecorded
      ? allow("proof_pending", "proof_evidence_recorded_for_review")
      : deny("proof_evidence_required");
  }
  if (input.state === "proof_pending" && input.eventType === "proof_recorded") {
    return input.proofRecorded
      ? allow("completed", "proof_verified_for_completion")
      : deny("proof_required_before_completion");
  }

  return deny("event_not_allowed_from_current_state");
}
