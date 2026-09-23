/**
 * How Rook moves when nobody is directing him: he keeps up with Trailblazer on
 * his own two feet, a little behind and to one side, and he does not crowd her.
 * He walks upright like a small person — the walk cycle does the rest. He never
 * hops and he never flies.
 *
 * Pure: the runtime feeds positions in and applies what comes out.
 */
import type { Vec } from "./holdTheLine";

export type Facing = "front" | "back" | "left" | "right";

export type RookFollowState = {
  position: Vec;
  facing: Facing;
  moving: boolean;
  /** Seconds he has stood still — idle flourishes key off this. */
  stillFor: number;
  /** Which side of her he prefers; he swaps only when she turns hard. */
  side: 1 | -1;
};

export type FollowTuning = {
  /** Start walking when he is further than this from his spot. */
  startDistance: number;
  /** Stop once he is this close. */
  stopDistance: number;
  /** He matches her pace but tops out a little higher, so he can catch up. */
  maxSpeed: number;
  /** Offset from her, in world units: behind, and to his preferred side. */
  trail: number;
  lateral: number;
  /** How far "behind" means in depth (y) on a stage seen from behind her. */
  depthScale: number;
};

export const DECK_FOLLOW: FollowTuning = {
  startDistance: 58,
  stopDistance: 22,
  maxSpeed: 205,
  trail: 44,
  lateral: 78,
  depthScale: 0.55,
};

export const SPAN_FOLLOW: FollowTuning = {
  startDistance: 52,
  stopDistance: 18,
  maxSpeed: 210,
  trail: 92,
  lateral: 10,
  depthScale: 0.25,
};

export function facingFor(delta: Vec, fallback: Facing): Facing {
  if (Math.hypot(delta.x, delta.y) < 3) return fallback;
  if (Math.abs(delta.x) > Math.abs(delta.y) * 0.9) return delta.x < 0 ? "left" : "right";
  return delta.y < 0 ? "back" : "front";
}

/** Where he wants to stand, given where she is and which way she is heading. */
export function followSpot(player: Vec, playerFacing: Facing, side: 1 | -1, tuning: FollowTuning): Vec {
  const behind =
    playerFacing === "left"
      ? { x: tuning.trail, y: 0 }
      : playerFacing === "right"
        ? { x: -tuning.trail, y: 0 }
        : playerFacing === "back"
          ? { x: 0, y: tuning.trail * tuning.depthScale }
          : { x: 0, y: -tuning.trail * tuning.depthScale };
  const lateral =
    playerFacing === "left" || playerFacing === "right"
      ? { x: 0, y: side * tuning.lateral * tuning.depthScale }
      : { x: side * tuning.lateral, y: 0 };
  return { x: player.x + behind.x + lateral.x, y: player.y + behind.y + lateral.y };
}

export function stepFollow(
  state: RookFollowState,
  player: Vec,
  playerFacing: Facing,
  playerSpeed: number,
  dt: number,
  tuning: FollowTuning,
  walkable: (p: Vec) => boolean
): RookFollowState {
  let side = state.side;
  // Swap sides if she has walked straight through his spot.
  const spot = followSpot(player, playerFacing, side, tuning);
  const alt = followSpot(player, playerFacing, (side * -1) as 1 | -1, tuning);
  const d = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
  let target = spot;
  if (!walkable(spot) && walkable(alt)) {
    side = (side * -1) as 1 | -1;
    target = alt;
  } else if (d(state.position, alt) + 30 < d(state.position, spot) && walkable(alt)) {
    side = (side * -1) as 1 | -1;
    target = alt;
  }
  const delta = { x: target.x - state.position.x, y: target.y - state.position.y };
  const distance = Math.hypot(delta.x, delta.y);
  const shouldMove = state.moving ? distance > tuning.stopDistance : distance > tuning.startDistance;
  if (!shouldMove) {
    const faceHer = { x: player.x - state.position.x, y: player.y - state.position.y };
    return {
      position: state.position,
      facing: state.stillFor > 1.2 ? facingFor(faceHer, state.facing) : state.facing,
      moving: false,
      stillFor: state.stillFor + dt,
      side,
    };
  }
  // Catch up faster when far behind; stroll when close.
  const speed = Math.min(tuning.maxSpeed, Math.max(90, playerSpeed * 1.05 + (distance - tuning.stopDistance) * 1.6));
  const step = Math.min(distance, speed * dt);
  const next = { x: state.position.x + (delta.x / distance) * step, y: state.position.y + (delta.y / distance) * step };
  const position = walkable(next) ? next : state.position;
  return { position, facing: facingFor(delta, state.facing), moving: position !== state.position, stillFor: 0, side };
}
