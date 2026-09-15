import { formatInTimeZone } from "date-fns-tz";
import { addDaysYmd, isValidYmd } from "../../analytics/businessPeriods";
import type { BriefingClock, BriefingTiming } from "./briefingTypes";

/**
 * Task time vs. the time of day Adam mentions for context, and which day a
 * piece of work belongs to. Pure functions over a business-local clock.
 */

export function briefingClock(now: Date, timeZone: string): BriefingClock {
  const today = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const hours = Number(formatInTimeZone(now, timeZone, "H"));
  const minutes = Number(formatInTimeZone(now, timeZone, "m"));
  return { now, timeZone, today, minutesNow: hours * 60 + minutes };
}

const WORD_HOURS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

export const TIME_TOKEN =
  "(?:noon|midday|midnight|(?:\\d{1,2}(?::\\d{2})?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\\s*(?:o'?clock))?(?:\\s*(?:a\\.?m\\.?|p\\.?m\\.?))?)";

type Meridiem = "am" | "pm" | null;

function parseClock(raw: string): { hour: number; minute: number; meridiem: Meridiem } | null {
  const text = raw.trim().toLowerCase().replace(/\./g, "").replace(/o'?clock/, "").trim();
  if (text === "noon" || text === "midday") return { hour: 12, minute: 0, meridiem: "pm" };
  if (text === "midnight") return { hour: 0, minute: 0, meridiem: "am" };
  const match = /^(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(am|pm)?$/.exec(text);
  if (!match) return null;
  const hour = /^\d+$/.test(match[1]!) ? Number(match[1]) : WORD_HOURS[match[1]!]!;
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute, meridiem: (match[3] as Meridiem) ?? null };
}

/**
 * Hours said without am/pm, the way an operator means them: 1–6 is the
 * afternoon; 7–11 is the morning unless that time has already passed today.
 */
function to24h(
  clock: { hour: number; minute: number; meridiem: Meridiem },
  context: { isToday: boolean; minutesNow: number; hint: Meridiem }
): string {
  let hour = clock.hour;
  const meridiem = clock.meridiem ?? context.hint;
  if (meridiem === "pm" && hour < 12) hour += 12;
  else if (meridiem === "am" && hour === 12) hour = 0;
  else if (!meridiem && hour >= 1 && hour <= 6) hour += 12;
  else if (!meridiem && hour >= 7 && hour <= 11 && context.isToday && hour * 60 + clock.minute <= context.minutesNow) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`;
}

export function spokenClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  if (h === 12 && m === 0) return "noon";
  if (h === 0 && m === 0) return "midnight";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

function windowLabel(start: string, end: string): string {
  const a = spokenClock(start);
  const b = spokenClock(end);
  const sameHalf = Number(start.slice(0, 2)) < 12 === Number(end.slice(0, 2)) < 12 && !/noon|midnight/.test(a + b);
  return sameHalf ? `between ${a.replace(/ (AM|PM)$/, "")} and ${b}` : `between ${a} and ${b}`;
}

function meridiemIn(text: string): Meridiem {
  if (/\b(?:a\.?m\.?)\b|\bmorning\b/.test(text)) return "am";
  if (/\b(?:p\.?m\.?)\b|\b(?:afternoon|evening|tonight)\b/.test(text)) return "pm";
  return null;
}

export type TimingParse = { timing: BriefingTiming; remainder: string };

/**
 * Reads the task timing inside ONE clause of work. A clause of context such
 * as "It's 9:30am" is never passed here, so current time cannot leak into a task.
 */
export function parseTiming(clause: string, input: { isToday: boolean; minutesNow: number }): TimingParse {
  let text = clause.trim();
  const lower = () => text.toLowerCase();
  const ctx = (hint: Meridiem) => ({ isToday: input.isToday, minutesNow: input.minutesNow, hint });
  const strip = (match: RegExpExecArray) => {
    text = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/\s+/g, " ").replace(/\s+([,.])/g, "$1").trim();
  };

  // "9 - 10am window: …", "7pm: …"
  const prefixWindow = new RegExp(`^(${TIME_TOKEN})\\s*(?:-|–|to|through|until)\\s*(${TIME_TOKEN})\\s*(?:window)?\\s*[:,-]\\s*`, "i").exec(text);
  if (prefixWindow) {
    const start = parseClock(prefixWindow[1]!);
    const end = parseClock(prefixWindow[2]!);
    if (start && end) {
      const hint = end.meridiem ?? meridiemIn(lower());
      const s = to24h(start, ctx(start.meridiem ?? hint));
      const e = to24h(end, ctx(hint));
      strip(prefixWindow);
      return { timing: { kind: "window", start: s, end: e, label: windowLabel(s, e) }, remainder: text };
    }
  }
  const prefixAt = new RegExp(`^(${TIME_TOKEN})\\s*[:,-]\\s*`, "i").exec(text);
  if (prefixAt && /\d|noon|midnight/.test(prefixAt[1]!)) {
    const at = parseClock(prefixAt[1]!);
    if (at) {
      const s = to24h(at, ctx(meridiemIn(lower())));
      strip(prefixAt);
      return { timing: { kind: "at", start: s, label: `at ${spokenClock(s)}` }, remainder: text };
    }
  }

  const between = new RegExp(`\\b(?:between|from)\\s+(${TIME_TOKEN})\\s+(?:and|to|through|until|-)\\s+(${TIME_TOKEN})(?:\\s*window)?`, "i").exec(text) ??
    new RegExp(`\\b(${TIME_TOKEN})\\s*(?:-|–|to)\\s*(${TIME_TOKEN})\\s*(?:window|slot)\\b`, "i").exec(text);
  if (between && !/^now$/i.test(between[1]!)) {
    const start = parseClock(between[1]!);
    const end = parseClock(between[2]!);
    if (start && end) {
      const hint = end.meridiem ?? meridiemIn(lower());
      const s = to24h(start, ctx(start.meridiem ?? hint));
      const e = to24h(end, ctx(hint));
      strip(between);
      return { timing: { kind: "window", start: s, end: e, label: windowLabel(s, e) }, remainder: text };
    }
  }

  const untilNow = new RegExp(`\\b(?:any ?time\\s+)?(?:from\\s+)?now\\s+(?:to|until|till|through|thru|-)\\s+(${TIME_TOKEN})`, "i").exec(text);
  const before = untilNow ?? new RegExp(`\\b(?:before|by|no later than|until|till)\\s+(${TIME_TOKEN})`, "i").exec(text);
  if (before) {
    const end = parseClock(before[1]!);
    if (end) {
      const e = to24h(end, ctx(meridiemIn(lower())));
      strip(before);
      return { timing: { kind: "before", end: e, label: `before ${spokenClock(e)}` }, remainder: text };
    }
  }

  const after = new RegExp(`\\bafter\\s+(${TIME_TOKEN})`, "i").exec(text);
  if (after && /\d|noon|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve/i.test(after[1]!)) {
    const start = parseClock(after[1]!);
    if (start) {
      const s = to24h(start, ctx(meridiemIn(lower())));
      strip(after);
      return { timing: { kind: "after", start: s, label: `after ${spokenClock(s)}` }, remainder: text };
    }
  }

  const at = new RegExp(`\\b(?:at|around|@|by about)\\s+(${TIME_TOKEN})`, "i").exec(text) ??
    /\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))(?=\W|$)/i.exec(text);
  if (at) {
    const clock = parseClock(at[1]!);
    if (clock && (clock.meridiem || /\d|noon|midnight/.test(at[1]!) || /\b(?:at|around)\s/i.test(at[0]))) {
      const s = to24h(clock, ctx(meridiemIn(lower())));
      strip(at);
      return { timing: { kind: "at", start: s, label: `at ${spokenClock(s)}` }, remainder: text };
    }
  }

  const daypart = /\b(first thing(?: in the morning)?|(?:some ?time |sometime )?(?:this|in the|later this) (?:morning|afternoon|evening)|tonight|later today|end of (?:the )?day|eod|over lunch|at lunch)\b/i.exec(text);
  if (daypart) {
    const label = daypart[1]!.toLowerCase().replace(/^some ?time /, "").replace(/^in the /, "this ");
    strip(daypart);
    return { timing: { kind: "daypart", label }, remainder: text };
  }
  return { timing: { kind: "none" }, remainder: text };
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function weekdayOf(ymd: string): string {
  return WEEKDAYS[new Date(`${ymd}T12:00:00Z`).getUTCDay()]!;
}

/** The next date (today or later) falling on `weekday`. */
function nextWeekday(today: string, weekday: string, allowToday: boolean): string {
  for (let offset = allowToday ? 0 : 1; offset <= 7; offset += 1) {
    const candidate = addDaysYmd(today, offset);
    if (weekdayOf(candidate) === weekday) return candidate;
  }
  return today;
}

function explicitDate(lower: string, today: string): string | null {
  const match = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(lower);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1]!) + 1;
  const year = Number(today.slice(0, 4));
  let ymd = `${year}-${String(month).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
  if (!isValidYmd(ymd)) return null;
  if (ymd < addDaysYmd(today, -180)) ymd = `${year + 1}${ymd.slice(4)}`;
  return ymd;
}

export type DayMention = { ymd: string; sticky: boolean; label: "today" | "tomorrow" | "date" };

/**
 * Which day a sentence or clause talks about, if it says. A bare leading
 * "Tomorrow…" section header is sticky: following sentences stay on tomorrow
 * until another day is named.
 */
export function dayMention(text: string, today: string): DayMention | null {
  const lower = text.toLowerCase();
  const date = explicitDate(lower, today);
  const header = /^(?:and |then |also |oh |plus )?(tomorrow|tmrw|today|tonight|this (?:morning|afternoon|evening)|(?:on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/.exec(lower);
  if (date) {
    return { ymd: date, sticky: Boolean(header) || /:\s*$/.test(text.trim()), label: date === today ? "today" : date === addDaysYmd(today, 1) ? "tomorrow" : "date" };
  }
  if (/\b(?:tomorrow|tmrw)\b/.test(lower)) return { ymd: addDaysYmd(today, 1), sticky: Boolean(header && /tomorrow|tmrw/.test(header[1]!)), label: "tomorrow" };
  if (/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/.test(lower)) {
    return { ymd: today, sticky: Boolean(header && /today|tonight|this/.test(header[1]!)), label: "today" };
  }
  const weekday = new RegExp(`\\b(?:on |this |next )?(${WEEKDAYS.join("|")})\\b`).exec(lower);
  if (weekday) {
    const next = /\bnext\s/.test(weekday[0]) ? addDaysYmd(nextWeekday(today, weekday[1]!, false), 7) : nextWeekday(today, weekday[1]!, true);
    return { ymd: next, sticky: Boolean(header), label: next === today ? "today" : next === addDaysYmd(today, 1) ? "tomorrow" : "date" };
  }
  return null;
}

export function spokenDay(ymd: string, today: string): string {
  if (ymd === today) return "today";
  if (ymd === addDaysYmd(today, 1)) return "tomorrow";
  const weekday = weekdayOf(ymd);
  const month = MONTHS[Number(ymd.slice(5, 7)) - 1]!;
  const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
  return `${cap(weekday)}, ${cap(month)} ${Number(ymd.slice(8, 10))}`;
}

export function timingSortKey(timing: BriefingTiming): string {
  switch (timing.kind) {
    case "at":
    case "window":
    case "after":
      return timing.start;
    case "before":
      return timing.end;
    default:
      return "99:99";
  }
}
