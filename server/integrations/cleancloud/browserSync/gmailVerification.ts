/* LEGACY DAYFORGE COMPATIBILITY: Jawbreaker CleanCloud direct sync, Gmail verification-code reader */
import crypto from "node:crypto";
import { google } from "googleapis";
import { sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { getDb } from "../../../db";

/**
 * Reads CleanCloud login-verification codes from the operator's Gmail
 * (gmail.readonly) so the existing direct sync can finish CleanCloud's
 * email-confirmation step. Codes and tokens are never logged.
 */

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
// JOYSTICK's admin front door. Vercel forwards /api to the Railway server, and Google's OAuth client lists this URI.
export const DEFAULT_JAWBREAKER_GMAIL_REDIRECT_URI =
  "https://admin.gojoystick.com/api/integrations/jawbreaker/gmail/callback";
const STATE_TTL_SECONDS = 10 * 60;
const STATE_PURPOSE = "jawbreaker_gmail_connect";

function gmailConfig() {
  return {
    clientId: process.env.JAWBREAKER_GMAIL_CLIENT_ID?.trim() || "",
    clientSecret: process.env.JAWBREAKER_GMAIL_CLIENT_SECRET?.trim() || "",
    redirectUri:
      process.env.JAWBREAKER_GMAIL_REDIRECT_URI?.trim() || DEFAULT_JAWBREAKER_GMAIL_REDIRECT_URI,
  };
}

export function isJawbreakerGmailConfigured(): boolean {
  const c = gmailConfig();
  return Boolean(c.clientId && c.clientSecret);
}

function encryptionKey() {
  const secret = process.env.JAWBREAKER_GMAIL_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET or JAWBREAKER_GMAIL_TOKEN_ENCRYPTION_KEY is required for Gmail token storage");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptGmailToken(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(p => p.toString("base64url")).join(".");
}

export function decryptGmailToken(value: string): string {
  const [iv, tag, data] = value.split(".");
  if (!iv || !tag || !data) throw new Error("Stored Gmail token is malformed");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

let tableReady: Promise<void> | null = null;
async function ensureTable() {
  if (tableReady) return tableReady;
  tableReady = (async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS jawbreaker_gmail_connections (
      tenantId varchar(64) NOT NULL,
      encryptedRefreshToken text NOT NULL,
      connectedEmail varchar(320) NULL,
      authorizedByUserId varchar(128) NOT NULL,
      createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (tenantId)
    )`));
  })().catch(error => {
    tableReady = null;
    throw error;
  });
  return tableReady;
}

function rows<T>(result: unknown): T[] {
  const r = result as unknown;
  if (Array.isArray(r) && Array.isArray(r[0])) return r[0] as T[];
  if (Array.isArray(r)) return r as T[];
  return ((r as { rows?: T[] })?.rows ?? []) as T[];
}

async function loadConnection(tenantId: string) {
  await ensureTable();
  const db = await getDb();
  if (!db) return null;
  const result = await db.execute(sql`
    SELECT tenantId, encryptedRefreshToken, connectedEmail
    FROM jawbreaker_gmail_connections WHERE tenantId = ${tenantId} LIMIT 1`);
  return rows<{ tenantId: string; encryptedRefreshToken: string; connectedEmail: string | null }>(result)[0] ?? null;
}

/** When the tenant's Gmail connection was last (re)authorized, or null when there is none. */
export async function getJawbreakerGmailConnectedAt(tenantId: string): Promise<Date | null> {
  if (!isJawbreakerGmailConfigured()) return null;
  await ensureTable();
  const db = await getDb();
  if (!db) return null;
  const result = await db.execute(sql`
    SELECT updatedAt FROM jawbreaker_gmail_connections WHERE tenantId = ${tenantId} LIMIT 1`);
  const value = rows<{ updatedAt: Date | string | null }>(result)[0]?.updatedAt ?? null;
  if (!value) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? at : null;
}

export async function getJawbreakerGmailStatus(tenantId: string) {
  if (!isJawbreakerGmailConfigured()) return { configured: false, connected: false, connectedEmail: null };
  const row = await loadConnection(tenantId);
  return { configured: true, connected: Boolean(row), connectedEmail: row?.connectedEmail ?? null };
}

function oauthClient() {
  const c = gmailConfig();
  if (!c.clientId || !c.clientSecret) throw new Error("Jawbreaker Gmail OAuth is not configured");
  return new google.auth.OAuth2(c.clientId, c.clientSecret, c.redirectUri);
}

function stateSecret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is required for Gmail OAuth state");
  return new TextEncoder().encode(value);
}

export async function createJawbreakerGmailConnectUrl(input: { tenantId: string; userId: string }) {
  const state = await new SignJWT({
    tenantId: input.tenantId,
    userId: input.userId,
    redirectUri: gmailConfig().redirectUri,
    purpose: STATE_PURPOSE,
    nonce: crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(stateSecret());
  return {
    url: oauthClient().generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [GMAIL_SCOPE, "openid", "email"],
      state,
    }),
  };
}

/** Verifies state against the signed-in operator, then stores the encrypted refresh token. */
export async function completeJawbreakerGmailConnection(input: {
  code: string;
  state: string;
  sessionTenantId: string;
  sessionUserId: string;
}) {
  const { payload } = await jwtVerify(input.state, stateSecret());
  const p = payload as { tenantId?: string; userId?: string; redirectUri?: string; purpose?: string };
  if (p.purpose !== STATE_PURPOSE || !p.tenantId || !p.userId) throw new Error("Gmail OAuth state is invalid");
  if (p.tenantId !== input.sessionTenantId || p.userId !== input.sessionUserId)
    throw new Error("Gmail OAuth user does not match the signed-in operator");
  if (p.redirectUri !== gmailConfig().redirectUri) throw new Error("Gmail OAuth redirect mismatch");
  const client = oauthClient();
  const { tokens } = await client.getToken(input.code);
  if (!tokens.refresh_token) throw new Error("Google did not return a refresh token; reconnect and grant offline access");
  if (!String(tokens.scope ?? "").includes(GMAIL_SCOPE)) throw new Error("Gmail read access was not granted");
  client.setCredentials(tokens);
  let connectedEmail: string | null = null;
  try {
    connectedEmail = (await google.oauth2({ version: "v2", auth: client }).userinfo.get()).data.email ?? null;
  } catch {
    /* display metadata only */
  }
  await ensureTable();
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.execute(sql`
    INSERT INTO jawbreaker_gmail_connections (tenantId, encryptedRefreshToken, connectedEmail, authorizedByUserId)
    VALUES (${p.tenantId}, ${encryptGmailToken(tokens.refresh_token)}, ${connectedEmail}, ${p.userId})
    ON DUPLICATE KEY UPDATE encryptedRefreshToken = VALUES(encryptedRefreshToken),
      connectedEmail = VALUES(connectedEmail), authorizedByUserId = VALUES(authorizedByUserId)`);
  return { connected: true, connectedEmail };
}

export type GmailMessage = { id: string; internalDate: number; payload: GmailPart | undefined };
type GmailPart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPart[] | null;
  headers?: Array<{ name?: string | null; value?: string | null }> | null;
};

export type GmailReader = {
  listMessageIds(query: string): Promise<string[]>;
  getMessage(id: string): Promise<GmailMessage>;
};

/**
 * The tenant's connected Gmail as an authorised client, for reading that needs more than verification codes (Gmail
 * reply detection: users.watch and users.history, both covered by the gmail.readonly grant). Null when not connected.
 */
export async function jawbreakerGmailAuthFor(tenantId: string): Promise<{ auth: ReturnType<typeof oauthClient>; connectedEmail: string | null } | null> {
  const row = await loadConnection(tenantId);
  if (!row) return null;
  const client = oauthClient();
  client.setCredentials({ refresh_token: decryptGmailToken(row.encryptedRefreshToken) });
  return { auth: client, connectedEmail: row.connectedEmail };
}

/** Connected tenants and their accounts, for Gmail reply detection to watch. */
export async function listJawbreakerGmailConnections(): Promise<Array<{ tenantId: string; connectedEmail: string | null; updatedAt: Date | null }>> {
  if (!isJawbreakerGmailConfigured()) return [];
  const db = await getDb();
  if (!db) return [];
  await ensureTable();
  // updatedAt moves when the operator reconnects (a new refresh token is stored)
  const result = await db.execute(sql`SELECT tenantId, connectedEmail, updatedAt FROM jawbreaker_gmail_connections`);
  return rows<{ tenantId: string; connectedEmail: string | null; updatedAt: Date | string | null }>(result).map(row => ({
    tenantId: row.tenantId,
    connectedEmail: row.connectedEmail,
    updatedAt: row.updatedAt ? new Date(row.updatedAt) : null,
  }));
}

async function gmailReaderFor(tenantId: string): Promise<GmailReader | null> {
  const row = await loadConnection(tenantId);
  if (!row) return null;
  const client = oauthClient();
  client.setCredentials({ refresh_token: decryptGmailToken(row.encryptedRefreshToken) });
  const gmail = google.gmail({ version: "v1", auth: client });
  return {
    async listMessageIds(q) {
      const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 10 });
      return (res.data.messages ?? []).map(m => m.id!).filter(Boolean);
    },
    async getMessage(id) {
      const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      return { id, internalDate: Number(res.data.internalDate ?? 0), payload: res.data.payload as GmailPart };
    },
  };
}

/** Text of the original message body: text/plain preferred, HTML stripped otherwise. */
export function gmailMessageText(part: GmailPart | undefined): string {
  if (!part) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: GmailPart) => {
    const data = p.body?.data ? Buffer.from(p.body.data, "base64url").toString("utf8") : "";
    if (data && p.mimeType === "text/plain") plain.push(data);
    else if (data && p.mimeType === "text/html") html.push(data);
    for (const child of p.parts ?? []) walk(child);
  };
  walk(part);
  if (plain.length) return plain.join("\n");
  return html
    .join("\n")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ");
}

/** The six-digit code from a CleanCloud verification email, or null when ambiguous. */
export function extractCleanCloudVerificationCode(text: string): string | null {
  const near = text.match(/code[^0-9]{0,80}\b(\d{6})\b/i);
  if (near) return near[1]!;
  const all = [...new Set(text.match(/\b\d{6}\b/g) ?? [])];
  return all.length === 1 ? all[0]! : null;
}

const consumedMessageIds = new Map<string, number>();

/**
 * Waits for a CleanCloud verification email received after this login attempt
 * began, and returns its code. Messages already used are never reused.
 */
export async function waitForCleanCloudVerificationCode(input: {
  tenantId: string;
  notBefore: Date;
  timeoutMs?: number;
  pollMs?: number;
  reader?: GmailReader | null;
  sleep?: (ms: number) => Promise<void>;
}): Promise<string> {
  const reader = input.reader === undefined ? await gmailReaderFor(input.tenantId) : input.reader;
  if (!reader) throw new Error("Jawbreaker Gmail is not connected for this tenant");
  const deadline = Date.now() + (input.timeoutMs ?? 120_000);
  const sleep = input.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
  // Small clock skew allowance; anything older belongs to a previous attempt.
  const floor = input.notBefore.getTime() - 5_000;
  const query = "from:cleancloudapp.com newer_than:1d";
  while (true) {
    const candidates: GmailMessage[] = [];
    for (const id of await reader.listMessageIds(query)) {
      if (consumedMessageIds.has(id)) continue;
      const message = await reader.getMessage(id);
      if (message.internalDate >= floor) candidates.push(message);
    }
    candidates.sort((a, b) => b.internalDate - a.internalDate);
    for (const message of candidates) {
      const code = extractCleanCloudVerificationCode(gmailMessageText(message.payload));
      if (code) {
        consumedMessageIds.set(message.id, Date.now());
        return code;
      }
    }
    if (Date.now() >= deadline) throw new Error("No CleanCloud verification email arrived in time");
    await sleep(input.pollMs ?? 5_000);
  }
}

export function _resetConsumedGmailMessagesForTests() {
  consumedMessageIds.clear();
}
