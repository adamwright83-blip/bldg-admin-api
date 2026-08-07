import crypto from "node:crypto";
import { google } from "googleapis";
import { sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { getDb } from "../db";

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const DEFAULT_REDIRECT_URI = "https://driver.bldg.chat/";
const STATE_TTL_SECONDS = 10 * 60;

export type GoogleCalendarConnectionStatus = {
  configured: boolean;
  connected: boolean;
  calendarId: string;
  connectedEmail: string | null;
};

type StoredConnection = {
  tenantId: string;
  userId: string;
  encryptedRefreshToken: string | null;
  encryptedAccessToken: string | null;
  expiryDate: number | null;
  calendarId: string;
  connectedEmail: string | null;
};

let tableReady: Promise<void> | null = null;

function calendarConfig() {
  return {
    clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() || "",
    clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() || "",
    redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI,
  };
}

function encryptionKey() {
  const secret = process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET or GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY is required for Google Calendar token storage");
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(value: string | null | undefined) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(part => part.toString("base64url")).join(".");
}

function decrypt(value: string | null | undefined) {
  if (!value) return null;
  const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error("Stored Google Calendar token is malformed");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function ensureTable() {
  if (tableReady) return tableReady;
  tableReady = (async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS google_calendar_connections (
      tenantId varchar(64) NOT NULL,
      userId varchar(128) NOT NULL,
      encryptedRefreshToken text NULL,
      encryptedAccessToken text NULL,
      expiryDate bigint NULL,
      calendarId varchar(255) NOT NULL DEFAULT 'primary',
      connectedEmail varchar(320) NULL,
      createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (tenantId, userId)
    )`));
  })().catch(error => {
    tableReady = null;
    throw error;
  });
  return tableReady;
}

function rowsFromExecute<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  if (Array.isArray(result)) return result as T[];
  return [];
}

async function loadConnection(tenantId: string, userId: string): Promise<StoredConnection | null> {
  await ensureTable();
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.execute(sql`
    SELECT tenantId, userId, encryptedRefreshToken, encryptedAccessToken, expiryDate, calendarId, connectedEmail
    FROM google_calendar_connections
    WHERE tenantId = ${tenantId} AND userId = ${userId}
    LIMIT 1
  `);
  return rowsFromExecute<StoredConnection>(result)[0] ?? null;
}

async function saveConnection(input: StoredConnection) {
  await ensureTable();
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.execute(sql`
    INSERT INTO google_calendar_connections
      (tenantId, userId, encryptedRefreshToken, encryptedAccessToken, expiryDate, calendarId, connectedEmail)
    VALUES
      (${input.tenantId}, ${input.userId}, ${input.encryptedRefreshToken}, ${input.encryptedAccessToken}, ${input.expiryDate}, ${input.calendarId}, ${input.connectedEmail})
    ON DUPLICATE KEY UPDATE
      encryptedRefreshToken = VALUES(encryptedRefreshToken),
      encryptedAccessToken = VALUES(encryptedAccessToken),
      expiryDate = VALUES(expiryDate),
      calendarId = VALUES(calendarId),
      connectedEmail = VALUES(connectedEmail)
  `);
}

function oauthClient() {
  const config = calendarConfig();
  if (!config.clientId || !config.clientSecret) throw new Error("Google Calendar OAuth is not configured");
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
}

function stateSecret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is required for Google Calendar OAuth state");
  return new TextEncoder().encode(value);
}

export async function getGoogleCalendarStatus(input: {
  tenantId: string;
  userId: string;
}): Promise<GoogleCalendarConnectionStatus> {
  const config = calendarConfig();
  if (!config.clientId || !config.clientSecret) {
    return { configured: false, connected: false, calendarId: "primary", connectedEmail: null };
  }
  const row = await loadConnection(input.tenantId, input.userId);
  return {
    configured: true,
    connected: Boolean(row?.encryptedRefreshToken || row?.encryptedAccessToken),
    calendarId: row?.calendarId || "primary",
    connectedEmail: row?.connectedEmail || null,
  };
}

export async function createGoogleCalendarConnectUrl(input: { tenantId: string; userId: string }) {
  const client = oauthClient();
  const config = calendarConfig();
  const state = await new SignJWT({
    tenantId: input.tenantId,
    userId: input.userId,
    redirectUri: config.redirectUri,
    purpose: "google_calendar_connect",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(stateSecret());

  return {
    url: client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [GOOGLE_CALENDAR_SCOPE, "openid", "email"],
      state,
      include_granted_scopes: true,
    }),
  };
}

export async function completeGoogleCalendarConnection(input: { code: string; state: string }) {
  const verified = await jwtVerify(input.state, stateSecret());
  const payload = verified.payload as {
    tenantId?: string;
    userId?: string;
    redirectUri?: string;
    purpose?: string;
  };
  if (payload.purpose !== "google_calendar_connect" || !payload.tenantId || !payload.userId) {
    throw new Error("Google Calendar OAuth state is invalid");
  }
  if (payload.redirectUri !== calendarConfig().redirectUri) {
    throw new Error("Google Calendar OAuth redirect mismatch");
  }

  const client = oauthClient();
  const { tokens } = await client.getToken(input.code);
  const prior = await loadConnection(payload.tenantId, payload.userId);
  const refreshToken = tokens.refresh_token || decrypt(prior?.encryptedRefreshToken);
  if (!refreshToken && !tokens.access_token) throw new Error("Google did not return a usable Calendar token");

  client.setCredentials({ ...tokens, refresh_token: refreshToken || undefined });
  let connectedEmail: string | null = prior?.connectedEmail || null;
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const me = await oauth2.userinfo.get();
    connectedEmail = me.data.email || connectedEmail;
  } catch {
    // Calendar access is the required capability. Email is only display metadata.
  }

  await saveConnection({
    tenantId: payload.tenantId,
    userId: payload.userId,
    encryptedRefreshToken: encrypt(refreshToken),
    encryptedAccessToken: encrypt(tokens.access_token),
    expiryDate: tokens.expiry_date ?? null,
    calendarId: prior?.calendarId || "primary",
    connectedEmail,
  });

  return { connected: true, connectedEmail };
}

async function authorizedCalendar(input: { tenantId: string; userId: string }) {
  const row = await loadConnection(input.tenantId, input.userId);
  if (!row) return null;
  const refreshToken = decrypt(row.encryptedRefreshToken);
  const accessToken = decrypt(row.encryptedAccessToken);
  if (!refreshToken && !accessToken) return null;

  const client = oauthClient();
  client.setCredentials({
    refresh_token: refreshToken || undefined,
    access_token: accessToken || undefined,
    expiry_date: row.expiryDate || undefined,
  });
  client.on("tokens", async tokens => {
    try {
      await saveConnection({
        ...row,
        encryptedRefreshToken: encrypt(tokens.refresh_token || refreshToken),
        encryptedAccessToken: encrypt(tokens.access_token || accessToken),
        expiryDate: tokens.expiry_date ?? row.expiryDate,
      });
    } catch (error) {
      console.warn("[GoogleCalendar] Could not persist refreshed token:", error);
    }
  });
  return { calendar: google.calendar({ version: "v3", auth: client }), row };
}

export function stableCalendarEventId(input: {
  tenantId: string;
  userId: string;
  missionId: number;
  followUpAt: Date;
}) {
  return crypto
    .createHash("sha256")
    .update(`${input.tenantId}:${input.userId}:${input.missionId}:${input.followUpAt.toISOString()}`)
    .digest("hex")
    .slice(0, 32);
}

export async function createWalkInFollowUpCalendarEvent(input: {
  tenantId: string;
  userId: string;
  missionId: number;
  missionCode: string;
  businessName: string;
  contactName?: string | null;
  contactTitle?: string | null;
  nextAction: string;
  conversationNotes: string;
  address?: string | null;
  followUpAt: Date;
  timeZone: string;
}) {
  try {
    const authorized = await authorizedCalendar({ tenantId: input.tenantId, userId: input.userId });
    if (!authorized) return { status: "not_connected" as const, eventId: null as string | null, htmlLink: null as string | null };

    const eventId = stableCalendarEventId(input);
    const end = new Date(input.followUpAt.getTime() + 15 * 60_000);
    const who = input.contactName
      ? `${input.contactName}${input.contactTitle ? ` (${input.contactTitle})` : ""}`
      : "Contact not captured";
    const description = [
      input.nextAction,
      "",
      `Contact: ${who}`,
      `Visit notes: ${input.conversationNotes}`,
      `DayForge mission: ${input.missionCode}`,
      `Admin: https://admin.bldg.chat/commercial-missions?mission=${input.missionId}`,
    ].join("\n");

    try {
      const created = await authorized.calendar.events.insert({
        calendarId: authorized.row.calendarId || "primary",
        requestBody: {
          id: eventId,
          summary: `FOLLOW UP — ${input.contactName ? `${input.contactName} @ ` : ""}${input.businessName}`,
          description,
          location: input.address || undefined,
          start: { dateTime: input.followUpAt.toISOString(), timeZone: input.timeZone },
          end: { dateTime: end.toISOString(), timeZone: input.timeZone },
          reminders: {
            useDefault: false,
            overrides: [
              { method: "popup", minutes: 10 },
              { method: "popup", minutes: 0 },
            ],
          },
        },
      });
      return { status: "created" as const, eventId: created.data.id || eventId, htmlLink: created.data.htmlLink || null };
    } catch (error: any) {
      if (error?.code === 409 || error?.response?.status === 409) {
        const existing = await authorized.calendar.events.get({
          calendarId: authorized.row.calendarId || "primary",
          eventId,
        });
        return { status: "already_exists" as const, eventId, htmlLink: existing.data.htmlLink || null };
      }
      throw error;
    }
  } catch (error) {
    console.warn("[GoogleCalendar] Follow-up event failed without blocking walk-in:", error);
    return { status: "failed" as const, eventId: null as string | null, htmlLink: null as string | null };
  }
}
