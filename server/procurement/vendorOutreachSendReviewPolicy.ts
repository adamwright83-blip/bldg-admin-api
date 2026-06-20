import {
  evaluateTemplateForUse,
  type LegalDocumentPolicyView,
  type OutreachTemplatePolicyView,
} from "./legalTemplatePolicy";
import type { OutreachSendReadinessDecision } from "./outreachSendReadinessPolicy";

export const VENDOR_OUTREACH_SEND_REVIEW_GATE_PREFIX = "vendor_outreach_send_review";

export type VendorOutreachSendReviewGateStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export type VendorOutreachSendReviewGateView = {
  gateKey: string;
  status: VendorOutreachSendReviewGateStatus;
  deadlineAt: Date | null;
  decidedAt: Date | null;
};

export type VendorOutreachSendReviewStatus =
  | "send_review_not_allowed"
  | "send_review_requirements_missing"
  | "awaiting_operator_send_review"
  | "operator_approved_for_manual_send_only"
  | "operator_rejected_send";

export type VendorOutreachSendReviewDecision = {
  status: VendorOutreachSendReviewStatus;
  sendReviewAllowed: boolean;
  gateRequired: boolean;
  requiredGateKey: string | null;
  operatorApprovedForManualSendOnly: boolean;
  liveSendReady: false;
  outreachSent: false;
  vendorContacted: false;
  providerMessageCreated: false;
  deliveryAttempted: false;
  booked: false;
  accepted: false;
  dispatched: false;
  paid: false;
  captured: false;
  completed: false;
  reasons: string[];
};

const BANNED_SEND_REVIEW_CLAIMS: Array<{ key: string; pattern: RegExp }> = [
  { key: "booked_claim", pattern: /\bbooked\b/i },
  { key: "selected_for_execution_claim", pattern: /\bselected for execution\b/i },
  { key: "approved_vendor_claim", pattern: /\bapproved vendor\b/i },
  { key: "guaranteed_volume_claim", pattern: /\bguaranteed volume\b/i },
  { key: "guaranteed_payment_claim", pattern: /\bguaranteed payment\b/i },
  { key: "guaranteed_dispatch_claim", pattern: /\bguaranteed dispatch\b/i },
  { key: "resident_committed_claim", pattern: /\bresident committed\b/i },
  { key: "payment_captured_claim", pattern: /\bpayment captured\b/i },
  { key: "already_assigned_claim", pattern: /\balready assigned\b/i },
];

function checkBannedSendReviewClaims(text: string): string[] {
  const blocking: string[] = [];
  for (const claim of BANNED_SEND_REVIEW_CLAIMS) {
    if (claim.pattern.test(text)) blocking.push(claim.key);
  }
  return blocking;
}

export function vendorOutreachSendReviewGateKey(input: { draftId: string }): string {
  return `${VENDOR_OUTREACH_SEND_REVIEW_GATE_PREFIX}:${input.draftId}`;
}

function result(input: {
  status: VendorOutreachSendReviewStatus;
  sendReviewAllowed?: boolean;
  gateRequired: boolean;
  requiredGateKey: string | null;
  operatorApprovedForManualSendOnly?: boolean;
  reasons: string[];
}): VendorOutreachSendReviewDecision {
  return {
    status: input.status,
    sendReviewAllowed: input.sendReviewAllowed ?? false,
    gateRequired: input.gateRequired,
    requiredGateKey: input.requiredGateKey,
    operatorApprovedForManualSendOnly: input.operatorApprovedForManualSendOnly ?? false,
    liveSendReady: false,
    outreachSent: false,
    vendorContacted: false,
    providerMessageCreated: false,
    deliveryAttempted: false,
    booked: false,
    accepted: false,
    dispatched: false,
    paid: false,
    captured: false,
    completed: false,
    reasons: Array.from(new Set(input.reasons)),
  };
}

/**
 * Pure, deterministic bridge from an internal Slice 28 outreach draft into a
 * final operator send-review gate. Never sends, contacts, delivers, books,
 * dispatches, pays, captures, or completes anything -- those fields are
 * hardcoded false on every return path, and liveSendReady is always false
 * because live sending remains disabled. Operator approval here means only
 * that a human may manually send later; it never means sent.
 */
export function evaluateVendorOutreachSendReview(input: {
  draftId: string | null;
  candidateId: string | null;
  workflowId: string | null;
  draftStatus: string | null;
  draftBridgeStatus: string | null;
  sendReadiness: OutreachSendReadinessDecision;
  subjectRendered: string | null;
  bodyRendered: string;
  template: OutreachTemplatePolicyView | null;
  legalDocument: LegalDocumentPolicyView | null;
  gate: VendorOutreachSendReviewGateView | null;
  now?: Date;
}): VendorOutreachSendReviewDecision {
  if (!input.draftId) return result({ status: "send_review_not_allowed", gateRequired: false, requiredGateKey: null,
    reasons: ["missing_draft_id"] });
  if (!input.candidateId) return result({ status: "send_review_not_allowed", gateRequired: false, requiredGateKey: null,
    reasons: ["missing_candidate_id"] });
  if (!input.workflowId) return result({ status: "send_review_not_allowed", gateRequired: false, requiredGateKey: null,
    reasons: ["missing_workflow_id"] });

  if (input.draftStatus !== "draft") {
    return result({ status: "send_review_not_allowed", gateRequired: false, requiredGateKey: null,
      reasons: [`draft_status_not_draft:${input.draftStatus ?? "unknown"}`] });
  }
  if (input.draftBridgeStatus !== "draft_ready_to_create" && input.draftBridgeStatus !== "draft_created_internally") {
    return result({ status: "send_review_not_allowed", gateRequired: false, requiredGateKey: null,
      reasons: [`draft_bridge_status_not_eligible:${input.draftBridgeStatus ?? "unknown"}`] });
  }

  const now = input.now ?? new Date();
  const requiredGateKey = vendorOutreachSendReviewGateKey({ draftId: input.draftId });
  const reasons: string[] = [];

  const templateDecision = evaluateTemplateForUse({
    template: input.template, requiredLegalDocument: input.legalDocument, lintRules: [], now,
  });
  if (!input.template || !templateDecision.usable) {
    reasons.push(...(templateDecision.reasons.length ? templateDecision.reasons : ["approved_template_version_required"]));
  }

  if (input.sendReadiness.liveSendAllowed || !input.sendReadiness.dryRunOnly || !input.sendReadiness.noSendPerformed
    || input.sendReadiness.evaluationMode !== "dry_run_only" || input.sendReadiness.sendOutcome !== "no_send_performed") {
    reasons.push("send_readiness_not_dry_run_only");
  }

  const renderedText = [input.subjectRendered, input.bodyRendered].filter(Boolean).join("\n");
  const bannedClaims = checkBannedSendReviewClaims(renderedText);
  if (bannedClaims.length > 0) reasons.push("rendered_draft_banned_claim", ...bannedClaims);

  if (reasons.length > 0) {
    return result({ status: "send_review_requirements_missing", gateRequired: true, requiredGateKey, reasons });
  }

  if (!input.gate) {
    return result({ status: "awaiting_operator_send_review", sendReviewAllowed: true, gateRequired: true,
      requiredGateKey, reasons: ["operator_send_review_gate_required"] });
  }
  if (input.gate.gateKey !== requiredGateKey) {
    return result({ status: "send_review_requirements_missing", gateRequired: true, requiredGateKey,
      reasons: ["operator_gate_key_mismatch"] });
  }
  if (input.gate.deadlineAt && input.gate.deadlineAt.getTime() <= now.getTime()) {
    return result({ status: "send_review_requirements_missing", gateRequired: true, requiredGateKey,
      reasons: ["operator_gate_stale"] });
  }
  if (input.gate.status === "pending") {
    return result({ status: "awaiting_operator_send_review", sendReviewAllowed: true, gateRequired: true,
      requiredGateKey, reasons: ["operator_send_review_gate_pending"] });
  }
  if (input.gate.status === "rejected" || input.gate.status === "expired" || input.gate.status === "cancelled") {
    return result({ status: "operator_rejected_send", gateRequired: true, requiredGateKey,
      reasons: [`operator_send_review_${input.gate.status}`] });
  }
  if (input.gate.status !== "approved") {
    return result({ status: "send_review_requirements_missing", gateRequired: true, requiredGateKey,
      reasons: [`operator_send_review_${input.gate.status}`] });
  }
  if (!(input.gate.decidedAt instanceof Date) || !Number.isFinite(input.gate.decidedAt.getTime())
    || input.gate.decidedAt.getTime() > now.getTime()) {
    return result({ status: "send_review_requirements_missing", gateRequired: true, requiredGateKey,
      reasons: ["operator_gate_decision_invalid"] });
  }

  return result({ status: "operator_approved_for_manual_send_only", sendReviewAllowed: true, gateRequired: true,
    requiredGateKey, operatorApprovedForManualSendOnly: true,
    reasons: ["operator_approved_for_manual_send_only_not_sent"] });
}
