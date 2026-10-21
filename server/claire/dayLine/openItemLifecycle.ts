/**
 * Open-item lifecycle: one carried item, one yes/no question, a governed way to close it.
 *
 * Production, 2026-09-21 to 2026-10-20: four open "Call Dana" commitments (09-21, 09-22, "Call Dana
 * Tuesday" 09-29, and 10-13) stayed open for a month. Claire opened calls on 10-13, 10-16, 10-18 and
 * 10-20 with the same overdue Louise item and never asked "did you call Dana?" as a yes/no, never offered
 * to close, drop or reschedule it, and on 10-13 Adam said "I will resolve this so that you never talk
 * about it again" without anything changing.
 *
 * - `collapseOpenCommitments` makes the same commitment open on several business dates ONE item with its age.
 * - `agendaQuestion` turns it into a yes/no question.
 * - `interpretOpenItemReply` reads "done", "drop it", "never talk about it again", "not this week".
 * - `applyOpenItemDecision` closes / drops / moves it through the existing governed writers
 *   (completeDayDirectorCommitment, cancelDayLineItem, moveDayDirectorCommitment), reads the Day Line back,
 *   and only then speaks what changed. A write that cannot be verified is spoken as unverified.
 */
import { addDaysYmd, daysInclusive } from "../../analytics/businessPeriods";
import { spokenDay, weekdayOf } from "../briefing/briefingTiming";
import type { DayLineItemRef } from "../../../shared/goldlineDayLine";
import type {
  completeDayDirectorCommitment,
  getDayDirectorState,
  moveDayDirectorCommitment,
} from "../../planning/dayDirector/dayDirectorService";
import type { cancelDayLineItem } from "../../planning/dayline/dayLineMutationService";
import { normalizeTitleKey } from "./buildingDedupe";

export type OpenCommitment = { id: string; title: string; businessDate: string; status: "open" | "completed" };

export type CarriedOpenItem = {
  /** Latest row. The one that stays if the operator keeps the item. */
  keeperId: string;
  /** Every open row for this commitment, keeper included. */
  ids: string[];
  rows: Array<{ id: string; businessDate: string }>;
  title: string;
  firstDate: string;
  lastDate: string;
  /** Days since it first appeared on the Day Line. */
  ageDays: number;
  dates: string[];
  question: string;
};

const DAY_WORDS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "today", "tomorrow", "tonight"]);

function lineKeyTokens(title: string): string[] {
  return normalizeTitleKey(title)
    .split(" ")
    .filter(token => token && !DAY_WORDS.has(token));
}

/** "call dana" and "call dana to resolve the overdue louise follow up" are the same commitment. */
function sameCommitment(a: string[], b: string[]): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 2 && short.every((token, index) => long[index] === token);
}

const lowerFirst = (text: string) => (text ? text.charAt(0).toLowerCase() + text.slice(1) : text);

const PERSON_VERBS = /^(call|email|text|message|visit|ask|meet|see|follow up with|reach out to|phone|ping|talk to|speak to|check in with)\s+/i;

/** A yes/no question the operator can answer in a word: "Did you call Dana?" */
export function agendaQuestion(title: string): string {
  const clean = title.replace(/\s+/g, " ").replace(/[.?!]+$/g, "").trim();
  const withoutDay = clean.replace(/\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)$/i, "");
  const verb = PERSON_VERBS.exec(withoutDay);
  if (verb) {
    const rest = withoutDay.slice(verb[0].length);
    const name = /^((?:[A-Z][\w'’.-]*)(?:\s+[A-Z][\w'’.-]*){0,2})/.exec(rest)?.[1];
    if (name) return `Did you ${verb[1]!.toLowerCase()} ${name}?`;
  }
  return `Did you ${lowerFirst(withoutDay || clean)}?`;
}

export function collapseOpenCommitments(items: OpenCommitment[], today: string): CarriedOpenItem[] {
  const open = items.filter(item => item.status === "open");
  const groups: Array<{ tokens: string[]; rows: OpenCommitment[] }> = [];
  for (const row of [...open].sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id))) {
    const tokens = lineKeyTokens(row.title);
    const group = tokens.length ? groups.find(candidate => sameCommitment(candidate.tokens, tokens)) : undefined;
    if (group) {
      group.rows.push(row);
      if (tokens.length < group.tokens.length) group.tokens = tokens;
    } else groups.push({ tokens, rows: [row] });
  }
  const carried: CarriedOpenItem[] = [];
  for (const { rows } of groups) {
    const dates = [...new Set(rows.map(row => row.businessDate))].sort();
    if (dates[0]! >= today) continue; // not carried: only today's or later
    const keeper = [...rows].sort((a, b) => b.businessDate.localeCompare(a.businessDate) || b.id.localeCompare(a.id))[0]!;
    carried.push({
      keeperId: keeper.id,
      ids: rows.map(row => row.id),
      rows: rows.map(row => ({ id: row.id, businessDate: row.businessDate })),
      title: keeper.title,
      firstDate: dates[0]!,
      lastDate: dates[dates.length - 1]!,
      ageDays: Math.max(0, daysInclusive(dates[0]!, today) - 1),
      dates,
      question: agendaQuestion(keeper.title),
    });
  }
  return carried.sort((a, b) => b.ageDays - a.ageDays || a.title.localeCompare(b.title));
}

export type OpenItemDecision =
  | { kind: "done" }
  | { kind: "drop" }
  | { kind: "snooze"; until: string }
  | { kind: "still_open" }
  | { kind: "unclear" };

function nextWeekdayAfter(today: string, weekday: string): string {
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = addDaysYmd(today, offset);
    if (weekdayOf(candidate) === weekday) return candidate;
  }
  return addDaysYmd(today, 7);
}

const DROP =
  /\b(?:drop (?:it|that|this)|kill (?:it|that|this)|forget (?:it|that|about (?:it|that))|take (?:it|that) off|remove (?:it|that)|cancel (?:it|that)|scratch (?:it|that)|not doing (?:it|that)|i(?:'m| am) not (?:going to|gonna) (?:do|call|chase)|never (?:talk|bring|ask|speak|mention)[^.?!]{0,40}(?:again|anymore|any more)|stop (?:asking|bringing|raising|mentioning)[^.?!]{0,30})\b/i;
const NEGATION = /\b(?:no|nope|not yet|didn'?t|did not|haven'?t|have not|never did|not really)\b/i;
const DONE =
  /^(?:yes|yeah|yep|yup|sure|done|did it|all done|finished|handled|already)\b|\b(?:i (?:already |just )?(?:called|did|sent|emailed|texted|spoke|talked|handled|took care|reached|met|visited)|it'?s (?:done|handled|taken care of)|took care of (?:it|that)|i got (?:to|hold of) (?:him|her|them))\b/i;

/** Reads the operator's answer to an agenda question. "Not this week" moves it; "never again" closes it. */
export function interpretOpenItemReply(utterance: string, today: string): OpenItemDecision {
  const text = utterance.trim();
  if (!text) return { kind: "unclear" };
  if (DROP.test(text)) return { kind: "drop" };
  if (/\bnot this week\b/i.test(text) || /\b(?:next week|after the weekend|this weekend)\b/i.test(text)) {
    return { kind: "snooze", until: nextWeekdayAfter(today, "monday") };
  }
  const named = /\b(?:on |until |next )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(text);
  if (named && /\b(?:not|later|push|move|remind|hold|wait|on|until|next)\b/i.test(text)) {
    return { kind: "snooze", until: nextWeekdayAfter(today, named[1]!.toLowerCase()) };
  }
  if (/\b(?:tomorrow|later|not today|not now)\b/i.test(text) && !DONE.test(text)) {
    return { kind: "snooze", until: addDaysYmd(today, 1) };
  }
  if (NEGATION.test(text) && !/\b(?:no problem|no worries)\b/i.test(text)) return { kind: "still_open" };
  if (DONE.test(text)) return { kind: "done" };
  return { kind: "unclear" };
}

export type OpenItemDeps = {
  complete: typeof completeDayDirectorCommitment;
  cancel: typeof cancelDayLineItem;
  move: typeof moveDayDirectorCommitment;
  readState: typeof getDayDirectorState;
};

function ref(item: { id: string; title: string }): DayLineItemRef {
  return {
    sourceType: "day_director_commitment",
    sourceId: item.id,
    displayTitle: item.title,
    accountName: item.title,
    actionId: item.id,
    editableCapabilities: ["dayline.edit", "dayline.cancel", "dayline.complete"],
    status: "active",
  };
}

async function rowsOn(deps: OpenItemDeps, target: { tenantId: string; actorId: string }, date: string) {
  const state = await deps.readState({ tenantId: target.tenantId, actorId: target.actorId, businessDate: date });
  return new Map((state.commitments ?? []).map(row => [row.id, row] as const));
}

export type OpenItemOutcome = { applied: boolean; verified: boolean; speak: string };

/**
 * Applies the operator's decision through the governed writers and reads the Day Line back before
 * saying anything changed. Older duplicate rows are cancelled with a reason that names the keeper.
 */
export async function applyOpenItemDecision(input: {
  decision: Extract<OpenItemDecision, { kind: "done" | "drop" | "snooze" }>;
  item: CarriedOpenItem;
  target: { tenantId: string; actorId: string };
  operatorWords: string;
  today: string;
  deps: OpenItemDeps;
}): Promise<OpenItemOutcome> {
  const { decision, item, target, deps } = input;
  const words = input.operatorWords.replace(/\s+/g, " ").trim().slice(0, 200);
  const otherIds = item.ids.filter(id => id !== item.keeperId);
  const failures: string[] = [];
  const cancel = async (id: string, reason: string) => {
    try {
      await deps.cancel({ tenantId: target.tenantId, actorId: target.actorId, item: ref({ id, title: item.title }), reason });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  };
  const keeperDate = item.rows.find(row => row.id === item.keeperId)?.businessDate ?? item.lastDate;

  try {
    if (decision.kind === "done") {
      await deps.complete({ tenantId: target.tenantId, actorId: target.actorId, commitmentId: item.keeperId });
      for (const id of otherIds) await cancel(id, `folded into ${item.keeperId}: same commitment, reported done (${words})`);
    } else if (decision.kind === "drop") {
      for (const id of item.ids) await cancel(id, `operator dropped it: ${words}`);
    } else {
      const moved = await deps.move({
        tenantId: target.tenantId,
        actorId: target.actorId,
        commitmentId: item.keeperId,
        fromBusinessDate: keeperDate,
        toBusinessDate: decision.until,
      });
      if (!moved) failures.push("the item changed before it could be moved");
      for (const id of otherIds) await cancel(id, `folded into ${item.keeperId}: same commitment, moved to ${decision.until} (${words})`);
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  // Readback: a cancelled row is hidden by the reader; the keeper must be in its expected state.
  let verified = false;
  if (!failures.length) {
    try {
      const probeDates = [...new Set([...item.dates, decision.kind === "snooze" ? decision.until : keeperDate])];
      const seen = new Map<string, { status: string; date: string }>();
      for (const date of probeDates) for (const [id, row] of await rowsOn(deps, target, date)) seen.set(id, { status: row.status, date });
      const keeper = seen.get(item.keeperId);
      const othersGone = otherIds.every(id => !seen.has(id));
      verified =
        decision.kind === "done"
          ? keeper?.status === "completed" && othersGone
          : decision.kind === "drop"
            ? !keeper && othersGone
            : keeper?.status === "open" && keeper.date === decision.until && othersGone;
    } catch {
      verified = false;
    }
  }
  if (failures.length || !verified) {
    return {
      applied: false,
      verified: false,
      speak: `I tried, but I couldn't verify that ${item.title} changed, so treat it as still open.`,
    };
  }
  const folded = otherIds.length ? ` and cleared ${otherIds.length} older ${otherIds.length === 1 ? "copy" : "copies"}` : "";
  const speak =
    decision.kind === "done"
      ? `Marked ${item.title} done${folded}.`
      : decision.kind === "drop"
        ? `Dropped ${item.title}${folded}. It's off the line.`
        : `Moved ${item.title} to ${spokenDay(decision.until, input.today)}${folded}.`;
  return { applied: true, verified: true, speak };
}
