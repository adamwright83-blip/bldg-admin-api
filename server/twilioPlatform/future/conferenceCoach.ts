import type {
  CoachBinding,
  CoachState,
  ConferenceListenSubject,
  ConferenceSession,
} from "@shared/twilioFuture";
import { requireNonOperatorListenConsent } from "./listenConsent";

export type CoachPathResult = {
  ok: false;
  code: "consent_required" | "recording_disabled" | "coaching_not_activated" | "third_party_dial_not_activated";
  session: ConferenceSession;
  binding: CoachBinding;
  dialed: false;
  listening: false;
  transcriptionStarted: false;
  recordingEnabled: false;
};

function inactiveSession(tenantId: string): ConferenceSession {
  return {
    kind: "conference_session",
    tenantId,
    activated: false,
    recordingEnabled: false,
    transcriptionEnabled: false,
    coachingActivated: false,
  };
}

function inactiveBinding(input: {
  subject: ConferenceListenSubject;
  requestedState: CoachState;
  consentRecordId: string | null;
}): CoachBinding {
  return {
    kind: "coach_binding",
    subject: input.subject,
    requestedState: input.requestedState,
    state: null,
    consentRecordId: input.consentRecordId,
    activated: false,
    listening: false,
    transcriptionStarted: false,
    recordingEnabled: false,
  };
}

/**
 * Coach and conference foundation. Does not dial, listen, transcribe,
 * or enter a coach state. Non-operator paths fail closed without consent.
 */
export function attemptCoachPath(input: {
  tenantId: string;
  subject: ConferenceListenSubject;
  consentRecordId?: string | null;
  requestedState: CoachState;
  env?: NodeJS.ProcessEnv;
}): CoachPathResult {
  const consentRecordId = input.consentRecordId?.trim() || null;
  const session = inactiveSession(input.tenantId);
  const binding = inactiveBinding({
    subject: input.subject,
    requestedState: input.requestedState,
    consentRecordId,
  });
  const closed = {
    ok: false as const,
    session,
    binding,
    dialed: false as const,
    listening: false as const,
    transcriptionStarted: false as const,
    recordingEnabled: false as const,
  };
  if (input.subject === "non_operator") {
    const consent = requireNonOperatorListenConsent({
      consentRecordId,
      env: input.env,
    });
    if (!consent.ok) {
      return { ...closed, code: consent.code };
    }
  }
  return { ...closed, code: "coaching_not_activated" };
}

/**
 * "Claire, get Russell on" is not implemented. A third party is a
 * non-operator listen. No consent fails closed. Consent still does not dial.
 */
export function requestThirdPartyOnCall(input: {
  tenantId: string;
  displayName: string;
  consentRecordId?: string | null;
  env?: NodeJS.ProcessEnv;
}): CoachPathResult {
  const consent = requireNonOperatorListenConsent({
    consentRecordId: input.consentRecordId,
    env: input.env,
  });
  const base = attemptCoachPath({
    tenantId: input.tenantId,
    subject: "non_operator",
    consentRecordId: input.consentRecordId,
    requestedState: "COACH_LISTENING",
    env: input.env,
  });
  if (!consent.ok) return base;
  return { ...base, code: "third_party_dial_not_activated" };
}
