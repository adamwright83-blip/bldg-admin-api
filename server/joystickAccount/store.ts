import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import { firstTenJourneys } from "../firstTenMinutes/schema";
import { joystickAccountJourneys, joystickAccounts, type AccountRow, type FunnelStep } from "./schema";

async function accountDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

export type GoogleIdentity = { subject: string; email: string; name: string | null; givenName: string | null };

export async function accountById(id: string): Promise<AccountRow | null> {
  const db = await accountDb();
  const [row] = await db.select().from(joystickAccounts).where(eq(joystickAccounts.id, id)).limit(1);
  return row ?? null;
}

export async function accountByGoogleSub(sub: string): Promise<AccountRow | null> {
  const db = await accountDb();
  const [row] = await db.select().from(joystickAccounts).where(eq(joystickAccounts.googleSub, sub)).limit(1);
  return row ?? null;
}

/**
 * The account for this Google identity: created on first sign-in, otherwise refreshed (Google's email and name win, as
 * they're what the person sees at Google). `created` says which.
 */
export async function signInAccount(identity: GoogleIdentity, now = new Date()): Promise<{ account: AccountRow; created: boolean }> {
  const db = await accountDb();
  const existing = await accountByGoogleSub(identity.subject);
  if (existing) {
    await db
      .update(joystickAccounts)
      .set({ email: identity.email, name: identity.name, givenName: identity.givenName, lastSignedInAt: now })
      .where(eq(joystickAccounts.id, existing.id));
    return { account: { ...existing, email: identity.email, name: identity.name, givenName: identity.givenName, lastSignedInAt: now }, created: false };
  }
  const id = randomUUID();
  try {
    await db.insert(joystickAccounts).values({
      id,
      googleSub: identity.subject,
      email: identity.email,
      name: identity.name,
      givenName: identity.givenName,
      signedUpAt: now,
      lastSignedInAt: now,
    });
  } catch (error) {
    // the same Google account signing up twice at once: the first insert wins, the second signs in to it
    if (!isMysqlDuplicateKeyError(error)) throw error;
    const raced = await accountByGoogleSub(identity.subject);
    if (!raced) throw error;
    return { account: raced, created: false };
  }
  return { account: (await accountById(id))!, created: true };
}

/** Sign-out everywhere: every cookie and journey token issued before this stops working. */
export async function revokeAccountSessions(accountId: string): Promise<void> {
  const db = await accountDb();
  await db.update(joystickAccounts).set({ sessionVersion: sql`${joystickAccounts.sessionVersion} + 1` }).where(eq(joystickAccounts.id, accountId));
}

export async function linkJourney(input: { accountId: string; journeyId: string; acquisitionSessionId: string }, now = new Date()): Promise<void> {
  const db = await accountDb();
  try {
    await db.insert(joystickAccountJourneys).values({ ...input, createdAt: now });
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
  }
}

/** The account's latest own journey and its draft, if it has one. */
export async function latestJourneyFor(accountId: string) {
  const db = await accountDb();
  const [row] = await db
    .select({ journey: firstTenJourneys, acquisitionSessionId: joystickAccountJourneys.acquisitionSessionId })
    .from(joystickAccountJourneys)
    .innerJoin(firstTenJourneys, eq(firstTenJourneys.id, joystickAccountJourneys.journeyId))
    .where(and(eq(joystickAccountJourneys.accountId, accountId), eq(firstTenJourneys.kind, "own")))
    .orderBy(desc(joystickAccountJourneys.createdAt))
    .limit(1);
  return row ?? null;
}

/** The account a journey belongs to, if any. */
export async function accountForJourney(journeyId: string): Promise<AccountRow | null> {
  const db = await accountDb();
  const [row] = await db
    .select({ account: joystickAccounts })
    .from(joystickAccountJourneys)
    .innerJoin(joystickAccounts, eq(joystickAccounts.id, joystickAccountJourneys.accountId))
    .where(eq(joystickAccountJourneys.journeyId, journeyId))
    .limit(1);
  return row?.account ?? null;
}

/** Whether this draft's journey belongs to this account. */
export async function accountOwnsDraft(accountId: string, acquisitionSessionId: string): Promise<boolean> {
  const db = await accountDb();
  const [row] = await db
    .select({ journeyId: joystickAccountJourneys.journeyId })
    .from(joystickAccountJourneys)
    .where(and(eq(joystickAccountJourneys.accountId, accountId), eq(joystickAccountJourneys.acquisitionSessionId, acquisitionSessionId)))
    .limit(1);
  return Boolean(row);
}

/**
 * The sign-up funnel: the first time a journey's account reached a step. A journey with no account (the crew link,
 * the example) records nothing. Never throws into the caller.
 */
export async function markFunnelStep(journeyId: string, step: FunnelStep, now = new Date()): Promise<void> {
  try {
    const db = await accountDb();
    const [link] = await db.select({ accountId: joystickAccountJourneys.accountId }).from(joystickAccountJourneys).where(eq(joystickAccountJourneys.journeyId, journeyId)).limit(1);
    if (!link) return;
    await db
      .update(joystickAccounts)
      .set({ [step]: now })
      .where(and(eq(joystickAccounts.id, link.accountId), isNull(joystickAccounts[step])));
  } catch (error) {
    console.warn("[Account] funnel step not recorded:", step, error instanceof Error ? error.name : "unknown");
  }
}
