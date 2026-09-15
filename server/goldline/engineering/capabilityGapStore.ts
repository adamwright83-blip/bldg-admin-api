import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { goldlineCapabilityGaps } from "../../../drizzle/schema";
import { getDb } from "../../db";
import type { CapabilityGapRecord, CapabilityGapStatus } from "../../../shared/goldlineCapabilities";

const OPEN_STATUSES: CapabilityGapStatus[] = [
  "IDENTIFIED",
  "APPROVED_FOR_ENGINEERING",
  "ENGINEERING_RUNNING",
  "NEEDS_HUMAN",
  "PR_READY",
];

function isMissingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /goldline_capability_gaps|ER_NO_SUCH_TABLE/i.test(message);
}

function toRecord(row: typeof goldlineCapabilityGaps.$inferSelect): CapabilityGapRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorUserId: row.operatorUserId,
    capabilityKey: row.capabilityKey,
    operatorRequest: row.operatorRequest,
    conversationSessionId: row.conversationSessionId,
    status: row.status as CapabilityGapStatus,
    engineeringSessionId: row.engineeringSessionId,
    engineeringStatus: row.engineeringStatus,
    terminalResultJson: (row.terminalResultJson as Record<string, unknown> | null) ?? null,
    branch: row.branch,
    prUrl: row.prUrl,
    blocker: row.blocker,
    requiresHumanApproval: Boolean(row.requiresHumanApproval),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findOpenCapabilityGap(input: {
  tenantId: string;
  capabilityKey: string;
}): Promise<CapabilityGapRecord | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = await db
      .select()
      .from(goldlineCapabilityGaps)
      .where(
        and(
          eq(goldlineCapabilityGaps.tenantId, input.tenantId),
          eq(goldlineCapabilityGaps.capabilityKey, input.capabilityKey),
          inArray(goldlineCapabilityGaps.status, OPEN_STATUSES)
        )
      )
      .orderBy(desc(goldlineCapabilityGaps.updatedAt))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

export async function insertCapabilityGap(input: {
  tenantId: string;
  operatorUserId: string;
  capabilityKey: string;
  operatorRequest: string;
  conversationSessionId?: string | null;
}): Promise<CapabilityGapRecord | { unavailable: true; reason: string }> {
  const existing = await findOpenCapabilityGap(input);
  if (existing) {
    await bumpCapabilityGapDemand(existing.id);
    return existing;
  }
  const db = await getDb();
  if (!db) return { unavailable: true, reason: "database_unavailable" };
  const row = {
    id: randomUUID(),
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    capabilityKey: input.capabilityKey,
    operatorRequest: input.operatorRequest.slice(0, 4000),
    conversationSessionId: input.conversationSessionId ?? null,
    status: "IDENTIFIED" as const,
  };
  try {
    await db.insert(goldlineCapabilityGaps).values(row);
    const [created] = await db
      .select()
      .from(goldlineCapabilityGaps)
      .where(eq(goldlineCapabilityGaps.id, row.id))
      .limit(1);
    return created ? toRecord(created) : { unavailable: true, reason: "insert_failed" };
  } catch (error) {
    if (isMissingTable(error)) {
      return {
        unavailable: true,
        reason: "migration_0077_not_applied",
      };
    }
    throw error;
  }
}

async function bumpCapabilityGapDemand(id: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const [row] = await db
      .select()
      .from(goldlineCapabilityGaps)
      .where(eq(goldlineCapabilityGaps.id, id))
      .limit(1);
    if (!row) return;
    await db
      .update(goldlineCapabilityGaps)
      .set({ demandCount: (row.demandCount ?? 1) + 1 })
      .where(eq(goldlineCapabilityGaps.id, id));
  } catch (error) {
    if (isMissingTable(error)) return;
    throw error;
  }
}

export async function getCapabilityGap(input: {
  tenantId: string;
  id: string;
  operatorUserId?: string;
}): Promise<CapabilityGapRecord | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = await db
      .select()
      .from(goldlineCapabilityGaps)
      .where(
        and(
          eq(goldlineCapabilityGaps.tenantId, input.tenantId),
          eq(goldlineCapabilityGaps.id, input.id)
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (input.operatorUserId && row.operatorUserId !== input.operatorUserId) return null;
    return toRecord(row);
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

export async function updateCapabilityGap(
  id: string,
  patch: Partial<{
    status: CapabilityGapStatus;
    engineeringSessionId: string | null;
    engineeringStatus: string | null;
    terminalResultJson: Record<string, unknown> | null;
    branch: string | null;
    prUrl: string | null;
    blocker: string | null;
    requiresHumanApproval: boolean;
  }>
): Promise<CapabilityGapRecord | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    await db
      .update(goldlineCapabilityGaps)
      .set(patch)
      .where(eq(goldlineCapabilityGaps.id, id));
    const [row] = await db
      .select()
      .from(goldlineCapabilityGaps)
      .where(eq(goldlineCapabilityGaps.id, id))
      .limit(1);
    return row ? toRecord(row) : null;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

export async function latestOperatorCapabilityGap(input: {
  tenantId: string;
  operatorUserId: string;
}): Promise<CapabilityGapRecord | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .select()
      .from(goldlineCapabilityGaps)
      .where(
        and(
          eq(goldlineCapabilityGaps.tenantId, input.tenantId),
          eq(goldlineCapabilityGaps.operatorUserId, input.operatorUserId)
        )
      )
      .orderBy(desc(goldlineCapabilityGaps.updatedAt))
      .limit(1);
    return row ? toRecord(row) : null;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}
