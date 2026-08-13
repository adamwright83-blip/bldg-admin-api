/**
 * Challenge Director (Slice 99) — tunes how entertaining the GAME layer is.
 * It structurally cannot touch the underlying business work: its input type
 * has nowhere to put a location, a count, or a business action, and its
 * output type has no field that could resize `ActionGrammar`. The same
 * pattern `shared/worldMutationDescriptor.ts`'s `WorldMutationInput` already
 * uses to keep game performance out of business truth (PR #51) — proven the
 * same way here: a guard test asserts these tokens are absent from the
 * input/output types' source.
 */
import type { GoldlineProgressionProjection } from "../../../../shared/goldlineProgression";

export const CHALLENGE_DEPTHS = ["baseline", "deepened"] as const;
export type ChallengeDepth = (typeof CHALLENGE_DEPTHS)[number];

/**
 * Demonstrated play skill only — the same `challengeDepth` signal
 * MissionDirector already derives from real progression state (PR-era
 * "DEEPENED" branch state), never a client-invented difficulty score.
 */
export type ChallengeDirectorInput = {
  depth: ChallengeDepth;
};

/**
 * Presentation-only tuning. No field here can create, count, or relocate
 * real work — there is no `count`, `locations`, or `businessActionId` in
 * this type, structurally matching the grammar it is forbidden from
 * touching.
 */
export type ChallengeTuning = {
  /** Safe gameplay timer duration in seconds. Never derived from `grammar.count`. */
  timerSeconds: number;
  /** Presentation complexity only (route-reading, camera pressure, ambient density). */
  presentationComplexity: "restrained" | "standard" | "elevated";
  /** Purely optional, purely fictional secondary objective — never a business condition. */
  optionalFictionalObjective: string | null;
};

const BASELINE_TIMER_SECONDS = 240;
const DEEPENED_TIMER_SECONDS = 180; // tighter, not longer/shorter work — same count either way

export function tuneChallenge(input: ChallengeDirectorInput): ChallengeTuning {
  if (input.depth === "deepened") {
    return {
      timerSeconds: DEEPENED_TIMER_SECONDS,
      presentationComplexity: "elevated",
      optionalFictionalObjective: "Cover the sector with zero return trips to any property.",
    };
  }
  return {
    timerSeconds: BASELINE_TIMER_SECONDS,
    presentationComplexity: "standard",
    optionalFictionalObjective: null,
  };
}
