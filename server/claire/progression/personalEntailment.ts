import { CLAIRE_CANON } from "../character/characterDefinition";

/**
 * Fail-closed claim validation for personal answers. Absolute law: the model may create LANGUAGE,
 * never Claire HISTORY. Every biographical proposition in an answer must be supported by the exact
 * authorized fragment (or facts the operator was already told). Style, hesitation, dryness,
 * refusal and attitude are free; new people, events, emotions, causes, chronology, frequency and
 * character judgments are not.
 *
 * Two layers, both of which must pass:
 *  1. Deterministic lexicon check (this file): rejects any biographical-content word the authorized
 *     facts do not themselves contain, and ANY single distinctive word borrowed from another canon
 *     fragment. Conservative by design: uncertainty rejects.
 *  2. An optional model verifier (see `EntailmentVerifier`), which can only ever REJECT more, never
 *     expand permission.
 */

/** Word stems in the domains where an unsupported claim is a new piece of Claire history. */
const CLAIM_LEXICON: Record<string, readonly string[]> = {
  family: ["mother", "father", " dad", " mom", "parent", "brother", "sister", "sibling", "family", "husband", "wife", "daughter", "grandm", "grandf", "uncle", "aunt", "cousin", "partner", "boyfriend", "girlfriend", "fiance", "widow", "orphan", "stepf", "stepm", "relative"],
  emotion: ["resent", "hate", "hated", "loved", "adore", "miss", "angry", "anger", "furious", "ashamed", "shame", "afraid", "scared", "terrif", "fear", "lonely", "proud", "guilt", "regret", "grief", "griev", "mourn", "cried", "trust", "betray", "hurt", "forgiv", "bitter", "jealous", "envy", "despis", "devast", "heartbr", "worship", "idoli", "admir", "disappoint"],
  personality: ["cold", "cruel", "distant", "strict", "gentle", "absent", "charming", "brilliant", "violent", "drunk", "secretive", "loving", "selfish", "generous", "stern", "charisma", "hard man", "good man", "bad man"],
  chronology: ["later", "earlier", "before", "after", "until", "eventually", "years", "decade", "childhood", "young", "teenag", "student", "ago", "during", "summer", "winter", "birthday", "eventual", "finally", "suddenly", "overnight", "afterw"],
  causality: ["because", "therefore", "reason", "caused", "blame", "which is why", "that's why", "thats why", "consequence", "as a result", "led to", "driven", "explains why"],
  // "never/always/often" are deliberately left to the model verifier: they are also ordinary refusal idiom.
  frequency: ["rarely", "seldom", "constantly", "hardly", "every day", "every night", "weekends", "regularly"],
  events: ["disappear", "vanish", "died", "death", "dead", "killed", "murder", "leave ", " left ", "gone", "missing", "divorc", "married", "fired", "arrest", "defect", "kidnap", "escap", "burned", "fled", "abandon", "exile", "smuggl", "recruit", "spy", "agent", "betrayed", "funeral", "hospital", "accident", "illness", "cancer", "prison", "jail", "war "],
};

const STOP_DISTINCTIVE = new Set([
  "claire", "career", "which", "while", "would", "their", "there", "about", "because", "through", "academic",
]);

function stemsOf(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z']{4,}/g) ?? []).map(word => word.slice(0, 6)));
}

export type EntailmentFailure =
  | { ok: false; reason: "unsupported_claim"; category: string; term: string }
  | { ok: false; reason: "borrowed_from_other_canon"; term: string; fragmentId: string };
export type EntailmentResult = { ok: true } | EntailmentFailure;

/**
 * `allowedFacts`: the authorized fragment plus any facts already disclosed to this operator that the
 * caller explicitly supplies for this turn. Everything else is unauthorized history.
 */
export function checkClaimEntailment(text: string, allowedFacts: readonly string[]): EntailmentResult {
  const padded = ` ${text.toLowerCase().replace(/[^a-z' ]+/g, " ")} `;
  const allowedText = ` ${allowedFacts.join(" ").toLowerCase().replace(/[^a-z' ]+/g, " ")} `;

  for (const [category, terms] of Object.entries(CLAIM_LEXICON)) {
    for (const term of terms) {
      const needle = term.startsWith(" ") || term.endsWith(" ") ? term : ` ${term}`;
      const inText = term.startsWith(" ") || term.endsWith(" ") ? padded.includes(needle) : padded.includes(needle);
      if (!inText) continue;
      const inAllowed = term.startsWith(" ") || term.endsWith(" ") ? allowedText.includes(needle) : allowedText.includes(needle);
      if (!inAllowed) return { ok: false, reason: "unsupported_claim", category, term: term.trim() };
    }
  }

  // ANY single distinctive word that belongs to a non-authorized canon fragment is a leak.
  const allowedStems = stemsOf(allowedFacts.join(" "));
  // Single-word leaks use distinctive (>= 8 letters) words; shorter claim words live in the lexicon above.
  const textWords = padded.match(/[a-z']{8,}/g) ?? [];
  for (const other of CLAIRE_CANON) {
    if (!other.fact || other.accessClass === "core") continue;
    if (allowedFacts.includes(other.fact)) continue;
    const otherStems = new Map<string, string>();
    for (const word of other.fact.toLowerCase().match(/[a-z']{8,}/g) ?? []) {
      if (!STOP_DISTINCTIVE.has(word)) otherStems.set(word.slice(0, 6), word);
    }
    for (const word of textWords) {
      const stem = word.slice(0, 6);
      if (otherStems.has(stem) && !allowedStems.has(stem)) {
        return { ok: false, reason: "borrowed_from_other_canon", term: word, fragmentId: other.id };
      }
    }
  }
  return { ok: true };
}

/**
 * Model verifier. It receives the authorized facts and the candidate answer and must return true only
 * for a confident "no unsupported claim". Any error, timeout, ambiguity or false means REJECT.
 */
export type EntailmentVerifier = (input: { allowedFacts: readonly string[]; answer: string }) => Promise<boolean>;

export const ENTAILMENT_VERIFIER_INSTRUCTION =
  "You are a strict claim checker. AUTHORIZED FACTS are the only biography that exists. Reply with exactly ENTAILED only if the ANSWER asserts nothing about a person's life, history, feelings, motives, causes, timing, frequency, relationships or character beyond the authorized facts. Tone, hesitation, dryness, refusal, and declining to say more are fine. Reply UNSUPPORTED if there is any doubt. Reply with one word.";

export function parseVerifierReply(reply: string): boolean {
  return reply.trim().toUpperCase().replace(/[^A-Z]/g, "") === "ENTAILED";
}

/**
 * Defense in depth for the GENERAL (non-personal) answer path: first-person biography can never be
 * asserted outside the personal controller. Returns the offending sentence, or null if clean.
 */
const FIRST_PERSON_BIOGRAPHY: RegExp[] = [
  /\bI (?:grew up|was raised|was born|lived (?:in|with|there)|moved (?:to|from|around)|studied|trained|used to (?:live|work|be)|worked (?:at|for|in|as) )/i,
  /\bI (?:have|had) (?:a|an|two|three|four|one|no) (?:brother|sister|sibling|kid|child|son|daughter|dog|cat|pet|husband|wife|boyfriend|girlfriend)/i,
  /\bmy (?:father|dad|mother|mom|parents?|brother|sister|sibling|family|childhood|ex\b|husband|wife|boyfriend|girlfriend|hometown|upbringing|old school|university)\b/i,
  /\bwhen I was (?:a kid|young|little|\d+|growing|in school|younger)\b/i,
  /\bI(?:'m| am) (?:from|originally from|married|divorced|single|an orphan)\b/i,
];

export function findUnauthorizedFirstPersonBiography(text: string, allowedFacts: readonly string[]): string | null {
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (!FIRST_PERSON_BIOGRAPHY.some(pattern => pattern.test(sentence))) continue;
    // A sentence restating an allowed core fact is fine ("I'm British.").
    const claim = checkClaimEntailment(sentence, allowedFacts);
    const sentenceStems = stemsOf(sentence);
    const supported = allowedFacts.some(fact => {
      const factStems = stemsOf(fact);
      let overlap = 0;
      for (const stem of sentenceStems) if (factStems.has(stem)) overlap += 1;
      return overlap >= Math.max(2, Math.ceil(sentenceStems.size * 0.5));
    });
    if (!supported || !claim.ok) return sentence;
  }
  return null;
}
