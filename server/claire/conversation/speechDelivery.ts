/**
 * Generated Claire speech is not confirmed-heard speech.
 * Provider ASR fragments are not canonical operator turns.
 *
 * These facts live on existing `providerMetadataJson` — no new column.
 */

export const SPEECH_DELIVERY = {
  /** Text was generated and queued for TTS; playback completion is not yet evidenced. */
  GENERATED_QUEUED: "generated_queued",
  /** Legacy alias — same meaning as generated_queued / unknown-unconfirmed. */
  UNCONFIRMED: "unconfirmed",
  CONFIRMED_HEARD: "confirmed_heard",
  /** Negative evidence exists (e.g. barge-in cancelled playback before completion). */
  CONFIRMED_NOT_HEARD: "confirmed_not_heard",
} as const;

export type SpeechDelivery = (typeof SPEECH_DELIVERY)[keyof typeof SPEECH_DELIVERY];

export const OPERATOR_REPRESENTATION = {
  /** One human thought, after stitching provider fragments. Downstream reasoning/history/analysis use this. */
  CANONICAL_UTTERANCE: "canonical_operator_utterance",
  /** A raw Twilio SpeechResult piece. Evidence only — never the semantic turn. */
  PROVIDER_FRAGMENT: "provider_fragment",
} as const;

export type OperatorRepresentation = (typeof OPERATOR_REPRESENTATION)[keyof typeof OPERATOR_REPRESENTATION];

/**
 * `heardConfirmed: true` means we have positive evidence the operator heard this Claire line.
 * `heardConfirmed: false` means we do NOT have that evidence — not that we know they did not hear it.
 * Use `speechDelivery: confirmed_not_heard` when negative playback evidence exists.
 */
export type ClaireSpeechMetadata = {
  speechDelivery: SpeechDelivery;
  heardConfirmed: boolean;
};

export type OperatorTurnMetadata = {
  representation: OperatorRepresentation;
  authoritativeOperatorTurn: boolean;
  providerFragments?: string[];
};

export function claireQueuedSpeechMetadata(): ClaireSpeechMetadata {
  return { speechDelivery: SPEECH_DELIVERY.GENERATED_QUEUED, heardConfirmed: false };
}

export function canonicalOperatorMetadata(fragments: string[]): OperatorTurnMetadata {
  const providerFragments = fragments.map(fragment => fragment.trim()).filter(Boolean);
  return {
    representation: OPERATOR_REPRESENTATION.CANONICAL_UTTERANCE,
    authoritativeOperatorTurn: true,
    providerFragments: providerFragments.length ? providerFragments : undefined,
  };
}

export function isAuthoritativeOperatorTurn(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) return true; // legacy rows: operator text was the semantic turn
  if (metadata.representation === OPERATOR_REPRESENTATION.PROVIDER_FRAGMENT) return false;
  if (metadata.authoritativeOperatorTurn === false) return false;
  return true;
}

export function isConfirmedHeardClaireSpeech(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.heardConfirmed === true && metadata?.speechDelivery === SPEECH_DELIVERY.CONFIRMED_HEARD;
}

export function isKnownNotHeardClaireSpeech(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.speechDelivery === SPEECH_DELIVERY.CONFIRMED_NOT_HEARD;
}

export function claireSpeechDeliveryOf(metadata: Record<string, unknown> | null | undefined): SpeechDelivery {
  if (metadata?.speechDelivery === SPEECH_DELIVERY.CONFIRMED_HEARD) return SPEECH_DELIVERY.CONFIRMED_HEARD;
  if (metadata?.speechDelivery === SPEECH_DELIVERY.CONFIRMED_NOT_HEARD) return SPEECH_DELIVERY.CONFIRMED_NOT_HEARD;
  if (metadata?.speechDelivery === SPEECH_DELIVERY.UNCONFIRMED) return SPEECH_DELIVERY.UNCONFIRMED;
  return SPEECH_DELIVERY.GENERATED_QUEUED;
}

/** Human-readable delivery annotation for analysis/transcripts — never equates unconfirmed with not-heard. */
export function claireDeliveryTranscriptSuffix(metadata: Record<string, unknown> | null | undefined): string {
  if (isConfirmedHeardClaireSpeech(metadata)) {
    return " [confirmed-heard]";
  }
  if (isKnownNotHeardClaireSpeech(metadata)) {
    return " [confirmed-not-heard]";
  }
  const delivery = claireSpeechDeliveryOf(metadata);
  return ` [${delivery}; heard-unconfirmed]`;
}
