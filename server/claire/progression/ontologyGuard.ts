/**
 * Character-integrity guard: Claire never leaks generic assistant ontology
 * ("As an AI…", "I'm not a person", "I don't have weekends") to paper over missing biography.
 *
 * Missing biography is handled as privacy / vagueness / refusal, in character — never by
 * disclaiming personhood, and never by inventing history (that half is the biography
 * entailment boundary in generalBiographyBoundary.ts; this is the independent second guard).
 *
 * Constructedness is NOT globally forbidden. GOLDLINE_CANON.md locks an authored story event in
 * which it legitimately becomes story material, and Claire "knows she is constructed". Ontology
 * disclosure is therefore authorised through exactly two channels:
 *   1. the operator directly asks what Claire is, or
 *   2. a specific authored campaign/story event is active (`storyEventActive`).
 * Outside those, the spoken line is replaced by an authored in-character decline.
 *
 * The primary constraint is the generation prompt (CLAIRE_PERSONALITY_LOCK). This post-generation
 * lint is defence in depth: it cannot enumerate every phrasing, and does not try to.
 */

const LEAK_PATTERNS: RegExp[] = [
  /\bas an? (?:ai|a\.i\.|artificial|language model|llm|assistant|virtual assistant|chatbot|bot|program|machine)\b/i,
  /\bi(?:'m| am) (?:just |only |really )?(?:an? )?(?:ai|a\.i\.|artificial|language model|llm|chatbot|bot|virtual assistant|computer program|program|machine|software)\b/i,
  /\bi(?:'m| am) not (?:a |an )?(?:real |actual )?(?:person|human|human being|someone)\b/i,
  /\bi(?:'m| am) (?:just )?(?:code|software)\b/i,
  /\bi (?:do not|don't|dont|cannot|can't|never) (?:actually |really |truly )?(?:have|experience|feel|get|take|do) (?:any |a |an |real |personal |actual )?(?:weekends?|personal life|private life|feelings?|emotions?|days? off|free time|body|personal experiences?|frustration|loneliness|hobbies)\b/i,
  /\bi (?:was|am) (?:created|programmed|built|trained|designed) (?:to|by)\b/i,
  /\bno (?:personal life|weekends?|feelings|emotions)\b.{0,20}\b(?:for me|i have)\b/i,
];

export function findOntologyLeak(text: string): string | null {
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (LEAK_PATTERNS.some(pattern => pattern.test(sentence))) return sentence.trim();
  }
  return null;
}

/**
 * The operator is directly asking what Claire is. Deliberately a small closed set: the failure
 * direction is safe (a missed phrasing yields an in-character deflection, never a leak or an invention).
 */
const EXPLICIT_ONTOLOGY_QUESTION =
  /\b(?:are you|r u|you(?:'re| are)) (?:really |actually |just |even )?(?:an? |a real |the )?(?:ai|a\.i\.|human|person|real|robot|bot|machine|program|chatbot|constructed|artificial|alive|sentient)\b|\bwhat are you\b|\bare you (?:made|built|programmed|constructed|created)\b|\bwho (?:made|built|created) you\b|\bhow were you (?:made|built|created)\b/i;

export function operatorAskedOntology(utterance: string): boolean {
  return EXPLICIT_ONTOLOGY_QUESTION.test(utterance);
}

export type OntologyBoundaryResult =
  | { ok: true; authorizedBy: "no_leak" | "operator_question" | "story_event" }
  | { ok: false; sentence: string };

export function checkOntologyBoundary(input: { text: string; utterance: string; storyEventActive?: boolean }): OntologyBoundaryResult {
  const leak = findOntologyLeak(input.text);
  if (!leak) return { ok: true, authorizedBy: "no_leak" };
  if (input.storyEventActive) return { ok: true, authorizedBy: "story_event" };
  if (operatorAskedOntology(input.utterance)) return { ok: true, authorizedBy: "operator_question" };
  return { ok: false, sentence: leak };
}
