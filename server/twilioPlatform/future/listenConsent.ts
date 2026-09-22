import {
  isClaireVoiceRecordingEnabled,
  recordingConsentLabel,
} from "../../claire/conversation/consent";

/**
 * Consent for a future non-operator listen or transcription.
 * The decision lives here, beside Goldline policy, and reuses the existing
 * Claire recording switch. It does not sit inside a Twilio transport client,
 * and it does not turn recording on.
 */
export type NonOperatorListenConsent =
  | {
      ok: false;
      code: "consent_required";
      recordingConsent: ReturnType<typeof recordingConsentLabel>;
      recordingEnabled: false;
    }
  | {
      ok: false;
      code: "recording_disabled";
      recordingConsent: "disabled";
      recordingEnabled: false;
    }
  | {
      ok: true;
      code: "consent_recorded";
      consentRecordId: string;
      recordingConsent: "dogfood_explicit";
      recordingEnabled: false;
      listenActivated: false;
    };

export function requireNonOperatorListenConsent(input: {
  consentRecordId: string | null | undefined;
  env?: NodeJS.ProcessEnv;
}): NonOperatorListenConsent {
  const env = input.env ?? process.env;
  const recordingOn = isClaireVoiceRecordingEnabled(env);
  const recordingConsent = recordingConsentLabel(recordingOn);
  const consentRecordId = input.consentRecordId?.trim() ?? "";
  if (!consentRecordId) {
    return {
      ok: false,
      code: "consent_required",
      recordingConsent,
      recordingEnabled: false,
    };
  }
  if (!recordingOn || recordingConsent !== "dogfood_explicit") {
    return {
      ok: false,
      code: "recording_disabled",
      recordingConsent: "disabled",
      recordingEnabled: false,
    };
  }
  return {
    ok: true,
    code: "consent_recorded",
    consentRecordId,
    recordingConsent: "dogfood_explicit",
    recordingEnabled: false,
    listenActivated: false,
  };
}
