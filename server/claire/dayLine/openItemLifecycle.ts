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

/**
 * Day Line titles are often the operator's own words: "I have to mail 4 former customers to try to get
 * them to order laundry pickups with me again." Spoken back verbatim that became "Did you i have to mail
 * 4 former customers…?" on the 2026-10-22 evening call. The action is what Claire says: "mail 4 former
 * customers".
 */
export function spokenAction(title: string): string {
  let text = title.replace(/\s+/g, " ").replace(/[.?!]+$/g, "").trim();
  text = text.replace(
    /^(?:(?:so|ok|okay|and|also|remember|reminder)[:,]?\s+)*(?:i(?:'ve| have)? (?:got|need|have|want|ought|should|must|will|'ll)?\s*(?:to\s+)?|i'll\s+|i will\s+|i should\s+|i must\s+|i need\s+to\s+|need to\s+|have to\s+|got to\s+|gotta\s+|remember to\s+|must\s+|should\s+)/i,
    ""
  );
  // The purpose clause is the operator's reason, not the action.
  text = text.replace(/\s+(?:to try to|to try and|in order to|so that|so they|so he|so she|to get (?:them|him|her) to)\b.*$/i, "");
  text = text
    .replace(/\bme\b/gi, "you")
    .replace(/\bmy\b/gi, "your")
    .replace(/\bmyself\b/gi, "yourself");
  return text.trim() || title.trim();
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};
const COUNT = /\b(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s+(?:more\s+|of (?:them|the)\s+|(?:former|old|past|new|regular|lapsed)\s+)*([a-z]{3,})/gi;

function countsIn(text: string): Array<{ n: number; noun: string }> {
  const out: Array<{ n: number; noun: string }> = [];
  for (const match of text.matchAll(COUNT)) {
    const raw = match[1]!.toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    if (n != null) out.push({ n, noun: match[2]!.toLowerCase().replace(/(?:es|s)$/, "") });
  }
  return out;
}

/** "Mail 4 former customers" answered with "I texted 1 former customer": 1 of 4, not done. */
export function partialCount(title: string, reply: string): { done: number; of: number; noun: string } | null {
  const target = countsIn(title).find(count => count.n > 1);
  if (!target) return null;
  const reported = countsIn(reply).find(count => count.noun === target.noun || count.noun.startsWith(target.noun) || target.noun.startsWith(count.noun));
  if (!reported || reported.n >= target.n) return null;
  return { done: reported.n, of: target.n, noun: target.noun };
}

/** A yes/no question the operator can answer in a word: "Did you call Dana?" */
export function agendaQuestion(title: string): string {
  const clean = spokenAction(title);
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
  /** Some of a counted item, not all of it. Nothing is closed. */
  | { kind: "progress"; done: number; of: number; noun: string }
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
  /^(?:yes|yeah|yep|yup|sure|done|did it|all done|finished|handled|already)\b|\b(?:i (?:already |just )?(?:called|did|sent|emailed|mailed|texted|spoke|talked|handled|took care|reached|met|visited|dropped off|delivered|finished)|it'?s (?:done|handled|taken care of)|took care of (?:it|that)|i got (?:to|hold of) (?:him|her|them))\b/i;

/** Reads the operator's answer to an agenda question. "Not this week" moves it; "never again" closes it. */
/**
 * A question is never the answer to Claire's yes/no. "What do you want me to do tomorrow?" names a
 * day but disposes of nothing; reading it as "snooze" moved Call Dana and cancelled its older copies
 * on a turn that only asked for the plan (W9, 2026-10-21). No disposition means no write.
 */
const QUESTION_OPENER =
  /^(?:and |so |okay |ok |well |hey |but )?(?:what|what's|whats|when|where|who|why|how|which|tell me|(?:do|does|did) (?:i|you|we|they|he|she)|(?:should|shall|can|could|would|will|is|are|was|were|have|has) (?:i|you|we|they|he|she|it|that|this|there))\b/i;

export function isQuestion(text: string): boolean {
  return /\?/.test(text) || QUESTION_OPENER.test(text.trim());
}

export function interpretOpenItemReply(utterance: string, today: string, itemTitle?: string): OpenItemDecision {
  const text = utterance.trim();
  if (!text) return { kind: "unclear" };
  if (isQuestion(text)) return { kind: "unclear" };
  // 2026-10-22: "I sent a text message to 1 former customer" closed "mail 4 former customers".
  const partial = itemTitle ? partialCount(itemTitle, text) : null;
  if (partial && !DROP.test(text)) return { kind: "progress", ...partial };
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
      speak: `I tried, but I couldn't verify that "${spokenAction(item.title)}" changed, so treat it as still open.`,
    };
  }
  const folded = otherIds.length ? ` and cleared ${otherIds.length} older ${otherIds.length === 1 ? "copy" : "copies"}` : "";
  const action = spokenAction(item.title);
  const speak =
    decision.kind === "done"
      ? `Marked "${action}" done${folded}.`
      : decision.kind === "drop"
        ? `Dropped "${action}"${folded}. It's off the line.`
        : `Moved "${action}" to ${spokenDay(decision.until, input.today)}${folded}.`;
  return { applied: true, verified: true, speak };
}
