import { joinList } from "../business/businessSpeech";
import { spokenDay, timingSortKey } from "./briefingTiming";
import type { BriefingItem, ParsedBriefing } from "./briefingTypes";

/**
 * Claire demonstrates she understood the whole briefing before asking
 * anything, and asks one confirmation for the whole bundle — never a yes/no
 * per line.
 */

const VERB_START =
  /^(?:pick ?up|pickup|pick|drop|deliver|drive|go|head|deposit|make|call|text|email|visit|stop|swing|grab|buy|get|bring|return|collect|run|meet|finish|print|prep|prepare|send|order|wash|fold|clean|check|take|load|unload|fix|book|pay|follow|remind|put|add|schedule|handle|restock|do|pitch|see|write|draft|update|file|process|sort)\b/i;

const PAST_START =
  /^(?:delivered|dropped off|picked up|finished|completed|did|made|deposited|called|texted|emailed|visited|went to|sent|paid|returned|collected|cleaned|fixed|handled|took care of|got|pitched|stopped by|swung by)\b/i;

function lowerVerb(title: string): string {
  return VERB_START.test(title) ? title.charAt(0).toLowerCase() + title.slice(1) : title;
}

function spokenTitle(item: BriefingItem): string {
  const first = item.title.split(/\s+/)[0] ?? "";
  // Keep Adam's casing: a word he said in lowercase ("payroll deposit") stays lowercase mid-sentence.
  if (first && /^[A-Z][a-z]/.test(first) && new RegExp(`\\b${first.toLowerCase()}\\b`).test(item.quote)) {
    return item.title.charAt(0).toLowerCase() + item.title.slice(1);
  }
  return lowerVerb(item.title);
}

function spokenItem(item: BriefingItem): string {
  const timing = item.timing.kind === "none" ? "" : ` ${item.timing.label}`;
  return `${spokenTitle(item)}${timing}`;
}

function spokenCompleted(item: BriefingItem): string {
  const title = item.title.replace(/^(?:i|we)\s+/i, "");
  if (PAST_START.test(title) || /^(?:already|just)\b/i.test(title)) return `You ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
  return item.title;
}

function inSpokenOrder(items: BriefingItem[]): BriefingItem[] {
  // Keep Adam's order; only items with an explicit clock time settle into time order among themselves.
  const timed = items.filter(item => item.timing.kind !== "none" && item.timing.kind !== "daypart");
  if (timed.length < 2) return items;
  const sortedTimed = [...timed].sort((a, b) => timingSortKey(a.timing).localeCompare(timingSortKey(b.timing)));
  let cursor = 0;
  return items.map(item => (item.timing.kind !== "none" && item.timing.kind !== "daypart" ? sortedTimed[cursor++]! : item));
}

/** Items a confirmation would actually write: new work not already tracked, and completed work. */
export function briefingAdditions(parsed: ParsedBriefing): BriefingItem[] {
  return parsed.items.filter(item => item.kind === "completed" || !item.existing);
}

export function speakBriefingSummary(input: {
  parsed: ParsedBriefing;
  today: string;
  answers?: string[];
  surface: "voice" | "text";
  continuing?: boolean;
}): { text: string; asksConfirmation: boolean } {
  const { parsed, today } = input;
  const sentences: string[] = [];
  const completed = parsed.items.filter(item => item.kind === "completed");
  const work = parsed.items.filter(item => item.kind === "new_work" && !item.existing);
  const already = parsed.items.filter(item => item.kind === "new_work" && item.existing);

  sentences.push(input.continuing ? "Got that too." : "Got it.");
  for (const item of completed) sentences.push(`${spokenCompleted(item)}.`);
  const days = Array.from(new Set(work.map(item => item.businessDate))).sort();
  for (const day of days) {
    const items = inSpokenOrder(work.filter(item => item.businessDate === day));
    const label = spokenDay(day, today);
    const lead = day === today ? "For today" : label === "tomorrow" ? "Tomorrow" : `For ${label}`;
    sentences.push(`${lead}: ${joinList(items.map(spokenItem))}.`);
  }
  for (const item of already) {
    sentences.push(
      item.existing?.source === "campaign"
        ? `${item.title} is already part of the campaign, so I won't add it again.`
        : `${item.title} is already on your line.`
    );
  }
  for (const answer of input.answers ?? []) sentences.push(answer);
  const question = work.find(item => item.needs)?.needs ?? null;
  const addable = work.length + completed.length;
  if (question) sentences.push(`One thing: ${question}`);
  if (addable > 0) {
    sentences.push(
      work.length === 0
        ? completed.length === 1
          ? "Want me to log that as done?"
          : "Want me to log those as done?"
        : addable === 1
          ? "Want me to put that on the Day Line?"
          : addable === 2
            ? "Want me to put both on the Day Line?"
            : "Want me to put all of that on the Day Line?"
    );
  }
  return { text: sentences.join(" ").replace(/\s+/g, " ").trim(), asksConfirmation: addable > 0 };
}
