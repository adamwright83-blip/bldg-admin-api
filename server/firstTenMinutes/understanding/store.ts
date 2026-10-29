import { and, eq, sql } from "drizzle-orm";
import type {
  FindingStatus,
  FindingView,
  UnderstandingStage,
  UnderstandingView,
} from "../../../shared/firstTenMinutesFindings";
import { firstTenDb } from "../store";
import { firstTenFindings, firstTenReadings, type FindingOrigin } from "../schema";
import type { DraftFinding } from "./draft";

export type ReadingRow = typeof firstTenReadings.$inferSelect;

const LEASE_MS = 90_000;
const NO_COUNTS: UnderstandingView["counts"] = { sent: 0, received: 0, events: 0, files: 0, slack: 0 };

function affected(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number })?.affectedRows ?? 0);
}

export async function readingRow(journeyId: string): Promise<ReadingRow | null> {
  const db = await firstTenDb();
  const [row] = await db.select().from(firstTenReadings).where(eq(firstTenReadings.journeyId, journeyId)).limit(1);
  return row ?? null;
}

/**
 * Take the journey's reading for `runId`. Only one run reads a journey at a time: a run whose lease lapsed (its
 * server went away) can be taken over; a complete reading is taken again only when asked.
 */
export async function claimReading(journeyId: string, runId: string, options: { again: boolean }): Promise<boolean> {
  const db = await firstTenDb();
  const now = new Date();
  const fresh = {
    runId,
    status: "running" as const,
    stage: null,
    finishedJson: [] as UnderstandingStage[],
    countsJson: NO_COUNTS,
    notesJson: [] as string[],
    leaseUntil: new Date(now.getTime() + LEASE_MS),
    startedAt: now,
    finishedAt: null,
  };
  const takeable = options.again
    ? sql`(${firstTenReadings.status} <> 'running' OR ${firstTenReadings.leaseUntil} < ${now})`
    : sql`(${firstTenReadings.status} = 'failed' OR (${firstTenReadings.status} = 'running' AND ${firstTenReadings.leaseUntil} < ${now}))`;
  const result = await db
    .update(firstTenReadings)
    .set(fresh)
    .where(and(eq(firstTenReadings.journeyId, journeyId), takeable));
  if (affected(result) === 1) return true;
  if (await readingRow(journeyId)) return false;
  try {
    await db.insert(firstTenReadings).values({ journeyId, ...fresh });
    return true;
  } catch {
    return false;
  }
}

/** Progress, written only by the run that holds the reading. Each write renews the lease. */
export async function updateReading(
  journeyId: string,
  runId: string,
  patch: { stage?: UnderstandingStage | null; finished?: UnderstandingStage[]; counts?: UnderstandingView["counts"]; notes?: string[] }
): Promise<void> {
  const db = await firstTenDb();
  await db
    .update(firstTenReadings)
    .set({
      ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
      ...(patch.finished ? { finishedJson: patch.finished } : {}),
      ...(patch.counts ? { countsJson: patch.counts } : {}),
      ...(patch.notes ? { notesJson: patch.notes } : {}),
      leaseUntil: new Date(Date.now() + LEASE_MS),
    })
    .where(and(eq(firstTenReadings.journeyId, journeyId), eq(firstTenReadings.runId, runId)));
}

export async function finishReading(journeyId: string, runId: string, status: "complete" | "failed", notes: string[]): Promise<void> {
  const db = await firstTenDb();
  await db
    .update(firstTenReadings)
    .set({ status, stage: null, notesJson: notes, leaseUntil: null, finishedAt: new Date() })
    .where(and(eq(firstTenReadings.journeyId, journeyId), eq(firstTenReadings.runId, runId)));
}

/**
 * Store findings as they are verified. A finding found again keeps whatever the person already said about it
 * (confirmed, changed, dismissed, their correction).
 */
export async function saveFindings(
  journeyId: string,
  runId: string,
  drafts: DraftFinding[],
  origins: ReadonlyMap<string, FindingOrigin> = new Map()
): Promise<void> {
  if (!drafts.length) return;
  const db = await firstTenDb();
  for (const draft of drafts) {
    const values = {
      runId,
      kind: draft.payload.kind,
      companion: draft.companion,
      rank: draft.rank,
      payloadJson: draft.payload,
      sourcesJson: draft.sources,
      originJson: origins.get(draft.id) ?? null,
    };
    await db
      .insert(firstTenFindings)
      .values({ id: draft.id, journeyId, status: "proposed", correctionText: null, ...values })
      .onDuplicateKeyUpdate({ set: values });
  }
}

/** The findings of the current reading, plus any the person already confirmed, changed or dismissed. */
export async function findingViews(journeyId: string, runId: string | null): Promise<FindingView[]> {
  const db = await firstTenDb();
  const rows = await db.select().from(firstTenFindings).where(eq(firstTenFindings.journeyId, journeyId));
  return rows
    .filter(row => row.runId === runId || row.status !== "proposed")
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.rank - b.rank)
    .map(row => ({
      id: row.id,
      companion: row.companion,
      status: row.status,
      payload: row.payloadJson,
      sources: row.sourcesJson,
      correction: row.correctionText,
    }));
}

export async function findingRow(journeyId: string, findingId: string) {
  const db = await firstTenDb();
  const [row] = await db
    .select()
    .from(firstTenFindings)
    .where(and(eq(firstTenFindings.journeyId, journeyId), eq(firstTenFindings.id, findingId)))
    .limit(1);
  return row ?? null;
}

export async function setFindingStatus(
  journeyId: string,
  findingId: string,
  status: FindingStatus,
  correction: string | null
): Promise<boolean> {
  const db = await firstTenDb();
  const result = await db
    .update(firstTenFindings)
    .set({ status, correctionText: correction })
    .where(and(eq(firstTenFindings.journeyId, journeyId), eq(firstTenFindings.id, findingId)));
  return affected(result) === 1;
}
