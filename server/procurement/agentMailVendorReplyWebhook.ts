import { timingSafeEqual } from "node:crypto";
import {
  buildResponseTermsPacket,
  interpretVendorReply,
  type VendorReplyIntakePacket,
} from "./vendorContactAttemptPolicy";
import type { VendorContactAttemptStore } from "./vendorContactAttemptStore";

/**
 * Slice 74f. The installed `agentmail` package exposes Svix-shaped type
 * aliases for webhook delivery (SvixSignature/SvixTimestamp/SvixId are all
 * plain `string` types) but does NOT export any verification helper or
 * documented HMAC scheme alongside them -- there is no `verifyWebhook` or
 * similar function in the SDK to call, and guessing at Svix's real signing
 * scheme without it being confirmed in this package would violate the "do
 * not guess" rule. This is therefore a documented, intentional limitation:
 * authentication here is a dedicated shared-secret header, not a
 * cryptographic signature over the payload. It still fails closed (401) on
 * any missing/mismatched secret and is compared with a timing-safe
 * comparison, but it is not equivalent to verifying a Svix signature.
 */

export const AGENTMAIL_VENDOR_WEBHOOK_SECRET_ENV_VAR = "AGENTMAIL_VENDOR_WEBHOOK_SECRET";
export const AGENTMAIL_VENDOR_WEBHOOK_SECRET_HEADER = "x-agentmail-vendor-webhook-secret";

export type WebhookEnv = Record<string, string | undefined>;

export type WebhookAuthResult = { authorized: boolean; reason: string | null };

/**
 * Timing-safe shared-secret comparison. Never logs the configured secret
 * or the value the caller provided, regardless of outcome.
 */
export function verifyAgentMailWebhookSecret(input: {
  providedSecret: string | string[] | undefined;
  env?: WebhookEnv;
}): WebhookAuthResult {
  const env = input.env ?? process.env;
  const expected = env[AGENTMAIL_VENDOR_WEBHOOK_SECRET_ENV_VAR];
  if (!expected || !expected.trim()) {
    return { authorized: false, reason: "webhook_secret_not_configured" };
  }
  const provided = Array.isArray(input.providedSecret) ? input.providedSecret[0] : input.providedSecret;
  if (!provided) {
    return { authorized: false, reason: "missing_webhook_secret_header" };
  }
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length) {
    return { authorized: false, reason: "invalid_webhook_secret" };
  }
  return timingSafeEqual(expectedBuf, providedBuf)
    ? { authorized: true, reason: null }
    : { authorized: false, reason: "invalid_webhook_secret" };
}

const INBOUND_MESSAGE_RECEIVED_EVENT_TYPES = new Set([
  "message.received",
  "message.received.spam",
  "message.received.blocked",
  "message.received.unauthenticated",
]);

type AgentMailWebhookMessage = {
  messageId?: unknown;
  threadId?: unknown;
  from?: unknown;
  extractedText?: unknown;
  text?: unknown;
  inReplyTo?: unknown;
  references?: unknown;
};

type AgentMailWebhookPayload = {
  type?: unknown;
  eventType?: unknown;
  eventId?: unknown;
  message?: AgentMailWebhookMessage;
};

export type AgentMailWebhookIntakeResult =
  | { status: "unauthorized"; reason: string }
  | { status: "invalid_payload"; reason: string }
  | { status: "ignored_event_type"; eventType: string }
  | { status: "unmatched"; reason: string }
  | { status: "already_processed"; durableAttemptId: string; agentMailEventId: string }
  | { status: "processed"; durableAttemptId: string; agentMailEventId: string; classification: string };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseJsonBody(rawBody: string | Buffer): AgentMailWebhookPayload | null {
  try {
    const parsed = JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as AgentMailWebhookPayload) : null;
  } catch {
    return null;
  }
}

function findCorrelatableProviderAttemptId(message: AgentMailWebhookMessage): string | null {
  const inReplyTo = text(message.inReplyTo);
  if (inReplyTo) return inReplyTo;
  const references = Array.isArray(message.references) ? message.references.filter((v): v is string => typeof v === "string") : [];
  return references.length > 0 ? references[references.length - 1] : null;
}

/**
 * Processes one inbound AgentMail webhook delivery. Never sends outbound
 * email, never calls any outbound provider, and never creates a new
 * vendor_contact_attempts row -- it only updates an existing row it can
 * confidently correlate to a real outbound send via provider_attempt_id
 * (matched against the reply's inReplyTo/references, which AgentMail's own
 * docs describe as "ID of message being replied to" / "IDs of previous
 * messages in thread", i.e. AgentMail's own message ids, the same id this
 * system stores as provider_attempt_id at send time). If no confident
 * match exists, it returns "unmatched" and writes nothing.
 */
export async function processAgentMailVendorReplyWebhook(input: {
  rawBody: string | Buffer;
  providedSecret: string | string[] | undefined;
  store: Pick<VendorContactAttemptStore, "getAttemptByProviderAttemptId" | "recordReplyAndTerms">;
  env?: WebhookEnv;
  now?: Date;
}): Promise<AgentMailWebhookIntakeResult> {
  const auth = verifyAgentMailWebhookSecret({ providedSecret: input.providedSecret, env: input.env });
  if (!auth.authorized) {
    return { status: "unauthorized", reason: auth.reason ?? "unauthorized" };
  }

  const payload = parseJsonBody(input.rawBody);
  if (!payload) {
    return { status: "invalid_payload", reason: "body_not_valid_json" };
  }

  const eventType = text(payload.eventType) ?? text(payload.type);
  const eventId = text(payload.eventId);
  if (!eventType || !eventId) {
    return { status: "invalid_payload", reason: "missing_event_type_or_event_id" };
  }
  if (!INBOUND_MESSAGE_RECEIVED_EVENT_TYPES.has(eventType)) {
    return { status: "ignored_event_type", eventType };
  }

  const message = payload.message;
  if (!message) {
    return { status: "invalid_payload", reason: "missing_message" };
  }

  const providerAttemptId = findCorrelatableProviderAttemptId(message);
  if (!providerAttemptId) {
    return { status: "unmatched", reason: "no_correlatable_reply_reference" };
  }

  const attempt = await input.store.getAttemptByProviderAttemptId(providerAttemptId);
  if (!attempt) {
    return { status: "unmatched", reason: "no_matching_durable_attempt" };
  }

  const existingEventId = (attempt.latestReplyJson as { agentMailEventId?: unknown } | null)?.agentMailEventId;
  if (typeof existingEventId === "string" && existingEventId === eventId) {
    return { status: "already_processed", durableAttemptId: attempt.id, agentMailEventId: eventId };
  }

  const now = input.now ?? new Date();
  const rawReplyText = text(message.extractedText) ?? text(message.text) ?? "";
  const packet: VendorReplyIntakePacket = {
    attemptId: attempt.id,
    candidateId: attempt.candidateId,
    sourceKey: attempt.sourceKey,
    channel: "email",
    receivedAt: now.toISOString(),
    rawReplyText,
    fromAddressOrPhone: text(message.from),
    inboundProvider: "email_future",
  };

  const interpreted = interpretVendorReply({ packet });
  const termsResult = buildResponseTermsPacket({
    attemptId: attempt.id,
    candidateId: attempt.candidateId,
    rawReplyText,
    occurredAt: now,
  });

  const latestReplyJson = {
    ...interpreted,
    agentMailEventId: eventId,
    agentMailMessageId: text(message.messageId),
    receivedAt: now.toISOString(),
  };
  const nextStatus = interpreted.blocked ? "blocked" : "interpreted";

  await input.store.recordReplyAndTerms({
    tenantId: attempt.tenantId,
    attemptId: attempt.id,
    latestReplyJson,
    latestTermsPacketJson: termsResult.allowed ? termsResult.packet : null,
    nextStatus,
    actor: "agentmail_webhook",
    now,
  });

  return { status: "processed", durableAttemptId: attempt.id, agentMailEventId: eventId, classification: interpreted.classification };
}
