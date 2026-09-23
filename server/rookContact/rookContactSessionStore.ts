/**
 * Factual CONTACT sessions. Not a second call-state machine.
 * scripts/migrate.mjs creates the table. Phone numbers are not stored.
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { goldlineRookContactSessions } from "../../drizzle/schema";
import {
  ROOK_CONTACT_CAPABILITY_ID,
  ROOK_CONTACT_SESSION_STATUSES,
  ROOK_OUTREACH_DRAFTING_CAPABILITY_ID,
  type RookContactEvidenceRef,
  type RookContactSessionStatus,
} from "../../shared/rookContact";
import { getDb } from "../db";
import { isMysqlMissingTableError } from "../mysqlErrors";

export type RookContactSession = {
  contactSessionId: string;
  tenantId: string;
  operatorId: string;
  accountId: number;
  contactId: number;
  capabilityId: typeof ROOK_CONTACT_CAPABILITY_ID;
  implementationCapabilityId: typeof ROOK_OUTREACH_DRAFTING_CAPABILITY_ID;
  evidenceRefs: RookContactEvidenceRef[];
  operatorAuthorizedAt: Date | null;
  callAttemptId: number | null;
  status: RookContactSessionStatus;
  createdAt: Date;
  updatedAt: Date;
};

function asStatus(value: string): RookContactSessionStatus | null {
  return (ROOK_CONTACT_SESSION_STATUSES as readonly string[]).includes(value)
    ? (value as RookContactSessionStatus)
    : null;
}

function asEvidence(value: unknown): RookContactEvidenceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const source = (item as { source?: unknown }).source;
    const id = (item as { id?: unknown }).id;
    if ((source === "commercial_account" || source === "commercial_account_contact") && typeof id === "string") {
      return [{ source, id }];
    }
    return [];
  });
}

function toSession(row: {
  contactSessionId: string;
  tenantId: string;
  operatorId: string;
  accountId: number;
  contactId: number;
  capabilityId: string;
  implementationCapabilityId: string;
  evidenceRefsJson: unknown;
  operatorAuthorizedAt: Date | null;
  callAttemptId: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): RookContactSession | null {
  const status = asStatus(row.status);
  if (!status) return null;
  if (row.capabilityId !== ROOK_CONTACT_CAPABILITY_ID) return null;
  if (row.implementationCapabilityId !== ROOK_OUTREACH_DRAFTING_CAPABILITY_ID) return null;
  return {
    contactSessionId: row.contactSessionId,
    tenantId: row.tenantId,
    operatorId: row.operatorId,
    accountId: row.accountId,
    contactId: row.contactId,
    capabilityId: ROOK_CONTACT_CAPABILITY_ID,
    implementationCapabilityId: ROOK_OUTREACH_DRAFTING_CAPABILITY_ID,
    evidenceRefs: asEvidence(row.evidenceRefsJson),
    operatorAuthorizedAt: row.operatorAuthorizedAt,
    callAttemptId: row.callAttemptId,
    status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

export async function findRookContactSession(input: {
  tenantId: string;
  operatorId: string;
  contactSessionId: string;
}): Promise<RookContactSession | null> {
  const db = await requireDb();
  try {
    const [row] = await db
      .select()
      .from(goldlineRookContactSessions)
      .where(
        and(
          eq(goldlineRookContactSessions.contactSessionId, input.contactSessionId),
          eq(goldlineRookContactSessions.tenantId, input.tenantId),
          eq(goldlineRookContactSessions.operatorId, input.operatorId)
        )
      )
      .limit(1);
    if (!row) return null;
    if (row.tenantId !== input.tenantId || row.operatorId !== input.operatorId) return null;
    return toSession(row);
  } catch (error) {
    if (isMysqlMissingTableError(error)) return null;
    throw error;
  }
}

export async function insertPreparedRookContactSession(input: {
  tenantId: string;
  operatorId: string;
  accountId: number;
  contactId: number;
  evidenceRefs: RookContactEvidenceRef[];
  at: Date;
}): Promise<RookContactSession> {
  const db = await requireDb();
  const contactSessionId = randomUUID();
  await db.insert(goldlineRookContactSessions).values({
    contactSessionId,
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    accountId: input.accountId,
    contactId: input.contactId,
    capabilityId: ROOK_CONTACT_CAPABILITY_ID,
    implementationCapabilityId: ROOK_OUTREACH_DRAFTING_CAPABILITY_ID,
    evidenceRefsJson: input.evidenceRefs,
    operatorAuthorizedAt: null,
    callAttemptId: null,
    status: "prepared",
    createdAt: input.at,
    updatedAt: input.at,
  });
  const stored = await findRookContactSession({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    contactSessionId,
  });
  if (!stored) throw new Error("CONTACT session was not stored");
  return stored;
}

export async function markRookContactSessionAuthorized(input: {
  tenantId: string;
  operatorId: string;
  contactSessionId: string;
  contactId: number;
  at: Date;
}): Promise<void> {
  const db = await requireDb();
  await db
    .update(goldlineRookContactSessions)
    .set({
      status: "authorized",
      operatorAuthorizedAt: input.at,
      updatedAt: input.at,
    })
    .where(
      and(
        eq(goldlineRookContactSessions.contactSessionId, input.contactSessionId),
        eq(goldlineRookContactSessions.tenantId, input.tenantId),
        eq(goldlineRookContactSessions.operatorId, input.operatorId),
        eq(goldlineRookContactSessions.contactId, input.contactId),
        eq(goldlineRookContactSessions.status, "prepared")
      )
    );
}

export async function markRookContactSessionDialing(input: {
  tenantId: string;
  operatorId: string;
  contactSessionId: string;
  callAttemptId: number;
  at: Date;
}): Promise<void> {
  const db = await requireDb();
  await db
    .update(goldlineRookContactSessions)
    .set({
      status: "dialing_operator",
      callAttemptId: input.callAttemptId,
      updatedAt: input.at,
    })
    .where(
      and(
        eq(goldlineRookContactSessions.contactSessionId, input.contactSessionId),
        eq(goldlineRookContactSessions.tenantId, input.tenantId),
        eq(goldlineRookContactSessions.operatorId, input.operatorId),
        eq(goldlineRookContactSessions.status, "authorized")
      )
    );
}

export async function markRookContactSessionFailed(input: {
  tenantId: string;
  operatorId: string;
  contactSessionId: string;
  at: Date;
}): Promise<void> {
  const db = await requireDb();
  await db
    .update(goldlineRookContactSessions)
    .set({ status: "failed", updatedAt: input.at })
    .where(
      and(
        eq(goldlineRookContactSessions.contactSessionId, input.contactSessionId),
        eq(goldlineRookContactSessions.tenantId, input.tenantId),
        eq(goldlineRookContactSessions.operatorId, input.operatorId)
      )
    );
}
