/**
 * Authoring an action proposal's MEANING.
 *
 * "I need to call Dana Tuesday" is a commitment the operator stated. Executive Function
 * decides whether that earns proposal authority and what, exactly, is being proposed.
 * The renderer may phrase the question; it may not decide to ask it, and it may not
 * decide what the work is.
 *
 * The title is derived from the operator's own words — it never invents a task, a
 * subject, or a date that was not said.
 */

import type { PerceivedTurn } from "../contracts/perceivedTurn";

/** Lead-ins that express intent rather than being part of the work itself. */
const COMMITMENT_LEAD_IN =
  /^(?:and\s+)?(?:i\s+(?:need|have|want|ought|got)\s+to|i\s+(?:should|must|gotta|will|ll)|i'?m\s+going\s+to|i'?ll|remind\s+me\s+to|don'?t\s+let\s+me\s+forget\s+to|make\s+sure\s+i)\s+/i;

const REQUEST_LEAD_IN =
  /^(?:can\s+you|could\s+you|would\s+you|please|put|add|schedule|set\s+up|book)\s+(?:a\s+|an\s+|the\s+)?(?:reminder\s+to\s+|note\s+to\s+)?/i;

function tidy(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;]+$/, "")
    .replace(/^(?:to|that)\s+/i, "");
}

function sentenceCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The work the operator described, in their words.
 *
 * Returns null when nothing recognisable is left after removing the lead-in — an
 * unnamed proposal is worse than none, because the operator cannot confirm what they
 * would be agreeing to.
 */
export function proposedWorkTitle(perceived: PerceivedTurn): string | null {
  const text = perceived.assembledText.trim();
  if (!text) return null;

  // Take the clause that carries the commitment, not the whole utterance.
  const clauses = text.split(/,(?=\s)|\s+(?:but|and then|then)\s+/i);
  const candidate =
    clauses.find(clause => COMMITMENT_LEAD_IN.test(clause.trim()) || REQUEST_LEAD_IN.test(clause.trim())) ?? text;

  let core = candidate.trim();
  core = core.replace(COMMITMENT_LEAD_IN, "").replace(REQUEST_LEAD_IN, "");
  core = tidy(core);

  // Nothing survived beyond the lead-in, or it is too thin to confirm against.
  if (core.length < 3) return null;
  if (core.toLowerCase() === perceived.assembledText.trim().toLowerCase() && !/\s/.test(core)) return null;
  return sentenceCase(core);
}

/** What Claire is actually asking the operator to approve. */
export function proposalText(title: string | null): string {
  if (!title) return "Want me to put that on your Day Line?";
  return `Want me to put "${title}" on your Day Line?`;
}
