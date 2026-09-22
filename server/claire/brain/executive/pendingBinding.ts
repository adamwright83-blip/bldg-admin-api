/**
 * When a held pending item may bind this utterance, and when the operator has
 * come back to one that was set aside.
 *
 * Binding is a property of the utterance's shape, not of the pending object.
 * The pending object does not get to decide what new speech means.
 */

import type { ChangeClass } from "../contracts/control";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { PendingProposalSnapshot, WorkingMemorySnapshot } from "../contracts/workingMemory";

const RETURN_CUE =
  /\b(?:what\s+about|back\s+to|go\s+back(?:\s+to)?|earlier|that\s+(?:stop|item|one|order)|the\s+pending)\b/i;

const GENERIC = new Set([
  "what",
  "about",
  "the",
  "that",
  "this",
  "stop",
  "item",
  "one",
  "order",
  "pending",
  "earlier",
  "back",
  "with",
  "from",
  "your",
  "still",
  "and",
  "for",
  "you",
]);

/**
 * An explicit refusal still binds when attention repair is in the same turn.
 * A refusal that abandons into a new task ("Forget that. What were my sales?")
 * does not: that task switch supersedes instead of rejecting.
 */
export function explicitRefusalStands(perceived: PerceivedTurn, change: ChangeClass): boolean {
  if (!perceived.refusal) return false;
  if (perceived.attentionRepair !== "none") return true;
  return change !== "task_switch" && change !== "set_shift" && change !== "query_requery";
}

/** A whole-utterance no. "No. Listen…" and "No, Wednesday" are not this. */
export function isBareRefusal(text: string): boolean {
  const trimmed = text.trim().toLowerCase().replace(/[.!?]+$/g, "");
  return /^(?:no|nope|nah)$/.test(trimmed);
}

export function heldPending(memory: WorkingMemorySnapshot): PendingProposalSnapshot | null {
  return memory.pendingProposal ?? memory.pendingBriefing ?? memory.pendingAccountFollowUp;
}

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(word => word.length >= 3 && !GENERIC.has(word));
}

/**
 * The operator named the dormant item, or pointed at the one held item.
 * This re-opens context. It does not confirm, reject, or rewrite it.
 */
export function explicitPendingReturn(perceived: PerceivedTurn, memory: WorkingMemorySnapshot): boolean {
  const pending = heldPending(memory);
  if (!pending) return false;
  if (!RETURN_CUE.test(perceived.assembledText)) return false;
  const hints = contentWords(pending.hints.join(" "));
  const said = contentWords(perceived.assembledText);
  if (hints.some(word => said.includes(word))) return true;
  return /\b(?:that|the|this)\s+(?:stop|item|one|order)\b/i.test(perceived.assembledText);
}
