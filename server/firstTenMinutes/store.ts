import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import {
  grantedGoogleProducts,
  type ConnectionProvider,
  type ConnectionView,
  type JourneyKind,
  type JourneyStage,
} from "../../shared/firstTenMinutes";
import { firstTenConnections, firstTenJourneys } from "./schema";
import { decryptConnectionToken, encryptConnectionToken } from "./tokens";

export type JourneyRow = typeof firstTenJourneys.$inferSelect;
export type ConnectionRow = typeof firstTenConnections.$inferSelect;

export async function firstTenDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

/** One journey per signup draft. Creating it twice for the same draft returns the first. */
export async function createJourney(input: { acquisitionSessionId: string; kind: JourneyKind }): Promise<JourneyRow> {
  const db = await firstTenDb();
  try {
    await db.insert(firstTenJourneys).values({
      id: randomUUID(),
      acquisitionSessionId: input.acquisitionSessionId,
      kind: input.kind,
      stage: "connect",
      version: 1,
    });
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
  }
  const row = await journeyBySession(input.acquisitionSessionId);
  if (!row) throw new Error("Journey was not saved");
  return row;
}

export async function journeyBySession(acquisitionSessionId: string): Promise<JourneyRow | null> {
  const db = await firstTenDb();
  const [row] = await db
    .select()
    .from(firstTenJourneys)
    .where(eq(firstTenJourneys.acquisitionSessionId, acquisitionSessionId))
    .limit(1);
  return row ?? null;
}

export async function journeyById(id: string): Promise<JourneyRow | null> {
  const db = await firstTenDb();
  const [row] = await db.select().from(firstTenJourneys).where(eq(firstTenJourneys.id, id)).limit(1);
  return row ?? null;
}

export async function setJourneyStage(journeyId: string, stage: JourneyStage): Promise<void> {
  const db = await firstTenDb();
  const current = await journeyById(journeyId);
  if (!current || current.stage === stage) return;
  await db
    .update(firstTenJourneys)
    .set({ stage, version: current.version + 1 })
    .where(eq(firstTenJourneys.id, journeyId));
}

export async function saveConnection(input: {
  journeyId: string;
  provider: ConnectionProvider;
  accountLabel: string | null;
  accountSubject: string | null;
  grantedScopes: readonly string[];
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: Date | null;
}): Promise<void> {
  const db = await firstTenDb();
  const values = {
    accountLabel: input.accountLabel,
    accountSubject: input.accountSubject,
    grantedScopes: input.grantedScopes.join(" "),
    encryptedAccessToken: encryptConnectionToken(input.accessToken),
    // Google only sends a refresh token on a fresh consent; a reconnect without one keeps nothing stale.
    encryptedRefreshToken: input.refreshToken ? encryptConnectionToken(input.refreshToken) : null,
    accessExpiresAt: input.accessExpiresAt,
    status: "connected" as const,
  };
  await db
    .insert(firstTenConnections)
    .values({ id: randomUUID(), journeyId: input.journeyId, provider: input.provider, ...values })
    .onDuplicateKeyUpdate({ set: values });
}

export async function connectionRows(journeyId: string): Promise<ConnectionRow[]> {
  const db = await firstTenDb();
  return db.select().from(firstTenConnections).where(eq(firstTenConnections.journeyId, journeyId));
}

export function connectionView(row: ConnectionRow): ConnectionView {
  const scopes = row.grantedScopes.split(/\s+/).filter(Boolean);
  return {
    provider: row.provider,
    account: row.accountLabel,
    connectedAt: row.updatedAt.toISOString(),
    products: row.provider === "google" ? grantedGoogleProducts(scopes) : [],
  };
}

/** Decrypted tokens for a live connection, for the readers. Never leaves the server. */
export async function connectionSecrets(journeyId: string, provider: ConnectionProvider) {
  const db = await firstTenDb();
  const [row] = await db
    .select()
    .from(firstTenConnections)
    .where(and(eq(firstTenConnections.journeyId, journeyId), eq(firstTenConnections.provider, provider)))
    .limit(1);
  if (!row || row.status !== "connected" || !row.encryptedAccessToken) return null;
  return {
    row,
    accessToken: decryptConnectionToken(row.encryptedAccessToken),
    refreshToken: row.encryptedRefreshToken ? decryptConnectionToken(row.encryptedRefreshToken) : null,
    accessExpiresAt: row.accessExpiresAt,
    grantedScopes: row.grantedScopes.split(/\s+/).filter(Boolean),
  };
}

export async function updateAccessToken(input: {
  journeyId: string;
  provider: ConnectionProvider;
  accessToken: string;
  accessExpiresAt: Date | null;
}): Promise<void> {
  const db = await firstTenDb();
  await db
    .update(firstTenConnections)
    .set({ encryptedAccessToken: encryptConnectionToken(input.accessToken), accessExpiresAt: input.accessExpiresAt })
    .where(and(eq(firstTenConnections.journeyId, input.journeyId), eq(firstTenConnections.provider, input.provider)));
}

/** JOYSTICK's copy of the access is deleted, whether or not the provider confirmed the revoke. */
export async function forgetConnection(journeyId: string, provider: ConnectionProvider): Promise<void> {
  const db = await firstTenDb();
  await db
    .update(firstTenConnections)
    .set({ encryptedAccessToken: null, encryptedRefreshToken: null, accessExpiresAt: null, status: "disconnected" })
    .where(and(eq(firstTenConnections.journeyId, journeyId), eq(firstTenConnections.provider, provider)));
}
