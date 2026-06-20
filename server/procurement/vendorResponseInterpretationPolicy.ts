export type VendorResponseClassification =
  | "response_invalid"
  | "vendor_declined"
  | "vendor_available"
  | "vendor_rate_info_provided"
  | "vendor_needs_clarification"
  | "vendor_unavailable"
  | "vendor_unsupported"
  | "vendor_general_response";

export type VendorResponseSnapshot = {
  id?: string;
  candidateId?: string | null;
  workflowId?: string | null;
  outreachDraftId?: string | null;
  direction?: string | null;
  channel?: string | null;
  eventStatus?: string | null;
  occurredAt?: Date | null;
  summary: string;
  rawPayload: Record<string, unknown>;
  responseKind?: string | null;
};

export type VendorResponseInterpretationDecision = {
  classification: VendorResponseClassification;
  allowed: boolean;
  reasons: string[];
  booked: false;
  accepted: false;
  dispatched: false;
  paid: false;
  captured: false;
  completed: false;
  selectedForExecution: false;
  providerMessageCreated: false;
  deliveryVerified: false;
};

const BANNED_INTERPRETATION_CLAIMS: Array<{ key: string; pattern: RegExp }> = [
  { key: "booked_claim", pattern: /\bbooked\b/i },
  { key: "accepted_claim", pattern: /\baccepted\b/i },
  { key: "dispatched_claim", pattern: /\bdispatched\b/i },
  { key: "paid_claim", pattern: /\bpaid\b/i },
  { key: "captured_claim", pattern: /\bcaptured\b/i },
  { key: "completed_claim", pattern: /\bcompleted\b/i },
  { key: "selected_for_execution_claim", pattern: /\bselected[_ ]for[_ ]execution\b/i },
  { key: "provider_message_id_claim", pattern: /\b(provider[_ ]message[_ ]id|providermessageid)\b/i },
  { key: "delivery_receipt_claim", pattern: /\bdelivery[_ ](receipt|confirmation)\b/i },
  { key: "automated_held_send_claim", pattern: /\b((held|we) (?:automatically )?sent|automated held send|automatically sent by held)\b/i },
  { key: "sent_by_held_claim", pattern: /\bsent[_ ]by[_ ]held\b/i },
  { key: "guaranteed_provider_commitment_claim", pattern: /\b(guaranteed provider commitment|provider commitment|guaranteed commitment)\b/i },
];

function checkBannedClaims(text: string): string[] {
  const blocking: string[] = [];
  for (const claim of BANNED_INTERPRETATION_CLAIMS) {
    if (claim.pattern.test(text)) {
      blocking.push(claim.key);
    }
  }
  return blocking;
}

function hasForbiddenPayloadKey(rawPayload: Record<string, unknown>): string[] {
  const forbiddenKeys = [
    "providerMessageId", "provider_message_id",
    "deliveryReceipt", "delivery_receipt",
    "sentByHeld", "sent_by_held",
    "automatedSend", "automated_send",
    "sentAt", "sent_at",
    "deliveryStatus", "delivery_status",
    "sendStatus", "send_status",
    "providerMessageCreated", "provider_message_created",
    "deliveryVerified", "delivery_verified",
  ];
  return Object.keys(rawPayload).filter(key =>
    forbiddenKeys.includes(key) && Boolean(rawPayload[key])
  );
}

function makeDecision(
  classification: VendorResponseClassification,
  reasons: string[] = []
): VendorResponseInterpretationDecision {
  return {
    classification,
    allowed: classification !== "response_invalid",
    reasons,
    booked: false,
    accepted: false,
    dispatched: false,
    paid: false,
    captured: false,
    completed: false,
    selectedForExecution: false,
    providerMessageCreated: false,
    deliveryVerified: false,
  };
}

export function interpretVendorResponse(
  snapshot: VendorResponseSnapshot
): VendorResponseInterpretationDecision {
  const summary = snapshot.summary ?? "";
  const rawPayload = snapshot.rawPayload ?? {};

  // Check forbidden payload keys first
  const forbiddenPayloadKeys = hasForbiddenPayloadKey(rawPayload);
  if (forbiddenPayloadKeys.length > 0) {
    return makeDecision("response_invalid", ["forbidden_payload_field", ...forbiddenPayloadKeys]);
  }

  // Check banned claims in summary and payload
  const claimText = [summary, JSON.stringify(rawPayload)].join("\n");
  const bannedClaims = checkBannedClaims(claimText);
  if (bannedClaims.length > 0) {
    return makeDecision("response_invalid", ["forbidden_claim", ...bannedClaims]);
  }

  // Extract explicit classification from rawPayload if set
  const explicitClassification = rawPayload.classification ?? rawPayload.interpreted_kind ?? rawPayload.interpretedKind;
  if (typeof explicitClassification === "string") {
    const normalized = explicitClassification.toLowerCase().trim();
    if (normalized === "declined" || normalized === "vendor_declined") {
      return makeDecision("vendor_declined");
    }
    if (normalized === "availability" || normalized === "available" || normalized === "vendor_available") {
      return makeDecision("vendor_available");
    }
    if (normalized === "rate_info" || normalized === "rate_info_provided" || normalized === "vendor_rate_info_provided") {
      return makeDecision("vendor_rate_info_provided");
    }
    if (normalized === "needs_clarification" || normalized === "clarification" || normalized === "vendor_needs_clarification") {
      return makeDecision("vendor_needs_clarification");
    }
    if (normalized === "unavailable" || normalized === "vendor_unavailable") {
      return makeDecision("vendor_unavailable");
    }
    if (normalized === "unsupported" || normalized === "vendor_unsupported") {
      return makeDecision("vendor_unsupported");
    }
    if (normalized === "general" || normalized === "general_response" || normalized === "vendor_general_response") {
      return makeDecision("vendor_general_response");
    }
    if (normalized === "invalid" || normalized === "response_invalid") {
      return makeDecision("response_invalid", ["explicitly_marked_invalid"]);
    }
  }

  // Check responseKind if provided
  const responseKind = snapshot.responseKind ?? rawPayload.responseKind ?? rawPayload.response_kind;
  if (typeof responseKind === "string") {
    const normalizedKind = responseKind.toLowerCase().trim();
    if (normalizedKind === "declined") {
      return makeDecision("vendor_declined");
    }
    if (normalizedKind === "availability") {
      return makeDecision("vendor_available");
    }
    if (normalizedKind === "rate_info") {
      return makeDecision("vendor_rate_info_provided");
    }
  }

  // Check summary keyword heuristic
  const textToCheck = summary.toLowerCase();

  // 1. Declined
  if (/\b(declined|decline|not interested|no thanks|cannot accept|not accepting)\b/i.test(textToCheck)) {
    return makeDecision("vendor_declined");
  }
  // 2. Unavailable
  if (/\b(unavailable|fully booked|no openings|no slot|booked up|out of office|busy)\b/i.test(textToCheck)) {
    return makeDecision("vendor_unavailable");
  }
  // 3. Unsupported
  if (/\b(unsupported|cannot do|not support|don't do|no service|outside scope|do not offer)\b/i.test(textToCheck)) {
    return makeDecision("vendor_unsupported");
  }
  // 4. Clarification
  if (/\b(clarify|clarification|question|details|explain|more info|need info|what time|where|how many)\b/i.test(textToCheck)) {
    return makeDecision("vendor_needs_clarification");
  }
  // 5. Rate info
  if (/\b(rate|price|cost|quote|charging|fee|cents|dollars|\$\d+)\b/i.test(textToCheck)) {
    return makeDecision("vendor_rate_info_provided");
  }
  // 6. Available
  if (/\b(available|opening|open slot|can do|schedule|openings)\b/i.test(textToCheck)) {
    return makeDecision("vendor_available");
  }

  // Default fallback
  return makeDecision("vendor_general_response");
}
