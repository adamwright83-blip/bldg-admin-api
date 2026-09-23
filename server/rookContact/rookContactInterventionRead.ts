/**
 * Minimum read over a Rook CONTACT intervention.
 * This does not complete a kingdom, a mission, or a challenge.
 * Connected, duration, CALL_COMPLETED, and businessSuccess are not a
 * verified commercial advance.
 */
export type VerifiedCommercialAdvance = "YES" | "NO" | "UNKNOWN";

export type RookContactInterventionSurface = {
  interventionHappened: boolean;
  correctProspectConnected: boolean;
  meaningfulCommercialAdvance: VerifiedCommercialAdvance;
  completed: false;
};

export function readRookContactInterventionSurface(input: {
  interventionRecorded: boolean;
  /** Prospect leg connected on the attempt that belongs to this session. */
  correctProspectConnected: boolean;
  /**
   * An authoritative commercial fact already proven elsewhere.
   * Null means no such fact was supplied.
   */
  authoritativeCommercialAdvance: "YES" | "NO" | null;
}): RookContactInterventionSurface {
  const meaningfulCommercialAdvance: VerifiedCommercialAdvance =
    input.authoritativeCommercialAdvance === "YES" ||
    input.authoritativeCommercialAdvance === "NO"
      ? input.authoritativeCommercialAdvance
      : "UNKNOWN";
  return {
    interventionHappened: input.interventionRecorded,
    correctProspectConnected: input.correctProspectConnected,
    meaningfulCommercialAdvance,
    completed: false,
  };
}
