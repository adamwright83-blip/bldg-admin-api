/**
 * The coupling between corridor space and screen space.
 *
 * GoldlineGame owns the real Trailblazer position as `progress` (0..1 along
 * the corridor) and `lateral` (-0.72..0.72 across it). The expedition's
 * tether physics work in screen pixels, because that is where the anchors,
 * the cable and the player visibly are.
 *
 * These two functions are exact inverses of each other, and BOTH are used by
 * the live runtime — `projectCorridorPoint` to place guardians and anchors,
 * `corridorDeltaFromScreenImpulse` to turn a swing back into real corridor
 * movement. Keeping them here rather than inline in GoldlineGame is what
 * lets `linehookIntegration.test.ts` drive the genuine production path
 * instead of a re-implementation that could silently drift from it.
 */

/** Vertical span of the corridor on screen, as a fraction of height. */
export const PROGRESS_SPAN_FRACTION = 0.61;
const PROGRESS_SPAN = PROGRESS_SPAN_FRACTION;
/** Screen y at progress 0, as a fraction of height. */
const PROGRESS_ORIGIN = 0.88;
/** Horizontal deflection per unit of normalised lateral. */
const LATERAL_SPAN = 0.22;
/** Authored plan lateral units per unit of normalised corridor lateral. */
export const PLAN_LATERAL_UNITS = 140;

export function projectCorridorPoint(input: {
  progress: number;
  /** Lateral in AUTHORED PLAN units, not normalised corridor units. */
  lateral: number;
  routeCenter: number;
  width: number;
  height: number;
}): { x: number; y: number; scale: number } {
  const normalised = input.lateral / PLAN_LATERAL_UNITS;
  const baseHeight = Math.max(
    134,
    Math.min(232, input.height * (0.25 - input.progress * 0.08))
  );
  return {
    x: input.width * (input.routeCenter + normalised * LATERAL_SPAN),
    y: input.height * (PROGRESS_ORIGIN - input.progress * PROGRESS_SPAN),
    scale: baseHeight / 180,
  };
}

/**
 * Exact inverse of the position half of `projectCorridorPoint`. Converts a
 * screen-space movement contribution from the tether into the corridor
 * deltas GoldlineGame applies to its own authoritative progress/lateral.
 *
 * Note the sign on progress: screen y grows downward while corridor
 * progress grows toward the horizon, so a swing that carries the player up
 * the plate is forward progress.
 */
export function corridorDeltaFromScreenImpulse(input: {
  dx: number;
  dy: number;
  width: number;
  height: number;
}): { deltaProgress: number; deltaLateral: number } {
  return {
    deltaProgress: -input.dy / (input.height * PROGRESS_SPAN),
    deltaLateral: input.dx / (input.width * LATERAL_SPAN),
  };
}
