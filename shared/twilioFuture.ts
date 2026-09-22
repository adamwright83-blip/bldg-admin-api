/**
 * Future Twilio product contracts for Goldline.
 *
 * These types import the platform capability union and receipt vocabulary.
 * They do not define a second client, capability registry, or receipt schema.
 * Nothing in this module places a call, sends a message, or talks to Twilio.
 */

import {
  BUSINESS_OUTCOMES_NOT_IMPLIED_BY_COMMUNICATIONS,
  TWILIO_CAPABILITY_IDS,
  type BusinessOutcomeNotImpliedByCommunications,
  type TwilioCapabilityId,
  type TwilioCapabilityState,
} from "./twilioPlatform";

export const FUTURE_TWILIO_CAPABILITY_IDS = [
  "lookup",
  "verify",
  "proxy",
  "conference",
  "transcription",
  "conversationIntelligence",
  "brandedCalling",
  "taskRouter",
  "sync",
  "studioFallback",
] as const satisfies readonly TwilioCapabilityId[];

export type FutureTwilioCapabilityId = (typeof FUTURE_TWILIO_CAPABILITY_IDS)[number];

export function isFutureTwilioCapabilityId(value: TwilioCapabilityId): value is FutureTwilioCapabilityId {
  return (FUTURE_TWILIO_CAPABILITY_IDS as readonly TwilioCapabilityId[]).includes(value);
}

/** Compile-time / test guard: the future list is a subset of the foundation union. */
export function futureCapabilityIdsAreFoundationSubset(): boolean {
  return FUTURE_TWILIO_CAPABILITY_IDS.every(id =>
    (TWILIO_CAPABILITY_IDS as readonly string[]).includes(id)
  );
}

export const LOOKUP_FIELD_AVAILABILITY = ["PRESENT", "UNCONFIGURED", "UNAVAILABLE"] as const;

export type LookupFieldAvailability = (typeof LOOKUP_FIELD_AVAILABILITY)[number];

export type LookupField<T> =
  | { availability: "PRESENT"; value: T }
  | { availability: "UNCONFIGURED"; value: null }
  | { availability: "UNAVAILABLE"; value: null };

export const LOOKUP_PREMIUM_PACKAGES = [
  "lineType",
  "callerName",
  "reassignedNumber",
  "identityMatch",
  "simSwap",
] as const;

export type LookupPremiumPackage = (typeof LOOKUP_PREMIUM_PACKAGES)[number];

/**
 * Provider snapshot only. The adapter does not fetch this from Lookup.
 * Premium status strings are observations, not authorization.
 */
export type LookupProviderSnapshot = {
  phoneNumber?: string | null;
  valid?: boolean | null;
  countryCode?: string | null;
  lineType?: string | null;
  callerName?: string | null;
  reassignedNumberStatus?: string | null;
  identityMatchStatus?: string | null;
  simSwapStatus?: string | null;
};

export type LookupObservation = {
  capabilityState: TwilioCapabilityState;
  authorizes: false;
  normalizedE164: LookupField<string>;
  valid: LookupField<boolean>;
  country: LookupField<string>;
  lineType: LookupField<string>;
  callerName: LookupField<string>;
  reassignedNumberStatus: LookupField<string>;
  identityMatchStatus: LookupField<string>;
  simSwapStatus: LookupField<string>;
};

export const VERIFY_ACTION_CLASSES = [
  "sensitive_export",
  "account_security_change",
  "high_value_spend",
  "credential_change",
] as const;

export type VerifyActionClass = (typeof VERIFY_ACTION_CLASSES)[number];

export const VERIFY_GRANT_TTL_MS = 5 * 60 * 1000;

export const VERIFY_DOES_NOT_EXECUTE = [
  "payment",
  "export",
  "credential_mutation",
  "business_action",
] as const;

export type VerifyDoesNotExecute = (typeof VERIFY_DOES_NOT_EXECUTE)[number];

/**
 * Authorization evidence for one action class. It is not a payment,
 * an export, a credential change, or any other business action.
 */
export type VerifyActionGrant = {
  kind: "verify_action_grant";
  grantId: string;
  tenantId: string;
  operatorUserId: string;
  actionClass: VerifyActionClass;
  issuedAtMs: number;
  expiresAtMs: number;
  evidenceOnly: true;
  executesBusinessAction: false;
};

export type ClaireTurnVerifyPolicy = {
  conversationOtpRequired: false;
  actionGrantRequired: boolean;
  keepsOrdinaryClaire: boolean;
};

export const PROXY_ANCHOR_KINDS = ["order", "deliveryJob", "customer", "driver"] as const;

export type ProxyAnchorKind = (typeof PROXY_ANCHOR_KINDS)[number];

export type GoldlineProxyAnchor =
  | { kind: "order"; orderId: string }
  | { kind: "deliveryJob"; deliveryJobId: string }
  | { kind: "customer"; customerId: string }
  | { kind: "driver"; driverId: string };

/**
 * Foundation descriptor. `liveSessionCreated` is false in this slice:
 * no Twilio Proxy session is opened.
 */
export type MaskedCommunicationSession = {
  kind: "masked_communication_session";
  tenantId: string;
  anchor: GoldlineProxyAnchor;
  liveSessionCreated: false;
  proxySessionSid: null;
};

export const COACH_STATES = [
  "COACH_LISTENING",
  "COACH_SUGGESTION_READY",
  "COACH_SPOKEN_PRIVATELY",
  "COACH_PAUSED",
  "COACH_ENDED",
] as const;

export type CoachState = (typeof COACH_STATES)[number];

export type ConferenceListenSubject = "operator" | "non_operator";

export type ConferenceSession = {
  kind: "conference_session";
  tenantId: string;
  activated: false;
  recordingEnabled: false;
  transcriptionEnabled: false;
  coachingActivated: false;
};

export type ConferenceParticipant = {
  participantId: string;
  role: ConferenceListenSubject;
  consentRecordId: string | null;
  dialed: false;
};

export type CoachBinding = {
  kind: "coach_binding";
  subject: ConferenceListenSubject;
  requestedState: CoachState;
  state: null;
  consentRecordId: string | null;
  activated: false;
  listening: false;
  transcriptionStarted: false;
  recordingEnabled: false;
};

export const TRANSCRIPT_CANDIDATE_CLASSES = [
  "possible_commitment",
  "possible_follow_up",
  "possible_contact_name",
  "possible_next_step",
  "possible_objection",
  "possible_business_claim",
] as const;

export type TranscriptCandidateClass = (typeof TRANSCRIPT_CANDIDATE_CLASSES)[number];

export const UNVERIFIED_TRANSCRIPT_EVIDENCE = "UNVERIFIED_TRANSCRIPT_EVIDENCE" as const;

export const TRANSCRIPT_CANNOT_CREATE = [
  "completed_work",
  "customer_approval",
  "sale",
  "verified_promise",
  "WeeklyIntent",
  "DailyCommandPrimary",
  "NarratorEvent",
] as const;

export type TranscriptCannotCreate = (typeof TRANSCRIPT_CANNOT_CREATE)[number];

export type TranscriptCandidateEvidence = {
  kind: "transcript_candidate_evidence";
  status: typeof UNVERIFIED_TRANSCRIPT_EVIDENCE;
  evidenceClass: TranscriptCandidateClass;
  text: string;
  /** Conversation Intelligence sentiment is not stored as Claire regard. */
  regard: null;
};

/**
 * Goldline remains canonical. This is a snapshot the adapter may describe.
 * The adapter has no writer for it.
 */
export type GoldlineCanonicalJob = {
  tenantId: string;
  jobId: string;
  orderId: string | null;
  driverId: string | null;
  availability: GoldlineWorkerAvailability;
  assignmentStatus: string;
};

export type GoldlineWorkerAvailability = "available" | "unavailable" | "off_duty";

export type GoldlineWorkerCapability = {
  driverId: string;
  skills: readonly string[];
};

export type GoldlineDispatchTask = {
  tenantId: string;
  jobId: string;
  orderId: string | null;
  driverId: string | null;
  availability: GoldlineWorkerAvailability;
};

export type TaskRouterProjection = {
  kind: "taskrouter_projection";
  goldlineRemainsCanonical: true;
  createsTwilioWorker: false;
  createsTwilioTask: false;
  mutatesCanonicalJob: false;
  capabilityState: TwilioCapabilityState;
  task: GoldlineDispatchTask;
  worker: GoldlineWorkerCapability | null;
};

export const GOLDLINE_COMM_EVENT_NAMES = [
  "call.started",
  "call.ringing",
  "call.connected",
  "call.ended",
  "message.sent",
  "message.delivered",
  "transcript.partial",
  "transcript.final",
  "coach.suggestion",
  "conference.participant_joined",
  "conference.participant_left",
] as const;

export type GoldlineCommEventName = (typeof GOLDLINE_COMM_EVENT_NAMES)[number];

export type GoldlineCommEvent = {
  name: GoldlineCommEventName;
  tenantId: string;
  occurredAt: string;
  payload: Record<string, string | number | boolean | null>;
  canonical: "goldline_domain_event";
  syncIsCanonicalState: false;
};

export function isGoldlineCommEventName(value: string): value is GoldlineCommEventName {
  return (GOLDLINE_COMM_EVENT_NAMES as readonly string[]).includes(value);
}

export function transcriptCannotCreate(
  _candidate: TranscriptCandidateEvidence,
  _authority: TranscriptCannotCreate | BusinessOutcomeNotImpliedByCommunications
): false {
  return false;
}

export function sentimentIsClaireRegard(_sentiment: string | null | undefined): false {
  return false;
}

export const COMMUNICATION_BUSINESS_OUTCOMES_STILL_NOT_IMPLIED =
  BUSINESS_OUTCOMES_NOT_IMPLIED_BY_COMMUNICATIONS;
