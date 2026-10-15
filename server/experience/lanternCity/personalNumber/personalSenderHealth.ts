/**
 * Personal-number sender health.
 * A page load is not health. A stale session is not connected.
 * A Google account, CleanCloud contact, or business phone is not the originating handset.
 * Classification never authorizes transmission by itself.
 */

export const PERSONAL_SENDER_STATES = [
  "connected",
  "disconnected",
  "unhealthy",
  "requires_pairing",
  "identity_unverified",
] as const;

export type PersonalSenderState = (typeof PERSONAL_SENDER_STATES)[number];

export const PERSONAL_SENDER_STATE_LABELS: Record<PersonalSenderState, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  unhealthy: "Unhealthy",
  requires_pairing: "Requires Pairing",
  identity_unverified: "Identity Unverified",
};

/** Observations older than this are disconnected, even if the last label said connected. */
export const PERSONAL_SENDER_SESSION_FRESH_MS = 90_000;

export const PERSONAL_SENDER_OBSERVATION_SOURCES = [
  "android_telephony_line",
  "simulated",
  "google_account",
  "cleancloud_contact",
  "business_twilio",
  "page_load",
  "unknown",
] as const;

export type PersonalSenderObservationSource =
  (typeof PERSONAL_SENDER_OBSERVATION_SOURCES)[number];

const US_E164 = /^\+1[2-9]\d{9}$/;

export function isStrictUsE164(phone: string | null | undefined): phone is string {
  return typeof phone === "string" && US_E164.test(phone);
}

export type PersonalSenderObservation = {
  pairingPresent: boolean;
  /** True when using this browser session would replace the operator's existing Google Messages web session. */
  displacesExistingWebSession: boolean;
  pageLoaded: boolean;
  deviceOnline: boolean;
  sessionObservedAt: Date | null;
  now: Date;
  originatingPhone: string | null;
  originatingPhoneVerified: boolean;
  observationSource: PersonalSenderObservationSource;
  deviceId: string | null;
  expectedDeviceId: string | null;
  transportProbeOk: boolean;
  freshForMs?: number;
};

export type PersonalSenderClassification = {
  state: PersonalSenderState;
  stateLabel: string;
  /** Health never grants a send. Transmission has its own human gate and a verifying transport. */
  authorizedToTransmit: false;
  blockReason: string;
  sessionStale: boolean;
};

function classified(
  state: PersonalSenderState,
  blockReason: string,
  sessionStale = false
): PersonalSenderClassification {
  return {
    state,
    stateLabel: PERSONAL_SENDER_STATE_LABELS[state],
    authorizedToTransmit: false,
    blockReason,
    sessionStale,
  };
}

function forbiddenSourceReason(source: PersonalSenderObservationSource): string | null {
  switch (source) {
    case "google_account":
      return "Identity Unverified. A Google account is not the originating phone.";
    case "cleancloud_contact":
      return "Identity Unverified. A CleanCloud contact is not the sending device.";
    case "business_twilio":
      return "Identity Unverified. The business phone is not the personal sender.";
    case "page_load":
      return "Identity Unverified. Loading a page did not verify the originating number.";
    case "unknown":
      return "Identity Unverified. The originating number has no authorized observation source.";
    default:
      return null;
  }
}

export function classifyPersonalSenderHealth(
  observation: PersonalSenderObservation
): PersonalSenderClassification {
  if (observation.displacesExistingWebSession) {
    return classified(
      "requires_pairing",
      "BLOCKED: attaching this browser session would displace the operator's existing personal Google Messages web session. Pairing was not started and the operator was not signed out."
    );
  }

  if (!observation.pairingPresent) {
    return classified(
      "requires_pairing",
      "Requires Pairing. No authorized Android personal-number session is paired. Live pairing stays blocked until the operator approves it."
    );
  }

  const forbidden = forbiddenSourceReason(observation.observationSource);
  const simulatedAllowed =
    observation.observationSource === "simulated" && process.env.NODE_ENV === "test";
  const sourceAllowed =
    observation.observationSource === "android_telephony_line" || simulatedAllowed;
  const phoneAllowed =
    observation.originatingPhoneVerified && isStrictUsE164(observation.originatingPhone);

  if (forbidden || !sourceAllowed || !phoneAllowed) {
    return classified(
      "identity_unverified",
      forbidden ??
        "Identity Unverified. The originating personal number was not verified from the Android telephony line."
    );
  }

  const freshFor = observation.freshForMs ?? PERSONAL_SENDER_SESSION_FRESH_MS;
  const observedAt = observation.sessionObservedAt?.getTime();
  const age =
    observedAt === undefined ? Number.POSITIVE_INFINITY : observation.now.getTime() - observedAt;
  const sessionStale = !Number.isFinite(age) || age < 0 || age > freshFor;

  if (!observation.deviceOnline || sessionStale) {
    return classified(
      "disconnected",
      sessionStale
        ? "Disconnected. The sender session is stale or was never observed. A stale session is not connected."
        : "Disconnected. The Android device is offline.",
      sessionStale
    );
  }

  const deviceMismatch =
    !observation.deviceId ||
    (observation.expectedDeviceId !== null && observation.deviceId !== observation.expectedDeviceId);

  if (deviceMismatch || !observation.transportProbeOk) {
    return classified(
      "unhealthy",
      deviceMismatch
        ? "Unhealthy. The paired device does not match the authorized personal handset."
        : "Unhealthy. Page load is not a health check, and the transport probe did not verify the sender."
    );
  }

  return classified(
    "connected",
    "Connected describes the device link only. It is not authorization to transmit. Browser Google Messages transport is BLOCKED, and a live send still requires operator approval of the originating number, recipient number, exact body, and immediate send."
  );
}
