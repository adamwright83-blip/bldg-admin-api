import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { AwaitingReplies } from "./firstTenMinutesKnowledge";

/**
 * Claire routines: recurring checks an operator asks for in their own words ("Every Monday morning, tell me who I'm
 * waiting to hear back from"). JOYSTICK runs them on schedule and keeps what each run found. A routine only reads
 * and reports: it never sends, contacts, labels or changes anything outside JOYSTICK. Any follow-up still goes
 * through the approved follow-up on the Claire Desk.
 *
 * The parser below is deterministic: a fixed allowlist of kinds and a fixed grammar of times. No model reads the
 * operator's words and nothing they type is executed. Anything outside it is refused plainly, with what Claire can
 * run today.
 */
export const ROUTINE_KINDS = ["waiting_on", "wrote_back"] as const;
export type RoutineKind = (typeof ROUTINE_KINDS)[number];
export type RoutineCadence = "daily" | "weekly";
export type RoutineStatus = "active" | "paused" | "stopped";
export type RoutineTrigger = "schedule" | "manual";
export type RoutineRunStatus = "running" | "done" | "failed";

/** When a routine runs: every day, or once a week on one weekday (0 = Sunday … 6 = Saturday), at HH:mm local time. */
export type RoutineSchedule = { cadence: RoutineCadence; weekday: number | null; localTime: string; timeZone: string };

export const MAX_ROUTINE_ATTEMPTS = 3;
export const MAX_ROUTINE_INSTRUCTION = 500;
/** A first "who wrote back" check looks back this far; later ones look back to the previous check. */
export const FIRST_WROTE_BACK_DAYS = 7;

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** What Claire can run today, said plainly: the list every refusal carries. */
export const ROUTINE_CAN_DO: readonly string[] = [
  "Tell you who you're waiting to hear back from: people you wrote to who haven't replied. For example: “Every Monday morning, tell me who I'm waiting to hear back from.”",
  "Tell you who wrote back since the last check. For example: “Check every morning who wrote back.”",
  "Either check every day, or once a week on a day you name, at a time you choose (8:00 unless you say).",
];

export type ParsedRoutine =
  | { ok: true; kind: RoutineKind; cadence: RoutineCadence; weekday: number | null; localTime: string; describe: string }
  | { ok: false; reason: string; canDo: string[] };

const refuse = (reason: string): ParsedRoutine => ({ ok: false, reason, canDo: [...ROUTINE_CAN_DO] });

export function isValidTimeZone(zone: string): boolean {
  if (!zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ the operator's words, read deterministically

const DAY_STEMS: Array<[RegExp, number]> = [
  [/^sun/, 0],
  [/^mon/, 1],
  [/^tues/, 2],
  [/^wednes/, 3],
  [/^thurs/, 4],
  [/^fri/, 5],
  [/^satur/, 6],
];
const WEEKDAY_WORD = /\b(sun|mon|tues|wednes|thurs|fri|satur)days?\b/g;
const dayIndex = (word: string) => DAY_STEMS.find(([stem]) => stem.test(word))?.[1] ?? null;

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/** Asking JOYSTICK to reach someone, or to change something: routines never do that. */
const ACTIONS = [
  /\b(send|sends|sending|draft|drafts|drafting|unsubscribe|delete|deletes)\b/,
  /\b(mark|label|archive|forward|star|flag|move|tag|book|cancel|charge) (them|it|those|these|everyone|everybody|people|the|their|as|each|all)\b/,
  /\b(e-?mail|text|message|call|phone|ping|nudge|chase|contact|remind|reply to|respond to|answer|write to|follow[- ]?up with|reach out to|get in touch with) (them|him|her|everyone|everybody|anyone|people|those|these|customers|clients|each|all|whoever)\b/,
];
/**
 * Any verb that contacts someone or changes something, aimed at anyone but the operator: "text Elena", "let them
 * know", "tell clients", "write a follow up", "archive messages". "tell me", "remind me", "let me know" ask for the
 * report and stay. A few words are nouns as often as verbs ("text messages", "email threads"): those pass when what
 * follows is plainly a kind of mail.
 */
const OUTWARD =
  /\b(text|sms|call|phone|contact|e-?mail|message|write (?:to|a|an|the)|reply to|respond to|follow[- ]?up with|remind|let|tell|notify|ping|nudge|chase|reach out to|get in touch with|archive|label|delete|forward|invite)\s+([\p{L}'@.-]+)/gu;
const THE_OPERATOR = new Set(["me", "myself"]);
const MAIL_NOUNS = new Set(["messages", "message", "threads", "thread", "replies", "emails", "email", "chats", "texts"]);
const NOUN_OR_VERB = /^(?:text|call|phone|e-?mail|message)$/;
function asksToActOnOthers(asked: string): boolean {
  for (const match of asked.matchAll(OUTWARD)) {
    const [, verb, object] = match;
    if (THE_OPERATOR.has(object!)) continue;
    if (NOUN_OR_VERB.test(verb!) && MAIL_NOUNS.has(object!)) continue;
    return true;
  }
  return false;
}
/** Asking for the report somewhere other than JOYSTICK. */
const DELIVERY = [/\b(e-?mail|text|sms|whatsapp|slack|call|phone|message|dm) me\b/, /\bsends? me (an? )?(e-?mail|text|sms|whatsapp|slack|message|dm)\b/];
/** The other direction: who is waiting on the operator. Not something Claire can check yet. */
const OWED_BY_OPERATOR =
  /\b(i (still )?owe|owe (them|people|a reply|an answer|a response|replies)|waiting (on|for) (me|my (reply|answer|response))|i (haven'?t|have not|didn'?t|did not|never) (repl(y|ied)|answer(ed)?|respond(ed)?|got(ten)? back|wr(itten|ote) back)|(reply|answer|response) from me|i need to (reply|answer|respond))\b/;

const WAITING = new RegExp(
  [
    "(?:waiting|awaiting|wait)(?: (?:on|for|to hear back from|to hear from))?(?: (?:an?|their|any) (?:repl(?:y|ies)|answers?|responses?))?",
    "(?:still )?owes? me(?: (?:an?|any) (?:repl(?:y|ies)|answers?|responses?))?",
    "still owe",
    "(?:haven'?t|hasn'?t|have not|has not|didn'?t|did not) (?:i|we) (?:yet |ever )?(?:heard|had|got|gotten|received)(?: (?:back|from|an?|any) ?(?:repl(?:y|ies)|answers?|responses?)?)?",
    "unanswered",
    "unreplied",
    "no repl(?:y|ies)",
    "no response",
    "no answer",
    "not (?:yet )?(?:replied|responded|answered|written(?: back)?|got(?:ten)? back|heard back|heard from)",
    "(?:haven'?t|hasn'?t|have not|has not|didn'?t|did not|never|yet to|don'?t|doesn'?t|do not|does not|won'?t|aren'?t|isn'?t) (?:yet |ever )?(?:repl(?:y|ied)|respond(?:ed)?|answer(?:ed)?|wr(?:ite|itten|ote)(?: back)?|gotten back|got back|get back|heard? back|heard? from|been in touch)",
    "no word",
    "silence",
    "unresponsive",
    "pending repl(?:y|ies)",
    "follow(?:ing)?[- ]?ups?",
    "chase",
    "(?:gone|went|go|going) (?:quiet|silent|cold)",
    "quiet",
    "silent",
    "ghost(?:ed|ing)?",
    "(?:need|needs|have|has|want|wants) to hear back",
    "hear back",
  ]
    .map(part => `\\b${part}\\b`)
    .join("|"),
  "g"
);
const WROTE_BACK =
  /\b(repl(y|ied|ies|ying)|respond(s|ed|ing)?|response|responses|wr(ote|ites|itten) back|write back|answer(s|ed)?|got back|gets back|gotten back|heard back|heard from|came back to me|emailed me back|been in touch)\b/;
/** Alongside a waiting check, only a verb that someone wrote back makes it a second check ("waiting for a reply" is one). */
const WROTE_BACK_VERB = /\b(replied|responded|wr(ote|itten) back|answered|got back|gotten back|heard back|heard from|came back to me|emailed me back)\b/;

const UNSUPPORTED_CADENCE =
  /\b(hourly|every (\d+ |few |couple of |other )?(hours?|minutes?|mins?)|every other|every \d+ (days|weeks)|biweekly|bi-weekly|fortnight(ly)?|monthly|every month|each month|of the month|quarterly|yearly|annually|every year|twice|three times|once a month)\b/;
const WEEKDAYS_ONLY = /\b(weekdays?|workdays?|work days?|business days?|weekends?|week days?)\b|\b(sun|mon|tues|wednes|thurs|fri|satur)days? ?(-|to|through|thru|until|till) ?(sun|mon|tues|wednes|thurs|fri|satur)days?\b/;
const SKIPPING = /\b(except|apart from|but not|other than|excluding|skip|skipping)\b/;
const DAILY = /\b(every ?day|daily|each day|every single day|once a day|per day|every (morning|afternoon|evening|night)|each (morning|afternoon|evening|night)|nightly|mornings|afternoons|evenings|nights)\b/;
const WEEKLY = /\b(weekly|every week|each week|once a week|per week)\b/;
const RECURRING = /\b(every|each|daily|weekly|nightly|everyday|mornings|afternoons|evenings|nights|once a (day|week)|per (day|week))\b|\b(sun|mon|tues|wednes|thurs|fri|satur)days\b/;
const ONE_OFF = /\b(today|tomorrow|tonight|next (sun|mon|tues|wednes|thurs|fri|satur)day|this (sun|mon|tues|wednes|thurs|fri|satur)day|once(?! a (day|week)))\b/;
/** "since Monday", "last Friday": a filter on what to look at, not when to run. */
const DAY_FILTER = /\b(since|from|after|before|until|till|by|last) (sun|mon|tues|wednes|thurs|fri|satur)day\b/g;
/** "since last night", "yesterday evening": also what to look at, not when to run. */
const PART_FILTER = /\b(since|from|after|before|until|till|last|yesterday|this) (morning|afternoon|evening|night)\b/g;

const PART_OF_DAY: Array<[RegExp, string, "am" | "pm"]> = [
  [/\b(mornings?|first thing|start of (the )?day)\b/, "08:00", "am"],
  [/\b(noon|midday|lunch ?time|lunch)\b/, "12:00", "pm"],
  [/\b(afternoons?)\b/, "13:00", "pm"],
  [/\b(evenings?|end of (the )?day|close of business|after work)\b/, "17:00", "pm"],
  [/\b(nights?|nightly|tonight)\b/, "20:00", "pm"],
  [/\b(midnight)\b/, "00:00", "am"],
];

const pad = (n: number) => String(n).padStart(2, "0");

function readTime(text: string): { localTime: string | null; error: string | null } {
  const parts = PART_OF_DAY.filter(([pattern]) => pattern.test(text));
  if (parts.length > 1) return { localTime: null, error: "One time per routine for now. Make one for each time you want it." };
  const part = parts[0];
  const spelled = text.replace(/\bat (one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, (_m, word: string) => `at ${NUMBER_WORDS[word]}`);
  const meridiem = spelled.match(/\b(\d{1,2})(?:[:.](\d{2}))? ?(a\.?m\.?|p\.?m\.?)(?![a-z])/);
  const at = spelled.match(/\b(?:at|around|by) (\d{1,2})(?:[:.](\d{2}))?(?! ?(?:days?|weeks?|people|replies|messages|emails|%))\b/);
  const clock = spelled.match(/\b(\d{1,2}):(\d{2})\b/);
  const found = meridiem ?? at ?? clock;
  if (!found) return { localTime: part ? part[1] : null, error: null };
  let hour = Number(found[1]);
  const minute = found[2] === undefined ? 0 : Number(found[2]);
  if (minute > 59) return { localTime: null, error: "That isn't a time Claire can read. Try “at 8:30am”." };
  if (meridiem) {
    if (hour < 1 || hour > 12) return { localTime: null, error: "That isn't a time Claire can read. Try “at 8:30am”." };
    const pm = /^p/.test(meridiem[3]);
    hour = (hour % 12) + (pm ? 12 : 0);
  } else {
    if (hour > 23) return { localTime: null, error: "That isn't a time Claire can read. Try “at 8:30am”." };
    if (part && part[2] === "pm" && hour >= 1 && hour < 12) hour += 12;
    else if (!part && hour >= 1 && hour <= 6 && !found[1].startsWith("0"))
      return { localTime: null, error: `Did you mean ${hour} in the morning or ${hour} in the afternoon? Say ${hour}am or ${hour}pm.` };
  }
  return { localTime: `${pad(hour)}:${pad(minute)}`, error: null };
}

function readKind(text: string): { kind: RoutineKind | null; both: boolean } {
  const waiting = WAITING.test(text);
  WAITING.lastIndex = 0;
  if (!waiting) return { kind: WROTE_BACK.test(text) ? "wrote_back" : null, both: false };
  const both = WROTE_BACK_VERB.test(text.replace(WAITING, " "));
  return { kind: both ? null : "waiting_on", both };
}

/**
 * Reads an operator's words into a routine Claire can run, or refuses honestly. Kinds: who they're waiting to hear
 * back from (`waiting_on`), who wrote back (`wrote_back`). Cadence: every day, or once a week on one named day. Time:
 * "at 8", "8:30am", "morning" (8:00), "afternoon" (13:00), "evening" (17:00); 8:00 when unsaid.
 */
export function parseRoutineInstruction(input: string, timeZone: string): ParsedRoutine {
  const raw = (input ?? "").normalize("NFKC").replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"');
  const text = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return refuse("Tell Claire what to check, and when.");
  if (text.length > MAX_ROUTINE_INSTRUCTION) return refuse(`That's longer than one routine. Keep it under ${MAX_ROUTINE_INSTRUCTION} characters.`);
  if (!isValidTimeZone(timeZone)) return refuse("Claire couldn't tell which time zone you're in.");

  if (DELIVERY.some(pattern => pattern.test(text)))
    return refuse("Routines report here, on the Claire Desk. Claire can't email, text or message the results to you.");
  // "send me a list" is asking for the report, not asking JOYSTICK to send anyone anything
  const asked = text.replace(/\bsends? me\b/g, "tell me");
  if (ACTIONS.some(pattern => pattern.test(asked)) || asksToActOnOthers(asked))
    return refuse("Routines only read and report. Claire won't send, contact, label or change anything on a schedule. To follow up with someone, use “Prepare a follow-up” on the Waiting to hear back card.");
  if (OWED_BY_OPERATOR.test(asked))
    return refuse("Claire can't check who is waiting on you yet. She can tell you who you're waiting on, and who wrote back.");

  const { kind, both } = readKind(asked);
  if (both) return refuse("That's two checks. Make one routine for who you're waiting on and another for who wrote back.");
  if (!kind) return refuse("Claire can't check that on a schedule yet.");

  if (UNSUPPORTED_CADENCE.test(asked)) return refuse("Claire runs a routine once a day, or once a week on one day, for now.");
  if (WEEKDAYS_ONLY.test(asked)) return refuse("Claire can run a routine every day, or once a week on one day. Weekdays only isn't something she can do yet.");
  if (SKIPPING.test(asked)) return refuse("Claire can't skip days yet. A routine runs every day, or once a week on one day.");

  const scheduleText = asked.replace(DAY_FILTER, " ").replace(PART_FILTER, " ");
  const days = [...new Set([...scheduleText.matchAll(WEEKDAY_WORD)].map(match => dayIndex(match[1])).filter((day): day is number => day !== null))];
  if (days.length > 1)
    return refuse(`One day a week per routine for now. Make one for ${WEEKDAY_NAMES[days[0]]} and another for ${WEEKDAY_NAMES[days[1]]}.`);
  const daily = DAILY.test(scheduleText);
  const weekly = WEEKLY.test(scheduleText);
  if (days.length && /\b(every ?day|daily|each day|every single day|once a day)\b/.test(scheduleText))
    return refuse("Say either every day, or one day of the week.");
  if (!RECURRING.test(scheduleText) && ONE_OFF.test(scheduleText))
    return refuse("Routines repeat. Say “every Monday” or “every morning”; for a one-off, just ask Claire on the desk.");

  const time = readTime(scheduleText);
  if (time.error) return refuse(time.error);
  let cadence: RoutineCadence;
  let weekday: number | null = null;
  if (days.length) {
    cadence = "weekly";
    weekday = days[0];
  } else if (weekly && !daily) {
    return refuse("Say which day of the week, for example “every Monday”.");
  } else if (daily || time.localTime) {
    cadence = "daily";
  } else {
    return refuse("Say when: for example “every morning”, “every day at 9”, or “every Monday”.");
  }
  const localTime = time.localTime ?? "08:00";
  return { ok: true, kind, cadence, weekday, localTime, describe: describeRoutine({ kind, cadence, weekday, localTime }) };
}

// ------------------------------------------------------------------ in words

const clock = (localTime: string) => {
  const [hh, mm] = localTime.split(":");
  return `${Number(hh)}:${mm}`;
};

export const ROUTINE_KIND_WORDS: Record<RoutineKind, string> = {
  waiting_on: "who you're waiting to hear back from",
  wrote_back: "who wrote back since the last check",
};

/** "Every Monday at 8:00 — who you're waiting to hear back from" */
export function describeRoutine(routine: { kind: RoutineKind; cadence: RoutineCadence; weekday: number | null; localTime: string }): string {
  const when = routine.cadence === "weekly" && routine.weekday !== null ? `Every ${WEEKDAY_NAMES[routine.weekday]}` : "Every day";
  return `${when} at ${clock(routine.localTime)} — ${ROUTINE_KIND_WORDS[routine.kind]}`;
}

/** How Claire names a routine in a sentence: "Monday check", "morning check". */
export function routineLabel(routine: { cadence: RoutineCadence; weekday: number | null; localTime: string }): string {
  if (routine.cadence === "weekly" && routine.weekday !== null) return `${WEEKDAY_NAMES[routine.weekday]} check`;
  const hour = Number(routine.localTime.slice(0, 2));
  return hour < 12 ? "morning check" : hour < 17 ? "afternoon check" : "evening check";
}

// ------------------------------------------------------------------ when it runs

const addDaysYmd = (ymd: string, days: number) => {
  const date = new Date(`${ymd}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const weekdayOfYmd = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

/**
 * The next time this routine runs strictly after `from`, at its local time in its own time zone (so 8:00 stays 8:00
 * across a daylight-saving change). Weekly routines land on their weekday.
 */
export function nextRunAt(schedule: RoutineSchedule, from: Date): Date {
  const today = formatInTimeZone(from, schedule.timeZone, "yyyy-MM-dd");
  for (let offset = 0; offset <= 8; offset += 1) {
    const day = addDaysYmd(today, offset);
    if (schedule.cadence === "weekly" && weekdayOfYmd(day) !== schedule.weekday) continue;
    const at = fromZonedTime(`${day}T${schedule.localTime}:00`, schedule.timeZone);
    if (at.getTime() > from.getTime()) return at;
  }
  throw new Error("No next run could be computed for this routine.");
}

/**
 * Which occurrence a scheduled run belongs to: the local date for a daily routine; for a weekly one, the local date
 * of that week's scheduled weekday. One run per routine per period (claire_routine_runs is unique on it).
 */
export function routinePeriodKey(schedule: RoutineSchedule, scheduledAt: Date): string {
  const day = formatInTimeZone(scheduledAt, schedule.timeZone, "yyyy-MM-dd");
  if (schedule.cadence !== "weekly" || schedule.weekday === null) return day;
  const back = (weekdayOfYmd(day) - schedule.weekday + 7) % 7;
  return addDaysYmd(day, -back);
}

export const manualPeriodKey = (now: Date) => `manual:${now.toISOString().slice(0, 16)}Z`;

// ------------------------------------------------------------------ what a run found

/** One person a run found: one real message in the operator's own Gmail. */
export type RoutineFinding = {
  person: { name: string | null; address: string };
  subject: string;
  /** the operator's last message to them (waiting_on), or their reply (wrote_back) */
  at: string;
  waitingDays: number | null;
  /** their words or the operator's, shortened */
  line: string;
  messageId: string;
  threadId: string;
  url: string | null;
};

export type RoutineFindings = {
  kind: RoutineKind;
  /** when Gmail was read for this run; null when it couldn't be */
  checkedAt: string | null;
  account: string | null;
  /** plain words when Gmail couldn't be read: the run is done, and says why */
  unavailable: string | null;
  /** wrote_back: replies after this moment (the previous check, or FIRST_WROTE_BACK_DAYS ago) */
  since: string | null;
  firstCheck: boolean;
  items: RoutineFinding[];
};

export function routineFindings(kind: RoutineKind, awaiting: AwaitingReplies | null, options: { since: Date | null; now: Date }): RoutineFindings {
  const firstCheck = kind === "wrote_back" && !options.since;
  const since = kind === "wrote_back" ? options.since ?? new Date(options.now.getTime() - FIRST_WROTE_BACK_DAYS * 86_400_000) : null;
  const base = { kind, since: since ? since.toISOString() : null, firstCheck };
  if (!awaiting) return { ...base, checkedAt: null, account: null, unavailable: "No Gmail is connected to this workspace.", items: [] };
  if (awaiting.unavailable) return { ...base, checkedAt: null, account: awaiting.account, unavailable: awaiting.unavailable, items: [] };
  const items: RoutineFinding[] =
    kind === "waiting_on"
      ? awaiting.items.map(item => ({
          person: item.person,
          subject: item.subject,
          at: item.sentAt,
          waitingDays: item.waitingDays,
          line: item.lastLine,
          messageId: item.messageId,
          threadId: item.threadId,
          url: item.url,
        }))
      : (awaiting.replies ?? [])
          .filter(reply => new Date(reply.at).getTime() > since!.getTime())
          .map(reply => ({
            person: reply.person,
            subject: reply.subject,
            at: reply.at,
            waitingDays: null,
            line: reply.snippet,
            messageId: reply.messageId,
            threadId: reply.threadId,
            url: reply.url,
          }));
  return { ...base, checkedAt: awaiting.checkedAt, account: awaiting.account, unavailable: null, items };
}

const NAMED = 3;
const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const nameOf = (finding: RoutineFinding) => finding.person.name ?? finding.person.address;
const joinNames = (names: string[], total: number) => {
  const more = total - names.length;
  if (more > 0) return `${names.join(", ")} and ${more} more`;
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

/** The one line a run leaves behind. */
export function summarizeRoutineFindings(findings: RoutineFindings, timeZone: string): string {
  if (findings.unavailable) return `Not checked: ${findings.unavailable}`;
  const items = findings.items;
  if (findings.kind === "waiting_on") {
    if (!items.length) return "Nobody you wrote to still owes you a reply.";
    const named = items.slice(0, NAMED).map(item => `${nameOf(item)} (${item.waitingDays} ${item.waitingDays === 1 ? "day" : "days"})`);
    return `You're waiting on a reply from ${people(items.length)}: ${joinNames(named, items.length)}.`;
  }
  const window = findings.firstCheck ? `in the last ${FIRST_WROTE_BACK_DAYS} days` : "since the last check";
  if (!items.length) return `Nobody wrote back ${window}.`;
  const named = items.slice(0, NAMED).map(item => `${nameOf(item)} (${formatInTimeZone(new Date(item.at), timeZone, "EEE d MMM")})`);
  return `${people(items.length)} wrote back ${window}: ${joinNames(named, items.length)}.`;
}

// ------------------------------------------------------------------ as the Desk and Claire read them

export type RoutineRunView = {
  id: string;
  trigger: RoutineTrigger;
  status: RoutineRunStatus;
  attempts: number;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  findings: RoutineFindings | null;
  /** plain words for a run that didn't finish; the raw error stays on the server */
  note: string | null;
};

export type RoutineView = {
  id: string;
  instruction: string;
  kind: RoutineKind;
  cadence: RoutineCadence;
  weekday: number | null;
  localTime: string;
  timeZone: string;
  status: RoutineStatus;
  describe: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  /** the latest runs, newest first */
  runs: RoutineRunView[];
};

export function failedRunNote(attempts: number, movedOn: boolean): string {
  return movedOn || attempts >= MAX_ROUTINE_ATTEMPTS
    ? `It didn't finish after ${attempts} ${attempts === 1 ? "try" : "tries"}; it runs again at its next time.`
    : `It didn't finish (try ${attempts} of ${MAX_ROUTINE_ATTEMPTS}); JOYSTICK tries again in a few minutes.`;
}

export type RoutinesBriefing = Array<{
  routine: string;
  /** the operator's own words */
  instruction: string;
  status: RoutineStatus;
  /** local time, e.g. "Monday 2 November, 08:00"; null when paused or stopped */
  nextRun: string | null;
  lastRun: null | { at: string; trigger: RoutineTrigger; status: RoutineRunStatus; summary: string | null; found: number | null };
}>;

/** What Claire is handed: each routine in words and its latest run, as it was recorded. */
export function routinesForBriefing(views: readonly RoutineView[], timeZone: string): RoutinesBriefing {
  const local = (iso: string) => formatInTimeZone(new Date(iso), timeZone, "EEEE d MMMM, HH:mm");
  return views
    .filter(view => view.status !== "stopped" || view.runs.length)
    .slice(0, 12)
    .map(view => {
      const run = view.runs[0];
      return {
        routine: view.describe,
        instruction: view.instruction,
        status: view.status,
        nextRun: view.status === "active" && view.nextRunAt ? local(view.nextRunAt) : null,
        lastRun: run
          ? {
              at: local(run.finishedAt ?? run.startedAt),
              trigger: run.trigger,
              status: run.status,
              summary: run.status === "done" ? run.summary : run.note,
              found: run.status === "done" && run.findings && !run.findings.unavailable ? run.findings.items.length : null,
            }
          : null,
      };
    });
}

export const ROUTINES_RULE =
  "BRIEFING.routines are the checks the operator asked JOYSTICK to run on a schedule (routine in words, their own instruction, status, nextRun, and lastRun with when it ran, its status and its summary); an empty list means none are set up. When asked about a routine or what it found, answer from there; never say a routine ran, or what it found, unless lastRun shows it, and a paused or stopped routine does not run. Routines only read the operator's own Gmail and report on the Claire Desk: they never send, contact, label or change anything. To add, pause, resume or stop one, point them to the Routines card on the Claire Desk.";

/** The desk's opening line when a scheduled run finished since the operator's last visit. */
export function routinesOpeningLine(views: readonly RoutineView[], lastSeen: Date | null): string | null {
  if (!lastSeen) return null;
  const fresh = views
    .map(view => ({ view, run: view.runs.find(run => run.trigger === "schedule" && run.status === "done" && run.finishedAt) }))
    .filter((entry): entry is { view: RoutineView; run: RoutineRunView } => Boolean(entry.run && new Date(entry.run.finishedAt!).getTime() > lastSeen.getTime()))
    .sort((a, b) => new Date(b.run.finishedAt!).getTime() - new Date(a.run.finishedAt!).getTime());
  if (!fresh.length) return null;
  const lines = fresh.slice(0, 2).map(({ view, run }) => {
    const label = `Your ${routineLabel(view)}`;
    const findings = run.findings;
    if (!findings || findings.unavailable) return `${label} couldn't read your Gmail${findings?.unavailable ? `: ${findings.unavailable.replace(/\.$/, "")}` : ""}.`;
    const n = findings.items.length;
    if (findings.kind === "waiting_on") return n ? `${label} found ${people(n)} you're waiting to hear back from.` : `${label} found nobody you're still waiting on.`;
    return n ? `${label} found ${people(n)} who wrote back.` : `${label} found nobody new who wrote back.`;
  });
  return lines.join(" ");
}
