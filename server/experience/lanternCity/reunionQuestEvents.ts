/**
 * Silver Lake reunion quests: the append-only store behind them (docs/goldline/silver-lake-3d-slice/REUNION_QUESTS.md).
 *
 * Rows are written by the selected business (`ctx.tenantId`) and name the signed-in operator. They record fiction
 * progress and the operator's explicit pass; they are never an outreach state and nothing else reads them.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { silverLakeReunionEvents } from "../../../drizzle/schema";
import { getDb } from "../../db";
import {
  REUNION_PROGRESS_HOLDS_DAYS,
  REUNION_TEMPLATE_ID_RE,
  type ReunionEvent,
  type ReunionEventKind,
} from "../../../shared/silverLakeReunionEvents";

const MAX_EVENTS = 500;

function allowTestFallback(): boolean {
  return process.env.NODE_ENV === "test" && !process.env.DATABASE_URL;
}
const testStore: Array<ReunionEvent & { tenantId: string; territoryId: string; operatorId: string }> = [];

export async function recordReunionEvent(input: {
  tenantId: string;
  territoryId: string;
  operatorId: string;
  customerId: string;
  templateId: string;
  kind: ReunionEventKind;
  now?: Date;
}): Promise<{ ok: true }> {
  const customerId = input.customerId.trim();
  if (!customerId) throw new Error("A reunion event needs a customer.");
  if (!REUNION_TEMPLATE_ID_RE.test(input.templateId)) throw new Error("Unknown reunion quest template.");
  const createdAt = input.now ?? new Date();
  const db = await getDb();
  if (!db) {
    if (!allowTestFallback()) throw new Error("Reunion quest progress could not be saved: no database.");
    testStore.push({ ...input, customerId, createdAt: createdAt.toISOString() });
    return { ok: true };
  }
  await db.insert(silverLakeReunionEvents).values({
    id: `slre_${randomUUID()}`,
    tenantId: input.tenantId,
    territoryId: input.territoryId,
    customerId,
    operatorId: input.operatorId,
    templateId: input.templateId,
    eventKind: input.kind,
    createdAt,
  });
  return { ok: true };
}

export async function listReunionEvents(input: {
  tenantId: string;
  territoryId: string;
  now?: Date;
}): Promise<ReunionEvent[]> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - REUNION_PROGRESS_HOLDS_DAYS * 24 * 60 * 60 * 1000);
  const db = await getDb();
  if (!db) {
    if (!allowTestFallback()) throw new Error("Reunion quest progress could not be read: no database.");
    return testStore
      .filter(e => e.tenantId === input.tenantId && e.territoryId === input.territoryId && e.createdAt >= since.toISOString())
      .map(({ customerId, templateId, kind, createdAt }) => ({ customerId, templateId, kind, createdAt }));
  }
  const rows = await db
    .select()
    .from(silverLakeReunionEvents)
    .where(
      and(
        eq(silverLakeReunionEvents.tenantId, input.tenantId),
        eq(silverLakeReunionEvents.territoryId, input.territoryId),
        gte(silverLakeReunionEvents.createdAt, since)
      )
    )
    .orderBy(desc(silverLakeReunionEvents.createdAt))
    .limit(MAX_EVENTS);
  return rows
    .filter(r => r.eventKind === "item_found" || r.eventKind === "reunited" || r.eventKind === "passed")
    .map(r => ({
      customerId: r.customerId,
      templateId: r.templateId,
      kind: r.eventKind as ReunionEventKind,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
}
