/**
 * Device-initiated SMS compose handoff.
 * Opens the operator's own Google Messages thread with an approved draft.
 * It does not transmit, does not request the default-SMS role, and does not
 * call a carrier API. The Android link is a browser intent URL. This module
 * does not launch a native activity, does not ship a companion app, and does not
 * automate Messages for web.
 */

export const GOOGLE_MESSAGES_PACKAGE = "com.google.android.apps.messaging";

/** True when Android uses a browser intent URL. Not a native activity bridge. */
export const SMS_COMPOSE_USES_ANDROID_INTENT = true;

export const SMS_COMPOSE_APPROVAL_CONFIRMATION =
  "I approve this exact message for this recipient and want to open my SMS app" as const;

export const SMS_COMPOSE_REPORTED_SENT_CONFIRMATION =
  "I sent this exact approved message from my phone" as const;

export const SMS_COMPOSE_HANDOFF_STATES = [
  "draft",
  "approved",
  "compose_opened",
  "operator_reported_sent",
  "independently_verified_sent",
] as const;

export type SmsComposeHandoffState = (typeof SMS_COMPOSE_HANDOFF_STATES)[number];

export const SMS_COMPOSE_HANDOFF_STATE_LABELS: Record<SmsComposeHandoffState, string> = {
  draft: "Draft",
  approved: "Approved",
  compose_opened: "Compose opened",
  operator_reported_sent: "Operator reported sent",
  independently_verified_sent: "Independently verified sent",
};

export const SMS_COMPOSE_COPY_FALLBACK_LABEL =
  "Copy this message into Google Messages. The link opens the existing thread for this number when Messages has one. The body was not prefilled. Opening Messages is not a send.";

export const SMS_COMPOSE_MISSING_BODY_LABEL =
  "No approved message body. The SMS app opens to the number only. Nothing was prefilled.";

export const SMS_COMPOSE_PHONE_CONTINUATION_LABEL =
  "Open this page on your phone, then tap Open in SMS. This computer cannot open the handset SMS app, and this link does not send the message.";

export type SmsComposeClientKind = "android" | "ios" | "desktop" | "other";

export type SmsComposeSurface = "cozy_composer" | "scheduled_outreach";

const URL_SHORTENERS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "cutt.ly",
  "rebrand.ly",
  "shorturl.at",
]);

export type SmsComposeUriResult = {
  kind: "prefilled" | "copy_fallback" | "missing_body" | "desktop_continuation" | "operator_report";
  uri: string | null;
  fallbackUri: string | null;
  bodyPrefillClaimed: boolean;
  /** Explicit claim flag. Fallback and desktop results use not_prefilled. */
  prefillClaim: "sms_uri_query" | "not_prefilled";
  copyBody: string | null;
  copyLabel: string | null;
  continuationHref: string | null;
  continuationLabel: string | null;
  actionSendto: false;
  messagesPackage: typeof GOOGLE_MESSAGES_PACKAGE | null;
};

export function clientKindFromUserAgent(userAgent: string): SmsComposeClientKind {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (/mobile/i.test(userAgent)) return "other";
  return "desktop";
}

export function usSmsDigits(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) {
    throw new Error("A 10-digit US phone number is required to open the SMS app.");
  }
  return digits;
}

function isUrlShortener(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  for (const name of URL_SHORTENERS) {
    if (host === name || host.endsWith(`.${name}`)) return true;
  }
  return false;
}

export function buildSameOriginPhoneContinuation(input: {
  pageUrl: string;
  origin: string;
}): { href: string; label: string } {
  let originUrl: URL;
  let page: URL;
  try {
    originUrl = new URL(input.origin);
    page = new URL(input.pageUrl, originUrl);
  } catch {
    throw new Error("Open the authenticated JOYSTICK page on the phone.");
  }
  if (page.origin !== originUrl.origin) {
    throw new Error("Open the authenticated JOYSTICK page on the phone. The continuation stays on this site.");
  }
  if (isUrlShortener(page.hostname)) {
    throw new Error("Recipient and body must not travel through a URL shortener.");
  }
  page.search = "";
  page.hash = "";
  return {
    href: page.href,
    label: SMS_COMPOSE_PHONE_CONTINUATION_LABEL,
  };
}

/**
 * Android sms: links do not reliably prefill a body. Chrome's intent URL can
 * open Google Messages on the existing sms: thread for this number. The body
 * is not put in the intent. The operator copies it. iOS may use an sms: body
 * query. Desktop never builds an sms: URI.
 */
export function googleMessagesThreadIntent(digits: string): string {
  return `intent://send/+1${digits}#Intent;action=android.intent.action.VIEW;scheme=sms;package=${GOOGLE_MESSAGES_PACKAGE};end`;
}

export function buildSmsComposeUri(input: {
  recipientPhone: string;
  body: string | null | undefined;
  clientKind: SmsComposeClientKind;
  pageUrl?: string;
  origin?: string;
}): SmsComposeUriResult {
  if (input.clientKind === "desktop") {
    const continuation = buildSameOriginPhoneContinuation({
      pageUrl: input.pageUrl ?? "/",
      origin: input.origin ?? "",
    });
    return {
      kind: "desktop_continuation",
      uri: null,
      fallbackUri: null,
      bodyPrefillClaimed: false,
      prefillClaim: "not_prefilled",
      copyBody: null,
      copyLabel: null,
      continuationHref: continuation.href,
      continuationLabel: continuation.label,
      actionSendto: false,
      messagesPackage: null,
    };
  }

  const digits = usSmsDigits(input.recipientPhone);
  const numberUri = `sms:+1${digits}`;
  const body = input.body?.trim() ?? "";
  if (!body) {
    return {
      kind: "missing_body",
      uri: numberUri,
      fallbackUri: numberUri,
      bodyPrefillClaimed: false,
      prefillClaim: "not_prefilled",
      copyBody: null,
      copyLabel: SMS_COMPOSE_MISSING_BODY_LABEL,
      continuationHref: null,
      continuationLabel: null,
      actionSendto: false,
      messagesPackage: null,
    };
  }

  if (input.clientKind === "android") {
    return {
      kind: "copy_fallback",
      uri: googleMessagesThreadIntent(digits),
      fallbackUri: numberUri,
      bodyPrefillClaimed: false,
      prefillClaim: "not_prefilled",
      copyBody: body,
      copyLabel: SMS_COMPOSE_COPY_FALLBACK_LABEL,
      continuationHref: null,
      continuationLabel: null,
      actionSendto: false,
      messagesPackage: GOOGLE_MESSAGES_PACKAGE,
    };
  }

  const bodyPrefillReliable = input.clientKind === "ios";
  if (!bodyPrefillReliable) {
    return {
      kind: "copy_fallback",
      uri: numberUri,
      fallbackUri: numberUri,
      bodyPrefillClaimed: false,
      prefillClaim: "not_prefilled",
      copyBody: body,
      copyLabel: SMS_COMPOSE_COPY_FALLBACK_LABEL,
      continuationHref: null,
      continuationLabel: null,
      actionSendto: false,
      messagesPackage: null,
    };
  }

  return {
    kind: "prefilled",
    uri: `${numberUri}?body=${encodeURIComponent(body)}`,
    fallbackUri: numberUri,
    bodyPrefillClaimed: true,
    prefillClaim: "sms_uri_query",
    copyBody: null,
    copyLabel: null,
    continuationHref: null,
    continuationLabel: null,
    actionSendto: false,
    messagesPackage: null,
  };
}

/** Staleness fingerprint of the exact approved body. Not a credential and not stored as the body. */
export function approvedBodyDigest(body: string): string {
  const parts = [0x811c9dc5, 0x811c9dc5 ^ body.length, 0x01000193, 0xa1b2c3d4];
  return parts
    .map((seed, index) => {
      let hash = seed >>> 0;
      const text = `${index}:${body}`;
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, "0");
    })
    .join("");
}

export type SmsComposeHandoffEvent = {
  id: string;
  tenantId: string;
  operatorId: string;
  messageId: string;
  revisionCount: number;
  bodyDigest: string;
  handoffState: "approved" | "compose_opened" | "operator_reported_sent";
  surface: SmsComposeSurface;
  invokedAt: string;
};

export type SmsComposeHandoffProjection = {
  messageId: string;
  revisionCount: number;
  state: SmsComposeHandoffState;
  label: string;
  covers: boolean;
  verifiedSent: false;
  pose: "idle" | "wave";
};

export function projectHandoffForRevision(
  events: readonly SmsComposeHandoffEvent[],
  query: { messageId: string; revisionCount: number; bodyDigest: string }
): SmsComposeHandoffProjection {
  let sawApproved = false;
  let sawCompose = false;
  let sawReport = false;
  for (const event of events) {
    if (event.messageId !== query.messageId) continue;
    if (event.revisionCount !== query.revisionCount) continue;
    if (event.bodyDigest !== query.bodyDigest) continue;
    if (event.handoffState === "approved") sawApproved = true;
    if (event.handoffState === "compose_opened") sawCompose = true;
    if (event.handoffState === "operator_reported_sent") sawReport = true;
  }
  let state: SmsComposeHandoffState = "draft";
  if (sawApproved) state = "approved";
  if (sawApproved && sawCompose) state = "compose_opened";
  if (sawApproved && sawCompose && sawReport) state = "operator_reported_sent";
  return {
    messageId: query.messageId,
    revisionCount: query.revisionCount,
    state,
    label: SMS_COMPOSE_HANDOFF_STATE_LABELS[state],
    covers: state === "compose_opened" || state === "operator_reported_sent",
    verifiedSent: false,
    pose: state === "approved" ? "wave" : "idle",
  };
}

export function handoffCoversRevision(
  events: readonly SmsComposeHandoffEvent[],
  query: { messageId: string; revisionCount: number; bodyDigest: string }
): boolean {
  return projectHandoffForRevision(events, query).covers;
}

/**
 * Compose opened and an operator self-report stay on those states.
 * An independent read-back is a different source and is not produced here.
 */
export function poseForProjectedHandoff(state: SmsComposeHandoffState): "idle" | "wave" {
  return state === "approved" ? "wave" : "idle";
}

export function poseForIndependentReadback(
  state: SmsComposeHandoffState
): "idle" | "acknowledged" {
  return state === "independently_verified_sent" ? "acknowledged" : "idle";
}

export function refuseVerifiedPromotion(from: SmsComposeHandoffState): {
  state: SmsComposeHandoffState;
  promoted: false;
  verifiedSent: false;
} {
  return {
    state: from,
    promoted: false,
    verifiedSent: false,
  };
}

export type OutboxDispatchSnapshot = {
  status: string;
  dispatchedAt: Date | string | null;
  externalMessageId: string | null;
  dispatchAttemptedAt?: Date | string | null;
};

export function composeHandoffLeavesOutboxUndispatched<T extends OutboxDispatchSnapshot>(row: T): {
  row: T;
  dispatchedAt: null;
  externalMessageId: null;
  markedDispatched: false;
  statusWritten: null;
} {
  return {
    row,
    dispatchedAt: null,
    externalMessageId: null,
    markedDispatched: false,
    statusWritten: null,
  };
}
