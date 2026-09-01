/**
 * Guardian boss engine.
 *
 * Pure, deterministic, no database, no fetch, no business service. The arcade
 * already proved this boundary: if the module cannot import a store, it cannot
 * write a customer. Guardian combat unlocks from derived territory readiness
 * and records nothing. Persistence of defeat is the caller's job, and the
 * caller must classify it as game_projection.
 *
 * Pre-ready play is allowed: notice, taunt, harmless bombs. Permanent clear is
 * refused until confrontationReady is true.
 */

import type { GuardianAttackFamily, GuardianId } from "./goldlineGuardians";
import { guardianById } from "./goldlineGuardians";

export const GUARDIAN_PHASES = [
  "idle",
  "notice",
  "taunt",
  "telegraph",
  "attack",
  "recover",
  "stunned",
  "hurt",
  "enraged",
  "defeated",
  "player_hit",
  "retry",
] as const;
export type GuardianPhase = (typeof GUARDIAN_PHASES)[number];

export type ArenaVec = { x: number; y: number };

export type GuardianProjectile = {
  id: string;
  family: GuardianAttackFamily;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  telegraphMs: number;
  liveMs: number;
  impactAtX: number;
  impactAtY: number;
  harmless: boolean;
  fused: boolean;
  huge: boolean;
  fizzled: boolean;
};

export type GuardianWorld = {
  guardianId: GuardianId;
  phase: GuardianPhase;
  health: number;
  maxHealth: number;
  playerHealth: number;
  playerMaxHealth: number;
  player: ArenaVec;
  playerVx: number;
  playerVy: number;
  facing: number;
  noticed: boolean;
  confrontationReady: boolean;
  attackIndex: number;
  phaseMs: number;
  invulnMs: number;
  projectiles: GuardianProjectile[];
  lastTell: string;
  lastHitKind: "none" | "player" | "guardian";
  defeated: boolean;
  retryAvailable: boolean;
  seed: number;
};

export const EMPTY_GUARDIAN_PLAYER: ArenaVec = { x: 50, y: 78 };

export const GUARDIAN_TUNING = {
  maxHealth: 3,
  playerMaxHealth: 3,
  telegraphMs: 720,
  attackMs: 640,
  recoverMs: 420,
  hurtMs: 380,
  playerHitMs: 360,
  retryMs: 500,
  noticeMs: 900,
  tauntMs: 1100,
  playerSpeed: 0.058,
  dodgeBoost: 1.7,
  projectileRadius: 4.2,
  playerRadius: 3.4,
  counterWindowMs: 720,
  arenaMinX: 8,
  arenaMaxX: 92,
  arenaMinY: 42,
  arenaMaxY: 90,
} as const;

export type GuardianEvent =
  | { type: "enter"; guardianId: GuardianId; confrontationReady: boolean; seed?: number }
  | { type: "notice" }
  | { type: "poke" }
  | { type: "ready"; confrontationReady: boolean }
  | { type: "move"; x: number; y: number }
  | { type: "dodge" }
  | { type: "counter" }
  | { type: "tick"; deltaMs: number }
  | { type: "retry" }
  | { type: "exit" };

let projectileSeq = 0;

function nextProjectileId(seed: number): string {
  projectileSeq += 1;
  return `gp-${seed}-${projectileSeq}`;
}

export function createGuardianWorld(input: {
  guardianId: GuardianId;
  confrontationReady: boolean;
  seed?: number;
}): GuardianWorld {
  projectileSeq = 0;
  const definition = guardianById(input.guardianId);
  return {
    guardianId: definition.id,
    phase: "idle",
    health: GUARDIAN_TUNING.maxHealth,
    maxHealth: GUARDIAN_TUNING.maxHealth,
    playerHealth: GUARDIAN_TUNING.playerMaxHealth,
    playerMaxHealth: GUARDIAN_TUNING.playerMaxHealth,
    player: { ...EMPTY_GUARDIAN_PLAYER },
    playerVx: 0,
    playerVy: 0,
    facing: 0,
    noticed: false,
    confrontationReady: input.confrontationReady,
    attackIndex: 0,
    phaseMs: 0,
    invulnMs: 0,
    projectiles: [],
    lastTell: definition.attackGrammar,
    lastHitKind: "none",
    defeated: false,
    retryAvailable: false,
    seed: input.seed ?? stableSeed(definition.id),
  };
}

function stableSeed(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rumble(seed: number, salt: number): number {
  const x = Math.sin(seed * 0.001 + salt * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function tellFor(family: GuardianAttackFamily, guardianId: GuardianId): string {
  if (family === "bomb_arc") {
    if (guardianId === "thunder_king") return "Thundercloud bomb — gold fuse lighting";
    if (guardianId === "drizzle_detective") return "Raindrop clue falling";
    return "Arcing cloud bomb";
  }
  if (family === "gust_shockwave") {
    if (guardianId === "cloud_duchess") return "Parasol cyclone — wind from the right";
    if (guardianId === "sleepy_one_eye") return "Snore shockwave";
    if (guardianId === "gust_jester") return "Laughing gust trap";
    return "Gust shockwave";
  }
  if (guardianId === "tiny_emperor") return "Command hand slam — shadow on the street";
  return "Hand slam — delayed impact";
}

function spawnAttack(world: GuardianWorld, family: GuardianAttackFamily): GuardianProjectile {
  const harmless = !world.confrontationReady;
  const roll = rumble(world.seed, world.attackIndex + world.phaseMs);
  const huge = world.guardianId === "thunder_king" && roll > 0.86;
  const fizzled = world.guardianId === "thunder_king" && roll < 0.08;
  const impactAtX = clamp(
    world.player.x + (roll - 0.5) * 18,
    GUARDIAN_TUNING.arenaMinX,
    GUARDIAN_TUNING.arenaMaxX
  );
  const impactAtY = clamp(
    world.player.y + (rumble(world.seed, world.attackIndex + 9) - 0.35) * 10,
    GUARDIAN_TUNING.arenaMinY,
    GUARDIAN_TUNING.arenaMaxY
  );
  const radius = huge ? GUARDIAN_TUNING.projectileRadius * 1.8 : GUARDIAN_TUNING.projectileRadius;
  return {
    id: nextProjectileId(world.seed),
    family,
    x: 50,
    y: 22,
    vx: (impactAtX - 50) / 18,
    vy: (impactAtY - 22) / 18,
    radius,
    telegraphMs: family === "hand_slam" ? 900 : GUARDIAN_TUNING.telegraphMs,
    liveMs: 0,
    impactAtX,
    impactAtY,
    harmless: harmless || fizzled,
    fused: family === "bomb_arc",
    huge,
    fizzled,
  };
}

function nextFamily(world: GuardianWorld): GuardianAttackFamily {
  const sequence = guardianById(world.guardianId).attackSequence;
  return sequence[world.attackIndex % sequence.length]!;
}

function hitPlayer(world: GuardianWorld, projectile: GuardianProjectile): GuardianWorld {
  if (world.invulnMs > 0 || world.defeated) return world;
  if (projectile.harmless) {
    return {
      ...world,
      phase: "taunt",
      phaseMs: 0,
      lastHitKind: "player",
      lastTell: "Harmless prank — no real damage",
    };
  }
  const playerHealth = Math.max(0, world.playerHealth - 1);
  return {
    ...world,
    playerHealth,
    phase: playerHealth <= 0 ? "retry" : "player_hit",
    phaseMs: 0,
    invulnMs: 700,
    lastHitKind: "player",
    retryAvailable: playerHealth <= 0,
    projectiles: [],
  };
}

function hitGuardian(world: GuardianWorld): GuardianWorld {
  if (!world.confrontationReady) {
    return {
      ...world,
      phase: "taunt",
      phaseMs: 0,
      lastTell: "The guardian is playing. The street is not ready.",
      projectiles: [],
    };
  }
  const health = Math.max(0, world.health - 1);
  const defeated = health <= 0;
  return {
    ...world,
    health,
    defeated,
    phase: defeated ? "defeated" : health === 1 ? "enraged" : "hurt",
    phaseMs: 0,
    lastHitKind: "guardian",
    projectiles: [],
    attackIndex: world.attackIndex + 1,
  };
}

function integratePlayer(world: GuardianWorld, deltaMs: number): GuardianWorld {
  const nextX = clamp(
    world.player.x + world.playerVx * GUARDIAN_TUNING.playerSpeed * deltaMs,
    GUARDIAN_TUNING.arenaMinX,
    GUARDIAN_TUNING.arenaMaxX
  );
  const nextY = clamp(
    world.player.y + world.playerVy * GUARDIAN_TUNING.playerSpeed * deltaMs,
    GUARDIAN_TUNING.arenaMinY,
    GUARDIAN_TUNING.arenaMaxY
  );
  return {
    ...world,
    player: { x: nextX, y: nextY },
    facing: world.playerVx !== 0 ? Math.sign(world.playerVx) : world.facing,
  };
}

function stepProjectiles(world: GuardianWorld, deltaMs: number): GuardianWorld {
  const live: GuardianProjectile[] = [];
  let next = world;
  for (const projectile of world.projectiles) {
    const liveMs = projectile.liveMs + deltaMs;
    const telegraphing = liveMs < projectile.telegraphMs;
    const x = telegraphing
      ? projectile.x
      : projectile.x + projectile.vx * (deltaMs / 16);
    const y = telegraphing
      ? projectile.y
      : projectile.y + projectile.vy * (deltaMs / 16);
    const moved = { ...projectile, x, y, liveMs };
    if (!telegraphing) {
      const dx = x - world.player.x;
      const dy = y - world.player.y;
      if (Math.hypot(dx, dy) < projectile.radius + GUARDIAN_TUNING.playerRadius) {
        next = hitPlayer({ ...next, projectiles: live }, moved);
        return { ...next, projectiles: [] };
      }
    }
    if (liveMs < projectile.telegraphMs + 1400 && y < 110) live.push(moved);
  }
  return { ...next, projectiles: live };
}

function beginAttack(world: GuardianWorld): GuardianWorld {
  if (world.defeated) return world;
  const family = nextFamily(world);
  const projectile = spawnAttack(world, family);
  return {
    ...world,
    phase: "telegraph",
    phaseMs: 0,
    lastTell: tellFor(family, world.guardianId),
    lastHitKind: "none",
    projectiles: [...world.projectiles.slice(-2), projectile],
    attackIndex: world.attackIndex + 1,
  };
}

export function guardianReducer(world: GuardianWorld, event: GuardianEvent): GuardianWorld {
  switch (event.type) {
    case "exit":
      return createGuardianWorld({
        guardianId: world.guardianId,
        confrontationReady: world.confrontationReady,
        seed: world.seed,
      });
    case "enter":
      return createGuardianWorld({
        guardianId: event.guardianId,
        confrontationReady: event.confrontationReady,
        seed: event.seed,
      });
    case "ready":
      return { ...world, confrontationReady: event.confrontationReady };
    case "notice":
      if (world.defeated) return world;
      return {
        ...world,
        noticed: true,
        phase: world.phase === "idle" ? "notice" : world.phase,
        phaseMs: world.phase === "idle" ? 0 : world.phaseMs,
      };
    case "poke":
      if (world.defeated) return world;
      return world.phase === "idle" || world.phase === "notice" || world.phase === "taunt"
        ? beginAttack({ ...world, noticed: true })
        : world;
    case "move":
      return { ...world, playerVx: clamp(event.x, -1, 1), playerVy: clamp(event.y, -1, 1) };
    case "dodge":
      return {
        ...world,
        playerVx: world.playerVx * GUARDIAN_TUNING.dodgeBoost,
        playerVy: world.playerVy * GUARDIAN_TUNING.dodgeBoost,
        invulnMs: Math.max(world.invulnMs, 180),
      };
    case "counter": {
      if (world.defeated) return world;
      const windowed = world.projectiles.find(
        projectile => projectile.liveMs <= projectile.telegraphMs && projectile.liveMs >= 80
      );
      if (!windowed) return world;
      return hitGuardian(world);
    }
    case "retry":
      if (!world.retryAvailable && world.phase !== "retry") return world;
      return {
        ...createGuardianWorld({
          guardianId: world.guardianId,
          confrontationReady: world.confrontationReady,
          seed: world.seed + 1,
        }),
        noticed: true,
        phase: "idle",
      };
    case "tick": {
      if (world.defeated && world.phase === "defeated") {
        return { ...world, projectiles: [], phaseMs: world.phaseMs + event.deltaMs };
      }
      let next = integratePlayer(world, event.deltaMs);
      next = {
        ...next,
        phaseMs: next.phaseMs + event.deltaMs,
        invulnMs: Math.max(0, next.invulnMs - event.deltaMs),
      };
      next = stepProjectiles(next, event.deltaMs);
      if (next.phase === "notice" && next.phaseMs >= GUARDIAN_TUNING.noticeMs) {
        return beginAttack({ ...next, phase: "taunt", phaseMs: 0 });
      }
      if (next.phase === "idle" && next.noticed && next.phaseMs >= 1800) {
        return beginAttack(next);
      }
      if (next.phase === "taunt" && next.phaseMs >= GUARDIAN_TUNING.tauntMs) {
        return beginAttack(next);
      }
      if (next.phase === "telegraph" && next.phaseMs >= GUARDIAN_TUNING.telegraphMs) {
        return { ...next, phase: "attack", phaseMs: 0 };
      }
      if (next.phase === "attack" && next.phaseMs >= GUARDIAN_TUNING.attackMs) {
        return { ...next, phase: "recover", phaseMs: 0 };
      }
      if (next.phase === "recover" && next.phaseMs >= GUARDIAN_TUNING.recoverMs) {
        return next.confrontationReady && next.health === 1
          ? beginAttack({ ...next, phase: "enraged" })
          : beginAttack({ ...next, phase: "idle" });
      }
      if (next.phase === "hurt" && next.phaseMs >= GUARDIAN_TUNING.hurtMs) {
        return beginAttack({ ...next, phase: "enraged" });
      }
      if (next.phase === "enraged" && next.phaseMs >= 240) {
        return beginAttack(next);
      }
      if (next.phase === "player_hit" && next.phaseMs >= GUARDIAN_TUNING.playerHitMs) {
        return { ...next, phase: "idle", phaseMs: 0 };
      }
      if (next.phase === "retry" && next.phaseMs >= GUARDIAN_TUNING.retryMs) {
        return { ...next, retryAvailable: true };
      }
      return next;
    }
    default:
      return world;
  }
}

export function guardianIsSettled(world: GuardianWorld): boolean {
  return (
    world.phase === "idle" &&
    world.projectiles.length === 0 &&
    world.playerVx === 0 &&
    world.playerVy === 0 &&
    !world.noticed
  );
}

export function canPermanentlyClear(world: GuardianWorld): boolean {
  return world.confrontationReady && world.defeated && world.health <= 0;
}
