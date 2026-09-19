import { looksLikeCancelRequest, looksLikeEditRequest } from "../../../shared/goldlineDayLine";
import { explicitDayLineRefusal, explicitTrackingRequest } from "../briefing/titleContract";

/**
 * Deterministic dialogue-act routing. No model hop.
 * Accept/reject while holding is decided by `replyDecision` in claireTurn, then mapped here.
 * Ambiguous speech falls through to the existing briefing / commitment / follow-up pipeline.
 */

export type DialogueAct =
  | { kind: "accept"; remainder: string }
  | { kind: "reject"; remainder: string }
  | { kind: "question" }
  | { kind: "explicit_track" }
  | { kind: "explicit_edit" }
  | { kind: "confide" }
  | { kind: "continue" };

const DIRECT_QUESTION =
  /^(?:and |so |okay |ok |well |then )?(?:what|what's|whats|who|who's|which|when|where|why|how|do you|does|did|is|are|can you|could you|would you|will you|should|tell me|remind me)\b|\?\s*$/i;

const CONFIDE =
  /\b(?:i(?:'m| am) (?:stressed|worried|confiding|tired|smiling)|i was hoping you would|confiding with you|i don'?t know what to do|i don'?t have any plans|just catching you up|i just have to say)\b/i;

const STRONG_WORK =
  /\b(?:pick ?up|drop off|deliver|deposit|visit|drive to|make \d|create (?:a |an )?(?:static |instagram )?ad|assignment|return)\b/i;

export function hasDirectQuestion(utterance: string): boolean {
  const text = utterance.trim();
  if (/\?\s*$/.test(text)) return true;
  const last = text.split(/(?<=[.!?])\s+/).filter(Boolean).pop() ?? text;
  return DIRECT_QUESTION.test(last.trim());
}

export function isObviousConfide(utterance: string): boolean {
  if (explicitTrackingRequest(utterance) || explicitDayLineRefusal(utterance)) return false;
  return CONFIDE.test(utterance) && !explicitTrackingRequest(utterance);
}

export function classifyOpenDialogueAct(utterance: string): Exclude<DialogueAct, { kind: "accept" } | { kind: "reject" }> {
  const text = utterance.trim();
  if (!text) return { kind: "continue" };
  if (explicitDayLineRefusal(text)) return { kind: "continue" }; // caller maps refusal onto reject when holding or as a no-op add
  if (looksLikeCancelRequest(text) || looksLikeEditRequest(text)) return { kind: "explicit_edit" };
  if (explicitTrackingRequest(text)) return { kind: "explicit_track" };
  if (hasDirectQuestion(text) && !explicitTrackingRequest(text) && !STRONG_WORK.test(text)) {
    return { kind: "question" };
  }
  if (isObviousConfide(text) && !STRONG_WORK.test(text)) return { kind: "confide" };
  return { kind: "continue" };
}
