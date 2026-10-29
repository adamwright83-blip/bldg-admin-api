import type { UnderstandingView } from "../../../shared/firstTenMinutesFindings";
import { findingViews, readingRow } from "./store";

const NO_COUNTS: UnderstandingView["counts"] = { sent: 0, received: 0, events: 0, files: 0, slack: 0 };

/**
 * What the page sees of a reading. A reading whose server went away mid-way (its lease lapsed) shows as failed, so
 * the page can offer to start it again; nothing it already found is lost.
 */
export async function understandingView(journeyId: string, now = new Date()): Promise<UnderstandingView> {
  const reading = await readingRow(journeyId);
  if (!reading) return { status: "idle", stage: null, finished: [], counts: NO_COUNTS, findings: [], notes: [] };
  const lapsed = reading.status === "running" && (!reading.leaseUntil || reading.leaseUntil < now);
  return {
    status: lapsed ? "failed" : reading.status,
    stage: lapsed ? null : reading.stage ?? null,
    finished: reading.finishedJson ?? [],
    counts: reading.countsJson ?? NO_COUNTS,
    findings: await findingViews(journeyId, reading.runId),
    notes: reading.notesJson ?? [],
  };
}
