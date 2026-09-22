export type ColosseumPoint = { x: number; y: number };

export type ClockheadAttackKind = "aimed" | "fan" | "sweep";

export type ColosseumProjectile = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * Optional authored timing. A projectile with `delayMs` is still charging in
   * Clockhead's face and neither moves nor collides; a projectile with `hang`
   * stops mid-flight, trembles, then resumes (WORLD_BIBLE §14 "Aimed Bolt —
   * hangs in place before suddenly resuming"). Legacy percent-space callers
   * never set these and behave exactly as before.
   */
  delayMs?: number;
  ageMs?: number;
  hang?: { atMs: number; forMs: number; resumeSpeed: number };
  hanging?: boolean;
  /** Set once a Borrowed Minute has turned it back toward Clockhead. */
  reversed?: boolean;
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

/**
 * Where attacks come from and how big the things they can hit are. Omitted
 * fields fall back to the original percent-space arena, so existing callers
 * and tests are untouched; the stage-space arena passes its own geometry.
 */
export type CombatGeometry = {
  origin: ColosseumPoint;
  speed: number;
  playerRadius: number;
  shieldRadius: number;
  /** How far in front of the body, toward the origin, the shield is held. */
  shieldOffset: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
};

const LEGACY_GEOMETRY: CombatGeometry = {
  origin: CLOCKHEAD_PROJECTILE_ORIGIN,
  speed: COLOSSEUM_PROJECTILE_SPEED,
  playerRadius: COLOSSEUM_PLAYER_HIT_RADIUS,
  shieldRadius: COLOSSEUM_SHIELD_HIT_RADIUS,
  shieldOffset: 3.2,
  bounds: { minX: -8, maxX: 108, minY: -8, maxY: 108 },
};

function geometryWith(overrides: Partial<CombatGeometry> | undefined): CombatGeometry {
  return overrides ? { ...LEGACY_GEOMETRY, ...overrides } : LEGACY_GEOMETRY;
}

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
  direction: ColosseumPoint,
  geometry: CombatGeometry
): ColosseumProjectile {
  return {
    id,
    x: geometry.origin.x,
    y: geometry.origin.y,
    vx: direction.x * geometry.speed,
    vy: direction.y * geometry.speed,
  };
}

/**
 * Clockhead commits to the player's position at RELEASE time. The projectile
 * never homes afterwards, so moving after the wind-up is real counter-play.
 */
export function spawnClockheadProjectiles(
  kind: Exclude<ClockheadAttackKind, "sweep">,
  player: ColosseumPoint,
  sequence: number,
  geometryOverrides?: Partial<CombatGeometry>
): ColosseumProjectile[] {
  const geometry = geometryWith(geometryOverrides);
  const direction = normalise(
    player.x - geometry.origin.x,
    player.y - geometry.origin.y
  );
  if (kind === "aimed") {
    return [projectile(`clockhead-${sequence}-0`, direction, geometry)];
  }

  return [-0.18, 0, 0.18].map((offset, index) =>
    projectile(`clockhead-${sequence}-${index}`, rotate(direction, offset), geometry)
  );
}

/**
 * Clock Fan: several bolts on STAGGERED timing (WORLD_BIBLE §14), committed to
 * where the player stood when the fan was loosed. `order` alternates which
 * side leads so the gap to move through is never the same twice.
 */
export function spawnStaggeredFan(input: {
  player: ColosseumPoint;
  sequence: number;
  count: number;
  spreadRadians: number;
  staggerMs: number;
  order: 1 | -1;
  geometry?: Partial<CombatGeometry>;
}): ColosseumProjectile[] {
  const geometry = geometryWith(input.geometry);
  const direction = normalise(
    input.player.x - geometry.origin.x,
    input.player.y - geometry.origin.y
  );
  const count = Math.max(1, Math.floor(input.count));
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const offset = (t - 0.5) * input.spreadRadians * input.order;
    return {
      ...projectile(`clockhead-${input.sequence}-fan-${index}`, rotate(direction, offset), geometry),
      delayMs: index * input.staggerMs,
      ageMs: 0,
    };
  });
}

/** An Aimed Bolt that will stop partway and hang before it resumes. */
export function spawnHangingBolt(input: {
  player: ColosseumPoint;
  sequence: number;
  hangAtMs: number;
  hangForMs: number;
  resumeSpeed: number;
  geometry?: Partial<CombatGeometry>;
}): ColosseumProjectile {
  const geometry = geometryWith(input.geometry);
  const direction = normalise(
    input.player.x - geometry.origin.x,
    input.player.y - geometry.origin.y
  );
  return {
    ...projectile(`clockhead-${input.sequence}-bolt`, direction, geometry),
    ageMs: 0,
    hang: { atMs: input.hangAtMs, forMs: input.hangForMs, resumeSpeed: input.resumeSpeed },
  };
}

export type ProjectileClockEvent = {
  kind: "launch" | "hang" | "resume";
  projectileId: string;
  x: number;
  y: number;
};

/**
 * Advances authored timing only: charge delays, the hang, and the resume. On
 * resume the bolt commits again to wherever `aimAt` is at that instant — a
 * second decision point, never continuous homing.
 */
export function advanceProjectileClocks(
  projectiles: readonly ColosseumProjectile[],
  deltaMs: number,
  aimAt: ColosseumPoint
): { projectiles: ColosseumProjectile[]; events: ProjectileClockEvent[] } {
  const events: ProjectileClockEvent[] = [];
  const next = projectiles.map(current => {
    const shot = { ...current };
    if ((shot.delayMs ?? 0) > 0) {
      shot.delayMs = Math.max(0, (shot.delayMs ?? 0) - deltaMs);
      if (shot.delayMs === 0) {
        events.push({ kind: "launch", projectileId: shot.id, x: shot.x, y: shot.y });
      }
      return shot;
    }
    if (shot.ageMs == null) return shot;
    const before = shot.ageMs;
    shot.ageMs = before + deltaMs;
    const hang = shot.hang;
    if (!hang) return shot;
    const hangEnds = hang.atMs + hang.forMs;
    if (!shot.hanging && before < hang.atMs && shot.ageMs >= hang.atMs) {
      shot.hanging = true;
      events.push({ kind: "hang", projectileId: shot.id, x: shot.x, y: shot.y });
    }
    if (shot.hanging && shot.ageMs >= hangEnds) {
      shot.hanging = false;
      const direction = normalise(aimAt.x - shot.x, aimAt.y - shot.y);
      shot.vx = direction.x * hang.resumeSpeed;
      shot.vy = direction.y * hang.resumeSpeed;
      shot.hang = undefined;
      events.push({ kind: "resume", projectileId: shot.id, x: shot.x, y: shot.y });
    }
    return shot;
  });
  return { projectiles: next, events };
}

/** Is the bolt still charging inside the clock face? */
export function isCharging(shot: ColosseumProjectile): boolean {
  return (shot.delayMs ?? 0) > 0;
}

function shieldCentre(player: ColosseumPoint, geometry: CombatGeometry): ColosseumPoint {
  const towardBoss = normalise(
    geometry.origin.x - player.x,
    geometry.origin.y - player.y
  );
  return {
    x: player.x + towardBoss.x * geometry.shieldOffset,
    y: player.y + towardBoss.y * geometry.shieldOffset,
  };
}

function pointDistance(a: ColosseumPoint, b: ColosseumPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * A shield raised toward Clockhead only meets shots travelling toward it. A
 * Borrowed Minute sends bolts back the other way; those arrive from behind.
 */
export function isFrontal(
  shot: ColosseumProjectile,
  player: ColosseumPoint,
  origin: ColosseumPoint
): boolean {
  const towardPlayer = normalise(player.x - origin.x, player.y - origin.y);
  return shot.vx * towardPlayer.x + shot.vy * towardPlayer.y > 0;
}

export function stepColosseumProjectiles(
  projectiles: readonly ColosseumProjectile[],
  deltaSeconds: number,
  player: ColosseumPoint,
  shieldTaken: boolean,
  playerInvulnerable: boolean,
  geometryOverrides?: Partial<CombatGeometry>
): {
  projectiles: ColosseumProjectile[];
  collisions: ColosseumProjectileCollision[];
} {
  const geometry = geometryWith(geometryOverrides);
  const next: ColosseumProjectile[] = [];
  const collisions: ColosseumProjectileCollision[] = [];
  const guard = shieldCentre(player, geometry);
  const { bounds } = geometry;

  for (const current of projectiles) {
    if (isCharging(current)) {
      next.push(current);
      continue;
    }
    const stepped = current.hanging
      ? { ...current }
      : {
          ...current,
          x: current.x + current.vx * deltaSeconds,
          y: current.y + current.vy * deltaSeconds,
        };

    if (
      stepped.x < bounds.minX ||
      stepped.x > bounds.maxX ||
      stepped.y < bounds.minY ||
      stepped.y > bounds.maxY
    ) {
      continue;
    }

    if (
      shieldTaken &&
      isFrontal(stepped, player, geometry.origin) &&
      pointDistance(stepped, guard) <= geometry.shieldRadius
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
      pointDistance(stepped, player) <= geometry.playerRadius
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

/** Shortest distance from a point to the segment a→b. */
export function distanceToSegment(
  point: ColosseumPoint,
  a: ColosseumPoint,
  b: ColosseumPoint
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby || 1;
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSq)
  );
  return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t));
}

/** Tip of the Second Hand at `angleDegrees` (0 = east, 90 = straight down). */
export function secondHandTip(
  origin: ColosseumPoint,
  angleDegrees: number,
  length: number
): ColosseumPoint {
  const radians = (angleDegrees * Math.PI) / 180;
  return {
    x: origin.x + Math.cos(radians) * length,
    y: origin.y + Math.sin(radians) * length,
  };
}

/**
 * The Second Hand is a blade, not a cone: its danger is a constant width
 * along its whole length, so standing far away never makes it wider.
 */
export function secondHandHits(input: {
  origin: ColosseumPoint;
  angleDegrees: number;
  length: number;
  halfWidth: number;
  target: ColosseumPoint;
  targetRadius: number;
}): boolean {
  const tip = secondHandTip(input.origin, input.angleDegrees, input.length);
  return (
    distanceToSegment(input.target, input.origin, tip) <=
    input.halfWidth + input.targetRadius
  );
}

export function movementFacing(input: ColosseumPoint): "front" | "back" | "left" | "right" {
  if (Math.abs(input.x) > Math.abs(input.y)) return input.x < 0 ? "left" : "right";
  return input.y < 0 ? "back" : "front";
}

export function perspectiveScale(y: number): number {
  const progress = Math.max(0, Math.min(1, (y - 34) / (86 - 34)));
  return 0.84 + progress * 0.28;
}
