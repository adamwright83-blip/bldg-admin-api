/**
 * Trailblazer in the Colosseum: one movement and defence model shared by the
 * search arena and the Clockhead finale, so the arena genuinely teaches the
 * fight it leads to.
 *
 * Pure and deterministic. Nothing here knows the real campaign exists.
 *
 * Canon this implements (docs/goldline/WORLD_BIBLE.md):
 *   §23 LINEBLADE — a slash is a luminous edge through space, not a sword.
 *   §24 Shield — perfect blocks store force; stored force releases as RETURN.
 */
import {
  isCharging,
  movementFacing,
  stepColosseumProjectiles,
  type ColosseumProjectile,
  type CombatGeometry,
} from "./colosseumCombat";
import {
  STAGE_HEIGHT,
  slideWithinFloor,
  stageDepthScale,
  stageDistance,
  torsoPoint,
  type StagePoint,
} from "./colosseumStage";

export type Facing = "front" | "back" | "left" | "right";

export type AvatarInput = {
  /** Stick vector, each axis -1..1. */
  x: number;
  y: number;
  /** Held, not pressed: the shield stays up while this is true. */
  guard?: boolean;
  /** One-shot presses. Buffered briefly so a press during hit-stop is kept. */
  dodge?: boolean;
  strike?: boolean;
  returnWave?: boolean;
};

export type Avatar = {
  feet: StagePoint;
  velocity: StagePoint;
  facing: Facing;
  moving: boolean;
  guardPips: number;
  maxGuardPips: number;
  hurtMs: number;
  dodgeMs: number;
  dodgeCooldownMs: number;
  dodgeDir: StagePoint;
  guarding: boolean;
  guardHeldMs: number;
  /** Stored by perfect blocks, released as RETURN. */
  force: number;
  strikeRecoveryMs: number;
  /** Visual only: which slash of a combo is playing. */
  slashMs: number;
  slashCombo: number;
  strikeBufferMs: number;
  dodgeBufferMs: number;
  returnBufferMs: number;
};

export const AVATAR_TUNING = {
  walkSpeed: 34,
  guardWalkSpeed: 15,
  acceleration: 260,
  deceleration: 380,
  dodgeMs: 300,
  dodgeSpeed: 92,
  dodgeCooldownMs: 820,
  hurtInvulnerableMs: 900,
  /** Raise the shield this close to impact and the block is perfect. */
  perfectBlockMs: 190,
  forceMax: 3,
  strikeRecoveryMs: 280,
  finisherRecoveryMs: 460,
  slashVisualMs: 220,
  inputBufferMs: 160,
  /** A slash that starts with a bolt this close to her torso cuts it down. */
  parryReach: 6,
  maxGuardPips: 3,
} as const;

export type AvatarEvent =
  | { type: "dodge"; at: StagePoint }
  | { type: "block"; at: StagePoint; perfect: boolean; force: number }
  | { type: "hurt"; at: StagePoint; source: "bolt" | "sweep" | "deadline" }
  | { type: "parry"; at: StagePoint };

export function createAvatar(at: StagePoint, guardPips: number = AVATAR_TUNING.maxGuardPips): Avatar {
  return {
    feet: { ...at },
    velocity: { x: 0, y: 0 },
    facing: "back",
    moving: false,
    guardPips,
    maxGuardPips: Math.max(AVATAR_TUNING.maxGuardPips, guardPips),
    hurtMs: 0,
    dodgeMs: 0,
    dodgeCooldownMs: 0,
    dodgeDir: { x: 0, y: 1 },
    guarding: false,
    guardHeldMs: 0,
    force: 0,
    strikeRecoveryMs: 0,
    slashMs: 0,
    slashCombo: 0,
    strikeBufferMs: 0,
    dodgeBufferMs: 0,
    returnBufferMs: 0,
  };
}

export function cloneAvatar(avatar: Avatar): Avatar {
  return {
    ...avatar,
    feet: { ...avatar.feet },
    velocity: { ...avatar.velocity },
    dodgeDir: { ...avatar.dodgeDir },
  };
}

/** Record one-shot presses into short buffers. */
export function bufferAvatarPresses(avatar: Avatar, input: AvatarInput) {
  if (input.strike) avatar.strikeBufferMs = AVATAR_TUNING.inputBufferMs;
  if (input.dodge) avatar.dodgeBufferMs = AVATAR_TUNING.inputBufferMs;
  if (input.returnWave) avatar.returnBufferMs = AVATAR_TUNING.inputBufferMs;
}

export function stepAvatarTimers(avatar: Avatar, ms: number) {
  avatar.hurtMs = Math.max(0, avatar.hurtMs - ms);
  avatar.dodgeMs = Math.max(0, avatar.dodgeMs - ms);
  avatar.dodgeCooldownMs = Math.max(0, avatar.dodgeCooldownMs - ms);
  avatar.strikeRecoveryMs = Math.max(0, avatar.strikeRecoveryMs - ms);
  avatar.slashMs = Math.max(0, avatar.slashMs - ms);
  avatar.strikeBufferMs = Math.max(0, avatar.strikeBufferMs - ms);
  avatar.dodgeBufferMs = Math.max(0, avatar.dodgeBufferMs - ms);
  avatar.returnBufferMs = Math.max(0, avatar.returnBufferMs - ms);
}

export function avatarTorso(avatar: Avatar): StagePoint {
  return torsoPoint(avatar.feet);
}

export function avatarInvulnerable(avatar: Avatar): boolean {
  return avatar.dodgeMs > 0 || avatar.hurtMs > 0;
}

function approach(value: number, target: number, maxDelta: number): number {
  if (value < target) return Math.min(target, value + maxDelta);
  if (value > target) return Math.max(target, value - maxDelta);
  return value;
}

/**
 * Guard, dodge and locomotion for one tick. `locked` freezes her in place
 * (a door opening, a recoil yank); `canGuard` is false until she has a shield.
 */
export function stepAvatarMotion(
  avatar: Avatar,
  input: AvatarInput,
  ms: number,
  options: { canGuard: boolean; locked?: boolean; faceToward?: StagePoint }
): AvatarEvent[] {
  const events: AvatarEvent[] = [];
  const dt = ms / 1000;

  // The shield cannot be raised mid-dodge or mid-swing; otherwise spamming
  // either would keep re-opening the perfect-block window for free.
  const wantsGuard =
    options.canGuard &&
    !options.locked &&
    input.guard === true &&
    avatar.dodgeMs === 0 &&
    avatar.strikeRecoveryMs === 0;
  if (wantsGuard) {
    if (!avatar.guarding) {
      avatar.guarding = true;
      avatar.guardHeldMs = 0;
    } else {
      avatar.guardHeldMs += ms;
    }
  } else {
    avatar.guarding = false;
    avatar.guardHeldMs = 0;
  }

  if (options.locked) {
    avatar.velocity = { x: 0, y: 0 };
    avatar.moving = false;
    avatar.dodgeBufferMs = 0;
    return events;
  }

  const stick = { x: input.x || 0, y: input.y || 0 };
  const stickLength = Math.hypot(stick.x, stick.y);
  const unit = stickLength > 1 ? { x: stick.x / stickLength, y: stick.y / stickLength } : stick;

  if (
    avatar.dodgeBufferMs > 0 &&
    avatar.dodgeCooldownMs === 0 &&
    avatar.dodgeMs === 0
  ) {
    avatar.dodgeBufferMs = 0;
    avatar.dodgeMs = AVATAR_TUNING.dodgeMs;
    avatar.dodgeCooldownMs = AVATAR_TUNING.dodgeCooldownMs;
    const magnitude = Math.hypot(unit.x, unit.y);
    avatar.dodgeDir =
      magnitude > 0.2 ? { x: unit.x / magnitude, y: unit.y / magnitude } : { x: 0, y: 1 };
    avatar.guarding = false;
    avatar.guardHeldMs = 0;
    events.push({ type: "dodge", at: { ...avatar.feet } });
  }

  if (avatar.dodgeMs > 0) {
    avatar.velocity = {
      x: avatar.dodgeDir.x * AVATAR_TUNING.dodgeSpeed,
      y: avatar.dodgeDir.y * AVATAR_TUNING.dodgeSpeed,
    };
  } else {
    const slowed = avatar.guarding
      ? AVATAR_TUNING.guardWalkSpeed
      : avatar.strikeRecoveryMs > 0
        ? AVATAR_TUNING.walkSpeed * 0.55
        : AVATAR_TUNING.walkSpeed;
    // Depth: the far end of the floor is further away, so the same stick
    // covers less of the painting there.
    const depth = 0.72 + 0.28 * stageDepthScale(avatar.feet.y);
    const target = { x: unit.x * slowed * depth, y: unit.y * slowed * depth };
    const rate =
      Math.hypot(unit.x, unit.y) > 0.05
        ? AVATAR_TUNING.acceleration
        : AVATAR_TUNING.deceleration;
    avatar.velocity = {
      x: approach(avatar.velocity.x, target.x, rate * dt),
      y: approach(avatar.velocity.y, target.y, rate * dt),
    };
  }

  const speed = Math.hypot(avatar.velocity.x, avatar.velocity.y);
  if (speed > 0.05) {
    avatar.feet = slideWithinFloor(avatar.feet, {
      x: avatar.feet.x + avatar.velocity.x * dt,
      y: avatar.feet.y + avatar.velocity.y * dt,
    });
  }
  avatar.moving = speed > 1.4 && avatar.dodgeMs === 0;

  if (avatar.guarding || avatar.strikeRecoveryMs > 0) {
    avatar.facing = "back";
  } else if (Math.hypot(unit.x, unit.y) > 0.12) {
    avatar.facing = movementFacing(unit);
  }
  return events;
}

/** Collision sizes grow as she comes toward the camera. */
export function avatarGeometry(avatar: Avatar, origin: StagePoint): Partial<CombatGeometry> {
  const depth = stageDepthScale(avatar.feet.y);
  return {
    origin,
    playerRadius: 2.1 + 1.7 * depth,
    shieldRadius: 3.3 + 1.9 * depth,
    shieldOffset: 2.4 + 1.6 * depth,
    bounds: { minX: -25, maxX: 125, minY: -25, maxY: STAGE_HEIGHT + 35 },
  };
}

/**
 * Moves every bolt one tick and resolves what it touched. A shield collision
 * is a block; if the shield went up within `perfectBlockMs` of the impact it
 * is a perfect block and stores one unit of force.
 */
export function resolveBolts(
  avatar: Avatar,
  projectiles: readonly ColosseumProjectile[],
  ms: number,
  origin: StagePoint,
  extraInvulnerable: boolean
): { projectiles: ColosseumProjectile[]; events: AvatarEvent[]; hits: StagePoint[] } {
  const events: AvatarEvent[] = [];
  const hits: StagePoint[] = [];
  const torso = avatarTorso(avatar);
  const stepped = stepColosseumProjectiles(
    projectiles,
    ms / 1000,
    torso,
    avatar.guarding,
    extraInvulnerable || avatarInvulnerable(avatar),
    avatarGeometry(avatar, origin)
  );
  for (const collision of stepped.collisions) {
    const at = { x: collision.x, y: collision.y };
    if (collision.kind === "shield") {
      const perfect = avatar.guardHeldMs <= AVATAR_TUNING.perfectBlockMs;
      if (perfect) avatar.force = Math.min(AVATAR_TUNING.forceMax, avatar.force + 1);
      else knockBack(avatar, origin, 1.6);
      events.push({ type: "block", at, perfect, force: avatar.force });
    } else {
      hits.push(at);
    }
  }
  return { projectiles: stepped.projectiles, events, hits };
}

export function knockBack(avatar: Avatar, from: StagePoint, distance: number) {
  const dx = avatar.feet.x - from.x;
  const dy = avatar.feet.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  avatar.feet = slideWithinFloor(avatar.feet, {
    x: avatar.feet.x + (dx / length) * distance,
    y: avatar.feet.y + (dy / length) * distance,
  });
}

/**
 * Take one pip of guard. Returns false (and changes nothing) while dodging or
 * still flinching from the last hit, so one mistake never costs two pips.
 */
export function hurtAvatar(avatar: Avatar): boolean {
  if (avatarInvulnerable(avatar)) return false;
  avatar.guardPips = Math.max(0, avatar.guardPips - 1);
  avatar.hurtMs = AVATAR_TUNING.hurtInvulnerableMs;
  avatar.guarding = false;
  avatar.guardHeldMs = 0;
  return true;
}

/** Starts a Lineblade slash if she is ready to swing; reports what it cut. */
export function trySlash(
  avatar: Avatar,
  projectiles: readonly ColosseumProjectile[]
): { swung: boolean; parried: ColosseumProjectile[]; remaining: ColosseumProjectile[] } {
  if (
    avatar.strikeBufferMs === 0 ||
    avatar.strikeRecoveryMs > 0 ||
    avatar.dodgeMs > 0
  ) {
    return { swung: false, parried: [], remaining: [...projectiles] };
  }
  avatar.strikeBufferMs = 0;
  avatar.guarding = false;
  avatar.guardHeldMs = 0;
  avatar.strikeRecoveryMs = AVATAR_TUNING.strikeRecoveryMs;
  avatar.slashMs = AVATAR_TUNING.slashVisualMs;
  avatar.facing = "back";
  const torso = avatarTorso(avatar);
  const parried: ColosseumProjectile[] = [];
  const remaining: ColosseumProjectile[] = [];
  for (const shot of projectiles) {
    if (!isCharging(shot) && stageDistance(shot, torso) <= AVATAR_TUNING.parryReach) {
      parried.push(shot);
    } else {
      remaining.push(shot);
    }
  }
  return { swung: true, parried, remaining };
}

/** Consume stored force for a RETURN if it is full and requested. */
export function tryReturn(avatar: Avatar): boolean {
  if (avatar.returnBufferMs === 0 || avatar.force < AVATAR_TUNING.forceMax) return false;
  avatar.returnBufferMs = 0;
  avatar.force = 0;
  avatar.guarding = false;
  avatar.guardHeldMs = 0;
  return true;
}
