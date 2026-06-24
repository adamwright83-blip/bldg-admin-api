import { randomUUID } from "node:crypto";
import type { OutreachDraft } from "./castingSprintExecutionPolicy";
import { evaluateVendorResponseTerms } from "./vendorResponseTermsPolicy";
import { interpretVendorResponse, type VendorResponseClassification } from "./vendorResponseInterpretationPolicy";
import type { ProducerLane } from "./vendorCastingSprintPolicy";

export const CONTACT_CHANNELS = [
  "email",
  "sms_if_allowed",
  "call",
  "voicemail",
  "website_form",
  "second_call_if_urgent",
] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const CONTACT_ATTEMPT_STATUSES = [
  "draft_ready",
  "gate_passed",
  "queued_noop",
  "sent_noop",
  "response_pending",
  "reply_received",
  "interpreted",
  "blocked",
] as const;
export type ContactAttemptStatus = (typeof CONTACT_ATTEMPT_STATUSES)[number];

export const AUTOMATION_MODES = ["noop_provider", "gated_provider_future", "manual_fallback"] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

export type ContactAttempt = {
  attemptId: string;
  sourceKey: string;
  candidateId: string | null;
  leadId: string | null;
  lane: ProducerLane | null;
  channel: ContactChannel;
  draftSubject: string;
  draftBody: string;
  recipientTarget: string;
  templateKey: "vendor_availability_request_v0";
  templateVersion: string;
  founderEscalationPresent: boolean;
  forbiddenClaimsDetected: string[];
  draftSafeToSend: boolean;
  status: ContactAttemptStatus;
  automationMode: AutomationMode;
  gatePassed: boolean;
  outreachSentByHeld: false;
  liveProviderInvoked: false;
  providerResponded: boolean;
  providerAccepted: false;
  bookingConfirmed: false;
  paymentAuthorized: false;
  dispatched: false;
  createdAt: string;
};

/**
 * Constructs the contact-attempt contract from an already-validated,
 * real-fact outreach draft (Slice 72). It performs no I/O; the attempt
 * starts in draft_ready and only advances through runNoopContactAttempt's
 * send gate and no-op provider dispatch.
 */
export function buildContactAttempt(input: {
  sourceKey: string;
  candidateId?: string | null;
  leadId?: string | null;
  lane?: ProducerLane | null;
  channel: ContactChannel;
  draft: OutreachDraft;
  recipientTarget: string;
  automationMode?: AutomationMode;
  now?: Date;
}): ContactAttempt {
  return {
    attemptId: `attempt_${randomUUID()}`,
    sourceKey: input.sourceKey,
    candidateId: input.candidateId ?? null,
    leadId: input.leadId ?? null,
    lane: input.lane ?? null,
    channel: input.channel,
    draftSubject: input.draft.subject,
    draftBody: input.draft.body,
    recipientTarget: input.recipientTarget,
    templateKey: input.draft.templateKey,
    templateVersion: "v0",
    founderEscalationPresent: input.draft.founderEscalationIncluded,
    forbiddenClaimsDetected: input.draft.forbiddenClaimsDetected,
    draftSafeToSend: input.draft.safeToCopy,
    status: "draft_ready",
    automationMode: input.automationMode ?? "noop_provider",
    gatePassed: false,
    outreachSentByHeld: false,
    liveProviderInvoked: false,
    providerResponded: false,
    providerAccepted: false,
    bookingConfirmed: false,
    paymentAuthorized: false,
    dispatched: false,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

export type ContactAttemptSendGateDecision = { allowed: boolean; reasons: string[] };

/**
 * Gates every contact attempt before any (even no-op) provider adapter is
 * invoked. Live sending is never permitted regardless of input:
 * gated_provider_future is always blocked because no gated live-provider
 * layer exists yet in this slice.
 */
export function evaluateContactAttemptSendGate(attempt: ContactAttempt): ContactAttemptSendGateDecision {
  const reasons: string[] = [];
  if (!attempt.draftSafeToSend) reasons.push("draft_not_safe_to_send");
  if (!attempt.founderEscalationPresent) reasons.push("founder_escalation_missing");
  if (attempt.forbiddenClaimsDetected.length > 0) reasons.push("forbidden_claims_detected");
  if (!attempt.sourceKey?.trim()) reasons.push("source_key_required");
  if (!attempt.candidateId && !attempt.leadId) reasons.push("candidate_or_lead_identity_required");
  if (!attempt.recipientTarget?.trim()) reasons.push("contact_method_required");
  if (attempt.automationMode === "gated_provider_future") reasons.push("live_provider_not_enabled");
  return { allowed: reasons.length === 0, reasons: Array.from(new Set(reasons)) };
}

export type NoopProviderResult = {
  attemptId: string;
  channel: ContactChannel;
  status: "sent_noop" | "queued_noop";
  liveProviderInvoked: false;
  timestamp: string;
  warnings: string[];
};

function noopResult(
  attemptId: string,
  channel: ContactChannel,
  status: NoopProviderResult["status"],
  now: Date,
  warnings: string[],
): NoopProviderResult {
  return { attemptId, channel, status, liveProviderInvoked: false, timestamp: now.toISOString(), warnings };
}

/** No-op email adapter. Makes no network call and never invokes a real email provider (SendGrid, etc). */
export function sendNoopEmail(attemptId: string, now: Date = new Date()): NoopProviderResult {
  return noopResult(attemptId, "email", "sent_noop", now, ["no_real_email_sent", "no_provider_configured"]);
}

/** No-op SMS adapter. Makes no network call and never invokes a real SMS provider (Twilio, etc). */
export function sendNoopSms(attemptId: string, now: Date = new Date()): NoopProviderResult {
  return noopResult(attemptId, "sms_if_allowed", "sent_noop", now, ["no_real_sms_sent", "no_provider_configured"]);
}

/** No-op voice adapter. Makes no real call and never invokes a real voice provider (ElevenLabs, etc). */
export function sendNoopVoiceCall(
  attemptId: string,
  status: "sent_noop" | "queued_noop",
  now: Date = new Date(),
): NoopProviderResult {
  return noopResult(attemptId, status === "queued_noop" ? "voicemail" : "call", status, now, ["no_real_call_placed", "no_provider_configured"]);
}

/** No-op website-form adapter. Performs no browser automation or real form submission. */
export function sendNoopWebsiteForm(attemptId: string, now: Date = new Date()): NoopProviderResult {
  return noopResult(attemptId, "website_form", "sent_noop", now, ["no_real_form_submitted", "no_provider_configured"]);
}

function dispatchNoopProvider(channel: ContactChannel, attemptId: string, now: Date): NoopProviderResult {
  switch (channel) {
    case "email": return sendNoopEmail(attemptId, now);
    case "sms_if_allowed": return sendNoopSms(attemptId, now);
    case "call": return sendNoopVoiceCall(attemptId, "sent_noop", now);
    case "voicemail": return sendNoopVoiceCall(attemptId, "queued_noop", now);
    case "second_call_if_urgent": return sendNoopVoiceCall(attemptId, "queued_noop", now);
    case "website_form": return sendNoopWebsiteForm(attemptId, now);
  }
}

export type RunContactAttemptResult = {
  attempt: ContactAttempt;
  providerResult: NoopProviderResult | null;
  blockedReasons: string[];
};

/**
 * Runs the send gate, then (only if allowed) dispatches to a no-op adapter.
 * No adapter here ever makes a real network call; liveProviderInvoked is
 * always false on the returned provider result. On success the attempt
 * lands on response_pending — HELD has executed the no-op provider path
 * and is now waiting for a vendor reply, not "Adam manually sent this."
 */
export function runNoopContactAttempt(attempt: ContactAttempt, now: Date = new Date()): RunContactAttemptResult {
  const gate = evaluateContactAttemptSendGate(attempt);
  if (!gate.allowed) {
    return { attempt: { ...attempt, status: "blocked", gatePassed: false }, providerResult: null, blockedReasons: gate.reasons };
  }
  const providerResult = dispatchNoopProvider(attempt.channel, attempt.attemptId, now);
  return {
    attempt: { ...attempt, status: "response_pending", gatePassed: true },
    providerResult,
    blockedReasons: [],
  };
}

/** Marks an attempt as having received a vendor reply, before interpretation runs. */
export function markAttemptReplyReceived(attempt: ContactAttempt): ContactAttempt {
  return { ...attempt, status: "reply_received" };
}

/** Marks an attempt as interpreted; providerResponded becomes true only once a real reply was actually classified. */
export function markAttemptInterpreted(attempt: ContactAttempt, blocked: boolean): ContactAttempt {
  return { ...attempt, status: blocked ? "blocked" : "interpreted", providerResponded: !blocked };
}

export const INBOUND_PROVIDERS = ["noop_test", "email_future", "sms_future", "voice_future", "form_future"] as const;
export type InboundProvider = (typeof INBOUND_PROVIDERS)[number];

export type VendorReplyIntakePacket = {
  attemptId: string;
  candidateId: string | null;
  sourceKey: string;
  channel: ContactChannel;
  receivedAt: string;
  rawReplyText: string;
  fromAddressOrPhone: string | null;
  inboundProvider: InboundProvider;
};

export type ReplyIntakeValidation = { valid: boolean; reasons: string[] };

export function validateReplyIntakePacket(packet: Partial<VendorReplyIntakePacket>): ReplyIntakeValidation {
  const reasons: string[] = [];
  if (!packet.attemptId?.trim()) reasons.push("attempt_id_required");
  if (!packet.sourceKey?.trim()) reasons.push("source_key_required");
  if (!packet.rawReplyText || packet.rawReplyText.trim().length < 3) reasons.push("raw_reply_text_required");
  if (!packet.channel || !CONTACT_CHANNELS.includes(packet.channel)) reasons.push("channel_required");
  if (!packet.inboundProvider || !INBOUND_PROVIDERS.includes(packet.inboundProvider)) reasons.push("inbound_provider_required");
  return { valid: reasons.length === 0, reasons: Array.from(new Set(reasons)) };
}

/**
 * Simulates a future inbound webhook/email/SMS/voice/form reply as a local,
 * admin-triggered test packet. inboundProvider is always noop_test here;
 * the *_future values exist only as the contract future ingestion adapters
 * will populate once a live provider is wired (not in this slice).
 */
export function buildSimulatedReplyIntakePacket(input: {
  attemptId: string;
  candidateId?: string | null;
  sourceKey: string;
  channel: ContactChannel;
  rawReplyText: string;
  fromAddressOrPhone?: string | null;
  now?: Date;
}): VendorReplyIntakePacket {
  return {
    attemptId: input.attemptId,
    candidateId: input.candidateId ?? null,
    sourceKey: input.sourceKey,
    channel: input.channel,
    receivedAt: (input.now ?? new Date()).toISOString(),
    rawReplyText: input.rawReplyText,
    fromAddressOrPhone: input.fromAddressOrPhone ?? null,
    inboundProvider: "noop_test",
  };
}

export const REPLY_CLASSIFICATIONS = [
  "available",
  "unavailable",
  "needs_more_info",
  "ambiguous",
  "do_not_contact",
  "late_qualified_responder",
] as const;
export type ReplyClassification = (typeof REPLY_CLASSIFICATIONS)[number];

export type InterpretedReply = {
  classification: ReplyClassification;
  bootstrapClassification: VendorResponseClassification;
  availableNotAccepted: true;
  blocked: boolean;
  blockedReasons: string[];
  extractedQuote: { amount: number; currency: string } | null;
  extractedAvailabilityWindow: string | null;
  requirements: string | null;
  upfrontPaymentRequired: boolean;
  confidence: "high" | "medium" | "low";
};

function mapBootstrapClassification(classification: VendorResponseClassification): ReplyClassification {
  switch (classification) {
    case "vendor_available": return "available";
    case "vendor_unavailable": return "unavailable";
    case "vendor_needs_clarification": return "needs_more_info";
    case "vendor_declined":
    case "vendor_unsupported":
      return "do_not_contact";
    case "vendor_rate_info_provided":
    case "vendor_general_response":
    default:
      return "ambiguous";
  }
}

function extractQuote(text: string): { amount: number; currency: string } | null {
  const match = /\$\s*([\d,]+(?:\.\d+)?)/.exec(text);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? { amount, currency: "USD" } : null;
}

function extractAvailabilityWindow(text: string): string | null {
  const match = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*(?:to|-|until)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.exec(text);
  return match ? match[0] : null;
}

function extractRequirements(text: string): string | null {
  const match = /\b(?:i|we)\s+(?:need|require|would need)\s+[^.?!]+/i.exec(text);
  return match ? match[0].trim() : null;
}

function detectUpfrontPayment(text: string): boolean {
  return /\b(up[- ]?front|deposit|prepay|pay (?:in advance|before)|before we (?:start|begin))\b/i.test(text);
}

/**
 * Deterministic v0 reply interpreter. Reuses the existing, already-deployed
 * interpretVendorResponse() banned-claims/classification logic rather than
 * re-deriving it, then narrows its 8-way classification down to this
 * slice's 6-way contract. availableNotAccepted is always true: this
 * function never produces or implies a provider-acceptance outcome.
 */
export function interpretVendorReply(input: { packet: VendorReplyIntakePacket; lateResponse?: boolean }): InterpretedReply {
  const interpretation = interpretVendorResponse({ summary: input.packet.rawReplyText, rawPayload: {} });
  if (!interpretation.allowed) {
    return {
      classification: "do_not_contact",
      bootstrapClassification: interpretation.classification,
      availableNotAccepted: true,
      blocked: true,
      blockedReasons: interpretation.reasons,
      extractedQuote: null,
      extractedAvailabilityWindow: null,
      requirements: null,
      upfrontPaymentRequired: false,
      confidence: "low",
    };
  }
  const classification = input.lateResponse ? "late_qualified_responder" : mapBootstrapClassification(interpretation.classification);
  return {
    classification,
    bootstrapClassification: interpretation.classification,
    availableNotAccepted: true,
    blocked: false,
    blockedReasons: [],
    extractedQuote: extractQuote(input.packet.rawReplyText),
    extractedAvailabilityWindow: extractAvailabilityWindow(input.packet.rawReplyText),
    requirements: extractRequirements(input.packet.rawReplyText),
    upfrontPaymentRequired: detectUpfrontPayment(input.packet.rawReplyText),
    confidence: classification === "available" || classification === "unavailable" ? "high" : classification === "needs_more_info" ? "medium" : "low",
  };
}

export type ResponseTermsPacket = {
  attemptId: string;
  candidateId: string | null;
  inquiryOnlyNotBooking: true;
  availabilityStatus: "available" | "unavailable" | "unknown" | "needs_clarification";
  rateStatus: "provided" | "not_provided" | "needs_clarification";
  quotedAmount: number | null;
  quotedCurrency: string | null;
  rateUnit: string | null;
  readyForAdminProposalReview: boolean;
  residentProposalReady: false;
  providerAccepted: false;
  bookingConfirmed: false;
  paymentAuthorized: false;
  dispatched: false;
  recommendedNextStep: string;
};

export type ResponseTermsPacketResult =
  | { allowed: true; reasons: []; packet: ResponseTermsPacket }
  | { allowed: false; reasons: string[]; packet: null };

/**
 * Builds a reviewable response-terms packet without any production write.
 * Calls the same pure, already-deployed interpretVendorResponse() and
 * evaluateVendorResponseTerms() policy functions the real DB-backed store
 * uses internally, just without the surrounding transaction/DB calls — so
 * this requires no outreachDraftId, no real outreach-event row, and no
 * schema change, while staying byte-for-byte consistent with the existing
 * availability/rate distinctions. residentProposalReady is always hardcoded
 * false regardless of the underlying admin-review readiness signal.
 */
export function buildResponseTermsPacket(input: {
  attemptId: string;
  candidateId: string | null;
  rawReplyText: string;
  occurredAt?: Date;
}): ResponseTermsPacketResult {
  const now = input.occurredAt ?? new Date();
  const interpretation = interpretVendorResponse({ summary: input.rawReplyText, rawPayload: {} });
  const decision = evaluateVendorResponseTerms({
    interpretation,
    event: {
      id: input.attemptId,
      workflowId: null,
      candidateId: input.candidateId ?? "unconfirmed_candidate",
      occurredAt: now,
      createdBy: "admin",
      summary: input.rawReplyText,
      rawPayload: {},
    },
    now,
  });
  if (!decision.allowed || !decision.terms) {
    return { allowed: false, reasons: decision.reasons, packet: null };
  }
  return {
    allowed: true,
    reasons: [],
    packet: {
      attemptId: input.attemptId,
      candidateId: input.candidateId,
      inquiryOnlyNotBooking: true,
      availabilityStatus: decision.terms.availabilityStatus,
      rateStatus: decision.terms.rateStatus,
      quotedAmount: decision.terms.quotedAmount,
      quotedCurrency: decision.terms.quotedCurrency,
      rateUnit: decision.terms.rateUnit,
      readyForAdminProposalReview: decision.proposalReady,
      residentProposalReady: false,
      providerAccepted: false,
      bookingConfirmed: false,
      paymentAuthorized: false,
      dispatched: false,
      recommendedNextStep: decision.proposalReady
        ? "Admin review before proposal: use First Real Proposal Bootstrap to assemble a proposal from this real response and evidence."
        : "Gather more information from the vendor before proposal assembly is possible.",
    },
  };
}
