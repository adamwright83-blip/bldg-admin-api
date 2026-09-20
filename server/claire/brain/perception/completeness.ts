/**
 * Complete-thought assembly — Perception's destination for voice.
 *
 * Today V1 decides whether a phone transcript was a finished thought, and the shadow
 * observer inherits that decision. For SHADOW that is acceptable. For CUTOVER it is
 * not: Brain V2 cannot own the turn while depending on V1 to tell it whether the turn
 * had ended.
 *
 * This is the V2 home for that decision. It deliberately WRAPS the proven V1 predicate
 * (`shouldHoldForContinuation` / `looksUnfinished`) rather than writing a second,
 * subtly different continuation algorithm — two disagreeing answers to "did he stop
 * talking?" is precisely the failure this architecture exists to remove.
 *
 * Nothing here is wired into production. V1 still owns live fragment handling.
 */

import { looksUnfinished, shouldHoldForContinuation } from "../../turn/claireTurn";
import type { Completeness } from "../contracts/perceivedTurn";

/** How many silent continuation gathers a single thought may use before we flush. */
export const MAX_FRAGMENT_HOLDS = 2;

export type FragmentState = {
  /** The partial thought held so far, if any. */
  pendingFragment: string | null;
  /** How many holds this thought has already used. */
  fragmentHolds: number;
  /** Raw provider pieces for the in-progress thought — evidence, not ledger turns. */
  providerFragments: string[];
};

export function emptyFragmentState(): FragmentState {
  return { pendingFragment: null, fragmentHolds: 0, providerFragments: [] };
}

export type AssemblyInput = {
  /** What the provider just delivered. */
  incoming: string;
  state: FragmentState;
  /** True when Claire asked something and is waiting on an answer. */
  awaitingReply?: boolean;
  /**
   * False when the caller went quiet: a held fragment is flushed as a complete thought
   * rather than waiting forever for words that are not coming.
   */
  allowFragmentWait?: boolean;
};

export type AssemblyResult = {
  /** Everything heard for this thought so far. */
  assembledText: string;
  completeness: Completeness;
  state: FragmentState;
};

/**
 * Fold one provider delivery into the in-progress thought.
 *
 * A held thought is released when it reads as finished, when the caller goes quiet, or
 * when the safety limit is reached — the limit exists so a mis-parse can never strand
 * an operator in silence.
 */
export function assembleThought(input: AssemblyInput): AssemblyResult {
  const { state, awaitingReply = false, allowFragmentWait = true } = input;
  const incoming = input.incoming.trim();

  const combined = [state.pendingFragment, incoming].filter(Boolean).join(" ").trim();
  const providerFragments = incoming
    ? [...state.providerFragments, incoming]
    : [...state.providerFragments];

  if (!combined) {
    return { assembledText: "", completeness: "incomplete", state: { ...state, providerFragments } };
  }

  // The caller stopped talking: take what we have rather than holding it hostage.
  if (!allowFragmentWait) {
    return {
      assembledText: combined,
      completeness: state.pendingFragment ? "forced_flush" : "complete",
      state: emptyFragmentState(),
    };
  }

  // Safety limit reached: flush instead of holding a thought indefinitely.
  if (state.fragmentHolds >= MAX_FRAGMENT_HOLDS) {
    return { assembledText: combined, completeness: "forced_flush", state: emptyFragmentState() };
  }

  if (shouldHoldForContinuation(combined, { awaitingReply })) {
    return {
      assembledText: combined,
      completeness: "incomplete",
      state: { pendingFragment: combined, fragmentHolds: state.fragmentHolds + 1, providerFragments },
    };
  }

  return { assembledText: combined, completeness: "complete", state: emptyFragmentState() };
}

/** Exposed so callers can reason about a fragment without re-implementing the rule. */
export function readsAsUnfinished(text: string): boolean {
  return looksUnfinished(text);
}
