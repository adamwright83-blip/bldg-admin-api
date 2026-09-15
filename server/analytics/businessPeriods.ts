import { getDashboardTimeZone, zonedDayStartUtc, zonedYmd } from "../dashboardZoned";

/**
 * Business-local calendar periods. Every analytical date boundary in Goldline
 * (Admin analytics and Claire) resolves through here so "last 30 days" means
 * the same thing everywhere: today's business-local calendar day plus the
 * preceding 29, never a UTC day.
 */

export type PeriodSpec =
  | { kind: "today" }
  | { kind: "yesterday" }
  | { kind: "this_week" }
  | { kind: "last_week" }
  | { kind: "this_month" }
  | { kind: "last_month" }
  | { kind: "this_year" }
  | { kind: "last_year" }
  | { kind: "trailing_days"; days: number }
  | { kind: "between"; start: string; end: string; label?: string }
  | { kind: "since"; start: string }
  | { kind: "all_time" };

export type ResolvedPeriod = {
  spec: PeriodSpec;
  /** Inclusive business-local start date, YYYY-MM-DD. */
  start: string;
  /** Inclusive business-local end date, YYYY-MM-DD. */
  end: string;
  startUtc: Date;
  endExclusiveUtc: Date;
  days: number;
  timeZone: string;
  label: string;
};

export const ALL_TIME_START = "2020-01-01";
const MAX_TRAILING_DAYS = 3660;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function isValidYmd(value: string): boolean {
  if (!YMD.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function addMonthsToMonthStart(ymd: string, months: number): string {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1 + months, 1)).toISOString().slice(0, 10);
}

export function daysInclusive(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 864e5) + 1;
}

function isoWeekday(ymd: string): number {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function monthStart(ymd: string): string {
  return `${ymd.slice(0, 8)}01`;
}

function monthEnd(ymd: string): string {
  return addDaysYmd(addMonthsToMonthStart(monthStart(ymd), 1), -1);
}

export function formatBusinessDate(ymd: string, includeYear = false): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${MONTHS[m! - 1]} ${d}${includeYear ? `, ${y}` : ""}`;
}

function rangeLabel(start: string, end: string, today: string): string {
  const includeYear = start.slice(0, 4) !== today.slice(0, 4) || end.slice(0, 4) !== today.slice(0, 4);
  if (start === end) return formatBusinessDate(start, includeYear);
  if (start === monthStart(start) && end === monthEnd(start)) {
    return `${MONTHS[Number(start.slice(5, 7)) - 1]}${includeYear ? ` ${start.slice(0, 4)}` : ""}`;
  }
  return `${formatBusinessDate(start, includeYear)} through ${formatBusinessDate(end, includeYear)}`;
}

function labelFor(spec: PeriodSpec, start: string, end: string, today: string): string {
  switch (spec.kind) {
    case "today":
      return "today";
    case "yesterday":
      return "yesterday";
    case "this_week":
      return "this week so far";
    case "last_week":
      return "last week";
    case "this_month":
      return "this month so far";
    case "last_month":
      return "last month";
    case "this_year":
      return "this year so far";
    case "last_year":
      return "last year";
    case "trailing_days":
      return spec.days === 1 ? "today" : `the last ${spec.days} days`;
    case "since":
      return `since ${formatBusinessDate(start, start.slice(0, 4) !== today.slice(0, 4))}`;
    case "all_time":
      return "all time";
    case "between":
      return spec.label ?? rangeLabel(start, end, today);
  }
}

function bounded(start: string, end: string, today: string): { start: string; end: string } {
  let s = start;
  let e = end;
  if (s > e) [s, e] = [e, s];
  if (e > today) e = today;
  if (s > e) s = e;
  if (s < ALL_TIME_START) s = ALL_TIME_START;
  return { start: s, end: e };
}

function build(spec: PeriodSpec, start: string, end: string, today: string, timeZone: string): ResolvedPeriod {
  const range = bounded(start, end, today);
  return {
    spec,
    start: range.start,
    end: range.end,
    startUtc: zonedDayStartUtc(range.start, timeZone),
    endExclusiveUtc: zonedDayStartUtc(addDaysYmd(range.end, 1), timeZone),
    days: daysInclusive(range.start, range.end),
    timeZone,
    label: labelFor(spec, range.start, range.end, today),
  };
}

export function businessToday(now = new Date(), timeZone = getDashboardTimeZone()): string {
  return zonedYmd(now, timeZone);
}

export function resolvePeriod(
  spec: PeriodSpec,
  now = new Date(),
  timeZone = getDashboardTimeZone()
): ResolvedPeriod {
  const today = zonedYmd(now, timeZone);
  switch (spec.kind) {
    case "today":
      return build(spec, today, today, today, timeZone);
    case "yesterday": {
      const day = addDaysYmd(today, -1);
      return build(spec, day, day, today, timeZone);
    }
    case "this_week":
      return build(spec, addDaysYmd(today, 1 - isoWeekday(today)), today, today, timeZone);
    case "last_week": {
      const monday = addDaysYmd(today, 1 - isoWeekday(today));
      return build(spec, addDaysYmd(monday, -7), addDaysYmd(monday, -1), today, timeZone);
    }
    case "this_month":
      return build(spec, monthStart(today), today, today, timeZone);
    case "last_month": {
      const start = addMonthsToMonthStart(monthStart(today), -1);
      return build(spec, start, monthEnd(start), today, timeZone);
    }
    case "this_year":
      return build(spec, `${today.slice(0, 4)}-01-01`, today, today, timeZone);
    case "last_year": {
      const year = Number(today.slice(0, 4)) - 1;
      return build(spec, `${year}-01-01`, `${year}-12-31`, today, timeZone);
    }
    case "trailing_days": {
      const days = Math.max(1, Math.min(MAX_TRAILING_DAYS, Math.round(spec.days)));
      return build({ kind: "trailing_days", days }, addDaysYmd(today, -(days - 1)), today, today, timeZone);
    }
    case "between": {
      const start = isValidYmd(spec.start) ? spec.start : today;
      const end = isValidYmd(spec.end) ? spec.end : today;
      return build(spec, start, end, today, timeZone);
    }
    case "since":
      return build(spec, isValidYmd(spec.start) ? spec.start : today, today, today, timeZone);
    case "all_time":
      return build(spec, ALL_TIME_START, today, today, timeZone);
  }
}

/**
 * The comparable period immediately before `period`.
 * Complete calendar periods compare to the previous complete calendar period;
 * to-date periods compare to the same number of elapsed days in the previous
 * one; everything else compares to the equal-length span right before it.
 */
export function previousPeriod(period: ResolvedPeriod, now = new Date()): ResolvedPeriod {
  const tz = period.timeZone;
  const today = zonedYmd(now, tz);
  const between = (start: string, end: string, label: string): ResolvedPeriod =>
    build({ kind: "between", start, end, label }, start, end, today, tz);
  switch (period.spec.kind) {
    case "today":
      return resolvePeriod({ kind: "yesterday" }, now, tz);
    case "yesterday": {
      const day = addDaysYmd(period.start, -1);
      return between(day, day, "the day before");
    }
    case "this_week":
      return between(addDaysYmd(period.start, -7), addDaysYmd(period.end, -7), "the same days last week");
    case "last_week":
      return between(addDaysYmd(period.start, -7), addDaysYmd(period.end, -7), "the week before");
    case "this_month": {
      const start = addMonthsToMonthStart(period.start, -1);
      const end = addDaysYmd(start, period.days - 1);
      return between(start, end > monthEnd(start) ? monthEnd(start) : end, "the same days last month");
    }
    case "last_month": {
      const start = addMonthsToMonthStart(period.start, -1);
      return between(start, monthEnd(start), MONTHS[Number(start.slice(5, 7)) - 1]!);
    }
    case "this_year": {
      const start = `${Number(period.start.slice(0, 4)) - 1}-01-01`;
      return between(start, addDaysYmd(start, period.days - 1), "the same stretch last year");
    }
    case "last_year": {
      const year = Number(period.start.slice(0, 4)) - 1;
      return between(`${year}-01-01`, `${year}-12-31`, String(year));
    }
    default: {
      const end = addDaysYmd(period.start, -1);
      const start = addDaysYmd(end, -(period.days - 1));
      return between(start, end, `the ${period.days} days before that`);
    }
  }
}

/** A resolved period frozen as an explicit date span (for follow-up context). */
export function freezePeriod(period: ResolvedPeriod): PeriodSpec {
  return { kind: "between", start: period.start, end: period.end, label: period.label };
}

// ── Natural-language period phrases ─────────────────────────────────────────

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  twenty: 20,
  "twenty-one": 21,
  thirty: 30,
  forty: 40,
  "forty-five": 45,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  "a hundred": 100,
};

export const NUMBER_PATTERN =
  "(\\d{1,4}|a hundred|hundred|twenty-one|forty-five|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)";

export function parseSpokenNumber(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return WORD_NUMBERS[normalized] ?? null;
}

const MONTH_PATTERN =
  "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)";

function monthIndex(name: string): number {
  const lower = name.toLowerCase().slice(0, 3);
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(lower);
}

function ymdFrom(year: number, monthIdx: number, day: number): string | null {
  const value = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidYmd(value) ? value : null;
}

/** Most recent occurrence of month/day that is not in the future. */
function pastDate(monthIdx: number, day: number, today: string, explicitYear?: number): string | null {
  if (explicitYear) return ymdFrom(explicitYear, monthIdx, day);
  const year = Number(today.slice(0, 4));
  const candidate = ymdFrom(year, monthIdx, day);
  if (candidate && candidate <= today) return candidate;
  return ymdFrom(year - 1, monthIdx, day);
}

export function parsePeriodPhrase(
  utterance: string,
  now = new Date(),
  timeZone = getDashboardTimeZone()
): PeriodSpec | null {
  const text = utterance.toLowerCase().replace(/[’']/g, "'");
  const today = zonedYmd(now, timeZone);

  const between = new RegExp(
    `\\b(?:between|from)\\s+${MONTH_PATTERN}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\s+(?:and|to|through|thru|until|till|-)\\s+(?:${MONTH_PATTERN}\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`
  ).exec(text);
  if (between) {
    const startMonth = monthIndex(between[1]!);
    const endMonth = between[4] ? monthIndex(between[4]) : startMonth;
    const start = pastDate(startMonth, Number(between[2]), today, between[3] ? Number(between[3]) : undefined);
    const endYear = between[6] ? Number(between[6]) : start ? Number(start.slice(0, 4)) : undefined;
    const end = endYear ? ymdFrom(endYear, endMonth, Number(between[5])) : null;
    if (start && end) return { kind: "between", start, end };
  }

  const since = new RegExp(
    `\\bsince\\s+${MONTH_PATTERN}\\.?(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?)?(?:,?\\s+(\\d{4}))?`
  ).exec(text);
  if (since) {
    const start = pastDate(monthIndex(since[1]!), since[2] ? Number(since[2]) : 1, today, since[3] ? Number(since[3]) : undefined);
    if (start) return { kind: "since", start };
  }

  const trailing = new RegExp(
    `\\b(?:last|past|previous|prior|trailing|the last|the past)\\s+${NUMBER_PATTERN}\\s+(days?|weeks?|months?)\\b`
  ).exec(text) ?? new RegExp(`\\b${NUMBER_PATTERN}\\s+(days?|weeks?)\\b`).exec(text);
  if (trailing) {
    const count = parseSpokenNumber(trailing[1]!);
    if (count && count > 0) {
      const unit = trailing[2]!;
      if (unit.startsWith("day")) return { kind: "trailing_days", days: count };
      if (unit.startsWith("week")) return { kind: "trailing_days", days: count * 7 };
      const start = addDaysYmd(addMonthsToMonthStart(monthStart(today), -count), Number(today.slice(8, 10)));
      return { kind: "between", start, end: today, label: `the last ${count} months` };
    }
  }

  const inMonth = new RegExp(`\\b(?:in|for|during|of)\\s+${MONTH_PATTERN}\\b(?:\\s+(\\d{4}))?`).exec(text);
  if (inMonth) {
    const idx = monthIndex(inMonth[1]!);
    const start = pastDate(idx, 1, today, inMonth[2] ? Number(inMonth[2]) : undefined);
    if (start) return { kind: "between", start, end: monthEnd(start) };
  }

  if (/\b(?:so far )?today\b/.test(text)) return { kind: "today" };
  if (/\byesterday\b/.test(text)) return { kind: "yesterday" };
  if (/\b(?:this week|week to date|so far this week)\b/.test(text)) return { kind: "this_week" };
  if (/\b(?:last|previous|prior) week\b/.test(text)) return { kind: "last_week" };
  if (/\bpast week\b/.test(text)) return { kind: "trailing_days", days: 7 };
  if (/\b(?:this month|month to date|mtd|so far this month)\b/.test(text)) return { kind: "this_month" };
  if (/\b(?:last|previous|prior) month\b/.test(text)) return { kind: "last_month" };
  if (/\bpast month\b/.test(text)) return { kind: "trailing_days", days: 30 };
  if (/\b(?:this year|year to date|ytd|so far this year)\b/.test(text)) return { kind: "this_year" };
  if (/\b(?:last|previous|prior) year\b/.test(text)) return { kind: "last_year" };
  if (/\b(?:all time|all-time|ever|lifetime)\b/.test(text)) return { kind: "all_time" };
  return null;
}
