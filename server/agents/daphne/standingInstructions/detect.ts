import { createHash } from "node:crypto";
import { isClaireRoleFeedback } from "../../../../shared/claireRoleFeedback";
import {
  REVIEW_TOPIC_OVERDUE_FOLLOWUPS,
  type DetectedStandingInstruction,
  type ReviewWindowPayload,
  type RoleFeedbackPayload,
} from "./types";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const WEEKDAY_LABEL = WEEKDAYS.map(day => day[0]!.toUpperCase() + day.slice(1));

/** What a prior Claire turn sounds like when it was an encouraging, goal-tied line. */
const PRIOR_ENCOURAGEMENT = /\b(?:attainable|achievable|within reach|doable|on track|closer than|you can get there|real progress|you(?:'ve| have) already|that counts)\b/i;
const ENCOURAGEMENT_WORD = /\b(?:encourag\w*|motivat\w*|pep talk|positive reinforcement|cheer(?:ing)? me|uplift\w*|keep me going)\b/i;
const EVERY_CALL = /\b(?:every|each)\s+(?:single\s+)?(?:call|time|morning|evening|day)\b|\bfrom now on\b|\bgoing forward\b|\balways\b/i;

function to24(hour: number, meridiem: string | undefined): number {
  const m = meridiem?.replace(/\./g, "").toLowerCase();
  if (m === "pm") return hour === 12 ? 12 : hour + 12;
  if (m === "am") return hour === 12 ? 0 : hour;
  return hour;
}

export function parseTimeRange(text: string): { start: number; end: number } | null {
  const match = /(?:\bfrom\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:to|-|–|until|and)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i.exec(text);
  if (!match) return null;
  const [, h1, m1, mer1, h2, m2, mer2] = match;
  const startHour = Number(h1);
  const endHour = Number(h2);
  if (startHour > 12 || endHour > 12 || startHour < 1 || endHour < 1) return null;
  let end = to24(endHour, mer2) * 60 + Number(m2 ?? 0);
  let start = to24(startHour, mer1 ?? mer2) * 60 + Number(m1 ?? 0);
  // "11 to 1 PM" means 11 AM to 1 PM, not 11 PM to 1 PM.
  if (!mer1 && start >= end) start = to24(startHour, "am") * 60 + Number(m1 ?? 0);
  if (start >= end) return null;
  return { start, end };
}

function clock(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour24 < 12 ? "AM" : "PM"}`;
}

export function describeReviewWindow(payload: ReviewWindowPayload): string {
  const day = WEEKDAY_LABEL[payload.weekday] ?? "that day";
  if (payload.startMinutes == null || payload.endMinutes == null) return day;
  return `${day} between ${clock(payload.startMinutes)} and ${clock(payload.endMinutes)}`;
}

const TOPIC_LABEL: Record<string, string> = {
  [REVIEW_TOPIC_OVERDUE_FOLLOWUPS]: "overdue follow-ups",
};
export const topicLabel = (topic: string): string => TOPIC_LABEL[topic] ?? topic.replaceAll("_", " ");

/** Reported speech, quotes and hypotheticals never become a durable rule. */
function isNonCommittal(text: string): boolean {
  const lower = text.toLowerCase();
  if (/["“”]|\b(?:hypothetical|pretend|imagine|joking|sarcastic|said)\b/i.test(text)) return true;
  return lower.endsWith("?") && /\b(?:should|would|could)\b/.test(lower) && !/\b(?:please|i want|i need|from now on)\b/.test(lower);
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function detectReviewWindow(text: string, prior: string): DetectedStandingInstruction | null {
  const lower = text.toLowerCase();
  const weekday = WEEKDAYS.findIndex(day => new RegExp(`\\b${day}s?\\b`).test(lower));
  if (weekday < 0) return null;
  if (!/\b(?:call|check-?in|catch-?up|meeting|talk|chat|session)\b/.test(lower)) return null;
  const asksForTiming = /\b(?:good time|best time|right time|ask me|bring (?:it|that|those|them|stuff|things)(?: \w+)? up|raise (?:it|that|those)|hold (?:it|that|those) until|wait until|save (?:it|that|those) for|review)\b/.test(lower);
  if (!asksForTiming) return null;
  const priorLower = prior.toLowerCase();
  const referring = /\b(?:stuff|things|that kind of|those|that sort of|that)\b/.test(lower);
  const topics: string[] = [];
  if (
    /\b(?:overdue|follow[- ]?ups?|outstanding|stale)\b/.test(lower) ||
    (referring && /\b(?:overdue|follow[- ]?ups?|stale|louise)\b/.test(priorLower))
  ) {
    topics.push(REVIEW_TOPIC_OVERDUE_FOLLOWUPS);
  }
  // A rule about "stuff like that" with no referent cannot be honoured, so it is not captured.
  if (!topics.length) return null;
  const range = parseTimeRange(text);
  const payload: ReviewWindowPayload = {
    weekday,
    startMinutes: range?.start ?? null,
    endMinutes: range?.end ?? null,
    topics,
  };
  return {
    kind: "review_window",
    subjectKey: `review_window:${topics.join("+")}`,
    status: "active",
    text: `Raise ${topics.map(topicLabel).join(" and ")} only on ${describeReviewWindow(payload)}. At any other time, do not raise them and do not say you are holding them.`,
    quote: text,
    payload,
  };
}

function detectEncouragement(text: string, prior: string): DetectedStandingInstruction | null {
  if (/\b(?:stop|no more|don't|do not|quit)\b[^.?!]*\b(?:encourag\w*|pep talks?|motivat\w*)\b/i.test(text)) {
    return {
      kind: "encouragement_every_call",
      subjectKey: "encouragement",
      status: "revoked",
      text: "The operator no longer wants an encouraging line on calls.",
      quote: text,
      payload: null,
    };
  }
  const namesIt = ENCOURAGEMENT_WORD.test(text) && EVERY_CALL.test(text);
  const pointsAtPrior =
    /\b(?:i want|i need|i'd like|do|keep doing|give me)\s+(?:that|this|more of that)\b[^.?!]*\b(?:every|each)\s+(?:call|time|morning|evening)\b/i.test(text) &&
    PRIOR_ENCOURAGEMENT.test(prior);
  if (!namesIt && !pointsAtPrior) return null;
  return {
    kind: "encouragement_every_call",
    subjectKey: "encouragement",
    status: "active",
    text: "Include one grounded sentence of encouragement on every call.",
    quote: text,
    payload: null,
  };
}

const ACCOUNTABILITY_SUBJECT = /\byou(?:'re| are)?\s+(?:the one|supposed|meant|expected|my chief of staff)\b/i;
const ACCOUNTABILITY_OBJECT = /\b(?:calling me|call me|telling me|tell me|chief of staff|missions?|the plan|each day|every day|running me|leading)\b/i;
const NOT_DOING_JOB = /\b(?:you(?:'re| are)\s+not|you\s+never|you\s+don't|aren't\s+you)\b[^.?!]*\b(?:running me|leading|telling me what|doing your job|chief of staff|calling me)\b/i;

export function isRoleAccountability(text: string): boolean {
  return (
    isClaireRoleFeedback(text) ||
    (ACCOUNTABILITY_SUBJECT.test(text) && ACCOUNTABILITY_OBJECT.test(text)) ||
    NOT_DOING_JOB.test(text)
  );
}

function detectRoleFeedback(text: string): DetectedStandingInstruction | null {
  if (!isRoleAccountability(text)) return null;
  const payload: RoleFeedbackPayload = { obligation: "open_with_goal_and_plan" };
  return {
    kind: "role_feedback",
    subjectKey: "role_feedback:chief_of_staff",
    status: "active",
    text: "The operator said Claire is not doing her job as chief of staff. Obligation: open every call with the goal and the plan, then ask for what is missing. Do not wait to be asked.",
    quote: text,
    payload,
  };
}

function detectCallRule(text: string): DetectedStandingInstruction | null {
  const cadence = /\b(?:from now on|going forward|on every (?:morning |evening |week )?call|every (?:morning|evening|week) call|each call)\b/i.test(text);
  const directive = /\b(?:i want|i need|i'd like|please|make sure|you (?:should|need to|have to|must))\b/i.test(text);
  // "I want that on every call" with nothing for "that" to point at is not a rule anyone can follow.
  const bareReference = /\b(?:i want|i need|i'd like|do|give me|please do)\s+(?:that|this|it|those|these)\b/i.test(text);
  if (!cadence || !directive || bareReference || text.length > 400) return null;
  return {
    kind: "call_rule",
    subjectKey: `call_rule:${shortHash(text.toLowerCase().replace(/\s+/g, " ").trim())}`,
    status: "active",
    text: `Operator rule for calls, in the operator's words: ${text.trim()}`,
    quote: text,
    payload: null,
  };
}

/**
 * Narrow parser for operator-authored rules about how Claire behaves on calls. It never infers a rule
 * from behaviour. `priorClaireTurn` resolves "that"/"stuff like that" and nothing else.
 */
export function detectStandingInstructions(
  utterance: string,
  context: { priorClaireTurn?: string | null } = {}
): DetectedStandingInstruction[] {
  const text = utterance.trim();
  if (!text || isNonCommittal(text)) return [];
  const prior = context.priorClaireTurn ?? "";
  const found: DetectedStandingInstruction[] = [];
  const reviewWindow = detectReviewWindow(text, prior);
  if (reviewWindow) found.push(reviewWindow);
  const encouragement = detectEncouragement(text, prior);
  if (encouragement) found.push(encouragement);
  const role = detectRoleFeedback(text);
  if (role) found.push(role);
  if (!found.length) {
    const rule = detectCallRule(text);
    if (rule) found.push(rule);
  }
  return found;
}
