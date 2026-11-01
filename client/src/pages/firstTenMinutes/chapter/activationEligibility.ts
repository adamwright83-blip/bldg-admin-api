/**
 * When the existing activation query may run.
 *
 * A kept portrait is enough. A customer draft is not required, and neither is a
 * qualifying opportunity. Checkout that has already started (`stage === "activation"`)
 * stays readable on the way back from Stripe, including when there was never a draft.
 *
 * Antigravity PR #800 (head 75040dd) still enables this query only when `hasDraft`
 * is true. Its no-opportunity `ChapterThreshold` adds "Three Days Later · Enter
 * the Machine" (`first-ten-enter-simulated-machine`) and does not render signup.
 * `MachineCorrespondence` still returns the empty panel (`!opportunity`) without
 * `ActivationOffer`. When that branch merges, keep this predicate as the query's
 * `enabled` value, keep their machine button, and render `ActivationOffer` both
 * under that threshold and in the empty panel. Do not put the draft gate back,
 * and do not treat the fictional prospect as an `example` journey.
 */
export function activationQueryEnabled(input: {
  hasCredentials: boolean;
  hasDraft: boolean;
  portraitKept: boolean;
  stage: string | null | undefined;
}): boolean {
  if (!input.hasCredentials) return false;
  return input.hasDraft || input.portraitKept || input.stage === "activation";
}
