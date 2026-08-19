export type ColosseumPoint = { x: number; y: number };

export type ClockheadAttackKind = "aimed" | "fan" | "sweep";

export type ColosseumProjectile = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type ColosseumProjectileCollision = {
  projectileId: string;
  kind: "shield" | "player";
  x: number;
  y: number;
};

export const CLOCKHEAD_PROJECTILE_ORIGIN: ColosseumPoint = { x: 50, y: 31 };
export const COLOSSEUM_PROJECTILE_SPEED = 34;
export const COLOSSEUM_PLAYER_HIT_RADIUS = 2.65;
export const COLOSSEUM_SHIELD_HIT_RADIUS = 3.15;
export const COLOSSEUM_SWEEP_RADIUS = 67;

function normalise(dx: number, dy: number): ColosseumPoint {
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function rotate(vector: ColosseumPoint, radians: number): ColosseumPoint {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos,
  };
}

function projectile(
  id: string,
  direction: ColosseumPoint
): ColosseumProjectile {
  return {
    id,
    x: CLOCKHEAD_PROJECTILE_ORIGIN.x,
    y: CLOCKHEAD_PROJECTILE_ORIGIN.y,
    vx: direction.x * COLOSSEUM_PROJECTILE_SPEED,
    vy: direction.y * COLOSSEUM_PROJECTILE_SPEED,
  };
}

/**
 * Clockhead commits to the player's position at RELEASE time. The projectile
 * never homes afterwards, so moving after the wind-up is real counter-play.
 */
export function spawnClockheadProjectiles(
  kind: Exclude<ClockheadAttackKind, "sweep">,
  player: ColosseumPoint,
  sequence: number
): ColosseumProjectile[] {
  const direction = normalise(
    player.x - CLOCKHEAD_PROJECTILE_ORIGIN.x,
    player.y - CLOCKHEAD_PROJECTILE_ORIGIN.y
  );
  if (kind === "aimed") {
    return [projectile(`clockhead-${sequence}-0`, direction)];
  }

  return [-0.18, 0, 0.18].map((offset, index) =>
    projectile(`clockhead-${sequence}-${index}`, rotate(direction, offset))
  );
}

function shieldCentre(player: ColosseumPoint): ColosseumPoint {
  const towardBoss = normalise(
    CLOCKHEAD_PROJECTILE_ORIGIN.x - player.x,
    CLOCKHEAD_PROJECTILE_ORIGIN.y - player.y
  );
  return {
    x: player.x + towardBoss.x * 3.2,
    y: player.y + towardBoss.y * 3.2,
  };
}

function pointDistance(a: ColosseumPoint, b: ColosseumPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function stepColosseumProjectiles(
  projectiles: readonly ColosseumProjectile[],
  deltaSeconds: number,
  player: ColosseumPoint,
  shieldTaken: boolean,
  playerInvulnerable: boolean
): {
  projectiles: ColosseumProjectile[];
  collisions: ColosseumProjectileCollision[];
} {
  const next: ColosseumProjectile[] = [];
  const collisions: ColosseumProjectileCollision[] = [];
  const guard = shieldCentre(player);

  for (const current of projectiles) {
    const stepped = {
      ...current,
      x: current.x + current.vx * deltaSeconds,
      y: current.y + current.vy * deltaSeconds,
    };

    if (stepped.x < -8 || stepped.x > 108 || stepped.y < -8 || stepped.y > 108) {
      continue;
    }

    if (
      shieldTaken &&
      pointDistance(stepped, guard) <= COLOSSEUM_SHIELD_HIT_RADIUS
    ) {
      collisions.push({
        projectileId: stepped.id,
        kind: "shield",
        x: stepped.x,
        y: stepped.y,
      });
      continue;
    }

    if (
      !playerInvulnerable &&
      pointDistance(stepped, player) <= COLOSSEUM_PLAYER_HIT_RADIUS
    ) {
      collisions.push({
        projectileId: stepped.id,
        kind: "player",
        x: stepped.x,
        y: stepped.y,
      });
      continue;
    }

    next.push(stepped);
  }

  return { projectiles: next, collisions };
}

export function sweepAngleDegrees(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return 35 + clamped * 110;
}

export function sweepHitsPlayer(
  progress: number,
  player: ColosseumPoint
): boolean {
  const dx = player.x - CLOCKHEAD_PROJECTILE_ORIGIN.x;
  const dy = player.y - CLOCKHEAD_PROJECTILE_ORIGIN.y;
  const distance = Math.hypot(dx, dy);
  if (distance > COLOSSEUM_SWEEP_RADIUS || dy <= 0) return false;

  const playerAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const sweepAngle = sweepAngleDegrees(progress);
  const difference = Math.abs(playerAngle - sweepAngle);
  return difference <= 5.5;
}

export function movementFacing(input: ColosseumPoint): "front" | "back" | "left" | "right" {
  if (Math.abs(input.x) > Math.abs(input.y)) return input.x < 0 ? "left" : "right";
  return input.y < 0 ? "back" : "front";
}

export function perspectiveScale(y: number): number {
  const progress = Math.max(0, Math.min(1, (y - 34) / (86 - 34)));
  return 0.84 + progress * 0.28;
}
