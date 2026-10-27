/**
 * Weekend default for overdue sales follow-ups.
 *
 * 2026-10-18 (a Saturday evening) Claire opened with "The Louise… 71 days overdue"; Adam: "not an
 * appropriate topic for the weekend." His stated rhythm is reviews on Sunday 5-7 PM. Until the standing
 * instruction store (repair plan W5) can hold this as an operator rule, the default is hard-coded here:
 * an overdue sales follow-up is not RAISED on Saturday or Sunday unless the operator asked about it.
 * It stays on the Day Line and in the data; it is only not volunteered.
 * Customer promises (orders, deliveries) are never covered by this rule.
 */
import { weekdayOf } from "../briefing/briefingTiming";

export function isWeekendBusinessDate(ymd: string): boolean {
  const day = weekdayOf(ymd);
  return day === "saturday" || day === "sunday";
}

export function mayRaiseOverdueSalesFollowUp(input: { businessDate: string; operatorAsked?: boolean }): boolean {
  return Boolean(input.operatorAsked) || !isWeekendBusinessDate(input.businessDate);
}

/** An open commitment that is really a sales follow-up (call, email, visit) rather than a customer promise. */
export function looksLikeSalesFollowUp(title: string): boolean {
  return /\b(?:follow[- ]?up|call|email|text|reach out|visit|pitch|touch base|check in)\b/i.test(title);
}
