/**
 * The forward limit on Trailblazer's corridor progress.
 *
 * There are FOUR production paths that mutate progress — ordinary joystick
 * locomotion, the dodge burst, the Linehook impulse, and traversal
 * actions — and every one of them must respect the same ceiling. They did
 * not: `forwardCeiling()` was computed correctly in the joystick path and
 * then discarded, because the clamp read
 *
 *     Math.min(blocked ? ceiling : 0.82, next)
 *
 * and `blocked` is false during ordinary unobstructed movement. So the
 * primary movement path — the one the player uses constantly — clamped to
 * the raw 0.82 and walked straight through the expedition ceiling, while
 * dodge and tether respected it. Unit tests passed because they asserted
 * the helper rather than the path that uses it.
 *
 * This module exists so the rule is a single named thing the runtime
 * genuinely calls, and so a test can drive the real decision with realistic
 * inputs instead of re-implementing it.
 */

export type ForwardLimitInput = {
  /**
   * Hard ceiling for the current mode: the expedition's end while an
   * expedition owns the world, otherwise the ordinary corridor maximum.
   */
  readonly modeCeiling: number;
  /** Corridor position of the authored traversal trigger ahead, if any. */
  readonly triggerAt: number | null;
  /** True once the player has closed to the trigger and must act on it. */
  readonly blocked: boolean;
};

/**
 * The mode ceiling ALWAYS applies. A traversal trigger can only make the
 * limit tighter, never looser — which is precisely the bug this replaces.
 */
export function forwardProgressLimit(input: ForwardLimitInput): number {
  if (input.blocked && input.triggerAt != null) {
    return Math.min(input.triggerAt, input.modeCeiling);
  }
  return input.modeCeiling;
}

export const CORRIDOR_MIN_PROGRESS = 0.035;

/** Applies the limit and the floor in one place, for every mutation path. */
export function clampCorridorProgress(
  next: number,
  limit: number
): number {
  return Math.max(CORRIDOR_MIN_PROGRESS, Math.min(limit, next));
}
