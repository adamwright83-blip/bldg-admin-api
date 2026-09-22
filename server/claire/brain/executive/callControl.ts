/**
 * V2 call-control interpretation.
 *
 * V1's departure grammar treats "I have to go" as leave-taking, including movement
 * toward a place. Explicit parting and hangup language outrank that reading, and
 * outrank any embedded business fact. A debt or a price cannot cancel a goodbye.
 */

import type { CallControlSignal } from "../contracts/perceivedTurn";

const EXPLICIT_GOODBYE =
  /\b(?:good\s*bye|goodbye|bye)\b|\b(?:talk|speak)\s+later\b|\bhang\s+up\b|\bend\s+(?:the\s+)?call\b/i;

/** Movement toward a destination or task, not departure from the conversation. */
const DESTINATION_MOVEMENT = /\b(?:go|head)\s+(?:there|back|over|to)\b/i;

export function reconcileCallControl(text: string, v1: CallControlSignal): CallControlSignal {
  if (EXPLICIT_GOODBYE.test(text)) return "end";
  if (v1 === "end" && DESTINATION_MOVEMENT.test(text)) return "continue";
  return v1;
}
