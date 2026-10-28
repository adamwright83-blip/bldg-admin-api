/**
 * Perception of turns where the operator wants Claire to LEAD.
 *
 * Three deterministic readings, all descriptive. None of them is authority:
 *
 *   leadRequest           "What do you have for me tomorrow? What do you want me
 *                         to do?" — the operator is asking for the next move, not
 *                         for a figure. Executive Function answers it with a plan.
 *
 *   dictatedClaireExample "Tomorrow you're gonna hit 3 locations in person…" —
 *                         the operator is showing Claire how she should speak to
 *                         them (second person, future, a work verb). It is NOT the
 *                         operator committing to their own work, so it may never
 *                         become a Day Line proposal or a "which three?" question.
 *
 *   claireRoleRemark      "You should already know them. I need to have that coded
 *                         in you." — feedback about Claire's responsibility. It is
 *                         not an intention the operator attested about their own
 *                         work, and it does not dispute any figure Claire stated.
 *
 *   disputesPriorClaim    whether an utterance actually doubts something Claire
 *                         said. A semantic "challenge_prior_claim" reading may open
 *                         the correctness lane only when this is also true; the
 *                         2026-10-20 call opened it on role feedback and answered
 *                         "I can't freshly verify that claim".
 *
 * Observed in the 2026-10-20 evening debrief (conversationKey
 * claire-call:3b15eb7a-f41a-4b2a-969d-403c0ab73d48).
 */

import { findIndependentFirstPersonWorkClause } from "../../turn/interpretTurn";

export type LeadHorizon = "today" | "tomorrow" | null;

export type LeadRequest = {
  horizon: LeadHorizon;
  /**
   * The operator asked to be relieved of the decision, not briefed: "I'm
   * overwhelmed, tell me what to do", "just pick one", "decide for me". The
   * plan then names ONE move, in one breath, with no second suggestion and no
   * question handed back. Observed on the 2026-10-27 evening call.
   */
  relief: boolean;
};

const RELIEF_STATE = new RegExp(
  [
    String.raw`\b(?:i'?m|i\s+am|i\s+feel|i'?m\s+feeling|feeling|been)\s+(?:like\s+)?(?:so\s+|really\s+|pretty\s+|totally\s+|completely\s+|kind\s+of\s+|kinda\s+|a\s+little\s+|very\s+)?(?:overwhelmed|drained|exhausted|fried|burnt\s+out|burned\s+out|wiped(?:\s+out)?|spent|tapped\s+out|running\s+on\s+empty|out\s+of\s+gas)\b`,
    String.raw`\bmentally\s+(?:drained|exhausted|fried|done|shot)\b`,
    String.raw`\b(?:it'?s|this\s+is|that'?s|everything\s+is)\s+(?:all\s+|just\s+)?too\s+much\b`,
    String.raw`\bcan'?t\s+(?:think|decide|focus)\s*(?:straight|right\s+now|tonight|anymore)?\b`,
    String.raw`\bdon'?t\s+have\s+it\s+in\s+me\b`,
  ].join("|"),
  "i"
);

const RELIEF_ASK = new RegExp(
  [
    String.raw`\b(?:just\s+)?(?:decide|pick|choose)\s+(?:one\s+)?for\s+me\b`,
    String.raw`\byou\s+(?:decide|pick|choose)\b`,
    String.raw`\bjust\s+(?:tell|give)\s+me\s+(?:the\s+)?one\s+thing\b`,
    String.raw`\b(?:just\s+)?(?:give|tell)\s+me\s+one\s+thing\b`,
    String.raw`\bjust\s+pick\s+(?:one|something)\b`,
    String.raw`\bwhat'?s\s+the\s+one\s+thing\b`,
  ].join("|"),
  "i"
);

/** True when the operator is asking Claire to carry the decision, not to brief them. */
export function reliefRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return RELIEF_STATE.test(trimmed) || RELIEF_ASK.test(trimmed);
}

const LEAD_REQUEST = new RegExp(
  [
    String.raw`\bwhat\s+(?:do\s+you\s+have|have\s+you\s+got|you\s+got)\s+for\s+me\b`,
    String.raw`\bwhat\s+do\s+you\s+(?:want|need)\s+me\s+to\s+(?:do|focus\s+on|hit|work\s+on)\b`,
    String.raw`\bwhat\s+should\s+i\s+(?:do|focus\s+on|work\s+on|hit)\b`,
    String.raw`\bwhat\s+(?:do\s+i\s+do|am\s+i\s+doing)\s+(?:tomorrow|today|next|first)\b`,
    String.raw`\bwhat(?:'s|\s+is)\s+(?:the\s+plan|next|my\s+(?:first|next)\s+move|the\s+(?:first|next)\s+move)\b`,
    String.raw`\bwhere\s+(?:do|should)\s+(?:i|we)\s+start\b`,
    String.raw`\btell\s+me\s+what\s+to\s+do\b`,
    String.raw`\b(?:run|lead)\s+me\b`,
    String.raw`\bgive\s+me\s+(?:the\s+plan|my\s+(?:day|marching\s+orders)|tomorrow)\b`,
  ].join("|"),
  "i"
);

/** A question that is scoped to a named person or account is not a lead request. */
const SCOPED_ABOUT = /\b(?:about|with|regarding|concerning)\s+(?!today|tomorrow|tonight|yesterday|now|this\s+week\b)/i;

export function leadRequest(text: string): LeadRequest | null {
  const trimmed = text.trim();
  if (!trimmed || SCOPED_ABOUT.test(trimmed)) return null;
  const relief = reliefRequest(trimmed);
  // "I'm overwhelmed" with no question in it is still a request to be led:
  // the operator has run out of decisions, and the answer is one move.
  if (!LEAD_REQUEST.test(trimmed) && !relief) return null;
  return { horizon: leadHorizon(trimmed), relief };
}

export function leadHorizon(text: string): LeadHorizon {
  if (/\btomorrow\b/i.test(text)) return "tomorrow";
  if (/\btoday\b|\btonight\b|\bright\s+now\b|\bnext\b|\bfirst\b/i.test(text)) return "today";
  return null;
}

/**
 * Second-person, future-tense work aimed at the operator ("you're gonna hit 3
 * locations") with no independent first-person commitment anywhere in the turn.
 * This is the operator dictating Claire's lines, not reporting their own plan.
 */
const SECOND_PERSON_FUTURE_WORK =
  /\byou(?:'re|\s+are)\s+(?:gonna|going\s+to)\s+(?:hit|visit|go|open|call|pitch|knock|walk|drive|head|stop|swing|complete|finish|do|work|start)\b|\byou(?:'ll|\s+will)\s+(?:hit|visit|go|open|call|pitch|knock|walk|drive|head|complete|finish)\b/i;

const SPEECH_EXAMPLE_LEAD_IN =
  /\b(?:say\s+(?:something\s+)?like|you\s+should\s+(?:say|tell\s+me)|tell\s+me\s+(?:something\s+)?like|like\s+this|for\s+example|something\s+like)\b/i;

export function dictatedClaireExample(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (SPEECH_EXAMPLE_LEAD_IN.test(trimmed) && SECOND_PERSON_FUTURE_WORK.test(trimmed)) return true;
  if (!SECOND_PERSON_FUTURE_WORK.test(trimmed)) return false;
  // "Tomorrow you're gonna hit three buildings, and I'm going to call Dana" keeps
  // the operator's own commitment; only a turn with no first-person work is an example.
  return findIndependentFirstPersonWorkClause(trimmed) === null;
}

const CLAIRE_ROLE_REMARK = new RegExp(
  [
    String.raw`\b(?:coded|built|programmed|baked|trained|wired|hard[-\s]?coded)\s+(?:in|into)\s+you\b`,
    String.raw`\byou\s+should\s+(?:already\s+)?(?:know|have|be\s+(?:telling|running|leading))\b`,
    String.raw`\bthat'?s\s+(?:your|the)\s+job\b`,
    String.raw`\byou(?:'re|\s+are)\s+(?:supposed|meant)\s+to\b`,
    String.raw`\b(?:never|not)\s+(?:running|leading)\s+me\b`,
    String.raw`\byou\s+need\s+to\s+(?:run|lead|drive)\s+me\b`,
    String.raw`\bi\s+(?:need|want)\s+you\s+to\s+(?:run|lead|drive)\s+(?:me|this)\b`,
  ].join("|"),
  "i"
);

export function claireRoleRemark(text: string): boolean {
  return CLAIRE_ROLE_REMARK.test(text.trim());
}

/** The second-person complement of "I need to …" is about Claire, not the operator's own work. */
export function intentionIsAboutClaire(label: string | null): boolean {
  if (!label) return false;
  return /\b(?:in|into|to|for|from)\s+you\b|\byour\s+(?:job|role|responsibility|side)\b|\byou\s+(?:to\s+)?(?:know|remember|learn)\b/i.test(label);
}

const DISPUTE = new RegExp(
  [
    String.raw`\bare\s+you\s+(?:sure|certain|positive)\b`,
    String.raw`\byou\s+sure\b`,
    String.raw`\b(?:that'?s|that\s+is|those\s+are|this\s+is|it'?s|it\s+is|they'?re|the\s+(?:number|figure|total)s?\s+(?:is|are))\s+(?:wrong|incorrect|off|not\s+(?:right|correct|accurate|true))\b`,
    String.raw`\bi\s+don'?t\s+(?:think|believe)\s+(?:that'?s|that\s+is|so|it'?s|it\s+is|those)\b`,
    String.raw`\b(?:double[-\s]?check|check\s+(?:that|it|those|this|again)|verify\s+(?:that|it|those))\b`,
    String.raw`\bdoesn'?t\s+(?:sound|seem|look|add\s+up)\b`,
    String.raw`\bthat\s+can'?t\s+be\s+right\b`,
    String.raw`\bwhere\s+(?:did|do)\s+you\s+get\s+that\b`,
    String.raw`\bi\s+(?:meant|said)\b[\s\S]{0,40}\b(?:number|figure|amount|total|revenue|sales)\b`,
    String.raw`\b(?:wrong|incorrect|mistaken)\b`,
    String.raw`\breally\?`,
  ].join("|"),
  "i"
);

export function disputesPriorClaim(text: string): boolean {
  return DISPUTE.test(text.trim());
}
