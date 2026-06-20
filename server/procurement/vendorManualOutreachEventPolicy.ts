export type ManualOutreachEventType = "manual_send" | "vendor_response";
export type VendorResponseKind = "declined" | "availability" | "rate_info" | "general";

export type ManualOutreachEventOutcome =
  | "manual_outreach_logged"
  | "vendor_response_logged"
  | "vendor_declined_logged"
  | "vendor_availability_logged"
  | "vendor_rate_info_logged"
  | "invalid_manual_event";

export type ManualOutreachEventDirection = "inbound" | "outbound_manual_note";
export type ManualOutreachEventStatus = "recorded" | "needs_review" | "rejected";

export type ManualOutreachEventDecision = {
  outcome: ManualOutreachEventOutcome;
  allowed: boolean;
  reasons: string[];
  direction: ManualOutreachEventDirection | null;
  eventStatus: ManualOutreachEventStatus;
  sentByHeld: false;
  providerMessageCreated: false;
  deliveryAttemptedByHeld: false;
  booked: false;
  accepted: false;
  dispatched: false;
  paid: false;
  captured: false;
  completed: false;
};

const BANNED_EVENT_CLAIMS: Array<{ key: string; pattern: RegExp }> = [
  { key: "booked_claim", pattern: /\bbooked\b/i },
  { key: "accepted_claim", pattern: /\baccepted\b/i },
  { key: "dispatched_claim", pattern: /\bdispatched\b/i },
  { key: "paid_claim", pattern: /\bpaid\b/i },
  { key: "captured_claim", pattern: /\bcaptured\b/i },
  { key: "completed_claim", pattern: /\bcompleted\b/i },
  { key: "selected_for_execution_claim", pattern: /\bselected[_ ]for[_ ]execution\b/i },
  { key: "provider_message_id_claim", pattern: /\b(provider[_ ]message[_ ]id|providermessageid)\b/i },
  { key: "delivery_receipt_claim", pattern: /\bdelivery[_ ](receipt|confirmation)\b/i },
  { key: "automated_held_send_claim", pattern: /\b(held|we) (?:automatically )?sent\b/i },
  { key: "sent_by_held_claim", pattern: /\bsent[_ ]by[_ ]held\b/i },
];

function checkBannedEventClaims(text: string): string[] {
  const blocking: string[] = [];
  for (const claim of BANNED_EVENT_CLAIMS) {
    if (claim.pattern.test(text)) blocking.push(claim.key);
  }
  return blocking;
}

function hasForbiddenPayloadKey(rawPayload: Record<string, unknown>): string[] {
  const forbiddenKeys = [
    "providerMessageId", "provider_message_id", "deliveryReceipt", "delivery_receipt",
    "sentByHeld", "sent_by_held", "automatedSend", "automated_send", "sentAt", "sent_at",
    "deliveryStatus", "delivery_status", "sendStatus", "send_status",
  ];
  return Object.keys(rawPayload).filter(key => forbiddenKeys.includes(key)
    && Boolean((rawPayload as Record<string, unknown>)[key]));
}

function invalidDecision(reasons: string[]): ManualOutreachEventDecision {
  return {
    outcome: "invalid_manual_event", allowed: false, reasons: Array.from(new Set(reasons)),
    direction: null, eventStatus: "rejected",
    sentByHeld: false, providerMessageCreated: false, deliveryAttemptedByHeld: false,
    booked: false, accepted: false, dispatched: false, paid: false, captured: false, completed: false,
  };
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * Pure, deterministic recorder of operator-supplied facts about manual
 * (human, outside-HELD) outreach sends and vendor responses. Records facts
 * only -- it never sends anything, and the hardcoded-false fields on every
 * return path make HELD-automated send, provider-message creation, delivery
 * tracking, booking, acceptance, dispatch, payment, capture, and completion
 * impossible to represent here.
 */
export function evaluateManualOutreachEvent(input: {
  eventType: ManualOutreachEventType;
  responseKind?: VendorResponseKind;
  candidateId: string | null;
  workflowId: string | null;
  draftId: string | null;
  sendReviewStatus?: string | null;
  summary: string;
  occurredAt: Date;
  rawPayload: Record<string, unknown>;
  now?: Date;
}): ManualOutreachEventDecision {
  if (!input.candidateId) return invalidDecision(["missing_candidate_id"]);
  if (!input.workflowId) return invalidDecision(["missing_workflow_id"]);
  if (!input.summary.trim()) return invalidDecision(["summary_required"]);
  if (!validDate(input.occurredAt)) return invalidDecision(["occurred_at_invalid"]);

  const now = input.now ?? new Date();
  if (input.occurredAt.getTime() > now.getTime()) return invalidDecision(["occurred_at_in_future"]);

  const forbiddenPayloadKeys = hasForbiddenPayloadKey(input.rawPayload);
  if (forbiddenPayloadKeys.length > 0) {
    return invalidDecision(["forbidden_payload_field", ...forbiddenPayloadKeys]);
  }

  const claimText = [input.summary, JSON.stringify(input.rawPayload)].join("\n");
  const bannedClaims = checkBannedEventClaims(claimText);
  if (bannedClaims.length > 0) {
    return invalidDecision(["forbidden_claim", ...bannedClaims]);
  }

  if (input.eventType === "manual_send") {
    if (!input.draftId) return invalidDecision(["missing_draft_id"]);
    if (input.sendReviewStatus !== "operator_approved_for_manual_send_only") {
      return invalidDecision([`send_review_not_approved_for_manual_send:${input.sendReviewStatus ?? "unknown"}`]);
    }
    return {
      outcome: "manual_outreach_logged", allowed: true, reasons: [],
      direction: "outbound_manual_note", eventStatus: "recorded",
      sentByHeld: false, providerMessageCreated: false, deliveryAttemptedByHeld: false,
      booked: false, accepted: false, dispatched: false, paid: false, captured: false, completed: false,
    };
  }

  if (!input.draftId) return invalidDecision(["missing_draft_id_for_vendor_response_context"]);
  if (!input.responseKind) return invalidDecision(["missing_response_kind"]);

  const outcomeByKind: Record<VendorResponseKind, ManualOutreachEventOutcome> = {
    declined: "vendor_declined_logged",
    availability: "vendor_availability_logged",
    rate_info: "vendor_rate_info_logged",
    general: "vendor_response_logged",
  };

  return {
    outcome: outcomeByKind[input.responseKind], allowed: true, reasons: [],
    direction: "inbound", eventStatus: "recorded",
    sentByHeld: false, providerMessageCreated: false, deliveryAttemptedByHeld: false,
    booked: false, accepted: false, dispatched: false, paid: false, captured: false, completed: false,
  };
}
