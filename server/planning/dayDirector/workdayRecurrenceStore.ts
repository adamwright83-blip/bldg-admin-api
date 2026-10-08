import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { dayDirectorRecurrenceRules } from "../../../drizzle/schema";
import type { DayDirectorKind } from "../../../shared/claireWorkdayCommand";
import { getDb } from "../../db";

export type DayDirectorRecurrenceRule = {
  id: string;
  tenantId: string;
  actorId: string;
  sourceIdentity: string;
  title: string;
  kind: DayDirectorKind;
  weekday: string;
  windowStart: string | null;
  windowEnd: string | null;
  sourceText: string | null;
  status: "active" | "cancelled";
};

function normalize(stored: typeof dayDirectorRecurrenceRules.$inferSelect): DayDirectorRecurrenceRule {
  return {
    id: stored.id,
    tenantId: stored.tenantId,
    actorId: stored.actorId,
    sourceIdentity: stored.sourceIdentity,
    title: stored.title,
    kind: stored.kind,
    weekday: stored.weekday,
    windowStart: stored.windowStart,
    windowEnd: stored.windowEnd,
    sourceText: stored.sourceText,
    status: stored.status,
  };
}

function assertAuthority(input: { tenantId: string; actorId: string }): void {
  if (!input.tenantId.trim()) throw new Error("Recurrence rule requires tenant authority");
  if (!input.actorId.trim()) throw new Error("Recurrence rule requires actor authority");
}

export async function persistDayDirectorRecurrenceRule(input: {
  tenantId: string;
  actorId: string;
  sourceIdentity: string;
  title: string;
  kind: DayDirectorKind;
  weekday: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  sourceText: string;
}): Promise<DayDirectorRecurrenceRule> {
  assertAuthority(input);
  if (!input.sourceIdentity.trim()) throw new Error("Recurrence source identity is required");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const id = randomUUID();
  const weekday = input.weekday.toLowerCase();
  await db
    .insert(dayDirectorRecurrenceRules)
    .values({
      id,
      tenantId: input.tenantId,
      actorId: input.actorId,
      sourceIdentity: input.sourceIdentity,
      title: input.title.trim().slice(0, 255),
      kind: input.kind,
      weekday,
      windowStart: input.windowStart ?? null,
      windowEnd: input.windowEnd ?? null,
      sourceText: input.sourceText,
      status: "active",
    })
    .onDuplicateKeyUpdate({
      set: {
        title: input.title.trim().slice(0, 255),
        kind: input.kind,
        weekday,
        windowStart: input.windowStart ?? null,
        windowEnd: input.windowEnd ?? null,
        sourceText: input.sourceText,
        status: "active",
      },
    });
  const [stored] = await db
    .select()
    .from(dayDirectorRecurrenceRules)
    .where(
      and(
        eq(dayDirectorRecurrenceRules.tenantId, input.tenantId),
        eq(dayDirectorRecurrenceRules.actorId, input.actorId),
        eq(dayDirectorRecurrenceRules.sourceIdentity, input.sourceIdentity)
      )
    )
    .limit(1);
  if (!stored) throw new Error("Recurrence rule was not persisted");
  return normalize(stored);
}

export async function cancelDayDirectorRecurrenceRule(input: {
  tenantId: string;
  actorId: string;
  ruleId: string;
}): Promise<{ ok: true }> {
  assertAuthority(input);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(dayDirectorRecurrenceRules)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(dayDirectorRecurrenceRules.tenantId, input.tenantId),
        eq(dayDirectorRecurrenceRules.actorId, input.actorId),
        eq(dayDirectorRecurrenceRules.id, input.ruleId)
      )
    );
  return { ok: true };
}

export async function listActiveDayDirectorRecurrenceRules(input: {
  tenantId: string;
  actorId: string;
}): Promise<DayDirectorRecurrenceRule[]> {
  assertAuthority(input);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(dayDirectorRecurrenceRules)
    .where(
      and(
        eq(dayDirectorRecurrenceRules.tenantId, input.tenantId),
        eq(dayDirectorRecurrenceRules.actorId, input.actorId),
        eq(dayDirectorRecurrenceRules.status, "active")
      )
    );
  return rows.map(normalize);
}
