/**
 * First-party fatal report. Customer UI gets a short notice and an optional
 * correlation id. Logs get a sanitized name, message, and stack only.
 */

const CORRELATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BEARER = /\bBearer\s+\S+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const SECRET_QUERY =
  /([?&#](?:access_token|refresh_token|id_token|token|secret|password|phone|email|authorization|api_key|apikey)=)[^&#\s]*/gi;
const LABELED_SECRET =
  /("?(?:phone|email|token|secret|password|authorization|messageBody|smsBody|body)"?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/g;
const VENDOR_KEY = /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+\b/g;

export type ClientFatalLogRecord = {
  correlationId: string;
  name: string;
  message: string;
  stack?: string;
};

export function createFatalCorrelationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "00000000-0000-4000-8000-000000000000";
}

export function isFatalCorrelationId(value: string): boolean {
  return CORRELATION_ID.test(value);
}

/** Strip tokens, message bodies, phone numbers, emails, and vendor secrets. */
export function sanitizeFatalText(value: string, maxLength: number): string {
  const cleaned = value
    .replace(BEARER, "Bearer [redacted]")
    .replace(JWT, "[redacted]")
    .replace(SECRET_QUERY, "$1[redacted]")
    .replace(LABELED_SECRET, "$1[redacted]")
    .replace(EMAIL, "[redacted]")
    .replace(PHONE, "[redacted]")
    .replace(VENDOR_KEY, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxLength);
}

export function customerFatalNotice(correlationId: string | null): {
  headline: string;
  recovery: string;
  correlationId: string | null;
} {
  return {
    headline: "Something went wrong.",
    recovery: "Reload to try again.",
    correlationId:
      correlationId && isFatalCorrelationId(correlationId) ? correlationId : null,
  };
}

export function fatalLogRecordFromError(
  error: unknown,
  correlationId: string
): ClientFatalLogRecord | null {
  if (!isFatalCorrelationId(correlationId)) return null;
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : "Unknown failure";
  const stack = error instanceof Error ? error.stack : undefined;
  const record: ClientFatalLogRecord = {
    correlationId,
    name: sanitizeFatalText(name, 80) || "Error",
    message: sanitizeFatalText(message, 400) || "Failure",
  };
  if (stack) record.stack = sanitizeFatalText(stack, 1500);
  return record;
}
