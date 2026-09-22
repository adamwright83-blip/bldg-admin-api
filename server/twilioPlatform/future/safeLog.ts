import { logContainsTwilioSecret } from "../config";

const SECRET_KEYS = new Set([
  "code",
  "otp",
  "verificationCode",
  "verification_code",
  "authToken",
  "auth_token",
  "token",
  "secret",
]);

function stripSecretKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecretKeys);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) continue;
    out[key] = stripSecretKeys(child);
  }
  return out;
}

/**
 * Log line for future adapters. Verification codes and Twilio secrets
 * are removed. The auth token is never returned.
 */
export function safeFutureLog(
  payload: unknown,
  env: NodeJS.ProcessEnv = process.env,
  extrasToRedact: readonly string[] = []
): string {
  let text = JSON.stringify(stripSecretKeys(payload));
  const secrets = [
    env.TWILIO_AUTH_TOKEN,
    env.TWILIO_API_KEY_SECRET,
    env.TWILIO_API_SECRET,
    ...extrasToRedact,
  ];
  for (const secret of secrets) {
    const trimmed = secret?.trim() ?? "";
    if (trimmed.length >= 4) text = text.split(trimmed).join("[redacted]");
  }
  if (logContainsTwilioSecret(text, env)) {
    throw new Error("twilio secret remained in a future-adapter log");
  }
  return text;
}
