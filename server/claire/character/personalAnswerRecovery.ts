/**
 * PR1 Claire Intelligence Repair -- corrective pass 3 (real-exam finding).
 *
 * The personal-specificity guard correctly caught an invented city in the
 * post-corrective real exam ("Where are you from, Claire?"), but the
 * recovery was a dead end: the generic conversation fallback, "Give me a
 * second-ask me that once more. In the meantime, the brief is: Visit The
 * Wilshire." That answer throws away canon Claire actually had available
 * (she is British; at a high enough tier, an internationally mobile
 * childhood), and it stalls a question she could have answered safely.
 *
 * Safety must not cost us the answer. This module implements the recovery
 * order Adam specified, in order:
 *
 *   1. Answer from eligible canon, if eligible canon supports any
 *      meaningful answer (one constrained retry, grounded strictly in the
 *      canon facts actually supplied for this turn, re-checked by the same
 *      hard guard).
 *   2. No unsupported specificity -- the retry output goes through
 *      assertNoUngroundedPersonalSpecificity again, unchanged and still
 *      fail-closed.
 *   3. No gated/higher-tier disclosure -- the retry is only ever given the
 *      canon already deemed eligible for this operator's tier; this module
 *      never widens retrieval.
 *   4. Canon-scoped deflection if answering would actually require gated
 *      canon (or if the retry also overreaches) -- an in-voice refusal
 *      about THIS topic, not a generic stall.
 *   5. The generic conversation fallback is reserved for genuine
 *      generation/system failure (API error, empty output), which is
 *      handled by the caller's existing outer catch, not here.
 */
import {
  assertNoUngroundedPersonalSpecificity,
  UngroundedPersonalSpecificityError,
} from "./personalSpecificityGuard";

/**
 * Step 4's canon-scoped deflection. Deliberately in Claire's register --
 * she declines the specific, she does not stall the conversation or change
 * the subject to the field brief.
 */
export const CANON_SCOPED_PERSONAL_DEFLECTION =
  "I'll leave that one vague. I don't hand out specifics I can't stand behind.";

export type PersonalAnswerRetry = (constraint: string) => Promise<string>;

/**
 * Builds the extra constraint appended to the retry's system prompt. Kept
 * as a pure function so a test can assert exactly what the retry is told,
 * and so the caller never has to hand-roll this string.
 */
export function buildPersonalRetryConstraint(eligibleCanonFacts: string[]): string {
  if (!eligibleCanonFacts.length) {
    return [
      "RETRY -- your previous answer asserted a personal specific that is not in your canon.",
      "You have NO eligible personal canon for this operator at this tier and topic.",
      "Do not answer the personal question with any specific at all. Decline the specific briefly, in your own voice, and move on.",
    ].join(" ");
  }
  return [
    "RETRY -- your previous answer asserted a personal specific (a place, name, or other detail) that is not present in your canon, so it was rejected.",
    "Answer again using ONLY these exact eligible canon facts, and nothing more specific than what they literally state:",
    eligibleCanonFacts.map(fact => `- ${fact}`).join(" "),
    "Do not name a city, a person, an organization, a date, or any other specific that does not literally appear in the facts above.",
    "A shorter, vaguer, true answer is correct here. If the facts above genuinely cannot support any answer, decline the specific briefly in your own voice instead of inventing one.",
  ].join(" ");
}

/**
 * Runs recovery steps 1-4. Returns the recovered answer plus which step
 * produced it, so the caller can record honest telemetry. Never throws for
 * a guard violation -- a second violation resolves to the canon-scoped
 * deflection. A genuine provider/system failure inside `retry` is allowed
 * to propagate, so the caller's existing outer catch can route it to the
 * generic fallback (step 5).
 */
export async function recoverPersonalAnswer(input: {
  eligibleCanonFacts: string[];
  retry: PersonalAnswerRetry;
}): Promise<{ text: string; via: "canon_retry" | "canon_scoped_deflection" }> {
  const constraint = buildPersonalRetryConstraint(input.eligibleCanonFacts);
  const retried = (await input.retry(constraint)).trim();
  if (!retried) {
    return { text: CANON_SCOPED_PERSONAL_DEFLECTION, via: "canon_scoped_deflection" };
  }
  try {
    assertNoUngroundedPersonalSpecificity(retried, input.eligibleCanonFacts);
    return { text: retried, via: "canon_retry" };
  } catch (error) {
    if (!(error instanceof UngroundedPersonalSpecificityError)) throw error;
    return { text: CANON_SCOPED_PERSONAL_DEFLECTION, via: "canon_scoped_deflection" };
  }
}
