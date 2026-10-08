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

import { createHash } from "node:crypto";
import {
  cancelDayDirectorRecurrenceRule,
  listActiveDayDirectorRecurrenceRules,
  persistDayDirectorRecurrenceRule,
  type DayDirectorRecurrenceRule,
} from "../planning/dayDirector/workdayRecurrenceStore";
import { weekdayOf } from "./briefing/briefingTiming";
import { acceptProposal } from "../planning/dayDirector/dayDirectorService";
import { emptyCommandMetadata } from "../../shared/claireWorkdayCommand";
import type { DayDirectorKind } from "../../shared/claireWorkdayCommand";

export type RecurrenceRule = DayDirectorRecurrenceRule;

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
  return persistDayDirectorRecurrenceRule({
    ...input,
    sourceIdentity: recurrenceSourceIdentity(input),
  });
}

export async function cancelRecurrenceRule(input: {
  tenantId: string;
  actorId: string;
  ruleId: string;
}): Promise<{ ok: true }> {
  return cancelDayDirectorRecurrenceRule(input);
}

export async function listActiveRecurrenceRules(input: {
  tenantId: string;
  actorId: string;
}): Promise<RecurrenceRule[]> {
  return listActiveDayDirectorRecurrenceRules(input);
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
