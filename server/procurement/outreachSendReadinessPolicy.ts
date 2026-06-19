export type OutreachSendChannel = "email" | "sms" | "dm" | "manual";

export type OutreachSendReadinessInput = {
  candidateStatus: string;
  templateStatus: string;
  templateEffective: boolean;
  lintClean: boolean;
  legalDocumentRequired: boolean;
  legalDocumentUsable: boolean;
  operatorGateStatus: string | null;
  channel: string;
  draftStatus: string;
  vendorOutreachEnabled: boolean;
  allowedChannels?: readonly OutreachSendChannel[];
};

export type OutreachSendReadinessDecision = {
  status: "blocked_for_live_send" | "dry_run_only";
  evaluationMode: "dry_run_only";
  sendOutcome: "no_send_performed";
  eligibleForFutureSendAttempt: boolean;
  dryRunOnly: true;
  noSendPerformed: true;
  liveSendAllowed: false;
  reasons: string[];
};

const DEFAULT_ALLOWED_CHANNELS: readonly OutreachSendChannel[] = ["email", "sms", "dm"];

/**
 * Evaluates an already-rendered draft. This pure policy intentionally has no
 * provider, transport, persistence, or send capability.
 */
export function evaluateOutreachSendReadiness(
  input: OutreachSendReadinessInput,
): OutreachSendReadinessDecision {
  const reasons: string[] = [];
  const allowedChannels = input.allowedChannels ?? DEFAULT_ALLOWED_CHANNELS;

  if (input.candidateStatus !== "approved_for_outreach") {
    reasons.push("candidate_not_approved_for_outreach");
  }
  if (input.templateStatus !== "approved" || !input.templateEffective) {
    reasons.push("template_not_approved_effective");
  }
  if (!input.lintClean) reasons.push("draft_lint_not_clean");
  if (input.legalDocumentRequired && !input.legalDocumentUsable) {
    reasons.push("required_legal_document_not_usable");
  }
  if (input.operatorGateStatus !== "approved") {
    reasons.push("operator_gate_not_approved");
  }
  if (!allowedChannels.includes(input.channel as OutreachSendChannel)) {
    reasons.push("outreach_channel_not_allowed");
  }
  if (input.draftStatus !== "approved_for_manual_send") {
    reasons.push("draft_status_not_approved_for_manual_send");
  }

  const prerequisitesMet = reasons.length === 0;
  if (!input.vendorOutreachEnabled) reasons.push("vendor_outreach_feature_flag_off");

  return {
    status: input.vendorOutreachEnabled && prerequisitesMet ? "dry_run_only" : "blocked_for_live_send",
    evaluationMode: "dry_run_only",
    sendOutcome: "no_send_performed",
    eligibleForFutureSendAttempt: prerequisitesMet,
    dryRunOnly: true,
    noSendPerformed: true,
    liveSendAllowed: false,
    reasons: Array.from(new Set(reasons)),
  };
}
