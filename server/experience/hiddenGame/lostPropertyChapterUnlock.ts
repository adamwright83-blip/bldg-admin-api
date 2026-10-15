/**
 * Insert-once Lost Property chapter unlocks.
 *
 * The eligibility read still recomputes from the paid-order ledger and from
 * completed Day Line objectives. This module records a chapter when that
 * recompute opens it. A later recompute that would have withheld the sale
 * does not delete the row, and a second pass does not insert it again.
 * Chapter 4 is not stored.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { hiddenGameChapterUnlocks } from "../../../drizzle/schema";
import {
  assertLostPropertyChapterPersist,
  isLostPropertyPreview,
  lostPropertyChaptersToPersist,
  previewLostPropertyUnlock,
  projectLostPropertyUnlock,
  type LostPropertyChapterPersist,
  type LostPropertyUnlockRead,
  type UnlockRecord,
} from "../../../shared/lostPropertyUnlock";
import { getDb } from "../../db";
import {
  readEligibleObjectiveCompletions,
  readFirstVerifiedTerritorialSale,
  type LostPropertyScope,
  type LostPropertyUnlockDeps,
} from "./lostPropertyUnlockRead";

export type LostPropertyDurableDeps = LostPropertyUnlockDeps & {
  readPersisted: (scope: LostPropertyScope) => Promise<readonly UnlockRecord[]>;
  insertChapter: (scope: LostPropertyScope, record: LostPropertyChapterPersist) => Promise<void>;
};

function requireTenant(tenantId: string): string {
  const id = tenantId.trim();
  if (!id) throw new Error("Lost Property eligibility requires a tenantId");
  return id;
}

function requireOperator(operatorId: string): string {
  const id = operatorId.trim();
  if (!id) throw new Error("Lost Property eligibility requires a canonicalOperatorId");
  return id;
}

function envFromProcess(): { openIds?: string; tenantId?: string } {
  return {
    openIds: process.env.HIDDEN_GAME_PREVIEW_OPEN_IDS,
    tenantId: process.env.HIDDEN_GAME_PREVIEW_TENANT_ID,
  };
}

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Lost Property stored chapter unlock is unreadable");
  }
  return date.toISOString();
}

function playableChapter(chapter: number): chapter is 1 | 2 | 3 {
  return chapter === 1 || chapter === 2 || chapter === 3;
}

export async function readStoredChapterUnlocks(scope: LostPropertyScope): Promise<UnlockRecord[]> {
  const tenantId = requireTenant(scope.tenantId);
  const canonicalOperatorId = requireOperator(scope.canonicalOperatorId);
  const db = await getDb();
  if (!db) throw new Error("Lost Property unlock store is unavailable");
  const rows = await db
    .select({
      chapter: hiddenGameChapterUnlocks.chapter,
      openedAt: hiddenGameChapterUnlocks.openedAt,
    })
    .from(hiddenGameChapterUnlocks)
    .where(
      and(
        eq(hiddenGameChapterUnlocks.tenantId, tenantId),
        eq(hiddenGameChapterUnlocks.canonicalOperatorId, canonicalOperatorId)
      )
    );
  return rows.flatMap(row => {
    if (!playableChapter(row.chapter)) return [];
    return [{ chapter: row.chapter, openedAt: asIso(row.openedAt) }];
  });
}

export async function insertStoredChapterUnlock(
  scope: LostPropertyScope,
  record: LostPropertyChapterPersist
): Promise<void> {
  const tenantId = requireTenant(scope.tenantId);
  const canonicalOperatorId = requireOperator(scope.canonicalOperatorId);
  assertLostPropertyChapterPersist(record);
  const db = await getDb();
  if (!db) throw new Error("Lost Property unlock store is unavailable");
  await db
    .insert(hiddenGameChapterUnlocks)
    .values({
      id: randomUUID(),
      tenantId,
      canonicalOperatorId,
      chapter: record.chapter,
      openedAt: new Date(record.openedAt),
      evidenceJson: record.evidence,
    })
    .onDuplicateKeyUpdate({
      set: { canonicalOperatorId },
    });
}

const defaultDurableDeps: LostPropertyDurableDeps = {
  readFirstSale: tenantId => readFirstVerifiedTerritorialSale(tenantId),
  readCompletedUnits: scope => readEligibleObjectiveCompletions(scope),
  readPersisted: scope => readStoredChapterUnlocks(scope),
  insertChapter: (scope, record) => insertStoredChapterUnlock(scope, record),
};

export async function readDurableLostPropertyUnlock(
  scope: LostPropertyScope,
  deps: LostPropertyDurableDeps = defaultDurableDeps
): Promise<LostPropertyUnlockRead> {
  const tenantId = requireTenant(scope.tenantId ?? "");
  const canonicalOperatorId = requireOperator(scope.canonicalOperatorId ?? "");
  const normalized: LostPropertyScope = {
    ...scope,
    tenantId,
    canonicalOperatorId,
    actorIds: scope.actorIds ?? [],
    operatorOpenIds: scope.operatorOpenIds ?? [],
  };
  const env = deps.env ?? envFromProcess();
  if (
    isLostPropertyPreview({
      tenantId,
      operatorOpenIds: normalized.operatorOpenIds ?? [],
      envOpenIds: env.openIds,
      envTenantId: env.tenantId,
    })
  ) {
    return previewLostPropertyUnlock();
  }
  const [firstSale, units] = await Promise.all([
    deps.readFirstSale(tenantId),
    deps.readCompletedUnits(normalized),
  ]);
  let persisted = [...(await deps.readPersisted(normalized))].filter(row => playableChapter(row.chapter));
  const pending = lostPropertyChaptersToPersist({ firstSale, units, persisted });
  for (const record of pending) {
    assertLostPropertyChapterPersist(record);
    await deps.insertChapter(normalized, record);
  }
  if (pending.length > 0) {
    persisted = [...(await deps.readPersisted(normalized))].filter(row => playableChapter(row.chapter));
  }
  return projectLostPropertyUnlock({ firstSale, units, persisted });
}
