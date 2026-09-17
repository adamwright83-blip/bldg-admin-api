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

/** Common words that are capitalized in ordinary English and should never
 * trip this guard: sentence starters, days, months, pronouns as "I"/"I'm",
 * and business/operational proper nouns Claire is expected to use freely
 * (her own name, the product name) that are not personal-biography claims.
 */
const ALWAYS_ALLOWED = new Set([
  "Claire",
  "Goldline",
  "I",
  "I'm",
  "I'll",
  "I've",
  "I'd",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December",
  "Not", "That", "The", "This", "There", "Here", "What", "When", "Where",
  "Who", "Why", "How", "Do", "Don't", "Does", "Doesn't", "You", "Your",
  "Yes", "No", "Right", "Good", "Well", "So", "But", "And", "If", "Once",
  "Before", "After", "Ask", "Tell", "Let", "Never", "Always", "Nothing",
  "Something", "Everything", "First", "Second", "Third", "One", "Two",
]);

/**
 * Extracts capitalized word / multi-word proper-noun-shaped candidates
 * from text (e.g. "London", "New York", "MI6") that aren't sentence-start
 * artifacts already covered by ALWAYS_ALLOWED.
 */
function extractProperNounCandidates(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-zA-Z]*(?:\s[A-Z][a-zA-Z]*)*\b/g) ?? [];
  return matches.filter(candidate => {
    const firstWord = candidate.split(/\s/)[0];
    return !ALWAYS_ALLOWED.has(firstWord) && !ALWAYS_ALLOWED.has(candidate);
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
