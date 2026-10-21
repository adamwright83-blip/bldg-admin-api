/**
 * Promise guard — the sibling of assertionGuard.ts for sentences about the FUTURE.
 *
 * assertionGuard blocks unverified "I sent / queued / scheduled". This blocks the same lie told
 * forward: "I'll have X ready", "tomorrow I'll …", "I'll keep that in mind". A promise Claire speaks must
 * be kept by the system (a prepared item the next call reads, or a saved standing instruction), or it is
 * never spoken. Default is strip.
 *
 * Deterministic renderers that say a promise because a row exists (the readback of a saved rule, the
 * property-visit preparation) do not go through this lint; they are the "kept by the system" case.
 */

export type PromiseSentence = { text: string; index: number };

const COMMIT = /\bI(?:'ll|\s+will|'m going to|\s+am going to|'m gonna)\b/i;
const CROSS_CALL =
  /\b(?:tomorrow|tonight|this (?:evening|afternoon|week)|in the (?:morning|evening)|first thing|next (?:call|time|week|morning|session)|later (?:today|this week|on)?|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|by (?:\d|noon|tonight|tomorrow|end of day|morning)|when we (?:next )?(?:talk|speak|connect)|from now on|going forward|every call|each call|until then|until (?:then|sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/i;

const STANDALONE: RegExp[] = [
  /\bI(?:'ll|\s+will)\s+keep\b[^.?!]*\bin\s+(?:mind|front of you|view)\b/i,
  /\bI(?:'ll|\s+will)\s+(?:remember|make a note|note that|write that down|hold (?:it|that|this|them) until|save (?:it|that|this) for)\b/i,
  /\bI(?:'ll|\s+will)\s+have\b[^.?!]*\b(?:ready|prepared|waiting|in front of you|lined up|teed up)\b/i,
  /\bI(?:'ll|\s+will)\s+make sure\b/i,
  /\bI(?:'ll|\s+will)\s+(?:bring|raise|ask)\b[^.?!]*\b(?:then|next time|later)\b/i,
];

/** Splits on sentence terminators, keeping them with their sentence. */
export function splitSentences(text: string): string[] {
  // A terminator ends a sentence only before whitespace or the end, so "$2,314.42" and "5:30" stay whole.
  const parts = text.match(/[\s\S]+?(?:[.!?]+["')\]]*(?=\s|$)|$)/g) ?? [];
  return parts.map(part => part.trim()).filter(Boolean);
}

export function isPromiseSentence(sentence: string): boolean {
  if (STANDALONE.some(pattern => pattern.test(sentence))) return true;
  return COMMIT.test(sentence) && CROSS_CALL.test(sentence);
}

export function findPromiseSentences(text: string): PromiseSentence[] {
  return splitSentences(text)
    .map((sentence, index) => ({ text: sentence, index }))
    .filter(item => isPromiseSentence(item.text));
}

/** A promise the system really keeps. `matches` decides which spoken sentence this backing covers. */
export type PromiseBacking = { id: string; matches: RegExp };

export type PromiseGuardResult = {
  pass: boolean;
  text: string;
  removed: string[];
  kept: string[];
  /** Everything was a promise: the caller must supply its own safe line. */
  emptied: boolean;
};

export function lintAndStripUnbackedPromises(
  text: string,
  options: { backed?: readonly PromiseBacking[] } = {}
): PromiseGuardResult {
  const backed = options.backed ?? [];
  const sentences = splitSentences(text);
  const removed: string[] = [];
  const kept: string[] = [];
  const out: string[] = [];
  for (const sentence of sentences) {
    if (!isPromiseSentence(sentence)) {
      out.push(sentence);
      continue;
    }
    const backing = backed.find(item => item.matches.test(sentence));
    if (backing) {
      kept.push(sentence);
      out.push(sentence);
    } else {
      removed.push(sentence);
    }
  }
  // Untouched text is returned byte for byte; rejoining sentences must never reformat a clean answer.
  const stripped = removed.length ? out.join(" ").trim() : text;
  if (removed.length) {
    console.warn("[Claire] promise guard removed unbacked promise", { count: removed.length });
  }
  return { pass: removed.length === 0, text: stripped, removed, kept, emptied: sentences.length > 0 && !stripped.trim() };
}
