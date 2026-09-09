/**
 * Slice 5: let a real, verified business event unlock a fictional
 * consequence while the player is away, exactly once. Reads the existing
 * canonical `TowerWarsBusinessEvent` ledger (shared/towerWars.ts) — never a
 * new integration, never a fabricated event. Writes only this chapter's own
 * armed/resolved bookkeeping; never touches order/payment/customer tables.
 *
 * FICTION LAW: this binding never kills the boss or completes the chapter.
 * It only unlocks an optional advantage (upper firing position / stabilized
 * balcony approach per docs/goldline/HANDOFF-FIRST-2_5D-CHAPTER.md section 5).
 * The chapter must remain completable with zero qualifying events.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { goldlineChapterEventBindings } from "../../drizzle/schema";
import { getDb } from "../db";
import type { TowerWarsBuildingId, TowerWarsBusinessEvent } from "../../shared/towerWars";

export type ChapterEventBinding = {
  buildingId: TowerWarsBuildingId;
  armedAt: string | null;
  resolvedEventId: string | null;
  resolvedAt: string | null;
};

function identity(input: { tenantId: string; chapterId: string; buildingId: TowerWarsBuildingId }) {
  return and(
    eq(goldlineChapterEventBindings.tenantId, input.tenantId),
    eq(goldlineChapterEventBindings.chapterId, input.chapterId),
    eq(goldlineChapterEventBindings.buildingId, input.buildingId)
  );
}

function toBinding(row: {
  buildingId: string;
  armedAt: Date | null;
  resolvedEventId: string | null;
  resolvedAt: Date | null;
}): ChapterEventBinding {
  return {
    buildingId: row.buildingId as TowerWarsBuildingId,
    armedAt: row.armedAt?.toISOString() ?? null,
    resolvedEventId: row.resolvedEventId,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export async function getChapterEventBinding(input: {
  tenantId: string;
  chapterId: string;
  buildingId: TowerWarsBuildingId;
}): Promise<ChapterEventBinding | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(goldlineChapterEventBindings)
    .where(identity(input))
    .limit(1);
  return row ? toBinding(row) : null;
}

/**
 * Prepare the fictional counterweight receiver. Idempotent: arming an
 * already-armed binding is a no-op that returns the existing armedAt rather
 * than resetting the window.
 */
export async function armChapterEventBinding(input: {
  tenantId: string;
  chapterId: string;
  buildingId: TowerWarsBuildingId;
}): Promise<ChapterEventBinding> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = await getChapterEventBinding(input);
  if (existing) return existing;
  const armedAt = new Date();
  await db.insert(goldlineChapterEventBindings).values({
    id: randomUUID(),
    tenantId: input.tenantId,
    chapterId: input.chapterId,
    buildingId: input.buildingId,
    armedAt,
  });
  return { buildingId: input.buildingId, armedAt: armedAt.toISOString(), resolvedEventId: null, resolvedAt: null };
}

function chapterEventBindingAffectedRows(result: unknown): number {
  if (Array.isArray(result)) {
    const header = result[0] as { affectedRows?: number } | undefined;
    return Number(header?.affectedRows ?? 0);
  }
  return Number((result as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

export type ReconcileResult =
  | { consequenceApplied: true; event: TowerWarsBusinessEvent }
  | { consequenceApplied: false; reason: "not_armed" | "already_resolved" | "no_qualifying_event" };

/**
 * Given the already-fetched canonical ledger for this tenant (the caller is
 * responsible for calling the real towerWarsService — this function never
 * fetches events itself, so it stays trivially testable and never trusts a
 * browser-asserted event), find the first qualifying event for this
 * binding's building that occurred after it was armed, and consume it
 * exactly once via a compare-and-set UPDATE guarded on `resolvedEventId IS
 * NULL`. Wrong building, wrong timing, or an already-resolved binding all
 * fall through to a no-op — this call is always safe to retry on every load
 * (including while the player was offline).
 */
export async function reconcileChapterEventBinding(input: {
  tenantId: string;
  chapterId: string;
  buildingId: TowerWarsBuildingId;
  candidateEvents: readonly TowerWarsBusinessEvent[];
}): Promise<ReconcileResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = await getChapterEventBinding(input);
  if (!existing || !existing.armedAt) return { consequenceApplied: false, reason: "not_armed" };
  if (existing.resolvedEventId) return { consequenceApplied: false, reason: "already_resolved" };

  const armedAt = new Date(existing.armedAt).getTime();
  const qualifying = input.candidateEvents
    .filter(event => event.buildingId === input.buildingId)
    .filter(event => new Date(event.occurredAt).getTime() > armedAt)
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())[0];
  if (!qualifying) return { consequenceApplied: false, reason: "no_qualifying_event" };

  const result = await db
    .update(goldlineChapterEventBindings)
    .set({ resolvedEventId: qualifying.eventId, resolvedAt: new Date() })
    .where(and(identity(input), isNull(goldlineChapterEventBindings.resolvedEventId)));

  if (chapterEventBindingAffectedRows(result) !== 1) {
    // Lost the race to a concurrent reconcile (or an offline retry that already landed) — not an error.
    return { consequenceApplied: false, reason: "already_resolved" };
  }
  return { consequenceApplied: true, event: qualifying };
}
