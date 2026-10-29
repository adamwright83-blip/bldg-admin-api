import { and, eq, sql } from "drizzle-orm";
import type { PortraitStatus } from "../../../shared/firstTenMinutesPortrait";
import { firstTenDb } from "../store";
import { firstTenPortraits } from "../schema";
import type { WrittenPortrait } from "./write";

export type PortraitRow = typeof firstTenPortraits.$inferSelect;
export type PortraitEdits = Record<string, { to: string | null; at: string }>;

const LEASE_MS = 60_000;

function affected(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number })?.affectedRows ?? 0);
}

export async function portraitRow(journeyId: string): Promise<PortraitRow | null> {
  const db = await firstTenDb();
  const [row] = await db.select().from(firstTenPortraits).where(eq(firstTenPortraits.journeyId, journeyId)).limit(1);
  return row ?? null;
}

/**
 * Take the writing of a journey's portrait for `runId`, on `basis` (what the findings say now). Only one run writes at
 * a time; a run whose lease lapsed can be taken over. A kept portrait is never written again, and a finished one only
 * when its basis has changed (or it failed).
 */
export async function claimPortrait(journeyId: string, runId: string, basis: string): Promise<boolean> {
  const db = await firstTenDb();
  const now = new Date();
  const fresh = { runId, status: "writing" as const, basis, leaseUntil: new Date(now.getTime() + LEASE_MS) };
  const takeable = sql`(${firstTenPortraits.status} <> 'kept' AND (
    (${firstTenPortraits.status} = 'writing' AND ${firstTenPortraits.leaseUntil} < ${now})
    OR (${firstTenPortraits.status} <> 'writing' AND (${firstTenPortraits.status} = 'failed' OR ${firstTenPortraits.basis} <> ${basis}))
  ))`;
  const result = await db
    .update(firstTenPortraits)
    .set(fresh)
    .where(and(eq(firstTenPortraits.journeyId, journeyId), takeable));
  if (affected(result) === 1) return true;
  if (await portraitRow(journeyId)) return false;
  try {
    await db.insert(firstTenPortraits).values({ journeyId, ...fresh, portraitJson: null, editsJson: {}, writtenBy: null, keptAt: null });
    return true;
  } catch {
    return false;
  }
}

/** The finished page (or none, when too little is known), written only by the run that holds the portrait. */
export async function finishPortrait(
  journeyId: string,
  runId: string,
  outcome: { status: Extract<PortraitStatus, "ready" | "unavailable" | "failed">; portrait: WrittenPortrait | null; writtenBy: string | null }
): Promise<void> {
  const db = await firstTenDb();
  await db
    .update(firstTenPortraits)
    .set({ status: outcome.status, portraitJson: outcome.portrait, writtenBy: outcome.writtenBy, editsJson: {}, leaseUntil: null })
    .where(and(eq(firstTenPortraits.journeyId, journeyId), eq(firstTenPortraits.runId, runId)));
}

/** "That sounds like me": kept as it stands, with the person's changes. Only a ready portrait can be kept. */
export async function keepPortrait(journeyId: string): Promise<boolean> {
  const db = await firstTenDb();
  const result = await db
    .update(firstTenPortraits)
    .set({ status: "kept", keptAt: new Date() })
    .where(and(eq(firstTenPortraits.journeyId, journeyId), eq(firstTenPortraits.status, "ready")));
  return affected(result) === 1;
}

/**
 * The person's words in place of one line (or null: take it out), until they keep the page. Each line is set on its
 * own, so two quick changes to different lines both stand.
 */
export async function editPortraitLine(journeyId: string, key: string, to: string | null): Promise<boolean> {
  if (!/^p[1-3]\.s[1-3]$/.test(key)) return false;
  const db = await firstTenDb();
  const value = JSON.stringify({ to, at: new Date().toISOString() });
  const result = await db
    .update(firstTenPortraits)
    .set({ editsJson: sql`JSON_SET(COALESCE(${firstTenPortraits.editsJson}, JSON_OBJECT()), ${`$."${key}"`}, CAST(${value} AS JSON))` })
    .where(and(eq(firstTenPortraits.journeyId, journeyId), eq(firstTenPortraits.status, "ready")));
  return affected(result) === 1;
}

/** Claire's line back in place of the person's change, until they keep the page. */
export async function restorePortraitEdit(journeyId: string, key: string): Promise<boolean> {
  if (!/^p[1-3]\.s[1-3]$/.test(key)) return false;
  const db = await firstTenDb();
  const result = await db
    .update(firstTenPortraits)
    .set({ editsJson: sql`JSON_REMOVE(COALESCE(${firstTenPortraits.editsJson}, JSON_OBJECT()), ${`$."${key}"`})` })
    .where(and(eq(firstTenPortraits.journeyId, journeyId), eq(firstTenPortraits.status, "ready")));
  return affected(result) === 1;
}
