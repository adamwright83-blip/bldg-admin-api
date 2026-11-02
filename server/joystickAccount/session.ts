import crypto from "node:crypto";

/**
 * A JOYSTICK account's two credentials, both HMAC-signed with JWT_SECRET and both revoked by raising the account's
 * `session_version` (sign-out):
 *
 *   the account cookie   `joystick_account`, httpOnly, host-only, 30 days: who is signed in on this browser. It reaches
 *                        nothing but the person's own first-ten journeys; it is never a workspace session. It also
 *                        carries the crew code version that admitted the account in `preview` (flag.ts).
 *   a journey token      what the first-ten pages hold as a journey's resume token on this browser:
 *                        acct_<account id>_<version>_<hex mac over the journey's draft id>. Derived, so the same
 *                        journey opens on every device the person signs in on, and no device's token replaces another's.
 */
export const ACCOUNT_COOKIE = "joystick_account";
export const ACCOUNT_COOKIE_DAYS = 30;

function key(env: NodeJS.ProcessEnv): string | null {
  return env.JWT_SECRET?.trim() || null;
}

const hmac = (secret: string, payload: string) => crypto.createHmac("sha256", secret).update(payload);
const equal = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export type AccountCookie = { accountId: string; version: number; previewVersion?: string | null };

export function issueAccountCookie(account: AccountCookie, env: NodeJS.ProcessEnv = process.env, now = new Date()): { value: string; maxAgeMs: number } | null {
  const secret = key(env);
  if (!secret) return null;
  const maxAgeMs = ACCOUNT_COOKIE_DAYS * 86_400_000;
  const payload = `${account.accountId}.${account.version}.${account.previewVersion || "-"}.${now.getTime() + maxAgeMs}`;
  return { value: `${payload}.${hmac(secret, `joystick-account:${payload}`).digest("base64url")}`, maxAgeMs };
}

/** The signed cookie's claims, if its signature and expiry hold. Whether the version is still current needs the row. */
export function readAccountCookie(value: string | undefined, env: NodeJS.ProcessEnv = process.env, now = new Date()): Required<AccountCookie> | null {
  const secret = key(env);
  if (!secret || !value) return null;
  const parts = value.split(".");
  if (parts.length !== 5) return null;
  const [accountId, version, preview, expires, signature] = parts;
  if (!/^[0-9a-f-]{36}$/.test(accountId) || !/^\d{1,9}$/.test(version) || !/^([0-9a-f]{16}|-)$/.test(preview) || !/^\d{1,15}$/.test(expires)) return null;
  if (!equal(signature, hmac(secret, `joystick-account:${accountId}.${version}.${preview}.${expires}`).digest("base64url"))) return null;
  if (Number(expires) <= now.getTime()) return null;
  return { accountId, version: Number(version), previewVersion: preview === "-" ? null : preview };
}

/** The account cookie in a request's Cookie header, if signed and unexpired. */
export function accountCookieFrom(cookieHeader: string | undefined, env: NodeJS.ProcessEnv = process.env, now = new Date()): AccountCookie | null {
  const raw = (cookieHeader ?? "")
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${ACCOUNT_COOKIE}=`));
  return readAccountCookie(raw ? decodeURIComponent(raw.slice(ACCOUNT_COOKIE.length + 1)) : undefined, env, now);
}

const JOURNEY_TOKEN = /^acct_([0-9a-f-]{36})_(\d{1,9})_([0-9a-f]{64})$/;

export function journeyToken(input: { accountId: string; version: number; sessionId: string }, env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = key(env);
  if (!secret) return null;
  const mac = hmac(secret, `joystick-account-journey:${input.sessionId}:${input.accountId}:${input.version}`).digest("hex");
  return `acct_${input.accountId}_${input.version}_${mac}`;
}

export function isJourneyToken(token: string): boolean {
  return JOURNEY_TOKEN.test(token);
}

/** The account a journey token was issued to, if it was issued for this draft. Whether that version is current needs the row. */
export function readJourneyToken(token: string, sessionId: string, env: NodeJS.ProcessEnv = process.env): AccountCookie | null {
  const match = JOURNEY_TOKEN.exec(token);
  const secret = key(env);
  if (!match || !secret) return null;
  const [, accountId, version] = match;
  const expected = journeyToken({ accountId, version: Number(version), sessionId }, env);
  return expected && equal(expected, token) ? { accountId, version: Number(version) } : null;
}
