/**
 * Claire Intelligence Repair Part 2, Slice G — live arbiter.
 *
 * Slice A said G stays last and cannot speak until the routing-telemetry flag
 * has been on for a week. This module is that gate: it reports shares when
 * enough production rows exist, and it refuses to declare a verdict when they
 * do not. It does not invent a baseline percentage from the 17-question
 * static probe — that probe is a matcher census, not a live-turn distribution.
 */

export const CLAIRE_REPAIR2_G_MIN_WINDOW_DAYS = 7;
export const CLAIRE_REPAIR2_G_MIN_TURNS = 50;

export type ClaireRepair2ArbiterInput = {
  windowDays: number;
  totalTurns: number;
  reachedFollowUpModelShare: number;
  rendererProseShare: number;
  fallbackShare: number;
};

export type ClaireRepair2ArbiterResult =
  | {
      status: "insufficient_data";
      readyToArbitrate: false;
      reason: string;
    }
  | {
      status: "comparable";
      readyToArbitrate: true;
      shares: {
        followUpModel: number;
        rendererProse: number;
        fallback: number;
      };
      observations: string[];
    };

export function arbitrateClaireRepair2(
  input: ClaireRepair2ArbiterInput
): ClaireRepair2ArbiterResult {
  if (input.windowDays < CLAIRE_REPAIR2_G_MIN_WINDOW_DAYS) {
    return {
      status: "insufficient_data",
      readyToArbitrate: false,
      reason: `Need at least ${CLAIRE_REPAIR2_G_MIN_WINDOW_DAYS} days of live answer-path telemetry.`,
    };
  }
  if (input.totalTurns < CLAIRE_REPAIR2_G_MIN_TURNS) {
    return {
      status: "insufficient_data",
      readyToArbitrate: false,
      reason: `Need at least ${CLAIRE_REPAIR2_G_MIN_TURNS} attributed turns in the window; have ${input.totalTurns}.`,
    };
  }
  return {
    status: "comparable",
    readyToArbitrate: true,
    shares: {
      followUpModel: input.reachedFollowUpModelShare,
      rendererProse: input.rendererProseShare,
      fallback: input.fallbackShare,
    },
    observations: [
      `Follow-up model share: ${(input.reachedFollowUpModelShare * 100).toFixed(1)}%. Slice A found most live turns never reached that path — this is the comparison number, not a pass/fail.`,
      `Renderer-prose share: ${(input.rendererProseShare * 100).toFixed(1)}%.`,
      `Fallback share: ${(input.fallbackShare * 100).toFixed(1)}%.`,
      "This arbiter does not declare the program a success. It reports shares once a week of production rows exists.",
    ],
  };
}
