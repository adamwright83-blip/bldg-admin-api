import { randomUUID } from "node:crypto";
import {
  SPEECH_DELIVERY,
  type ClaireSpeechMetadata,
} from "../conversation/speechDelivery";

/**
 * Generated speech, queued speech, playback that has started, and speech
 * heard completely are different facts. Narrator disclosure accounting reads
 * heard confirmation off provider metadata. A full sentence that was
 * generated or even started is not a heard disclosure.
 */

export const CLAIRE_SPEECH_PHASES = [
  "generated",
  "queued",
  "playback_started",
  "heard_completely",
] as const;

export type ClaireSpeechPhase = (typeof CLAIRE_SPEECH_PHASES)[number];

export type ClaireSpeechAccountPhase = ClaireSpeechPhase | "interrupted";

export type ClaireSpeechAccount = {
  utteranceId: string;
  text: string;
  phase: ClaireSpeechAccountPhase;
  heardCompletely: boolean;
};

export function beginGeneratedSpeech(text: string, utteranceId = randomUUID()): ClaireSpeechAccount {
  return {
    utteranceId,
    text,
    phase: "generated",
    heardCompletely: false,
  };
}

export function markSpeechQueued(account: ClaireSpeechAccount): ClaireSpeechAccount {
  if (account.phase !== "generated") return account;
  return { ...account, phase: "queued", heardCompletely: false };
}

export function markPlaybackStarted(account: ClaireSpeechAccount): ClaireSpeechAccount {
  if (account.phase !== "queued") return account;
  return { ...account, phase: "playback_started", heardCompletely: false };
}

/** Explicit playback-complete evidence only. Interrupt, queue, and generation cannot reach this. */
export function markHeardCompletely(account: ClaireSpeechAccount): ClaireSpeechAccount {
  if (account.phase !== "playback_started") return account;
  return { ...account, phase: "heard_completely", heardCompletely: true };
}

/**
 * Operator barge-in stops playback. The sentence already generated does not
 * become heard completely.
 */
export function applyBargeIn(account: ClaireSpeechAccount): ClaireSpeechAccount {
  if (account.phase === "heard_completely") return account;
  return { ...account, phase: "interrupted", heardCompletely: false };
}

export function claireSpeechLedgerMetadata(
  account: ClaireSpeechAccount,
  narrative?: {
    narratorOccurrenceLedgerId: string;
    narratorBeatId: string;
    narrativePresentationId: string;
  }
): ClaireSpeechMetadata & {
  claireSpeechPhase: ClaireSpeechAccountPhase;
  narratorOccurrenceLedgerId?: string;
  narratorBeatId?: string;
  narrativePresentationId?: string;
} {
  const delivery: ClaireSpeechMetadata =
    account.phase === "heard_completely" && account.heardCompletely
      ? { speechDelivery: SPEECH_DELIVERY.CONFIRMED_HEARD, heardConfirmed: true }
      : account.phase === "interrupted"
        ? { speechDelivery: SPEECH_DELIVERY.CONFIRMED_NOT_HEARD, heardConfirmed: false }
        : { speechDelivery: SPEECH_DELIVERY.GENERATED_QUEUED, heardConfirmed: false };
  return {
    ...delivery,
    claireSpeechPhase: account.phase,
    ...(narrative ?? {}),
  };
}
