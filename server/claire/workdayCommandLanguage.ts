/**
 * Operator-language detectors for Daily Command.
 *
 * Primary authority is explicit designation or confirmation of Claire's proposal.
 * Historical cadence is never silent recurrence. Unknown identity stays unknown.
 */

import { dayMention, spokenDay } from "./briefing/briefingTiming";
import { UNKNOWN_CARGO_IDENTITY } from "../../shared/claireWorkdayCommand";
import type { CommandRole } from "../../shared/claireWorkdayCommand";
import { classifyDayDirectorKind, isHousekeepingUtterance, isTomorrowPrepUtterance } from "./workdayCommandKind";

const PRIMARY =
  /\b(?:(?:today|tomorrow|tonight|(?:this |next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))(?:'s|s)?\s+)?(?:priority|primary(?: mission)?|main (?:thing|focus|mission)|protected mission)\b|\bmake\s+.+\s+my mission\b|\bthat(?:'s| is) the main thing\b|\bmy mission(?: for| on)?\s+(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

const EXTERNAL_TOLD = /\bI (?:told|promised|committed to)\s+([A-Z][a-zA-Z]+)/;
const EXTERNAL_SEND = /\bsend(?:ing)? (?:it|this|the ad) to\s+([A-Z][a-zA-Z]+)/;

const RECURRENCE =
  /\b(?:every|each)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\bweekly\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:weekly|recurring)\b|\bmake\s+.+\s+recurring\b/i;

const RECONCILIATION_DONE =
  /\b(?:that(?:'s| is) (?:all|everything|it)|nothing else|no other (?:pickups?|drop-?offs?)|that(?:'s| is) the lot|line is complete)\b/i;

const UNKNOWN_IDENTITY =
  /\b(?:can'?t|cannot|don'?t|do not) remember (?:the )?(?:tenant'?s? |customer'?s? )?name\b|\bwhose name i (?:can'?t|cannot|don'?t)\b|\bunknown (?:tenant|customer|identity)\b|\ba new tenant whose name\b/i;

const GREETING = /^(?:good morning|morning|hey(?: claire)?|hi(?: claire)?|hello)\b/i;

export function detectPrimaryDesignation(text: string): boolean {
  return PRIMARY.test(text);
}

export function detectExternalPromisee(text: string): string | null {
  return EXTERNAL_TOLD.exec(text)?.[1] ?? EXTERNAL_SEND.exec(text)?.[1] ?? null;
}

export function detectRecurrenceWeekday(text: string): string | null {
  const match = RECURRENCE.exec(text);
  const weekday = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").toLowerCase();
  return weekday || null;
}

export function detectUnknownCargoIdentity(text: string): boolean {
  return UNKNOWN_IDENTITY.test(text);
}

export function detectReconciliationComplete(text: string): boolean {
  return RECONCILIATION_DONE.test(text);
}

export function isMorningGreeting(text: string): boolean {
  return GREETING.test(text.trim()) && text.trim().split(/\s+/).length <= 6;
}

export function resolveCommitmentBusinessDate(text: string, today: string): string {
  return dayMention(text, today)?.ymd ?? today;
}

export function unknownCargoDisplayName(text: string): string {
  return detectUnknownCargoIdentity(text) ? UNKNOWN_CARGO_IDENTITY : "";
}

export function interpretCommandRole(text: string): CommandRole {
  if (detectPrimaryDesignation(text)) return "primary";
  if (isHousekeepingUtterance(text)) return "housekeeping";
  if (isTomorrowPrepUtterance(text)) return "tomorrow_prep";
  if (detectExternalPromisee(text)) return "external_commitment";
  if (/\b(pick ?up|drop ?off|deliver|appointment|window)\b/i.test(text) && /\d|noon|between|am|pm|morning/i.test(text)) {
    return "fixed";
  }
  return null;
}

export function commandMetadataFromUtterance(
  text: string,
  nowIso: string
): {
  role: CommandRole;
  designatedBy: "operator" | null;
  designatedAt: string | null;
  promisedTo: string | null;
  identityUnknown: boolean;
} {
  const role = interpretCommandRole(text);
  return {
    role,
    designatedBy: role === "primary" ? "operator" : null,
    designatedAt: role === "primary" ? nowIso : null,
    promisedTo: detectExternalPromisee(text),
    identityUnknown: detectUnknownCargoIdentity(text),
  };
}

const PRIMARY_STOP =
  /^(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|priority|primary|mission|main|thing|focus|finish|finishing|sending|ready|launch|being|collaborator|approval)$/;

function primarySubjectText(utterance: string): string {
  const afterPriority = utterance.match(
    /(?:priority|primary(?: mission)?|main (?:thing|focus|mission)|protected mission)\s+(?:is\s+)?(.+)/i
  );
  if (afterPriority?.[1]) return afterPriority[1];
  const makeMission = utterance.match(/\bmake\s+(.+?)\s+my mission\b/i);
  if (makeMission?.[1]) return makeMission[1];
  return utterance;
}

export function itemMatchesPrimary(itemText: string, utterance: string): boolean {
  if (!detectPrimaryDesignation(utterance)) return false;
  const distinctive = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(token => token.length >= 4 && !PRIMARY_STOP.test(token));
  const wanted = distinctive(primarySubjectText(utterance));
  const have = distinctive(itemText);
  if (!wanted.length || !have.length) return false;
  return wanted.some(token => have.includes(token));
}

export function isVehicleCargoUtterance(text: string): boolean {
  return (
    detectUnknownCargoIdentity(text) ||
    /\bdry[ -]?clean(?:ing)?\b/i.test(text) && /\b(?:car|vehicle|in the (?:car|van))\b/i.test(text)
  );
}

export function speakCommitmentDay(ymd: string, today: string): string {
  return spokenDay(ymd, today);
}

export { classifyDayDirectorKind };
