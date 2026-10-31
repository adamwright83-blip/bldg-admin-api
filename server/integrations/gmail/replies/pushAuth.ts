import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Who may deliver Gmail change notifications: only Google Cloud Pub/Sub, pushing for JOYSTICK's own subscription.
 * The subscription is configured with authentication on (Duet step F), so every push carries a Google-signed OIDC
 * token. It is accepted only when Google's signature verifies, the issuer is Google, the audience is the configured
 * push URL, and the token was minted for the configured push service account with a verified email.
 *
 * Config (Railway, bldg-admin-api):
 *   GMAIL_PUSH_AUDIENCE         the subscription's audience, e.g. https://admin.bldg.chat/api/integrations/gmail/push
 *   GMAIL_PUSH_SERVICE_ACCOUNT  joystick-gmail-push@gen-lang-client-0159109182.iam.gserviceaccount.com
 * Without both, every push is refused: an unauthenticated mailbox-change endpoint is never open.
 */
export type PushAuthConfig = { audience: string; serviceAccount: string };

export function pushAuthConfig(env: NodeJS.ProcessEnv = process.env): PushAuthConfig | null {
  const audience = env.GMAIL_PUSH_AUDIENCE?.trim() ?? "";
  const serviceAccount = env.GMAIL_PUSH_SERVICE_ACCOUNT?.trim().toLowerCase() ?? "";
  return audience && serviceAccount ? { audience, serviceAccount } : null;
}

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
let googleKeys: JWTVerifyGetKey | null = null;
const defaultKeys = () => (googleKeys ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")));

export type PushAuthResult = { ok: true; subject: string } | { ok: false; reason: string };

/** Verifies the push's Authorization header. Never throws; the reason is for logs, never secret. */
export async function verifyPushAuthorization(
  header: string | undefined,
  config: PushAuthConfig | null,
  keys: JWTVerifyGetKey = defaultKeys()
): Promise<PushAuthResult> {
  if (!config) return { ok: false, reason: "push authentication is not configured" };
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return { ok: false, reason: "no bearer token" };
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: GOOGLE_ISSUERS, audience: config.audience, algorithms: ["RS256"] });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    if (email !== config.serviceAccount) return { ok: false, reason: "token is not from the push service account" };
    if (payload.email_verified !== true) return { ok: false, reason: "service account email is not verified" };
    return { ok: true, subject: String(payload.sub ?? email) };
  } catch (error) {
    return { ok: false, reason: `token rejected: ${error instanceof Error ? error.name : "invalid"}` };
  }
}

/** One Gmail change notification, as Pub/Sub delivers it. It says a mailbox changed, nothing about what. */
export type GmailPushNotice = { pubsubMessageId: string; emailAddress: string; historyId: string; publishTime: string | null };

/** Parses a Pub/Sub push body; null when it isn't a well-formed Gmail notification (it is acknowledged and dropped). */
export function parseGmailPush(body: unknown): GmailPushNotice | null {
  const message = (body as { message?: { data?: unknown; messageId?: unknown; message_id?: unknown; publishTime?: unknown } } | null)?.message;
  const id = typeof message?.messageId === "string" ? message.messageId : typeof message?.message_id === "string" ? message.message_id : null;
  if (!message || !id || typeof message.data !== "string") return null;
  try {
    const data = JSON.parse(Buffer.from(message.data, "base64").toString("utf8")) as { emailAddress?: unknown; historyId?: unknown };
    const emailAddress = typeof data.emailAddress === "string" ? data.emailAddress.trim().toLowerCase() : "";
    const historyId = typeof data.historyId === "number" || typeof data.historyId === "string" ? String(data.historyId) : "";
    if (!emailAddress.includes("@") || !/^\d{1,20}$/.test(historyId)) return null;
    return { pubsubMessageId: id, emailAddress, historyId, publishTime: typeof message.publishTime === "string" ? message.publishTime : null };
  } catch {
    return null;
  }
}
