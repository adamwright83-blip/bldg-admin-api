/**
 * Cross-device Goldline chapter fiction state. One row per tenant/operator/
 * chapter. Optimistic concurrency (revision) and idempotent retry
 * (lastRequestId) mirror the goldlineCampaignInstances pattern in
 * campaignService.ts. Never touches business tables.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { goldlineChapterStates } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  goldlineChapterFictionStateSchema,
  type GoldlineChapterFictionState,
} from "../../shared/goldlineChapterState";

export type ChapterStateRow = {
  revision: number;
  state: GoldlineChapterFictionState;
};

export class ChapterStateRevisionConflictError extends Error {
  constructor(public readonly latest: ChapterStateRow | null) {
    super("Goldline chapter state revision conflict");
    this.name = "ChapterStateRevisionConflictError";
  }
}

export function chapterStateAffectedRows(result: unknown): number {
  if (Array.isArray(result)) {
    const header = result[0] as { affectedRows?: number } | undefined;
    return Number(header?.affectedRows ?? 0);
  }
  return Number(
    (result as { affectedRows?: number } | undefined)?.affectedRows ?? 0
  );
}

function identity(input: {
  tenantId: string;
  operatorId: string;
  chapterId: string;
}) {
  return and(
    eq(goldlineChapterStates.tenantId, input.tenantId),
    eq(goldlineChapterStates.operatorId, input.operatorId),
    eq(goldlineChapterStates.chapterId, input.chapterId)
  );
}

export async function getChapterState(input: {
  tenantId: string;
  operatorId: string;
  chapterId: string;
}): Promise<ChapterStateRow | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(goldlineChapterStates)
    .where(identity(input))
    .limit(1);
  if (!row) return null;
  const parsed = goldlineChapterFictionStateSchema.safeParse(row.stateJson);
  if (!parsed.success) return null;
  return { revision: row.revision, state: parsed.data };
}

/**
 * Compare-and-set write. `expectedRevision` is 0 for a brand-new chapter.
 * A mismatch throws with the current authoritative row so the caller adopts
 * server truth instead of silently overwriting a newer write from another
 * device. `requestId` dedupes a retried write without bumping the revision
 * twice for the same intentional action.
 */
export async function saveChapterState(input: {
  tenantId: string;
  operatorId: string;
  chapterId: string;
  expectedRevision: number;
  state: GoldlineChapterFictionState;
  requestId: string;
}): Promise<ChapterStateRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = await getChapterState(input);

  if (!existing) {
    if (input.expectedRevision !== 0) {
      throw new ChapterStateRevisionConflictError(null);
    }
    await db.insert(goldlineChapterStates).values({
      id: randomUUID(),
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      chapterId: input.chapterId,
      revision: 1,
      stateJson: input.state,
      lastRequestId: input.requestId,
    });
    return { revision: 1, state: input.state };
  }

  const [row] = await db
    .select({ lastRequestId: goldlineChapterStates.lastRequestId })
    .from(goldlineChapterStates)
    .where(identity(input))
    .limit(1);
  if (row?.lastRequestId === input.requestId) return existing;

  if (existing.revision !== input.expectedRevision) {
    throw new ChapterStateRevisionConflictError(existing);
  }

  const nextRevision = existing.revision + 1;
  const result = await db
    .update(goldlineChapterStates)
    .set({
      revision: nextRevision,
      stateJson: input.state,
      lastRequestId: input.requestId,
    })
    .where(and(identity(input), eq(goldlineChapterStates.revision, existing.revision)));

  if (chapterStateAffectedRows(result) !== 1) {
    const latest = await getChapterState(input);
    throw new ChapterStateRevisionConflictError(latest ?? existing);
  }
  return { revision: nextRevision, state: input.state };
}
