import { enforceTitleContract } from "./titleContract";
import { parseSpokenNumber } from "../../analytics/businessPeriods";
import { isCombineRequest } from "../business/businessLanguage";
import { dayMention, parseTiming, TIME_TOKEN } from "./briefingTiming";
import type { BriefingClock, BriefingItem, BriefingTiming, ParsedBriefing } from "./briefingTypes";
import { detectPrimaryDesignation } from "../workdayCommandLanguage";

/**
 * Structural understanding of a briefing without a model: sentences (with
 * telephone fragments re-joined), day sections, list clauses, then context /
 * question / completed / work. It is instant, so it always runs; the model
 * path (llmBriefing.ts) handles messier speech but is validated against the
 * same words and falls back to this.
 */

const ACTION_WORDS =
  "pick ?up|pickup|pick|drop ?off|drop|deliver|delivery|drive|go|head|deposit|make|call|text|email|visit|stop by|swing by|grab|buy|get|bring|return|collect|run|meet|finish(?:ing)?|print(?:ing)?|prep|prepare|send(?:ing)?|order|wash|fold|clean|check|take|load|unload|fix|book|pay|follow up|follow-up|remind|put|add|schedule|handle|ship|mail|post|install|set up|clear|restock|count|do|pitch|see|talk to|write|draft|update|file|process|sort|bag|tag|iron|press";
const ACTION = `(?:${ACTION_WORDS})`;

const LEAD_IN = new RegExp(
  "^(?:(?:and|so|also|plus|oh|um|uh|okay|ok|alright|well|yes|yeah|then|and then|next|after that|first|second|third|finally|lastly|morning|good morning|hey|hi|claire|hey claire)[,.\\s]+)*" +
    "(?:(?:i|we) (?:still )?(?:need|have|has|got|gotta|'ve got|should|must|want) (?:to )?|(?:still )?(?:need|have|got|gotta) to |i need |we need |i'?ll |i will |let'?s |remember to |don'?t forget to |remind me to |make sure (?:i |to )?|gotta |also )?",
  "i"
);

const COMPLETED =
  /^(?:(?:i|we)\s+)?(?:(?:already|just|finally)\s+)?(?:delivered|dropped off|picked up|finished|completed|did|done with|took care of|handled|made|deposited|called|texted|emailed|visited|went to|got|sent|paid|returned|collected|cleaned|fixed|pitched|stopped by|swung by)\b|\b(?:is|was|are|were|got|'s)\s+(?:already\s+|all\s+)?(?:delivered|done|finished|picked up|dropped off|taken care of|handled|complete|completed|paid|sent)\b|^(?:i|we)\s+already\b|^already\b/i;

const QUESTION_START =
  /^(?:how much|how many|how often|what|what's|whats|who|who's|when|which|where|why|did|does|do (?:we|i|you)|is|are|was|were|has|have|can you tell|tell me|give me|compare)\b/i;

const CONTEXT =
  /^(?:(?:it'?s|it is|right now it'?s|the time is|current time is|time is|it'?s currently)\s+(?:about\s+|around\s+|almost\s+|like\s+)?(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|noon)\b|(?:today is|it'?s)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?\.?$|(?:agenda|here'?s (?:my|the) (?:day|agenda|plan)|my day|the plan|today'?s plan|for today|today|tomorrow|this morning)\s*:?$)/i;

const NOISE = /^(?:agenda|morning|good morning|hi|hello|hey|okay|ok|so|alright|um|uh|yeah|yes|anyway|by the way|and|then|and then|actually(?: no)?|no wait|wait|sorry|scratch that|okay so(?: today)?|so today)\W*$/i;
const CORRECTION = /^(?:(?:actually|no|sorry|wait|scratch that)[,\s]+)*(?:make (?:that|it)|i mean|change (?:that|it) to|it'?s)\s+(.+)$/i;

const FYI = /\b(?:just so you know|fyi|for what it'?s worth|heads up|i'?m (?:frustrated|tired|stressed|worried)|keeps me up|says|said|told me|mentioned|wasn'?t there|was not there|not in)\b/i;

const DAY_WORDS =
  /\b(?:(?:for |on |by )?(?:tomorrow|tmrw)(?: morning| afternoon| evening| night)?|today|(?:(?:for |on |by |this |next )?)(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:,?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?)?)\b/gi;

const LEADING_TIMING = new RegExp(
  `^(?:(?:before|by|after|at|around|until)\\s+${TIME_TOKEN}|(?:some ?time |sometime )?(?:this|later this|in the) (?:morning|afternoon|evening)|tonight|first thing|any ?time (?:from )?now (?:to|until|till|through) ${TIME_TOKEN})\\b`,
  "i"
);

const NAME_STOP = new Set([
  "I", "OPUS", "LA", "KITH", "TREATS", "Coast", "Dry", "Cleaners", "Cleaning", "Rodeo", "Drive", "Century", "Park", "East",
  "Lugos", "Lugo", "Lavanderia", "Deliver", "Pickup", "Pick", "Make", "Drop", "Deposit", "Go", "Head", "Call", "Visit", "The",
  "Tomorrow", "Today", "Tonight", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "January",
  "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "AM", "PM",
  "Laundry", "Butler", "Farm", "Goldline", "CleanCloud", "Claire", "Agenda", "Greystar", "Louise", "Maybourne", "Also", "And",
  "Then", "Still", "Need", "Gym", "Payroll", "Towels", "Swing", "Restock", "Order", "Yes", "Front", "Desk", "Put", "Remind",
]);

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "").trim();
}

function capitalizeFirst(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function hasAction(value: string): boolean {
  return new RegExp(`\\b${ACTION}\\b`, "i").test(value);
}

function stripLeadIn(clause: string): string {
  let current = clause.trim();
  for (let i = 0; i < 3; i += 1) {
    const next = current.replace(LEAD_IN, "").trim();
    if (next === current) break;
    current = next;
  }
  return current;
}

/** Remove leading day words and timing phrases, to see what the clause actually does. */
function coreOf(value: string): string {
  let current = stripLeadIn(value.replace(/^(?:and|then|also)\s+/i, ""));
  for (let i = 0; i < 3; i += 1) {
    const next = stripLeadIn(
      current
        .replace(/^(?:tomorrow|tmrw|today|tonight)(?:\s+(?:morning|afternoon|evening|night))?[,\s]*/i, "")
        .replace(LEADING_TIMING, "")
        .trim()
    );
    if (next === current) break;
    current = next;
  }
  return current;
}

function leadsWithAction(value: string): boolean {
  return new RegExp(`^${ACTION}\\b`, "i").test(coreOf(value));
}

const FRAGMENT_JOIN = /^(?:for|with|from|to|on|east|west|north|south)\b(?!\s+(?:today|tomorrow|tonight))/i;
const DANGLING_LEAD_IN = /^(?:(?:yes|yeah|ok|okay|so|and|um|uh|then|and then)[,\s]+)*(?:(?:i|we)\s+(?:still\s+)?(?:have|need|got|gotta)\s+to|and|then|and then|also|so)$/i;

const RUN_ON_VERBS = new Set([
  "Pickup", "Pick", "Deposit", "Deliver", "Drop", "Call", "Text", "Email", "Visit", "Grab", "Buy", "Collect", "Swing", "Stop",
  "Restock", "Wash", "Fold", "Clean", "Send", "Print", "Prep", "Meet", "Finish", "Bring", "Get", "Head", "Go", "Remind", "Schedule",
]);
/** Verbs that are also street or place words ("Rodeo Drive", "Mail Order"): only a verb after a lowercase word. */
const AMBIGUOUS_VERBS = new Set(["Drive", "Make", "Order", "Run", "Return", "Check", "Take", "Pay", "Book", "Fix", "Put"]);
const TIMING_PREFIX_AHEAD = /^\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?(?:\s*window)?\s*:/i;

/**
 * A briefing read without pauses arrives as one run-on line ("…for Yassie &
 * Carol Pickup KITH TREATS aprons…"). Split where a new task visibly starts:
 * a capitalized action verb, a "7pm:" timing prefix, or a "Tomorrow," header.
 */
function splitRunOn(line: string): string[] {
  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length < 12) return [line];
  const parts: string[][] = [[]];
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1] ?? "";
    const rest = tokens.slice(index).join(" ");
    const bare = token.replace(/[^A-Za-z]/g, "");
    // "9 - 10am window:" is one timing prefix: never split inside a range.
    const insideRange = /^(?:-|to|through|until|and|between)$/i.test(previous) || /\d$/.test(previous);
    const startsTask =
      index > 0 &&
      !/[.!?;:,&]$/.test(previous) &&
      (RUN_ON_VERBS.has(bare) ||
        (AMBIGUOUS_VERBS.has(bare) && /^[a-z0-9]/.test(previous)) ||
        (TIMING_PREFIX_AHEAD.test(rest) && !insideRange) ||
        /^(?:Tomorrow|Today|Tonight),/.test(token));
    if (startsTask && parts[parts.length - 1]!.length >= 2) parts.push([]);
    parts[parts.length - 1]!.push(token);
  });
  return parts.map(part => part.join(" "));
}

/**
 * Sentences, keeping "9:30am", "1hr", and "Dr." intact, and re-joining what a
 * telephone transcript splits at pauses ("Yes, I have to. Pick up… For Carol.").
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\r/g, "").replace(/[’]/g, "'").replace(/[–—]/g, " - ");
  const raw: string[] = [];
  for (const line of normalized.split(/\n+/)) {
    for (const piece of line.split(/(?<=[.!?;])\s+(?=[A-Za-z0-9"'])/)) {
      for (const runOn of splitRunOn(piece.trim())) {
        const trimmed = runOn.trim();
        if (trimmed) raw.push(trimmed);
      }
    }
  }
  const merged: string[] = [];
  let carry = "";
  for (const sentence of raw) {
    const core = sentence.replace(/[.!?;]+$/, "").trim();
    if (DANGLING_LEAD_IN.test(core)) {
      carry = `${carry} ${core}`.trim();
      continue;
    }
    if (merged.length && !carry && FRAGMENT_JOIN.test(core) && !/:\s*/.test(core)) {
      const joined = /^(?:for|with|from|to|on)\b/i.test(core) ? core.charAt(0).toLowerCase() + core.slice(1) : core;
      merged[merged.length - 1] = `${merged[merged.length - 1]!.replace(/[.!?;]+$/, "")} ${joined}.`;
      continue;
    }
    merged.push(carry ? `${carry} ${sentence}` : sentence);
    carry = "";
  }
  if (carry) merged.push(carry);
  return merged;
}

const PREPOSITION_FRAGMENT = /^(?:for|with|from|at|on|by|in|to|who|which|including|about)\b/i;
const MODIFIER_ONLY = new RegExp(
  `^(?:(?:and|then|and then)\\s+)?(?:(?:tomorrow|tmrw|today|tonight)(?:\\s+(?:morning|afternoon|evening|night))?|(?:before|by|after|at|around)\\s+${TIME_TOKEN}|this (?:morning|afternoon|evening))$`,
  "i"
);

export type Clause = { text: string; list: boolean };

/** Work clauses within one sentence. Commas only split a real list. */
export function splitClauses(sentence: string): Clause[] {
  const out: Clause[] = [];
  const connectorParts = sentence
    .split(/\s*,?\s*\b(?:and then|after that|afterwards)\b\s*|\s*[,.;]?\s+then\s+(?=(?:i\s|we\s|go|drive|head|pick|drop|deliver|make|deposit|call|visit|swing|stop|grab|run))/i)
    .map(value => value.trim())
    .filter(Boolean);
  for (const part of connectorParts) {
    const commaParts = part.split(/\s*,\s*(?:and\s+)?/).map(value => value.trim()).filter(Boolean);
    let pieces: Clause[];
    if (commaParts.length >= 2) {
      const actionParts = commaParts.filter(leadsWithAction).length;
      const nounList = commaParts.length >= 3 && actionParts <= 1 && commaParts.filter(value => !PREPOSITION_FRAGMENT.test(value) && !MODIFIER_ONLY.test(value)).length >= 3;
      const questionAndWork =
        commaParts.length === 2 &&
        (QUESTION_START.test(commaParts[0]!) || QUESTION_START.test(commaParts[1]!)) &&
        (leadsWithAction(commaParts[0]!) || leadsWithAction(commaParts[1]!) || QUESTION_START.test(commaParts[1]!));
      if (actionParts >= 2 || nounList || questionAndWork) {
        const merged: string[] = [];
        let pendingModifier = "";
        for (const fragment of commaParts) {
          if (MODIFIER_ONLY.test(fragment)) {
            pendingModifier = `${pendingModifier} ${fragment}`.trim();
            continue;
          }
          if (merged.length && PREPOSITION_FRAGMENT.test(fragment) && !leadsWithAction(fragment)) {
            merged[merged.length - 1] += ` ${fragment}`;
          } else {
            merged.push(pendingModifier ? `${pendingModifier} ${fragment}` : fragment);
          }
          pendingModifier = "";
        }
        if (pendingModifier && merged.length) merged[merged.length - 1] += ` ${pendingModifier}`;
        pieces = merged.map(text => ({ text, list: nounList }));
      } else {
        pieces = [{ text: commaParts.join(" "), list: false }];
      }
    } else {
      pieces = [{ text: part, list: false }];
    }
    for (const piece of pieces) {
      for (const sub of piece.text.split(new RegExp(`\\s+(?:and|&)\\s+(?=(?:(?:i|we)\\s+(?:still\\s+)?(?:need|have|got)\\s+to\\s+|then\\s+|(?:at|by|before|after|around)\\s+${TIME_TOKEN}\\s+)?${ACTION}\\b)`, "i"))) {
        const text = tidy(sub);
        if (text) out.push({ text, list: piece.list });
      }
    }
  }
  return out;
}

function quantityOf(text: string): number | null {
  const match = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s+(?!am\b|pm\b|a\.m|p\.m|hr\b|hour|minute|min\b|lb|pound|o'?clock|to\b|and\b|-)([a-z][a-z-]+)/i.exec(text);
  if (!match) return null;
  const value = parseSpokenNumber(match[1]!.toLowerCase());
  return value && value > 0 && value <= 500 ? value : null;
}

export function peopleOf(text: string): string[] {
  const names = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw) return;
    for (const token of raw.split(/\s*(?:,|&|\band\b)\s*/)) {
      const name = token.replace(/'s$/, "").trim();
      if (/^[A-Z][a-z]+$/.test(name) && !NAME_STOP.has(name)) names.add(name);
    }
  };
  add(/\bfor\s+([A-Z][a-z]+(?:\s*(?:,|&|and)\s*[A-Z][a-z]+)*)/.exec(text)?.[1]);
  add(/\b([A-Z][a-z]+(?:\s*(?:&|and)\s*[A-Z][a-z]+)+)\b/.exec(text)?.[1]);
  for (const match of Array.from(text.matchAll(/\b([A-Z][a-z]+)'s\b/g))) add(match[1]);
  for (const match of Array.from(text.matchAll(/\b(?:has|did|does|is|was|call|text|email|meet|see)\s+([A-Z][a-z]+)\b/g))) add(match[1]);
  return Array.from(names);
}

function placeOf(text: string): string | null {
  const match = /\b(?:to|at|on|from|in)\s+([A-Z][\w'&.-]*(?:\s+(?:[A-Z0-9][\w'&.-]*|of|de|la))*)/.exec(text);
  if (!match || new RegExp(`^${ACTION}\\b`, "i").test(match[1]!)) return null;
  const place = match[1]!.replace(/[,.]+$/, "").trim();
  if (/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(place)) return null;
  return place.split(/\s+/).length <= 6 ? place : null;
}

function needsFor(title: string): string | null {
  if (/^(?:drop|pick|deliver|bring|take)(?: it| them| that| those| this)?(?: off| up| back)?$/i.test(title)) return `Which order is "${title}" for?`;
  if (/^[a-z]+$/.test(title)) return `What should "${title}" say?`;
  return null;
}

export function parseBriefingDeterministically(utterance: string, clock: BriefingClock): ParsedBriefing {
  const items: BriefingItem[] = [];
  const context: string[] = [];
  const questions: string[] = [];
  const unparsed: string[] = [];
  let sectionDay = clock.today;
  const cleaned = utterance.replace(/\bby the way,?\s*/gi, ". ");

  for (const rawSentence of splitSentences(cleaned)) {
    let sentence = rawSentence;
    const header = /^([^:]{1,48}):\s*(.*)$/.exec(sentence);
    if (header && !/\d\s*(?:am|pm)?\s*$/i.test(header[1]!) && !/\d{1,2}\s*(?:am|pm)?\s*(?:-|to)\s*\d/i.test(header[1]!)) {
      const mention = dayMention(header[1]!, clock.today);
      if (mention) {
        sectionDay = mention.ymd;
        sentence = header[2]!;
      } else if (/^(?:agenda|today'?s? (?:plan|agenda)|plan|my day|to ?do|todo|list)$/i.test(header[1]!.trim())) {
        sectionDay = clock.today;
        sentence = header[2]!;
      }
      if (!sentence.trim()) continue;
    }
    const whole = tidy(sentence);
    if (CONTEXT.test(whole) || NOISE.test(whole)) {
      if (/^(?:tomorrow|tmrw)\b/i.test(whole)) sectionDay = dayMention(whole, clock.today)?.ymd ?? sectionDay;
      if (!NOISE.test(whole)) context.push(whole);
      continue;
    }
    const sentenceDay = dayMention(sentence, clock.today);
    if (sentenceDay?.sticky) sectionDay = sentenceDay.ymd;

    let sharedTiming: BriefingTiming | null = null;
    for (const { text: clause, list } of splitClauses(sentence)) {
      const bare = tidy(clause);
      if (!bare || NOISE.test(bare)) continue;
      const correction = items.length ? CORRECTION.exec(bare) : null;
      if (correction) {
        // "grab the OPUS towels, actually no, make that the KITH aprons" corrects the item just said.
        const last = items[items.length - 1]!;
        const replacement = tidy(correction[1]!.replace(/\b(?:first|instead|then)\b\s*$/i, ""));
        const retimed = parseTiming(replacement, { isToday: last.businessDate === clock.today, minutesNow: clock.minutesNow });
        if (retimed.timing.kind !== "none" && retimed.remainder.replace(/[^a-z]/gi, "").length < 3) {
          last.timing = retimed.timing;
        } else {
          const verb = new RegExp(`^(${ACTION})\\b`, "i").exec(last.title)?.[1];
          const title = verb && !new RegExp(`^${ACTION}\\b`, "i").test(replacement) ? `${verb} ${replacement}` : replacement;
          last.title = capitalizeFirst(title);
          last.people = peopleOf(title);
          last.place = placeOf(title);
          if (retimed.timing.kind !== "none") last.timing = retimed.timing;
        }
        last.quote = `${last.quote} ${bare}`;
        continue;
      }
      if (CONTEXT.test(bare)) {
        context.push(bare);
        continue;
      }
      if (/\?$/.test(bare) || QUESTION_START.test(bare)) {
        questions.push(bare.replace(/^(?:and|so|also|oh)\s+/i, ""));
        continue;
      }
      // A filter on the current customer conversation uses "order" as a noun.
      // It must reach the business thread instead of becoming a Day Line task.
      if (/^(?:only|just|exclude|include)\s+(?:the\s+)?(?:people|customers|clients|residents)\b/i.test(bare) &&
          /\b(?:orders?|ordered|more than|at least|since|this year|last \d+ days)\b/i.test(bare)) {
        questions.push(bare);
        continue;
      }
      if (isCombineRequest(bare.toLowerCase())) {
        questions.push(bare);
        continue;
      }
      const completed = COMPLETED.test(stripLeadIn(bare)) || COMPLETED.test(bare);
      if (!completed && FYI.test(bare) && !leadsWithAction(bare)) {
        context.push(bare);
        continue;
      }
      const clauseDay = dayMention(bare, clock.today);
      const businessDate = clauseDay ? clauseDay.ymd : sectionDay;
      const withoutDay = stripLeadIn(tidy(bare.replace(DAY_WORDS, " ")));
      const leading = LEADING_TIMING.test(withoutDay);
      const parsedTiming = completed
        ? { timing: { kind: "none" } as BriefingTiming, remainder: withoutDay }
        : parseTiming(withoutDay, { isToday: businessDate === clock.today, minutesNow: clock.minutesNow });
      let timing = parsedTiming.timing;
      if (timing.kind !== "none" && leading) sharedTiming = timing;
      else if (timing.kind === "none" && sharedTiming && !completed) timing = sharedTiming;
      const title = capitalizeFirst(
        tidy(
          stripLeadIn(parsedTiming.remainder)
            .replace(/\b(?:any ?time|sometime|some time)\b\s*$/i, "")
            .replace(/\s*,\s*(?=for\b)/i, " ")
            .replace(/\bwindow\b\s*$/i, "")
            .replace(/^for the\s+/i, "the ")
            .replace(/\s+(?:for|on|by)$/i, "")
        )
      );
      const actionable =
        completed ||
        list ||
        hasAction(bare) ||
        /\b(?:need|have|got)\s+to\b/i.test(bare) ||
        detectPrimaryDesignation(bare);
      if (!title || !actionable) {
        if (bare.split(/\s+/).length >= 2) unparsed.push(bare);
        continue;
      }
      items.push({
        kind: completed ? "completed" : "new_work",
        title: enforceTitleContract(title),
        quote: bare,
        businessDate,
        timing,
        quantity: completed ? null : quantityOf(title),
        people: peopleOf(bare),
        place: placeOf(bare),
        needs: completed ? null : needsFor(title),
        existing: null,
      });
    }
  }

  // "his"/"her" in a work title refers to the one person Adam named, when there is exactly one.
  const named = new Set<string>();
  for (const item of items) item.people.forEach(person => named.add(person));
  for (const question of questions) peopleOf(question).forEach(person => named.add(person));
  if (named.size === 1) {
    const person = Array.from(named)[0]!;
    for (const item of items) {
      if (item.kind === "new_work" && /\b(?:his|her)\b/i.test(item.title)) {
        item.title = item.title.replace(/\b(?:his|her)\b/i, `${person}'s`);
        if (!item.people.includes(person)) item.people.push(person);
      }
    }
  }
  return { items, context, questions, unparsed, source: "deterministic" };
}
