import { getDayDirectorState } from "../../dayDirector/dayDirectorService";
import { getFieldToday } from "../../field/fieldTodayService";
import { addDaysYmd } from "../../analytics/businessPeriods";
import { zonedYmd } from "../../dashboardZoned";
import { joinList, plural } from "../business/businessSpeech";
import { isProductionVisibleBusinessRecord } from "./productionVisibility";

/**
 * "What do I have left today?", "What did I finish?", "What's tomorrow?"
 *
 * The Day Line as the operator actually sees it: Day Director commitments
 * (what Adam told Claire or typed) plus Field Today's authoritative route
 * work (pickups, deliveries, commercial follow-ups). Day Director rows are
 * read directly — Field Today does not include them, which is why Claire
 * previously could save work that never appeared in her own picture.
 */

export type DayWorkItem = {
  id: string;
  title: string;
  status: "open" | "completed";
  source: "day_line" | "route";
  timing: string | null;
  completedAt: string | null;
};

export type DayWork = { businessDate: string; open: DayWorkItem[]; completed: DayWorkItem[]; routeAvailable: boolean };

export type OperationsQuestion =
  | { kind: "remaining"; day: "today" }
  | { kind: "completed"; day: "today" | "yesterday" }
  | { kind: "day"; day: "tomorrow" | "today" };

export function operationsQuestion(lower: string): OperationsQuestion | null {
  if (/\bwhat (?:did|have) i (?:already )?(?:finish|finished|complete|completed|get done|got done|do|done)\b|\bwhat(?:'s| is| have i) (?:already )?(?:done|finished)\b|\bwhat got done\b/.test(lower)) {
    return { kind: "completed", day: /\byesterday\b/.test(lower) ? "yesterday" : "today" };
  }
  if (/\btomorrow\b/.test(lower) && /\bwhat\b|\bwhat'?s\b|\banything\b|\bschedule\b|\bplan\b|\bsupposed\b/.test(lower) && !/\b(add|put|move|remind|schedule (?:a|the|it))\b/.test(lower)) {
    return { kind: "day", day: "tomorrow" };
  }
  if (
    /\bwhat (?:do i|else do i|have i got|am i) (?:still )?(?:have )?(?:left|remaining|to do)\b|\bwhat(?:'s| is) left\b|\bwhat else (?:do i have|is there|is on)\b|\bwhat do i (?:still )?have (?:left |going on )?today\b|\bwhat(?:'s| is) on (?:my|the) (?:plate|line|day ?line|list)\b|\bwhat(?:'s| is) (?:still )?open today\b|\bwhat commitments do i (?:still )?have\b|\bwhat do i have today\b/.test(
      lower
    )
  ) {
    return { kind: "remaining", day: "today" };
  }
  return null;
}

function timingOf(note: string | null): string | null {
  if (!note) return null;
  const parts = note.split("·").map(part => part.trim()).filter(Boolean);
  const schedule = parts.find(part => /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)|before|after|by|noon|morning|afternoon|evening|tonight|window|anytime)\b/i.test(part));
  return schedule ?? null;
}

export async function loadDayWork(
  input: {
    tenantId: string;
    operatorUserId: string;
    dayDirectorActorId: string;
    businessDate: string;
    now: Date;
    timeZone: string;
  },
  deps: { getState?: typeof getDayDirectorState; getField?: typeof getFieldToday } = {}
): Promise<DayWork> {
  const getState = deps.getState ?? getDayDirectorState;
  const getField = deps.getField ?? getFieldToday;
  const [state, field] = await Promise.all([
    getState({ tenantId: input.tenantId, actorId: input.dayDirectorActorId, businessDate: input.businessDate }),
    getField({
      tenantId: input.tenantId,
      userId: input.operatorUserId,
      includeAllAssignees: false,
      now: input.now,
      timeZone: input.timeZone,
      businessDate: input.businessDate,
    }).catch(error => {
      console.warn("[Claire] field today unavailable for operations answer", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);
  const open: DayWorkItem[] = [];
  const completed: DayWorkItem[] = [];
  for (const commitment of state.commitments) {
    if (
      !isProductionVisibleBusinessRecord({
        note: [commitment.title, commitment.detailNote].filter(Boolean).join(" "),
      })
    ) {
      continue;
    }
    const item: DayWorkItem = {
      id: `day-director:${commitment.id}`,
      title: commitment.title,
      status: commitment.status === "completed" ? "completed" : "open",
      source: "day_line",
      timing: timingOf(commitment.detailNote),
      completedAt: commitment.completedAt,
    };
    (item.status === "completed" ? completed : open).push(item);
  }
  const ROUTE_KINDS = new Set(["pickup", "delivery", "follow_up", "commercial_visit", "commercial_call", "payment_blocker"]);
  for (const entry of field?.timeline ?? []) {
    if (!ROUTE_KINDS.has(entry.kind)) continue;
    if (!isProductionVisibleBusinessRecord({ note: entry.title })) continue;
    const timing = entry.scheduledAt
      ? new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(entry.scheduledAt))
      : null;
    open.push({ id: entry.id, title: entry.title, status: "open", source: "route", timing: timing ? `at ${timing}` : null, completedAt: null });
  }
  return { businessDate: input.businessDate, open, completed, routeAvailable: Boolean(field) };
}

function describe(item: DayWorkItem): string {
  return item.timing ? `${item.title} (${item.timing})` : item.title;
}

export function speakDayWork(work: DayWork, question: OperationsQuestion, surface: "voice" | "text"): string {
  const cap = surface === "voice" ? 8 : 25;
  const list = (items: DayWorkItem[]) => {
    const shown = items.slice(0, cap).map(describe);
    const rest = items.length - shown.length;
    return rest > 0 ? `${shown.join(", ")}, and ${rest} more` : joinList(shown);
  };
  const routeCaveat = work.routeAvailable ? "" : " I couldn't load route stops just now, so that's only the Day Line.";
  if (question.kind === "completed") {
    const label = question.day === "yesterday" ? "Yesterday" : "Today";
    if (!work.completed.length) {
      return `I don't have anything marked finished ${question.day === "yesterday" ? "yesterday" : "today yet"}.${routeCaveat}`;
    }
    return `${label} you finished ${list(work.completed)}.${routeCaveat}`;
  }
  const label = question.day === "tomorrow" ? "tomorrow" : "today";
  if (!work.open.length) {
    return question.kind === "remaining"
      ? `Nothing is left on today's line.${routeCaveat}`
      : `Nothing is on tomorrow's line yet.${routeCaveat}`;
  }
  const count = work.open.length;
  const lead =
    question.kind === "remaining"
      ? `You have ${count} ${plural(count, "thing")} left today`
      : `${label === "tomorrow" ? "Tomorrow" : "Today"} you have ${count} ${plural(count, "thing")}`;
  return `${lead}: ${list(work.open)}.${routeCaveat}`;
}

export function businessDateFor(day: "today" | "tomorrow" | "yesterday", now: Date, timeZone: string): string {
  const today = zonedYmd(now, timeZone);
  return day === "today" ? today : addDaysYmd(today, day === "tomorrow" ? 1 : -1);
}
