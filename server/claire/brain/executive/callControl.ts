/**
 * V2 call-control interpretation.
 *
 * V1's departure grammar treats "I have to go" as leave-taking, and that match
 * swallows a following complement ("go home", "go pick up"). Explicit parting
 * and hangup language outrank both readings, and outrank any embedded business
 * fact. A debt or a price cannot cancel a goodbye, and it cannot turn movement
 * into leave-taking. A temporal modifier ("go now", "go for now") is still
 * leave-taking.
 */

import type { CallControlSignal } from "../contracts/perceivedTurn";

const EXPLICIT_GOODBYE =
  /\b(?:good\s*bye|goodbye|bye)\b|\b(?:talk|speak)\s+later\b|\bhang\s+up\b|\bend\s+(?:the\s+)?call\b/i;

/**
 * Temporal words that modify the departure itself ("go now", "go soon", "go for now").
 * Anything else left in the same clause is a destination or a work complement.
 */
const TEMPORAL_LEAVE_TAKING = /^(?:for\s+now|right\s+now|now|soon|already|then|later)\b\s*/i;

/** The words after "go" and before a comma or sentence boundary. */
function sameClauseAfterGo(text: string): string {
  const match = /\bgo\b([\s\S]*)$/i.exec(text);
  if (!match?.[1]) return "";
  const clause = match[1].split(/[,;]|[.!?](?:\s|$)/)[0] ?? "";
  return clause.replace(/[.!?]+$/g, "").trim();
}

/**
 * True when "go" is followed by a destination or work complement in the same clause.
 * "head out" and "get going" stay inside V1's departure lexeme and are not rewritten here.
 */
function goHasDestinationOrWork(text: string): boolean {
  let rest = sameClauseAfterGo(text);
  while (rest) {
    const temporal = TEMPORAL_LEAVE_TAKING.exec(rest);
    if (!temporal) break;
    rest = rest.slice(temporal[0].length).trim();
  }
  return /[a-z0-9]/i.test(rest);
}

export function reconcileCallControl(text: string, v1: CallControlSignal): CallControlSignal {
  if (EXPLICIT_GOODBYE.test(text)) return "end";
  if (v1 === "end" && goHasDestinationOrWork(text)) return "continue";
  return v1;
}
