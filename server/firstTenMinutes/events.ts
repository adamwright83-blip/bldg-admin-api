import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { firstTenDb } from "./store";
import { firstTenEvents } from "./schema";

/**
 * What the person decided, in order, append-only. Only the person's own acts are recorded here (a confirmation, a
 * correction, later a draft prepared or a message handed off); nothing here claims an outcome in the world.
 */
export type JourneyEventKind =
  | "finding_confirmed"
  | "finding_changed"
  | "finding_dismissed"
  | "portrait_kept"
  | "portrait_changed"
  | "chapter_revealed"
  | "letter_step"
  | "letter_written"
  | "draft_prepared"
  | "draft_changed"
  | "draft_declined"
  | "activation_started"
  | "draft_handed_off"
  | "draft_reported_sent"
  | "draft_not_sent_yet"
  | "draft_verified_sent"
  | "first_chapter_opened"
  | "claire_answered"
  | "claire_unanswered";

export async function recordEvent(journeyId: string, kind: JourneyEventKind, payload: Record<string, unknown>): Promise<void> {
  const db = await firstTenDb();
  await db.insert(firstTenEvents).values({ id: randomUUID(), journeyId, kind, payloadJson: payload });
}

export async function journeyEvents(journeyId: string) {
  const db = await firstTenDb();
  return db.select().from(firstTenEvents).where(eq(firstTenEvents.journeyId, journeyId)).orderBy(asc(firstTenEvents.createdAt));
}
