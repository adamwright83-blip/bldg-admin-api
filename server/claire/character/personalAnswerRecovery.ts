/**
 * Claire personal-answer recovery.
 *
 * The post-generation specificity guard remains the hard safety boundary:
 * if the model invents a personal place/name/org, that output never reaches
 * the operator. Recovery must also not depend on asking the model to "try
 * again" and hoping it hallucinates less the second time.
 *
 * Instead, this module deterministically renders only canon fragments that:
 *  - were already eligible for this operator's disclosure tier, and
 *  - are relevant to the requested personal topic.
 *
 * If no eligible canon can answer the topic, Claire gives a short in-voice
 * deflection. No higher-tier canon is retrieved here and no new fact is
 * synthesized.
 */
import { CLAIRE_CANON } from "./characterDefinition";
import { assertNoUngroundedPersonalSpecificity } from "./personalSpecificityGuard";
import { selectDialogueLine } from "../progression/dialogueRegistry";

export const CANON_SCOPED_PERSONAL_DEFLECTION =
  "I'll leave that one vague. I don't hand out specifics I can't stand behind.";

export type PersonalAnswerRecoveryVia =
  | "canon_render"
  | "canon_scoped_deflection";

/**
 * Ordered canon fragments that can directly answer each supported personal
 * topic. Ordering is deliberate: use the most direct fact first. The
 * childhood topic may safely fall back to nationality at Tier 0 when the
 * childhood fragment itself is still gated.
 *
 * This is topic-to-canon routing, not phrase-specific copy: the existing
 * topic detector decides which topic the operator asked about.
 */
const TOPIC_FRAGMENT_PRIORITY: Record<string, readonly string[]> = {
  age: ["core_age"],
  childhood: ["core_childhood", "core_nationality"],
  background: ["core_study", "core_field_work", "core_nationality"],
  father: ["core_father_career", "core_father_disappearance"],
  professional_failure: ["core_field_failure"],
  past_relationship: ["core_relationship"],
  central_wound: ["core_central_wound"],
  is_she_real: ["core_ontology"],
};

/**
 * Convert a canon fact from its stored third-person form into a compact
 * first-person answer without introducing any new factual tokens.
 */
export function renderCanonFactFirstPerson(fact: string): string {
  return fact
    .replace(/^Claire knows she is /, "I know I'm ")
    .replace(/^Claire's /, "My ")
    .replace(/^Claire is /, "I'm ")
    .replace(/^Claire had /, "I had ")
    .replace(/^Claire studied /, "I studied ")
    .replace(/^Claire /, "I ")
    .replace(/\bClaire's\b/g, "my")
    .replace(/\bClaire\b/g, "I")
    .replace(/\bShe\b/g, "I")
    .replace(/\bshe\b/g, "I")
    .replace(/\bher\b/g, "my");
}

/**
 * Deterministically render the best eligible canon fact for the requested
 * topic. Returns null when this tier simply does not contain a meaningful
 * answer for that topic.
 */
export function renderCanonScopedPersonalAnswer(input: {
  eligibleCanonFacts: string[];
  eligibleCanonFragmentIds?: string[];
  requestedTopic?: string;
}): string | null {
  if (!input.requestedTopic) return null;

  // Prefer the compiler's fragment IDs as the eligibility authority. Facts
  // remain accepted for backward-compatible callers/tests, but IDs avoid a
  // brittle text-equality dependency between retrieval and recovery.
  const eligibleFacts = new Set(input.eligibleCanonFacts);
  const eligibleIds = new Set(input.eligibleCanonFragmentIds ?? []);
  if (eligibleFacts.size === 0 && eligibleIds.size === 0) return null;

  const priority = TOPIC_FRAGMENT_PRIORITY[input.requestedTopic] ?? [];
  const fragment = priority
    .map(id => CLAIRE_CANON.find(candidate => candidate.id === id))
    .find(candidate =>
      candidate?.fact &&
      (eligibleIds.has(candidate.id) || eligibleFacts.has(candidate.fact))
    );

  if (!fragment?.fact) return null;

  const rendered = renderCanonFactFirstPerson(fragment.fact).trim();
  if (!rendered) return null;

  // The deterministic renderer is still re-checked by the same hard guard.
  // When fragment IDs are the compiler's eligibility authority, include the
  // facts belonging to those already-eligible IDs in the guard inventory too.
  // This does not widen disclosure: only compiler-authorized fragments enter.
  const guardEligibleFacts = [
    ...input.eligibleCanonFacts,
    ...CLAIRE_CANON
      .filter(candidate => eligibleIds.has(candidate.id))
      .map(candidate => candidate.fact),
  ];
  assertNoUngroundedPersonalSpecificity(rendered, [...new Set(guardEligibleFacts)]);
  return rendered;
}

/**
 * Recovery after a model answer trips the personal-specificity guard.
 * There is deliberately no second free-form model generation here.
 */
export function recoverPersonalAnswer(input: {
  eligibleCanonFacts: string[];
  eligibleCanonFragmentIds?: string[];
  requestedTopic?: string;
}): { text: string; via: PersonalAnswerRecoveryVia } {
  const rendered = renderCanonScopedPersonalAnswer(input);
  if (rendered) return { text: rendered, via: "canon_render" };
  // Canon does not answer this topic. Speak an authored personal decline, not a
  // business-epistemic "I can't stand behind specifics" line.
  const authored = selectDialogueLine({ category: "decline", rapportBand: 0 });
  return {
    text: authored?.text ?? CANON_SCOPED_PERSONAL_DEFLECTION,
    via: "canon_scoped_deflection",
  };
}
