import type { OverworldFacing, OverworldPoint } from "./types";

export const OVERWORLD_DEADZONE = 0.1;
export const WALK_SPEED = 110;
export const MAX_SPEED = 190;
export const ACCELERATION = 550;
export const DECELERATION = 800;
export const REVERSAL_ACCELERATION = 1000;

export function remapAnalogInput(x: number, y: number) {
  const vectorMagnitude = Math.hypot(x, y);
  const rawMagnitude = Math.min(1, vectorMagnitude);
  if (rawMagnitude <= OVERWORLD_DEADZONE) return { x: 0, y: 0, magnitude: 0 };
  const magnitude =
    (rawMagnitude - OVERWORLD_DEADZONE) / (1 - OVERWORLD_DEADZONE);
  return {
    x: (x / vectorMagnitude) * magnitude,
    y: (y / vectorMagnitude) * magnitude,
    magnitude,
  };
}

export function targetSpeed(magnitude: number): number {
  if (magnitude <= 0) return 0;
  if (magnitude <= 0.45) return WALK_SPEED * (magnitude / 0.45);
  return WALK_SPEED + (MAX_SPEED - WALK_SPEED) * ((magnitude - 0.45) / 0.55);
}

function approach(current: number, target: number, amount: number) {
  if (current < target) return Math.min(target, current + amount);
  return Math.max(target, current - amount);
}

export function stepVelocity(
  current: OverworldPoint,
  input: ReturnType<typeof remapAnalogInput>,
  deltaSeconds: number
): OverworldPoint {
  const speed = targetSpeed(input.magnitude);
  const directionScale = input.magnitude > 0 ? 1 / input.magnitude : 0;
  const target = {
    x: input.x * directionScale * speed,
    y: input.y * directionScale * speed,
  };
  const currentDotTarget = current.x * target.x + current.y * target.y;
  const reversing = input.magnitude > 0 && currentDotTarget < 0;
  const currentMagnitude = Math.hypot(current.x, current.y);
  const rate = reversing
    ? REVERSAL_ACCELERATION
    : input.magnitude === 0 || speed < currentMagnitude
      ? DECELERATION
      : ACCELERATION;
  return {
    x: approach(current.x, target.x, rate * deltaSeconds),
    y: approach(current.y, target.y, rate * deltaSeconds),
  };
}

export function facingForVelocity(
  velocity: OverworldPoint,
  fallback: OverworldFacing
): OverworldFacing {
  if (Math.hypot(velocity.x, velocity.y) < 5) return fallback;
  if (Math.abs(velocity.x) > Math.abs(velocity.y))
    return velocity.x < 0 ? "left" : "right";
  return velocity.y < 0 ? "back" : "front";
}
