/**
 * Smallest durable recurrence for operator-confirmed Day Line work.
 *
 * A recurrence rule is not an order. It is authority to project one Day
 * Director commitment onto matching future business dates. Historical
 * cadence never creates a rule.
 *
 * `projectRecurrenceForDate` is an execution write. Daily Command's reader
 * must not call it. Mission Director calls it only from `planForDate`, the
 * path that persists the day's plan — never from the persistence-free compute.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { dayDirectorRecurrenceRules } from "../../drizzle/schema";
import { getDb } from "../db";
import { weekdayOf } from "./briefing/briefingTiming";
import { acceptProposal } from "../dayDirector/dayDirectorService";
import { emptyCommandMetadata } from "../../shared/claireWorkdayCommand";
import type { DayDirectorKind } from "../../shared/claireWorkdayCommand";

export type RecurrenceRule = {
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

export function recurrenceSourceIdentity(input: { actorId: string; title: string; weekday: string }): string {
  return createHash("sha256")
    .update(`${input.actorId}|${input.title.trim().toLowerCase()}|${input.weekday}`)
    .digest("hex")
    .slice(0, 40);
}

export function recurrenceIdempotencyKey(ruleId: string, businessDate: string): string {
  return `recurrence:${ruleId}:${businessDate}`;
}

export function shouldProjectRule(rule: Pick<RecurrenceRule, "status" | "weekday">, businessDate: string): boolean {
  return rule.status === "active" && weekdayOf(businessDate) === rule.weekday;
}

export async function confirmRecurrenceRule(input: {
  tenantId: string;
  actorId: string;
  title: string;
  kind: DayDirectorKind;
  weekday: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  sourceText: string;
}): Promise<RecurrenceRule> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const sourceIdentity = recurrenceSourceIdentity(input);
  const id = randomUUID();
  const weekday = input.weekday.toLowerCase();
  await db
    .insert(dayDirectorRecurrenceRules)
    .values({
      id,
      tenantId: input.tenantId,
      actorId: input.actorId,
      sourceIdentity,
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
        eq(dayDirectorRecurrenceRules.sourceIdentity, sourceIdentity)
      )
    )
    .limit(1);
  if (!stored) throw new Error("Recurrence rule was not persisted");
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

export async function cancelRecurrenceRule(input: {
  tenantId: string;
  actorId: string;
  ruleId: string;
}): Promise<{ ok: true }> {
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

export async function listActiveRecurrenceRules(input: {
  tenantId: string;
  actorId: string;
}): Promise<RecurrenceRule[]> {
  const db = await getDb();
  if (!db) return [];
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
  return rows.map(stored => ({
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
  }));
}

export async function projectRecurrenceForDate(
  input: { tenantId: string; actorId: string; businessDate: string },
  deps: { accept?: typeof acceptProposal; listRules?: typeof listActiveRecurrenceRules } = {}
): Promise<{ projectedIds: string[]; created: number }> {
  const listRules = deps.listRules ?? listActiveRecurrenceRules;
  const accept = deps.accept ?? acceptProposal;
  const rules = await listRules({ tenantId: input.tenantId, actorId: input.actorId });
  const projectedIds: string[] = [];
  let created = 0;
  for (const rule of rules) {
    if (!shouldProjectRule(rule, input.businessDate)) continue;
    const command = emptyCommandMetadata();
    command.role = "fixed";
    command.recurrenceRuleId = rule.id;
    command.constraints.windowStart = rule.windowStart;
    command.constraints.windowEnd = rule.windowEnd;
    const stored = await accept({
      tenantId: input.tenantId,
      actorId: input.actorId,
      businessDate: input.businessDate,
      proposal: {
        promptKey: recurrenceIdempotencyKey(rule.id, input.businessDate),
        title: rule.title,
        kind: rule.kind,
        quantity: null,
        sourceText: rule.sourceText ?? rule.title,
        prerequisites: [],
        question: null,
        intelligence: "manual_fallback",
        command,
      },
    });
    const id = stored && typeof stored === "object" && "id" in stored ? String((stored as { id?: unknown }).id ?? "") : "";
    if (id) {
      projectedIds.push(id);
      created += 1;
    }
  }
  return { projectedIds, created };
}
