/**
 * V2 call-control interpretation.
 *
 * V1's departure grammar treats "I have to go" as leave-taking, and that match
 * swallows a following complement ("go home", "go pick up"). Explicit parting
 * and hangup language outrank both readings, and outrank any embedded business
 * fact. A debt or a price cannot cancel a goodbye, and it cannot turn movement
 * into leave-taking.
 */

import type { CallControlSignal } from "../contracts/perceivedTurn";

const EXPLICIT_GOODBYE =
  /\b(?:good\s*bye|goodbye|bye)\b|\b(?:talk|speak)\s+later\b|\bhang\s+up\b|\bend\s+(?:the\s+)?call\b/i;

/**
 * "go" plus a same-clause complement: destination, location, object, or work.
 * Punctuation ends a bare departure ("go.", "go,"). "bye" is not a complement.
 * "head out" and "get going" stay inside V1's departure lexeme and are not rewritten here.
 */
const GO_WITH_COMPLEMENT = /\bgo\s+(?!bye\b)[a-z0-9]/i;

export function reconcileCallControl(text: string, v1: CallControlSignal): CallControlSignal {
  if (EXPLICIT_GOODBYE.test(text)) return "end";
  if (v1 === "end" && GO_WITH_COMPLEMENT.test(text)) return "continue";
  return v1;
}
