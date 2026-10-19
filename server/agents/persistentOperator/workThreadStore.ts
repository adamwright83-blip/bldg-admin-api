import { createHash, randomUUID } from "node:crypto";
import { and, eq, max } from "drizzle-orm";
import { workThreads } from "../../../drizzle/schema";
import type { WeeklyGrowthCandidate } from "../../../shared/weeklyGrowthCandidates";
import {
  workThreadIdFromCandidateId,
  workThreadOpportunityKey,
  type WorkThreadOpportunity,
} from "../../../shared/workThread";
import { getDb } from "../../db";
import { isMysqlDuplicateKeyError } from "../../mysqlErrors";

/**
 * Durable Work Thread identity (Phase 2 · Slice A). See shared/workThread.ts
 * for the contract. This store is the only writer of `work_threads`.
 *
 * - `resolveWorkThread` returns the open thread for an opportunity, minting one
 *   only when none is open. Re-observing an opportunity updates its display
 *   title and last source, never its id, key or generation.
 * - A closed thread is never reopened; the same opportunity observed later
 *   mints the next generation, a new initiative with its own history.
 * - A reference this store cannot verify (missing, closed, conflicting) is
 *   reported as unresolved. It is never re-pointed at a guessed thread.
 */

export type WorkThreadStatus = "open" | "closed";

export type WorkThreadRecord = {
  id: string;
  tenantId: string;
  opportunityKey: string;
  generation: number;
  status: WorkThreadStatus;
  opportunity: WorkThreadOpportunity;
  title: string;
  createdByOperatorId: string | null;
  firstSourceRef: string | null;
  lastSourceRef: string | null;
  lastObservedAt: string | null;
  closedReason: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkThreadResolution =
  | { status: "resolved"; thread: WorkThreadRecord }
  | {
      status: "unresolved";
      reason:
        | "work_thread_missing"
        | "work_thread_closed"
        | "ambiguous_work_thread_lineage"
        | "pre_thread_strategy_candidate";
      references: string[];
    };

const keyHash = (key: string) => createHash("sha256").update(key).digest("hex");
const clip = (value: string, length: number) => value.trim().slice(0, length);

function toRecord(row: typeof workThreads.$inferSelect): WorkThreadRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    opportunityKey: row.opportunityKey,
    generation: row.generation,
    status: row.status === "closed" ? "closed" : "open",
    opportunity: (typeof row.opportunityJson === "string"
      ? JSON.parse(row.opportunityJson)
      : row.opportunityJson) as WorkThreadOpportunity,
    title: row.title,
    createdByOperatorId: row.createdByOperatorId,
    firstSourceRef: row.firstSourceRef,
    lastSourceRef: row.lastSourceRef,
    lastObservedAt: row.lastObservedAt?.toISOString() ?? null,
    closedReason: row.closedReason,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Work thread database unavailable");
  return db;
}

export async function getWorkThread(input: {
  tenantId: string;
  threadId: string;
}): Promise<WorkThreadRecord | null> {
  const db = await database();
  const [row] = await db
    .select()
    .from(workThreads)
    .where(and(eq(workThreads.tenantId, input.tenantId), eq(workThreads.id, input.threadId)))
    .limit(1);
  return row ? toRecord(row) : null;
}

async function openRow(tenantId: string, hash: string) {
  const db = await database();
  const [row] = await db
    .select()
    .from(workThreads)
    .where(
      and(
        eq(workThreads.tenantId, tenantId),
        eq(workThreads.opportunityKeyHash, hash),
        eq(workThreads.openSlot, 1)
      )
    )
    .limit(1);
  return row ?? null;
}

/** The open thread for this opportunity, if any. Read-only. */
export async function findOpenWorkThread(input: {
  tenantId: string;
  opportunity: WorkThreadOpportunity;
}): Promise<WorkThreadRecord | null> {
  const row = await openRow(input.tenantId, keyHash(workThreadOpportunityKey(input.opportunity)));
  return row ? toRecord(row) : null;
}

/**
 * The open Work Thread for this opportunity, minting one when none is open.
 * Concurrent callers converge on one thread: the open-slot and generation
 * unique keys reject a second insert, and the loser reads the winner.
 */
export async function resolveWorkThread(input: {
  tenantId: string;
  opportunity: WorkThreadOpportunity;
  title: string;
  /** Provenance of this observation (a diagnosis, a candidate). Not identity. */
  sourceRef: string;
  canonicalOperatorId?: string | null;
  now?: Date;
}): Promise<WorkThreadRecord> {
  const tenantId = input.tenantId.trim();
  if (!tenantId) throw new Error("Work thread requires a tenant");
  const key = workThreadOpportunityKey(input.opportunity);
  const hash = keyHash(key);
  const now = input.now ?? new Date();
  const title = clip(input.title, 255) || key.slice(0, 255);
  const sourceRef = clip(input.sourceRef, 191) || null;
  const db = await database();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const open = await openRow(tenantId, hash);
    if (open) {
      // A later observation refreshes presentation only; an out-of-order
      // older one leaves the newer presentation in place.
      if (!open.lastObservedAt || open.lastObservedAt.getTime() <= now.getTime()) {
        await db
          .update(workThreads)
          .set({ title, lastSourceRef: sourceRef, lastObservedAt: now })
          .where(and(eq(workThreads.tenantId, tenantId), eq(workThreads.id, open.id), eq(workThreads.openSlot, 1)));
      }
      const current = await getWorkThread({ tenantId, threadId: open.id });
      if (!current) throw new Error("Work thread readback failed");
      return current;
    }
    const [latest] = await db
      .select({ generation: max(workThreads.generation) })
      .from(workThreads)
      .where(and(eq(workThreads.tenantId, tenantId), eq(workThreads.opportunityKeyHash, hash)));
    const id = randomUUID();
    try {
      await db.insert(workThreads).values({
        id,
        tenantId,
        opportunityKey: key,
        opportunityKeyHash: hash,
        generation: (latest?.generation ?? 0) + 1,
        openSlot: 1,
        status: "open",
        kind: input.opportunity.kind,
        opportunityJson: input.opportunity,
        title,
        createdByOperatorId: input.canonicalOperatorId?.trim() || null,
        firstSourceRef: sourceRef,
        lastSourceRef: sourceRef,
        lastObservedAt: now,
      });
      const created = await getWorkThread({ tenantId, threadId: id });
      if (!created) throw new Error("Work thread readback failed");
      return created;
    } catch (error) {
      // Another writer opened this key (or took this generation) first: read it.
      if (!isMysqlDuplicateKeyError(error)) throw error;
    }
  }
  throw new Error("Work thread resolution did not converge");
}

/**
 * Ends a thread. Its history (decisions, objectives, commitments, outcomes)
 * keeps pointing at it; the next observation of the same opportunity starts a
 * new generation. Idempotent: closing a closed thread returns it unchanged.
 */
export async function closeWorkThread(input: {
  tenantId: string;
  threadId: string;
  reason: string;
  now?: Date;
}): Promise<WorkThreadRecord> {
  const reason = clip(input.reason, 64);
  if (!reason) throw new Error("Closing a work thread requires a reason");
  const db = await database();
  await db
    .update(workThreads)
    .set({ status: "closed", openSlot: null, closedReason: reason, closedAt: input.now ?? new Date() })
    .where(
      and(
        eq(workThreads.tenantId, input.tenantId),
        eq(workThreads.id, input.threadId),
        eq(workThreads.status, "open")
      )
    );
  const thread = await getWorkThread({ tenantId: input.tenantId, threadId: input.threadId });
  if (!thread) throw new Error(`Work thread ${input.threadId} not found`);
  return thread;
}

/**
 * The Work Thread a selected Weekly Growth candidate belongs to.
 *
 * Strategy work and approved work already name their thread; that reference is
 * verified (same tenant, still open), never re-pointed. Other work's durable
 * candidate id (built from source ids) is its subject. A pre-thread strategy
 * candidate (`diagnosis_…:strategy-…`) is left unresolved rather than matched
 * by wording to a thread it may not belong to.
 */
export async function resolveCandidateWorkThread(input: {
  tenantId: string;
  candidate: Pick<WeeklyGrowthCandidate, "id" | "title" | "sourceKind" | "workThreadId" | "conflictingWorkThreadIds">;
  canonicalOperatorId: string;
  now?: Date;
}): Promise<WorkThreadResolution> {
  const { candidate } = input;
  if (candidate.conflictingWorkThreadIds?.length)
    return { status: "unresolved", reason: "ambiguous_work_thread_lineage", references: [...candidate.conflictingWorkThreadIds] };
  const named = candidate.workThreadId ?? workThreadIdFromCandidateId(candidate.id);
  if (named) {
    const thread = await getWorkThread({ tenantId: input.tenantId, threadId: named });
    if (!thread) return { status: "unresolved", reason: "work_thread_missing", references: [named] };
    if (thread.status !== "open") return { status: "unresolved", reason: "work_thread_closed", references: [named] };
    return { status: "resolved", thread };
  }
  if (candidate.sourceKind === "strategy_diagnosis")
    return { status: "unresolved", reason: "pre_thread_strategy_candidate", references: [candidate.id] };
  return {
    status: "resolved",
    thread: await resolveWorkThread({
      tenantId: input.tenantId,
      opportunity: { kind: "work_subject", subjectRef: candidate.id },
      title: candidate.title,
      sourceRef: candidate.id,
      canonicalOperatorId: input.canonicalOperatorId,
      now: input.now,
    }),
  };
}
