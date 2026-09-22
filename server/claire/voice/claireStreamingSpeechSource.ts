import type { ClaireVoiceSession } from "./claireVoiceSession";

export type ClaireSpeechChunk = {
  text: string;
  last: boolean;
};

export type ClaireSpeechGenerationInput = ClaireVoiceSession & {
  /** Operator speech. Untrusted transport text. Not a business decision. */
  utterance: string;
};

/**
 * Speech text source for a voice transport.
 * Current Claire may return one chunk containing the full string.
 * This interface does not call a model and does not claim token streaming.
 */
export interface ClaireStreamingSpeechSource {
  generate(input: ClaireSpeechGenerationInput): AsyncIterable<ClaireSpeechChunk>;
}

/** One chunk, the whole string, then stop. No model call. */
export function singleChunkSpeechSource(
  speak: (input: ClaireSpeechGenerationInput) => Promise<string>
): ClaireStreamingSpeechSource {
  return {
    async *generate(input) {
      const text = await speak(input);
      yield { text, last: true };
    },
  };
}

export async function* chunksFromFullText(text: string): AsyncIterable<ClaireSpeechChunk> {
  yield { text, last: true };
}
