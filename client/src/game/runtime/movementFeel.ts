/**
 * Pure movement-feel math, factored out of GoldlineGame's render loop so it
 * can be unit tested without a Pixi Application. Input response (what the
 * joystick reports) stays immediate — these functions only govern how the
 * character's presented VELOCITY eases toward that input, never how quickly
 * the input itself is read.
 */

/** Minimum joystick deflection that counts as movement intent. */
export const INPUT_DEADZONE = 0.08;

const MAX_SPEED = 0.13;
export const ACCEL_UNITS_PER_SECOND = 2.6;
export const DECEL_UNITS_PER_SECOND = 4.2;
/** Direction reversal ramps faster than a plain stop — a held-back tap
 * should not coast through zero the same way releasing the stick does. */
export const REVERSAL_UNITS_PER_SECOND = 6.5;

/**
 * Continuous target speed from joystick magnitude — not a 2-tier walk/run
 * step function. A small deflection genuinely moves slower than a full one,
 * not just "slow" vs "fast".
 */
export function targetSpeedForMagnitude(magnitude: number, branchPace: number): number {
  if (magnitude < INPUT_DEADZONE) return 0;
  const normalized = Math.min(1, (magnitude - INPUT_DEADZONE) / (1 - INPUT_DEADZONE));
  return normalized * MAX_SPEED * branchPace;
}

/**
 * One frame of eased velocity. `directionSign` is the current movement
 * direction (-1, 0, 1) derived from input; when it flips relative to the
 * previous frame's effective direction, ramping uses the faster reversal
 * rate so the character doesn't visibly coast through the change.
 */
export function stepVelocity(input: {
  currentVelocity: number;
  targetSpeed: number;
  deltaSeconds: number;
  isReversing: boolean;
}): number {
  const { currentVelocity, targetSpeed, deltaSeconds, isReversing } = input;
  const rampRate = isReversing
    ? REVERSAL_UNITS_PER_SECOND
    : targetSpeed > currentVelocity
      ? ACCEL_UNITS_PER_SECOND
      : DECEL_UNITS_PER_SECOND;
  const maxStep = rampRate * deltaSeconds * 0.13;
  const delta = targetSpeed - currentVelocity;
  return currentVelocity + Math.sign(delta) * Math.min(maxStep, Math.abs(delta));
}

export function branchPaceFor(branch: "safe" | "intel" | "upper"): number {
  if (branch === "safe") return 0.82;
  if (branch === "upper") return 1.08;
  return 1;
}
