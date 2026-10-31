import crypto from "node:crypto";

/**
 * A controlled preview of the first ten minutes. While JOYSTICK_FIRST_TEN_MINUTES is `preview`, the server answers only
 * browsers holding a preview pass: an httpOnly cookie it issues to whoever opens /joystick-start?crew=<code> with the
 * right JOYSTICK_FIRST_TEN_PREVIEW_CODE. The `?crew` link is no longer just a UI switch; without a pass every
 * first-ten procedure and the OAuth callbacks refuse. Without a configured code (at least 16 characters), preview is
 * closed to everyone. Changing the code revokes every pass already issued.
 */
export const FIRST_TEN_PREVIEW_COOKIE = "joystick_first_ten_preview";
const PASS_DAYS = 14;
const MIN_CODE_LENGTH = 16;

function previewCode(env: NodeJS.ProcessEnv): string | null {
  const code = env.JOYSTICK_FIRST_TEN_PREVIEW_CODE?.trim() ?? "";
  return code.length >= MIN_CODE_LENGTH ? code : null;
}

function signingKey(env: NodeJS.ProcessEnv): string | null {
  return env.JWT_SECRET?.trim() || null;
}

const digest = (value: string) => crypto.createHash("sha256").update(value).digest();
/** which code a pass was issued under: a new code makes every older pass invalid */
const codeVersion = (code: string) => digest(`first-ten-preview-code:${code}`).toString("hex").slice(0, 16);
const mac = (key: string, payload: string) => crypto.createHmac("sha256", key).update(`first-ten-preview:${payload}`).digest("base64url");

/** Whether `given` is the configured code (constant-time). */
export function previewCodeMatches(given: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const code = previewCode(env);
  if (!code || !given) return false;
  return crypto.timingSafeEqual(digest(given), digest(code));
}

/** A pass for this browser, or null when preview can't be granted (no code, no signing key). */
export function issuePreviewPass(env: NodeJS.ProcessEnv = process.env, now = new Date()): { value: string; maxAgeMs: number } | null {
  const code = previewCode(env);
  const key = signingKey(env);
  if (!code || !key) return null;
  const maxAgeMs = PASS_DAYS * 86_400_000;
  const payload = `${now.getTime() + maxAgeMs}.${codeVersion(code)}`;
  return { value: `${payload}.${mac(key, payload)}`, maxAgeMs };
}

export function verifyPreviewPass(value: string | undefined, env: NodeJS.ProcessEnv = process.env, now = new Date()): boolean {
  const code = previewCode(env);
  const key = signingKey(env);
  if (!code || !key || !value) return false;
  const [expires, version, signature] = value.split(".");
  if (!expires || !version || !signature) return false;
  const expected = Buffer.from(mac(key, `${expires}.${version}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return false;
  return version === codeVersion(code) && Number(expires) > now.getTime();
}

/** The preview pass in a request's Cookie header, verified. */
export function requestHasPreviewPass(cookieHeader: string | undefined, env: NodeJS.ProcessEnv = process.env, now = new Date()): boolean {
  const raw = (cookieHeader ?? "")
    .split(";")
    .map(part => part.trim())
    .find(part => part.startsWith(`${FIRST_TEN_PREVIEW_COOKIE}=`));
  return verifyPreviewPass(raw ? decodeURIComponent(raw.slice(FIRST_TEN_PREVIEW_COOKIE.length + 1)) : undefined, env, now);
}
