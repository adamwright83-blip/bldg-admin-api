import twilio from "twilio";

export const CLAIRE_CONVERSATION_RELAY_PATH = "/api/claire/twilio/conversation-relay";

/**
 * Trusted public origin for the WebSocket Twilio signs.
 * `CLAIRE_TWILIO_RELAY_PUBLIC_BASE_URL` is optional and unset by default.
 * When unset, the origin is the same public base Gather already uses.
 * Host and X-Forwarded-Host are never consulted.
 */
export function trustedRelayHttpBase(input: {
  publicBaseUrl: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const override = input.env?.CLAIRE_TWILIO_RELAY_PUBLIC_BASE_URL?.trim();
  return (override || input.publicBaseUrl).replace(/\/$/, "");
}

export function trustedRelayWebSocketBase(input: {
  publicBaseUrl: string;
  env?: NodeJS.ProcessEnv;
}): string {
  return trustedRelayHttpBase(input).replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
}

/** URL placed on ConversationRelay. Twilio signs this exact string. */
export function conversationRelayWebSocketUrl(input: {
  publicBaseUrl: string;
  token: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const wsBase = trustedRelayWebSocketBase(input);
  return `${wsBase}${CLAIRE_CONVERSATION_RELAY_PATH}?token=${encodeURIComponent(input.token)}`;
}

function requestTarget(requestUrl: string): string {
  const raw = requestUrl.startsWith("/") ? requestUrl : `/${requestUrl}`;
  return (raw.split("#")[0] ?? raw) || "/";
}

/**
 * Reconstruct the externally visible wss URL from the trusted origin plus the
 * upgrade request target (path and query, including the Claire token).
 * Does not read Host, X-Forwarded-Host, or X-Forwarded-Proto.
 */
export function conversationRelayValidationUrl(input: {
  requestUrl: string;
  publicBaseUrl: string;
  env?: NodeJS.ProcessEnv;
}): string {
  return `${trustedRelayWebSocketBase(input)}${requestTarget(input.requestUrl)}`;
}

export function twilioSignatureMatchesExactUrl(input: {
  authToken: string;
  signature: string;
  url: string;
}): boolean {
  return twilio.validateRequest(input.authToken, input.signature, input.url, {});
}

/**
 * Production handshake check. The signature is checked only against the
 * reconstructed wss URL. An https URL is not a fallback. The token-bearing
 * URL is not returned and must not be logged.
 */
export function validateConversationRelayUpgrade(input: {
  authToken: string;
  signature: unknown;
  requestUrl: string;
  publicBaseUrl: string;
  nodeEnv: string;
  env?: NodeJS.ProcessEnv;
  forwardedHost?: unknown;
  host?: unknown;
}): { ok: boolean } {
  void input.forwardedHost;
  void input.host;
  const missingSignature = typeof input.signature !== "string" || !input.signature;
  if (input.nodeEnv === "production" && missingSignature) return { ok: false };
  if (!input.authToken) return { ok: input.nodeEnv !== "production" };
  if (missingSignature) return { ok: false };
  const url = conversationRelayValidationUrl(input);
  if (!url.startsWith("wss://") && !url.startsWith("ws://")) return { ok: false };
  return {
    ok: twilioSignatureMatchesExactUrl({
      authToken: input.authToken,
      signature: input.signature as string,
      url,
    }),
  };
}
