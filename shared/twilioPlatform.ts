/**
 * Goldline Twilio platform contract.
 *
 * Twilio is the pipe and the source of provider receipts. These types are
 * communications evidence only. They are not Goldline business outcomes,
 * WeeklyIntent, Daily Command, or Narrator events.
 */

export const TWILIO_PLATFORM_PROVIDER = "twilio" as const;

export const COMMUNICATION_RECEIPT_TABLE = "communication_receipts" as const;

export const TWILIO_CAPABILITY_IDS = [
  "voiceGather",
  "conversationRelay",
  "answeringMachineDetection",
  "sms",
  "conversations",
  "whatsapp",
  "transcription",
  "conversationIntelligence",
  "lookup",
  "verify",
  "proxy",
  "conference",
  "brandedCalling",
  "taskRouter",
  "sync",
  "studioFallback",
] as const;

export type TwilioCapabilityId = (typeof TWILIO_CAPABILITY_IDS)[number];

export const TWILIO_CAPABILITY_STATES = [
  "UNCONFIGURED",
  "DISABLED",
  "CONFIGURED",
  "CONFIGURED_FAILING",
  "LIVE",
] as const;

export type TwilioCapabilityState = (typeof TWILIO_CAPABILITY_STATES)[number];

export const TWILIO_CAPABILITY_REASONS = {
  featureFlagOff: "feature_flag_off",
  missingServiceSid: "missing_service_sid",
  missingAccountSid: "missing_account_sid",
  missingAuthToken: "missing_auth_token",
  missingFromNumber: "missing_from_number",
  missingOperatorPhone: "missing_operator_phone",
  missingFlowSid: "missing_flow_sid",
  missingWorkspaceSid: "missing_workspace_sid",
  missingCustomerProfileSid: "missing_customer_profile_sid",
  notProvisioned: "not_provisioned",
  providerFailure: "provider_failure",
} as const;

export type TwilioCapabilityReason =
  (typeof TWILIO_CAPABILITY_REASONS)[keyof typeof TWILIO_CAPABILITY_REASONS];

export type TwilioCapabilityRecord = {
  id: TwilioCapabilityId;
  state: TwilioCapabilityState;
  reason: TwilioCapabilityReason | null;
};

/**
 * Public configuration. Presence and operational addresses only.
 * Auth tokens and API secrets are never fields on this object.
 */
export type TwilioPlatformConfig = {
  accountSidPresent: boolean;
  authTokenPresent: boolean;
  claireFromNumber: string | null;
  smsFromNumber: string | null;
  operatorPhoneConfigured: boolean;
  conversationRelayEnabled: boolean;
  answeringMachineDetectionEnabled: boolean;
  proxyServiceSidPresent: boolean;
  verifyServiceSidPresent: boolean;
  conversationsServiceSidPresent: boolean;
  messagingServiceSidPresent: boolean;
  syncServiceSidPresent: boolean;
  taskRouterWorkspaceSidPresent: boolean;
  studioFlowSidPresent: boolean;
  studioFallbackEnabled: boolean;
  intelligenceServiceSidPresent: boolean;
  lookupEnabled: boolean;
  transcriptionEnabled: boolean;
  whatsappFrom: string | null;
  conferenceEnabled: boolean;
  brandedCallingCustomerProfileSidPresent: boolean;
};

export const COMMUNICATION_RECEIPT_EVENTS = [
  "CALL_ATTEMPTED",
  "CALL_RINGING",
  "CALL_CONNECTED",
  "CALL_COMPLETED",
  "CALL_NO_ANSWER",
  "CALL_BUSY",
  "CALL_FAILED",
  "VOICEMAIL_DETECTED",
  "MESSAGE_SENT",
  "MESSAGE_DELIVERED",
  "MESSAGE_FAILED",
] as const;

export type CommunicationReceiptEventType = (typeof COMMUNICATION_RECEIPT_EVENTS)[number];

export type CommunicationDirection = "inbound" | "outbound";

export type TwilioCommunicationReceipt = {
  id: string;
  tenantId: string;
  operatorUserId: string | null;
  provider: typeof TWILIO_PLATFORM_PROVIDER;
  providerEventId: string | null;
  eventType: CommunicationReceiptEventType;
  callSid: string | null;
  parentCallSid: string | null;
  messageSid: string | null;
  direction: CommunicationDirection | null;
  from: string | null;
  to: string | null;
  status: string | null;
  startedAt: string | null;
  answeredAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
  idempotencyKey: string;
  createdAt: string;
};

export const COMMUNICATION_EVIDENCE_CONCEPTS = [
  "CALL_ATTEMPTED",
  "CALL_RINGING",
  "CALL_CONNECTED",
  "CALL_COMPLETED",
  "CALL_DURATION_OBSERVED",
  "CALL_NO_ANSWER",
  "CALL_BUSY",
  "CALL_FAILED",
  "VOICEMAIL_DETECTED",
  "MESSAGE_SENT",
  "MESSAGE_DELIVERED",
] as const;

export type CommunicationEvidenceConcept = (typeof COMMUNICATION_EVIDENCE_CONCEPTS)[number];

/**
 * Communications evidence. A connected call, including one that lasted
 * several minutes, does not imply customer interest, property approval,
 * a sale, a mission, WeeklyIntent, Daily Command, or a Narrator event.
 */
export type CommunicationCandidateEvidence = {
  kind: "communications_evidence";
  concept: CommunicationEvidenceConcept;
  tenantId: string;
  operatorUserId: string | null;
  provider: typeof TWILIO_PLATFORM_PROVIDER;
  providerEventId: string | null;
  callSid: string | null;
  parentCallSid: string | null;
  messageSid: string | null;
  direction: CommunicationDirection | null;
  durationSeconds: number | null;
  observedAt: string;
  sourceIdempotencyKey: string;
  goldlineEntityId: null;
};

export const BUSINESS_OUTCOMES_NOT_IMPLIED_BY_COMMUNICATIONS = [
  "CUSTOMER_INTERESTED",
  "CUSTOMER_APPROVED",
  "PROPERTY_APPROVED",
  "SALES_FOLLOWUP_SUCCESS",
  "MISSION_COMPLETED",
  "SALE_WON",
  "PROMISE_KEPT",
  "WEEKLY_INTENT_FULFILLED",
  "DAILY_COMMAND_COMPLETED",
  "NARRATOR_EVENT",
] as const;

export type BusinessOutcomeNotImpliedByCommunications =
  (typeof BUSINESS_OUTCOMES_NOT_IMPLIED_BY_COMMUNICATIONS)[number];

const VOICE_STATUS_EVENTS: Record<string, CommunicationReceiptEventType> = {
  queued: "CALL_ATTEMPTED",
  initiated: "CALL_ATTEMPTED",
  ringing: "CALL_RINGING",
  "in-progress": "CALL_CONNECTED",
  answered: "CALL_CONNECTED",
  completed: "CALL_COMPLETED",
  "no-answer": "CALL_NO_ANSWER",
  busy: "CALL_BUSY",
  failed: "CALL_FAILED",
  canceled: "CALL_FAILED",
  cancelled: "CALL_FAILED",
};

const MESSAGE_STATUS_EVENTS: Record<string, CommunicationReceiptEventType> = {
  accepted: "MESSAGE_SENT",
  queued: "MESSAGE_SENT",
  sending: "MESSAGE_SENT",
  sent: "MESSAGE_SENT",
  delivered: "MESSAGE_DELIVERED",
  undelivered: "MESSAGE_FAILED",
  failed: "MESSAGE_FAILED",
};

const MACHINE_ANSWERED_BY = new Set([
  "machine",
  "machine_start",
  "machine_end_beep",
  "machine_end_silence",
  "machine_end_other",
]);

export function isCommunicationReceiptEvent(
  value: string
): value is CommunicationReceiptEventType {
  return (COMMUNICATION_RECEIPT_EVENTS as readonly string[]).includes(value);
}

export function communicationReceiptEventFromProviderStatus(input: {
  channel: "voice" | "message";
  status: string;
  answeredBy?: string | null;
}): CommunicationReceiptEventType | null {
  const answeredBy = input.answeredBy?.trim().toLowerCase() ?? "";
  if (input.channel === "voice" && MACHINE_ANSWERED_BY.has(answeredBy)) {
    return "VOICEMAIL_DETECTED";
  }
  const status = input.status.trim().toLowerCase();
  const table = input.channel === "voice" ? VOICE_STATUS_EVENTS : MESSAGE_STATUS_EVENTS;
  return table[status] ?? null;
}

/**
 * Provider event identity when Twilio sent one. Otherwise tenant plus
 * CallSid or MessageSid plus the receipt event class. The key is stable
 * across retries of the same provider event.
 */
export function communicationReceiptIdempotencyKey(input: {
  tenantId: string;
  eventType: CommunicationReceiptEventType;
  providerEventId?: string | null;
  callSid?: string | null;
  messageSid?: string | null;
}): string {
  const tenantId = input.tenantId.trim();
  if (!tenantId) {
    throw new Error("communication receipt requires tenantId");
  }
  const providerEventId = input.providerEventId?.trim() || null;
  if (providerEventId) {
    return `twilio:event:${tenantId}:${providerEventId}`;
  }
  const resource = input.callSid?.trim() || input.messageSid?.trim() || "";
  if (!resource) {
    throw new Error(
      "communication receipt requires providerEventId or CallSid/MessageSid"
    );
  }
  return `twilio:class:${tenantId}:${resource}:${input.eventType}`;
}

/** Provider SIDs are not Goldline missions, orders, intents, or narrator ids. */
export function providerSidIsGoldlineEntityId(_providerSid: string | null | undefined): false {
  return false;
}

export function redactEndpointForLog(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 4) return `***${digits.slice(-4)}`;
  return "[redacted]";
}
