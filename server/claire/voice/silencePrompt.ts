/**
 * When Claire may prompt into silence.
 *
 * Production call 2026-10-15 17:30 PT (session 958159a5) has Claire speaking twice in a row
 * twice: her reply ("Done. 7 on today's line.") was followed 3-10 seconds later by "Go ahead,
 * I'm listening." while the operator was still taking in the reply. The Gather timeout fires
 * an empty webhook as soon as the line is quiet, and the handler answered every empty webhook
 * with a prompt, whatever Claire had just said.
 *
 * Rules, all pure so they can be tested with the real timings:
 *   1. The window starts when Claire FINISHES speaking. We do not receive a playback-complete
 *      event on the Gather path, so the end of speech is estimated from the words she said.
 *   2. Never prompt within QUIET_AFTER_SPEECH_MS of that estimated end.
 *   3. Never prompt twice without the operator saying something in between.
 * Inside the window Claire keeps listening silently; she does not speak.
 */

export const QUIET_AFTER_SPEECH_MS = 8_000;
const MS_PER_WORD = 400;
const MIN_SPEECH_MS = 1_500;

export function estimateClaireSpeechMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(MIN_SPEECH_MS, words * MS_PER_WORD);
}

export type SilencePromptDecision = "prompt" | "listen_quietly";

export function silencePromptDecision(input: {
  nowMs: number;
  /** Claire's most recent spoken turn and when it was generated. Null when she has not spoken. */
  lastClaire: { text: string; at: number } | null;
  /** A silence prompt has already been spoken and the operator has not spoken since. */
  promptedSinceOperator: boolean;
}): SilencePromptDecision {
  if (input.promptedSinceOperator) return "listen_quietly";
  if (!input.lastClaire) return "prompt";
  const speechEndsAt = input.lastClaire.at + estimateClaireSpeechMs(input.lastClaire.text);
  return input.nowMs - speechEndsAt >= QUIET_AFTER_SPEECH_MS ? "prompt" : "listen_quietly";
}
