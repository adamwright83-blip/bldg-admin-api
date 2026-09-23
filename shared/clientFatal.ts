/**
 * First-party fatal report. Customer UI gets a short notice and an optional
 * correlation id. Logs get a sanitized name, message, and stack only.
 */

const CORRELATION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BEARER = /\bBearer\s+\S+/gi;
const BASIC = /\bBasic\s+\S+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const SECRET_QUERY =
  /([?&#](?:access_token|refresh_token|id_token|token|secret|password|phone|email|authorization|api_key|apikey)=)[^&#\s]*/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?\d[\d\s().-]{8,}\d|\b\d{3}-\d{4}\b)/g;
const VENDOR_KEY = /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]+\b/g;
const LABELED_KEY =
  "phone|email|token|secret|password|authorization|messageBody|smsBody|body|api_key|apikey|cookie";

export type ClientFatalLogRecord = {
  correlationId: string;
  name: string;
  message: string;
  stack?: string;
};

function fallbackFatalCorrelationId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createFatalCorrelationId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      const id = crypto.randomUUID();
      if (isFatalCorrelationId(id)) return id;
    }
  } catch {
    // randomUUID is missing or refused outside a secure context.
  }
  return fallbackFatalCorrelationId();
}

export function isFatalCorrelationId(value: string): boolean {
  return CORRELATION_ID.test(value);
}

function replaceCopy(value: string, pattern: RegExp, replacement: string): string {
  return value.replace(new RegExp(pattern.source, pattern.flags), replacement);
}

/**
 * Redact a labeled secret through the end of its value. Unquoted values take
 * the rest of the line. An empty value also takes the following line, which
 * is where a wrapped message body would otherwise survive.
 */
function redactLabeledSecrets(value: string): string {
  const label = new RegExp(
    `((?:^|[^A-Za-z0-9_])"?(?:${LABELED_KEY})"?\\s*[:=]\\s*)`,
    "gi"
  );
  const lines = value.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let cursor = 0;
    let rebuilt = "";
    let consumeNext = false;
    label.lastIndex = 0;
    for (const match of line.matchAll(label)) {
      const start = match.index ?? 0;
      if (start < cursor) continue;
      rebuilt += line.slice(cursor, start);
      const after = line.slice(start + match[0].length);
      const quoted = /^("[^"]*"|'[^']*')/.exec(after);
      if (quoted) {
        rebuilt += `${match[1]}[redacted]`;
        cursor = start + match[0].length + quoted[0].length;
        continue;
      }
      rebuilt += `${match[1]}[redacted]`;
      cursor = line.length;
      consumeNext = after.trim() === "";
      break;
    }
    rebuilt += line.slice(cursor);
    lines[i] = rebuilt;
    if (consumeNext && i + 1 < lines.length) {
      lines[i + 1] = "[redacted]";
      i += 1;
    }
  }
  return lines.join("\n");
}

const TOKEN_REPLACEMENTS: Array<[RegExp, string]> = [
  [BEARER, "Bearer [redacted]"],
  [BASIC, "Basic [redacted]"],
  [JWT, "[redacted]"],
  [SECRET_QUERY, "$1[redacted]"],
  [EMAIL, "[redacted]"],
  [PHONE, "[redacted]"],
  [VENDOR_KEY, "[redacted]"],
];

/** Strip tokens, message bodies, phone numbers, emails, and vendor secrets. */
export function sanitizeFatalText(value: string, maxLength: number): string {
  const stripped = TOKEN_REPLACEMENTS.reduce(
    (text, [pattern, replacement]) => replaceCopy(text, pattern, replacement),
    value
  );
  const cleaned = redactLabeledSecrets(stripped)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, Math.max(0, maxLength));
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
  if (stack) {
    const cleanedStack = sanitizeFatalText(stack, 1500);
    if (cleanedStack) record.stack = cleanedStack;
  }
  return record;
}
