import {
  addDaysYmd,
  businessToday,
  isValidYmd,
  parsePeriodPhrase,
  resolvePeriod,
  type PeriodSpec,
} from "../../analytics/businessPeriods";

/**
 * First registered kind of the business-goal engine.
 * The operator asks to earn an amount inside a horizon. "Another" marks that
 * amount as incremental on top of whatever the week already holds. A bare
 * "earn $500 this week" is the same period target: produce that amount inside
 * the horizon. It is not the trailing-30 net-sales level the metric reader uses.
 */
export const INCREMENTAL_EARNINGS_KIND = "incremental_earnings" as const;

export type BusinessGoalKind = typeof INCREMENTAL_EARNINGS_KIND;

export type GoalHorizon = {
  startYmd: string;
  endYmd: string;
  label: string;
};

export type IncrementalEarningsGoal = {
  kind: typeof INCREMENTAL_EARNINGS_KIND;
  statement: string;
  amountCents: number;
  explicitAnother: boolean;
  period: PeriodSpec;
  horizon: GoalHorizon;
};

export type BusinessGoalParse =
  | { status: "goal"; goal: IncrementalEarningsGoal }
  | { status: "needs_period"; statement: string; amountCents: number; explicitAnother: boolean }
  | { status: "past_period"; statement: string; amountCents: number; explicitAnother: boolean; periodLabel: string }
  | { status: "not_a_goal" };

const NOT_A_GOAL: BusinessGoalParse = { status: "not_a_goal" };

const QUESTION_LEAD =
  /^(?:how much|what|what's|whats|who|when|which|where|why|did|do|does|is|are|was|were|have we|did we)\b/i;

const AMOUNT =
  /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?|\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(?:dollars|bucks|usd)\b/i;

const PAST_KINDS = new Set<PeriodSpec["kind"]>([
  "yesterday",
  "last_week",
  "last_month",
  "last_year",
]);

function amountCents(match: RegExpMatchArray): number | null {
  const raw = (match[1] ?? match[3] ?? "").replace(/,/g, "");
  if (!/^\d+$/.test(raw)) return null;
  const dollars = Number(raw);
  if (!Number.isSafeInteger(dollars) || dollars < 0) return null;
  const fraction = match[2] ?? match[4] ?? "";
  const extra = fraction ? Number((fraction + "00").slice(0, 2)) : 0;
  const cents = dollars * 100 + extra;
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000_000_00) return null;
  return cents;
}

function earningsFrame(text: string): boolean {
  if (QUESTION_LEAD.test(text) || /\bhow much\b/i.test(text)) return false;
  const another = /\b(?:another|an extra|additional)\b/i.test(text);
  const helped =
    /\b(?:help me|can you help(?: me)?|could you help(?: me)?|would you help(?: me)?|i want to|i need to|i'd like to|i would like to|let's|we need to)\s+(?:earn|make|bring in|pull in)\b/i.test(
      text
    );
  const imperative = /^(?:please\s+)?(?:earn|make|bring in|pull in)\b/i.test(text);
  if (!helped && !imperative) return false;
  if (/\bearn\b/i.test(text)) return true;
  return another;
}

/**
 * Calendar week for a goal runs Monday through Sunday, not week-to-date.
 * Month and year horizons run through the last day of that period.
 */
export function resolveGoalHorizon(
  period: PeriodSpec,
  now: Date,
  timeZone: string
): GoalHorizon | null {
  if (PAST_KINDS.has(period.kind) || period.kind === "all_time" || period.kind === "since") {
    return null;
  }
  const today = businessToday(now, timeZone);
  if (period.kind === "today") {
    return { startYmd: today, endYmd: today, label: "today" };
  }
  if (period.kind === "this_week") {
    const week = resolvePeriod(period, now, timeZone);
    return { startYmd: week.start, endYmd: addDaysYmd(week.start, 6), label: "this week" };
  }
  if (period.kind === "this_month") {
    const month = resolvePeriod(period, now, timeZone);
    const [year, monthNumber] = month.start.split("-").map(Number);
    const nextMonth =
      monthNumber === 12
        ? `${year! + 1}-01-01`
        : `${year}-${String(monthNumber! + 1).padStart(2, "0")}-01`;
    return { startYmd: month.start, endYmd: addDaysYmd(nextMonth, -1), label: "this month" };
  }
  if (period.kind === "this_year") {
    const year = today.slice(0, 4);
    return { startYmd: `${year}-01-01`, endYmd: `${year}-12-31`, label: "this year" };
  }
  if (period.kind === "between") {
    if (!isValidYmd(period.start) || !isValidYmd(period.end) || period.end < period.start) return null;
    if (period.end < today) return null;
    const startYmd = period.start < today ? today : period.start;
    return {
      startYmd,
      endYmd: period.end,
      label: period.label ?? `${startYmd} through ${period.end}`,
    };
  }
  if (period.kind === "trailing_days") {
    const resolved = resolvePeriod(period, now, timeZone);
    if (resolved.end < today) return null;
    return { startYmd: resolved.start, endYmd: resolved.end, label: resolved.label };
  }
  return null;
}

function periodFromUtterance(text: string, now: Date, timeZone: string): PeriodSpec | "past" | null {
  const nextDays = /\bnext\s+(\d{1,3})\s+days?\b/i.exec(text);
  if (nextDays) {
    const days = Number(nextDays[1]);
    if (!Number.isInteger(days) || days < 1 || days > 366) return null;
    const today = businessToday(now, timeZone);
    return {
      kind: "between",
      start: today,
      end: addDaysYmd(today, days - 1),
      label: `the next ${days} days`,
    };
  }
  const period = parsePeriodPhrase(text, now, timeZone);
  if (!period) return null;
  if (PAST_KINDS.has(period.kind)) return "past";
  if (period.kind === "between") {
    const resolved = resolvePeriod(period, now, timeZone);
    if (resolved.end < businessToday(now, timeZone)) return "past";
  }
  if (period.kind === "all_time" || period.kind === "since") return null;
  return period;
}

export function parseBusinessGoal(
  utterance: string,
  now: Date,
  timeZone: string
): BusinessGoalParse {
  const statement = utterance.trim().replace(/\s+/g, " ");
  if (!statement || !earningsFrame(statement)) return NOT_A_GOAL;
  const amountMatch = AMOUNT.exec(statement);
  if (!amountMatch) return NOT_A_GOAL;
  const cents = amountCents(amountMatch);
  if (cents == null) return NOT_A_GOAL;
  const explicitAnother = /\b(?:another|an extra|additional)\b/i.test(statement);
  const period = periodFromUtterance(statement, now, timeZone);
  if (period === "past") {
    const label = parsePeriodPhrase(statement, now, timeZone);
    return {
      status: "past_period",
      statement,
      amountCents: cents,
      explicitAnother,
      periodLabel: label?.kind.replace(/_/g, " ") ?? "that period",
    };
  }
  if (!period) {
    return { status: "needs_period", statement, amountCents: cents, explicitAnother };
  }
  const horizon = resolveGoalHorizon(period, now, timeZone);
  if (!horizon) {
    return { status: "needs_period", statement, amountCents: cents, explicitAnother };
  }
  return {
    status: "goal",
    goal: {
      kind: INCREMENTAL_EARNINGS_KIND,
      statement,
      amountCents: cents,
      explicitAnother,
      period,
      horizon,
    },
  };
}
