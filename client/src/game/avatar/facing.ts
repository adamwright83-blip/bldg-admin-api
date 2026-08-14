/**
 * Presentation-only facing derivation. Orthogonal to AvatarState — this
 * never becomes a new state (no WALK_EAST/WALK_WEST), just which
 * directional texture variant a state renders with. Deterministic from the
 * raw joystick vector alone: same input always yields the same facing, no
 * randomness, no hidden clock dependency.
 */
export type TrailblazerFacing = "front" | "back" | "left" | "right";

/** Below this input magnitude, the player isn't meaningfully steering —
 * keep whatever facing was last legitimately established rather than
 * snapping back to a default, so idle doesn't visually "forget" which way
 * she was walking. */
const DEAD_ZONE = 0.12;

/**
 * `x` is lateral input (-1 left .. 1 right), `y` is forward/back input
 * (-1 forward/away .. 1 backward/toward camera — matches the existing
 * `forward = -input.y` convention already used for locomotion). Whichever
 * axis has the larger magnitude wins; a tie keeps the current facing
 * rather than picking arbitrarily.
 */
export function facingForInput(
  x: number,
  y: number,
  current: TrailblazerFacing
): TrailblazerFacing {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax < DEAD_ZONE && ay < DEAD_ZONE) return current;
  if (ay >= ax) {
    return y < 0 ? "back" : "front";
  }
  return x < 0 ? "left" : "right";
}
