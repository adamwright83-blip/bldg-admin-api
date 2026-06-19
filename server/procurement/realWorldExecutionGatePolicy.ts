import type { ErrandPurchasePathDecision } from "./errandPurchasePathPolicy";

export const REAL_WORLD_EXECUTION_GATE_PREFIX = "real_world_execution_approval";

export type OperatorGateStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export type RealWorldExecutionGateView = {
  gateKey: string;
  workflowKey: string;
  subjectType: "guest_readiness_plan_item" | "errand_purchase_path";
  subjectId: string;
  status: OperatorGateStatus;
  deadlineAt: Date | null;
  decidedAt: Date | null;
};

export type RealWorldExecutionGateStatus =
  | "no_gate_needed"
  | "gate_required"
  | "gate_pending"
  | "gate_approved"
  | "gate_denied"
  | "blocked";

export type RealWorldExecutionGateDecision = {
  status: RealWorldExecutionGateStatus;
  gateRequired: boolean;
  requiredGateKey: string | null;
  operatorExecutionApproved: boolean;
  executionReady: false;
  dispatchReady: false;
  paymentReady: false;
  booked: false;
  completed: false;
  reasons: string[];
};

export function realWorldExecutionGateKey(input: {
  workflowKey: string;
  subjectType: RealWorldExecutionGateView["subjectType"];
  subjectId: string;
}) {
  return `${REAL_WORLD_EXECUTION_GATE_PREFIX}:${input.subjectType}:${input.subjectId}`;
}

function result(input: {
  status: RealWorldExecutionGateStatus;
  gateRequired: boolean;
  requiredGateKey: string | null;
  operatorExecutionApproved?: boolean;
  reasons: string[];
}): RealWorldExecutionGateDecision {
  return {
    status: input.status,
    gateRequired: input.gateRequired,
    requiredGateKey: input.requiredGateKey,
    operatorExecutionApproved: input.operatorExecutionApproved ?? false,
    executionReady: false,
    dispatchReady: false,
    paymentReady: false,
    booked: false,
    completed: false,
    reasons: Array.from(new Set(input.reasons)),
  };
}

export function evaluateRealWorldExecutionGate(input: {
  readiness: ErrandPurchasePathDecision;
  workflowKey: string;
  subjectType: RealWorldExecutionGateView["subjectType"];
  subjectId: string;
  authorityCurrent: boolean;
  vendorAgreementRequired: boolean;
  vendorAgreementCurrent: boolean;
  providerAcceptanceRequired: boolean;
  providerAcceptanceCurrent: boolean;
  paymentRequired: boolean;
  paymentAuthorized: boolean;
  riskConfirmationRequired: boolean;
  gate: RealWorldExecutionGateView | null;
  now?: Date;
}): RealWorldExecutionGateDecision {
  const now = input.now ?? new Date();
  const requiredGateKey = realWorldExecutionGateKey(input);
  const readinessStatus = input.readiness.status;

  if (readinessStatus === "unsupported" || readinessStatus === "infeasible") {
    return result({ status: "blocked", gateRequired: false, requiredGateKey: null,
      reasons: [`readiness_${readinessStatus}`] });
  }
  if (readinessStatus.startsWith("blocked_")) {
    return result({ status: "blocked", gateRequired: false, requiredGateKey: null,
      reasons: [readinessStatus] });
  }
  if (!input.authorityCurrent) {
    return result({ status: "blocked", gateRequired: false, requiredGateKey: null,
      reasons: ["authority_not_current"] });
  }
  if (input.vendorAgreementRequired && !input.vendorAgreementCurrent) {
    return result({ status: "blocked", gateRequired: false, requiredGateKey: null,
      reasons: ["vendor_agreement_not_current"] });
  }
  if (input.providerAcceptanceRequired && !input.providerAcceptanceCurrent) {
    return result({ status: "blocked", gateRequired: false, requiredGateKey: null,
      reasons: ["provider_acceptance_not_current"] });
  }
  if (input.paymentRequired && !input.paymentAuthorized) {
    return result({ status: "blocked", gateRequired: false, requiredGateKey: null,
      reasons: ["payment_not_authorized"] });
  }

  const readinessCanRequestGate = readinessStatus === "ready_for_operator_execution_review"
    || readinessStatus === "requires_operator_confirmation";
  if (!readinessCanRequestGate) {
    return result({ status: "no_gate_needed", gateRequired: false, requiredGateKey: null,
      reasons: ["readiness_does_not_require_execution_gate"] });
  }
  if (readinessStatus === "requires_operator_confirmation"
    && input.readiness.reasons.includes("resident_approval_required")) {
    return result({ status: "blocked", gateRequired: false, requiredGateKey: null,
      reasons: ["resident_approval_cannot_be_replaced_by_operator_gate"] });
  }
  if (!input.gate) {
    return result({ status: "gate_required", gateRequired: true, requiredGateKey,
      reasons: [input.riskConfirmationRequired ? "risk_confirmation_gate_required" : "operator_execution_gate_required"] });
  }
  if (input.gate.gateKey !== requiredGateKey) {
    return result({ status: "blocked", gateRequired: true, requiredGateKey,
      reasons: ["operator_gate_key_mismatch"] });
  }
  if (input.gate.workflowKey !== input.workflowKey
    || input.gate.subjectType !== input.subjectType || input.gate.subjectId !== input.subjectId) {
    return result({ status: "blocked", gateRequired: true, requiredGateKey,
      reasons: ["operator_gate_subject_mismatch"] });
  }
  if (input.gate.deadlineAt && input.gate.deadlineAt.getTime() <= now.getTime()) {
    return result({ status: "blocked", gateRequired: true, requiredGateKey,
      reasons: ["operator_gate_stale"] });
  }
  if (input.gate.status === "pending") {
    return result({ status: "gate_pending", gateRequired: true, requiredGateKey,
      reasons: ["operator_gate_pending"] });
  }
  if (input.gate.status !== "approved") {
    return result({ status: "gate_denied", gateRequired: true, requiredGateKey,
      reasons: [`operator_gate_${input.gate.status}`] });
  }
  if (!(input.gate.decidedAt instanceof Date) || !Number.isFinite(input.gate.decidedAt.getTime())
    || input.gate.decidedAt.getTime() > now.getTime()) {
    return result({ status: "blocked", gateRequired: true, requiredGateKey,
      reasons: ["operator_gate_decision_invalid"] });
  }

  return result({ status: "gate_approved", gateRequired: true, requiredGateKey,
    operatorExecutionApproved: true, reasons: ["operator_execution_approved_for_next_controlled_step"] });
}
