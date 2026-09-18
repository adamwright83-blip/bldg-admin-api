/**
 * PR1 Claire Intelligence Repair -- corrective pass (real-exam finding,
 * hard correctness fix per Adam's explicit instruction).
 *
 * The real exam asked "Where are you from, Claire?" Eligible canon at
 * Tier 0 only supports "Claire is British" and "Claire had an
 * internationally mobile childhood" -- no city is in canon anywhere. The
 * model answered "London, originally." -- an invented specific fact, not a
 * compression of real canon. The entire tiered-disclosure architecture
 * exists specifically to prevent exactly this: an unsupported personal
 * claim reaching the operator as if it were true.
 *
 * This guard is deliberately GENERAL, not a denylist for the word
 * "London" or a single fact: it flags ANY proper-noun-shaped specific
 * (a place, a person's name, an organization) that appears in a
 * Claire-personal answer but does not appear, verbatim or as a clear
 * substring, in the eligible canon actually supplied for this turn. It
 * does not attempt to catch invented specific numbers or dates textually
 * (a much harder NLP problem); those remain covered by the existing
 * "never invent biography beyond what is listed above" prompt instruction
 * and can be added here later if a real example surfaces one.
 *
 * This mirrors the fail-closed pattern of assertPostGenerationStateVerbs:
 * on a violation, it throws, and the caller's existing try/catch routes to
 * the deterministic conservative fallback -- exactly like the assertion
 * guard and G2/CEO lints already do.
 */

/**
 * Proper nouns Claire is expected to use freely: her own name and the
 * product name. These are never personal-biography claims.
 */
const ALWAYS_ALLOWED = new Set(["Claire", "Goldline"]);

/**
 * Common English words that are routinely capitalized at the start of a
 * sentence. Without this, any ordinary sentence-initial verb or adverb
 * ("Moved around a lot as a kid...", "Fine, then.") looks exactly like a
 * proper noun to a capitalization-based detector and trips the guard --
 * a false positive that costs a perfectly good, canon-grounded answer.
 *
 * Matching is done on the lowercased word with common inflectional
 * suffixes stripped, so one entry covers "move/moved/moves/moving".
 * Deliberately a common-word list, NOT a place/name denylist: the guard
 * stays general (anything not recognizably a common word and not in canon
 * is treated as an unsupported specific), which is what makes it catch an
 * invented city or surname it has never seen.
 */
const COMMON_WORD_STEMS = new Set([
  // pronouns / determiners / conjunctions / prepositions
  "i", "im", "ill", "ive", "id", "you", "your", "yours", "he", "she", "they",
  "them", "their", "we", "our", "us", "it", "its", "this", "that", "these",
  "those", "the", "a", "an", "and", "but", "or", "so", "if", "then", "than",
  "because", "while", "when", "where", "what", "who", "whose", "why", "how",
  "there", "here", "not", "no", "yes", "all", "any", "some", "none", "both",
  "either", "neither", "each", "every", "for", "from", "with", "without",
  "about", "into", "onto", "over", "under", "after", "before", "once",
  "again", "still", "just", "only", "even", "also", "too", "very", "at",
  "on", "in", "of", "to", "by", "up", "down", "out", "off", "as", "per",
  // very common verbs
  "be", "am", "is", "are", "was", "were", "been", "being", "do", "does",
  "did", "done", "doing", "have", "has", "had", "having", "can", "could",
  "will", "would", "shall", "should", "may", "might", "must", "get", "got",
  "go", "went", "gone", "come", "came", "make", "made", "take", "took",
  "taken", "give", "gave", "given", "say", "said", "tell", "told", "ask",
  "asked", "know", "knew", "known", "think", "thought", "want", "wanted",
  "need", "needed", "try", "tried", "keep", "kept", "let", "leave", "left",
  "move", "moved", "moves", "moving", "work", "worked", "call", "called",
  "find", "found", "look", "looked", "see", "saw", "seen", "put", "start",
  "started", "stop", "stopped", "run", "ran", "grow", "grew", "grown",
  "spend", "spent", "live", "lived", "stay", "stayed", "turn", "turned",
  "use", "used", "help", "helped", "answer", "answered", "talk", "talked",
  "show", "showed", "shown", "bring", "brought", "hand", "handed", "pick",
  "picked", "check", "checked", "sort", "sorted", "figure", "figured",
  // common adjectives / adverbs / nouns that open sentences
  "good", "great", "fine", "right", "wrong", "well", "better", "best",
  "bad", "worse", "worst", "sure", "maybe", "honestly", "frankly", "really",
  "probably", "possibly", "mostly", "usually", "always", "never", "often",
  "sometimes", "first", "second", "third", "last", "next", "new", "old",
  "long", "short", "hard", "easy", "true", "false", "same", "different",
  "nothing", "something", "everything", "anything", "someone", "anyone",
  "everyone", "nobody", "somewhere", "anywhere", "everywhere", "nowhere",
  "particular", "general", "specific", "exactly", "originally", "one", "two",
  "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "day", "days", "week", "weeks", "month", "months", "year", "years",
  "time", "times", "place", "places", "thing", "things", "people", "kid",
  "kids", "family", "home", "point", "part", "way", "ways", "back", "kind",
  "lot", "bit", "little", "much", "more", "most", "less", "least", "enough",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
  "sunday", "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december", "today",
  "tomorrow", "yesterday", "morning", "afternoon", "evening", "night",
]);

/** Strips common inflectional suffixes so one stem covers its forms. */
function normalizeWord(word: string): string {
  const base = word.toLowerCase().replace(/['’]/g, "");
  for (const suffix of ["'s", "ing", "ed", "es", "s", "ly"]) {
    if (base.length > suffix.length + 2 && base.endsWith(suffix)) {
      return base.slice(0, base.length - suffix.length);
    }
  }
  return base;
}

function isCommonWord(word: string): boolean {
  const lower = word.toLowerCase().replace(/['’]/g, "");
  return COMMON_WORD_STEMS.has(lower) || COMMON_WORD_STEMS.has(normalizeWord(word));
}

/**
 * Extracts capitalized word / multi-word proper-noun-shaped candidates
 * from text (e.g. "London", "New York", "MI6"), skipping Claire's own
 * allowed names and ordinary English words that merely happen to be
 * capitalized because they start a sentence.
 */
function extractProperNounCandidates(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-zA-Z]*(?:\s[A-Z][a-zA-Z]*)*\b/g) ?? [];
  return matches.filter(candidate => {
    if (ALWAYS_ALLOWED.has(candidate)) return false;
    const words = candidate.split(/\s+/);
    // A candidate is only a real proper-noun candidate if at least one of
    // its words is not an ordinary common English word. "Moved" alone is
    // not; "New York" is; "London" is.
    return words.some(word => !ALWAYS_ALLOWED.has(word) && !isCommonWord(word));
  });
}

export class UngroundedPersonalSpecificityError extends Error {
  readonly candidate: string;
  constructor(candidate: string) {
    super(
      `Personal answer asserted a specific detail ("${candidate}") not present in the eligible canon supplied for this turn.`
    );
    this.name = "UngroundedPersonalSpecificityError";
    this.candidate = candidate;
  }
}

/**
 * Throws if `text` (a Claire-personal-mode answer) contains a proper-noun
 * specific not grounded in `eligibleCanonFacts` (the exact fact strings
 * actually supplied to the model this turn). Call this only for
 * personal-mode / personal-topic generations -- it is not meant to run
 * against ordinary business answers, which legitimately reference account
 * and property proper nouns that have nothing to do with Claire's own
 * biography.
 */
export function assertNoUngroundedPersonalSpecificity(
  text: string,
  eligibleCanonFacts: string[]
): void {
  const canonText = eligibleCanonFacts.join(" \n ");
  const candidates = extractProperNounCandidates(text);
  for (const candidate of candidates) {
    if (!canonText.includes(candidate)) {
      throw new UngroundedPersonalSpecificityError(candidate);
    }
  }
}
