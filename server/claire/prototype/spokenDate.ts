/**
 * Server-side resolution of a spoken day to a business date.
 *
 * The model passes the operator's own words for the day ("tomorrow", "Friday",
 * "day after tomorrow", "the 3rd"); the server, which owns the call's calendar
 * and time zone, turns them into one YYYY-MM-DD or refuses. A vague day
 * ("sometime next week", "soon", "later") is a refusal with a reason the model
 * can read back as a question. The model never guesses a calendar date.
 */

export type SpokenDateResolution =
  | { kind: "resolved"; businessDate: string; from: string }
  | { kind: "ambiguous"; reason: string }
  | { kind: "invalid"; reason: string };

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function utc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export function addDaysYmd(ymd: string, days: number): string {
  const date = utc(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Monday-start week index, for "next <weekday>" = a day in the following week. */
function weekIndex(ymd: string): number {
  const date = utc(ymd);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return Math.floor((date.getTime() - mondayOffset * 86_400_000) / (7 * 86_400_000));
}

/**
 * One rule for every weekday reference, shared with the evaluation's DateRefs:
 *   coming  "Friday"       → the next Friday after today (a Friday said on a Friday is in a week)
 *   this    "this Friday"  → the coming Friday, today included
 *   next    "next Friday"  → the Friday of NEXT week (Monday-start), never this week's
 */
export function resolveWeekday(today: string, target: number, mode: "coming" | "this" | "next"): string {
  const current = utc(today).getUTCDay();
  let delta = (target - current + 7) % 7;
  if (delta === 0 && mode !== "this") delta = 7;
  let candidate = addDaysYmd(today, delta);
  if (mode === "next" && weekIndex(candidate) === weekIndex(today)) candidate = addDaysYmd(candidate, 7);
  return candidate;
}

const VAGUE = /\b(some ?time|sometime|soon|later|eventually|at some point|whenever|one of these days|this week|next week|this month|next month|in a (?:few|couple)|end of (?:the )?(?:week|month)|early next|mid|around)\b/i;

export function resolveSpokenDate(spokenRaw: string, context: { today: string }): SpokenDateResolution {
  const spoken = spokenRaw.trim().toLowerCase().replace(/[’]/g, "'");
  const { today } = context;
  if (!spoken) return { kind: "invalid", reason: "no day was given" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(spoken)) {
    return Number.isNaN(utc(spoken).getTime())
      ? { kind: "invalid", reason: `"${spokenRaw}" is not a real date` }
      : { kind: "resolved", businessDate: spoken, from: spokenRaw };
  }
  if (VAGUE.test(spoken) && !/\b(next|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(spoken)) {
    return { kind: "ambiguous", reason: `"${spokenRaw}" does not name a single day; ask which day` };
  }
  if (/^(today|tonight|this (?:morning|afternoon|evening)|later today)$/.test(spoken)) return { kind: "resolved", businessDate: today, from: spokenRaw };
  if (/^(tomorrow|tomorrow (?:morning|afternoon|evening|night))$/.test(spoken)) return { kind: "resolved", businessDate: addDaysYmd(today, 1), from: spokenRaw };
  if (/^(the )?day after tomorrow$/.test(spoken)) return { kind: "resolved", businessDate: addDaysYmd(today, 2), from: spokenRaw };
  if (/^yesterday$/.test(spoken)) return { kind: "resolved", businessDate: addDaysYmd(today, -1), from: spokenRaw };
  const inDays = /^in (\d+) days?$/.exec(spoken);
  if (inDays) return { kind: "resolved", businessDate: addDaysYmd(today, Number(inDays[1])), from: spokenRaw };

  const weekday = /^(?:(next|this)\s+)?(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening|night))?$/.exec(spoken);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2]!);
    const mode = weekday[1] === "next" ? "next" : weekday[1] === "this" ? "this" : "coming";
    return { kind: "resolved", businessDate: resolveWeekday(today, target, mode), from: spokenRaw };
  }

  const monthDay = /^(?:on\s+)?(?:the\s+)?(?:(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?|(\d{1,2})(?:st|nd|rd|th)?(?:\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december))?)$/.exec(spoken);
  if (monthDay) {
    const monthWord = monthDay[1] ?? monthDay[4];
    const day = Number(monthDay[2] ?? monthDay[3]);
    const [year, month] = today.split("-").map(Number);
    let m = month! - 1;
    if (monthWord) {
      m = MONTHS.findIndex(name => name.startsWith(monthWord.slice(0, 3)));
      if (m < 0) return { kind: "invalid", reason: `unknown month in "${spokenRaw}"` };
    }
    let y = year!;
    let candidate = new Date(Date.UTC(y, m, day));
    if (candidate.getUTCMonth() !== m) return { kind: "invalid", reason: `"${spokenRaw}" is not a real date` };
    let ymd = candidate.toISOString().slice(0, 10);
    // A bare day-of-month or month-day already past this year means the next one.
    if (ymd < today) {
      if (monthWord) { y += 1; candidate = new Date(Date.UTC(y, m, day)); }
      else { candidate = new Date(Date.UTC(y, m + 1, day)); }
      ymd = candidate.toISOString().slice(0, 10);
    }
    return { kind: "resolved", businessDate: ymd, from: spokenRaw };
  }
  return { kind: "ambiguous", reason: `"${spokenRaw}" could not be read as one day; ask which day` };
}

export function businessDateToday(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function spokenDay(businessDate: string, today: string): string {
  if (businessDate === today) return "today";
  if (businessDate === addDaysYmd(today, 1)) return "tomorrow";
  const weekday = WEEKDAYS[utc(businessDate).getUTCDay()]!;
  const label = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}`;
  const delta = Math.round((utc(businessDate).getTime() - utc(today).getTime()) / 86_400_000);
  return delta > 1 && delta < 7 ? label : `${label} ${businessDate}`;
}
