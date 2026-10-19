/**
 * The period the operator explicitly named, if any.
 *
 * Only unambiguous phrases are recognized. "This past week" or "recently" are
 * not, so they never trigger a refusal; they are simply answered as read.
 */

import type { PeriodSpec } from "../../../analytics/businessPeriods";

export type RequestedPeriod = { kind: PeriodSpec["kind"]; days?: number; label: string };

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, five: 5, seven: 7, ten: 10, fourteen: 14, thirty: 30, sixty: 60, ninety: 90,
};

export function requestedPeriod(utterance: string): RequestedPeriod | null {
  const text = utterance.toLowerCase();
  const trailing = /\b(?:last|past|previous)\s+(\d{1,3}|two|three|five|seven|ten|fourteen|thirty|sixty|ninety)\s+days?\b/.exec(text);
  if (trailing) {
    const days = Number(trailing[1]) || NUMBER_WORDS[trailing[1]!] || 0;
    if (days > 0) return { kind: "trailing_days", days, label: `the last ${days} days` };
  }
  if (/\btoday(?:'s)?\b/.test(text)) return { kind: "today", label: "today" };
  if (/\byesterday(?:'s)?\b/.test(text)) return { kind: "yesterday", label: "yesterday" };
  if (/\bthis past week\b/.test(text)) return null;
  if (/\blast week(?:'s)?\b/.test(text)) return { kind: "last_week", label: "last week" };
  if (/\bthis week(?:'s)?\b/.test(text)) return { kind: "this_week", label: "this week" };
  if (/\blast month(?:'s)?\b/.test(text)) return { kind: "last_month", label: "last month" };
  if (/\bthis month(?:'s)?\b|\bmonth[- ]to[- ]date\b/.test(text)) return { kind: "this_month", label: "this month" };
  if (/\blast year(?:'s)?\b/.test(text)) return { kind: "last_year", label: "last year" };
  if (/\bthis year(?:'s)?\b|\byear[- ]to[- ]date\b/.test(text)) return { kind: "this_year", label: "this year" };
  return null;
}

/** True when an executed query's period is exactly the period the operator asked for. */
export function periodMatches(requested: RequestedPeriod, executed: PeriodSpec | null | undefined): boolean {
  if (!executed) return false;
  if (executed.kind !== requested.kind) return false;
  if (requested.kind === "trailing_days") {
    return executed.kind === "trailing_days" && executed.days === requested.days;
  }
  return true;
}
