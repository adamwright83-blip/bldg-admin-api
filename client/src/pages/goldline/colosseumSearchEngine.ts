/**
 * The Colosseum before the real hunt is finished: Clockhead is only a
 * projection here. The arena is a place to learn the fight — shield, perfect
 * block, dodge, Lineblade — and to find out, door by door, that he is not
 * inside it.
 *
 * TRUTH BOUNDARY
 *
 * This simulation cannot advance the real campaign and cannot see it. It has
 * no notion of targets, visits or outcomes. How far the real hunt has got is
 * projected onto Clockhead's seals by the renderer from the authoritative
 * campaign, read-only; nothing here can break a seal, reveal him, or unlock
 * the finale. Checking doors, blocking bolts and RETURN are play, not proof.
 */
import {
  advanceProjectileClocks,
  secondHandHits,
  spawnHangingBolt,
  spawnStaggeredFan,
  type ColosseumProjectile,
} from "./colosseumCombat";
import {
  avatarGeometry,
  avatarInvulnerable,
  avatarTorso,
  bufferAvatarPresses,
  cloneAvatar,
  createAvatar,
  hurtAvatar,
  resolveBolts,
  stepAvatarMotion,
  stepAvatarTimers,
  tryReturn,
  trySlash,
  type Avatar,
  type AvatarEvent,
  type AvatarInput,
} from "./colosseumAvatar";
import {
  ARENA_ANCHOR,
  CLOCKHEAD_CENTER,
  COLOSSEUM_DOORS,
  SHIELD_REST,
  doorAt,
  slideWithinFloor,
  stageDistance,
  type ColosseumDoor,
  type ColosseumDoorId,
  type StagePoint,
} from "./colosseumStage";

export type SearchPattern = "aimed" | "fan" | "sweep";

export type SearchStage =
  | "calm"
  | "rest"
  | "tell"
  | "attack"
  | "door"
  | "disrupted"
  | "recoil";

export type SearchInput = AvatarInput & { takeShield?: boolean };

export type SearchEvent =
  | AvatarEvent
  | { type: "shield_taken" }
  | { type: "tell"; pattern: SearchPattern }
  | { type: "launch"; pattern: SearchPattern }
  | { type: "hang"; at: StagePoint }
  | { type: "resume"; at: StagePoint }
  | { type: "sweep"; direction: 1 | -1 }
  | { type: "door_open"; door: ColosseumDoorId }
  | { type: "door_empty"; door: ColosseumDoorId }
  | { type: "door_close"; door: ColosseumDoorId }
  | { type: "slash"; at: StagePoint }
  | { type: "return"; at: StagePoint; cleared: number }
  | { type: "recoil_start"; at: StagePoint }
  | { type: "recoil_land"; at: StagePoint };

export type SearchSweep = {
  direction: 1 | -1;
  angle: number;
  live: boolean;
  hit: boolean;
};

export type SearchArena = {
  avatar: Avatar;
  shieldTaken: boolean;
  stage: SearchStage;
  pattern: SearchPattern;
  patternIndex: number;
  clock: number;
  sequence: number;
  projectiles: ColosseumProjectile[];
  sweep: SearchSweep | null;
  door: { id: ColosseumDoorId; clock: number } | null;
  doorsChecked: ColosseumDoorId[];
  recoilFrom: StagePoint | null;
  freezeMs: number;
  events: SearchEvent[];
};

/** Guard, then move, then dodge: one rotation teaches every answer. */
export const SEARCH_PATTERNS: readonly SearchPattern[] = ["aimed", "fan", "sweep"];

export const SEARCH_TUNING = {
  /** Walk onto the shield to take it; the button appears a little further out. */
  shieldAutoTakeReach: 4.2,
  shieldPromptReach: 9,
  firstVolleyDelayMs: 900,
  restMs: 1150,
  tellMs: 950,
  boltSpeed: 58,
  hangAtMs: 300,
  hangForMs: 620,
  resumeSpeed: 92,
  fanCount: 3,
  fanSpread: 0.62,
  fanStaggerMs: 140,
  fanSpeed: 56,
  sweepMs: 1300,
  sweepFromDeg: 18,
  sweepToDeg: 162,
  secondHandLength: 150,
  secondHandHalfWidth: 2.4,
  door: {
    paintedMs: 2600,
    debatedMs: 2300,
    revealAtMs: 700,
    debatedRevealAtMs: 900,
    closeAtMs: 2050,
  },
  disruptedMs: 2800,
  recoil: { drainMs: 520, yankMs: 480, settleMs: 520 },
} as const;

export function createSearchArena(): SearchArena {
  return {
    avatar: createAvatar(ARENA_ANCHOR),
    shieldTaken: false,
    stage: "calm",
    pattern: SEARCH_PATTERNS[0]!,
    patternIndex: 0,
    clock: 0,
    sequence: 0,
    projectiles: [],
    sweep: null,
    door: null,
    doorsChecked: [],
    recoilFrom: null,
    freezeMs: 0,
    events: [],
  };
}

function attackMs(pattern: SearchPattern): number {
  if (pattern === "aimed") return SEARCH_TUNING.hangAtMs + SEARCH_TUNING.hangForMs + 1500;
  if (pattern === "fan") return SEARCH_TUNING.fanCount * SEARCH_TUNING.fanStaggerMs + 1500;
  return SEARCH_TUNING.sweepMs + 260;
}

function doorById(id: ColosseumDoorId): ColosseumDoor {
  return COLOSSEUM_DOORS.find(door => door.id === id)!;
}

function doorDurationMs(door: ColosseumDoor): number {
  return door.painted ? SEARCH_TUNING.door.paintedMs : SEARCH_TUNING.door.debatedMs;
}

function clearHazards(state: SearchArena) {
  state.projectiles = [];
  state.sweep = null;
}

function toRest(state: SearchArena) {
  state.stage = state.shieldTaken ? "rest" : "calm";
  state.clock = 0;
}

/** Step out of a door's trigger, toward the middle of the floor. */
function stepAwayFrom(state: SearchArena, door: ColosseumDoor) {
  const dx = SHIELD_REST.x - door.threshold.x;
  const dy = SHIELD_REST.y - door.threshold.y;
  const length = Math.hypot(dx, dy) || 1;
  const distance = door.radius + 2.6;
  state.avatar.feet = slideWithinFloor(state.avatar.feet, {
    x: door.threshold.x + (dx / length) * distance,
    y: door.threshold.y + (dy / length) * distance,
  });
  state.avatar.velocity = { x: 0, y: 0 };
}

function beginAttack(state: SearchArena) {
  state.stage = "attack";
  state.clock = 0;
  state.sequence += 1;
  const torso = avatarTorso(state.avatar);
  const geometry = { origin: CLOCKHEAD_CENTER };
  if (state.pattern === "aimed") {
    state.projectiles.push(
      spawnHangingBolt({
        player: torso,
        sequence: state.sequence,
        hangAtMs: SEARCH_TUNING.hangAtMs,
        hangForMs: SEARCH_TUNING.hangForMs,
        resumeSpeed: SEARCH_TUNING.resumeSpeed,
        geometry: { ...geometry, speed: SEARCH_TUNING.boltSpeed },
      })
    );
    state.events.push({ type: "launch", pattern: "aimed" });
  } else if (state.pattern === "fan") {
    state.projectiles.push(
      ...spawnStaggeredFan({
        player: torso,
        sequence: state.sequence,
        count: SEARCH_TUNING.fanCount,
        spreadRadians: SEARCH_TUNING.fanSpread,
        staggerMs: SEARCH_TUNING.fanStaggerMs,
        order: state.sequence % 2 === 0 ? 1 : -1,
        geometry: { ...geometry, speed: SEARCH_TUNING.fanSpeed },
      })
    );
    state.events.push({ type: "launch", pattern: "fan" });
  } else {
    const direction: 1 | -1 = state.sequence % 2 === 0 ? 1 : -1;
    state.sweep = {
      direction,
      angle: direction === 1 ? SEARCH_TUNING.sweepFromDeg : SEARCH_TUNING.sweepToDeg,
      live: true,
      hit: false,
    };
    state.events.push({ type: "sweep", direction });
  }
}

function hurt(state: SearchArena, at: StagePoint, source: "bolt" | "sweep") {
  if (!hurtAvatar(state.avatar)) return;
  state.freezeMs = Math.max(state.freezeMs, 90);
  state.events.push({ type: "hurt", at, source });
  if (state.avatar.guardPips <= 0) {
    state.stage = "recoil";
    state.clock = 0;
    state.recoilFrom = { ...state.avatar.feet };
    clearHazards(state);
    state.events.push({ type: "recoil_start", at: { ...state.avatar.feet } });
  }
}

function updateSweep(state: SearchArena) {
  const sweep = state.sweep;
  if (!sweep) return;
  const progress = Math.min(1, state.clock / SEARCH_TUNING.sweepMs);
  const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
  const from = sweep.direction === 1 ? SEARCH_TUNING.sweepFromDeg : SEARCH_TUNING.sweepToDeg;
  const to = sweep.direction === 1 ? SEARCH_TUNING.sweepToDeg : SEARCH_TUNING.sweepFromDeg;
  sweep.angle = from + (to - from) * eased;
  sweep.live = progress < 1;
  if (!sweep.live || sweep.hit || avatarInvulnerable(state.avatar)) return;
  const torso = avatarTorso(state.avatar);
  const radius = avatarGeometry(state.avatar, CLOCKHEAD_CENTER).playerRadius ?? 3;
  if (
    secondHandHits({
      origin: CLOCKHEAD_CENTER,
      angleDegrees: sweep.angle,
      length: SEARCH_TUNING.secondHandLength,
      halfWidth: SEARCH_TUNING.secondHandHalfWidth,
      target: torso,
      targetRadius: radius,
    })
  ) {
    sweep.hit = true;
    hurt(state, torso, "sweep");
  }
}

function updateDoor(state: SearchArena) {
  const active = state.door;
  if (!active) return;
  const door = doorById(active.id);
  const before = active.clock;
  active.clock = state.clock;
  const reveal = door.painted ? SEARCH_TUNING.door.revealAtMs : SEARCH_TUNING.door.debatedRevealAtMs;
  if (before < reveal && active.clock >= reveal) {
    state.events.push({ type: "door_empty", door: door.id });
  }
  if (door.painted && before < SEARCH_TUNING.door.closeAtMs && active.clock >= SEARCH_TUNING.door.closeAtMs) {
    state.events.push({ type: "door_close", door: door.id });
  }
  if (active.clock >= doorDurationMs(door)) {
    stepAwayFrom(state, door);
    state.door = null;
    toRest(state);
  }
}

function updateRecoil(state: SearchArena) {
  const { drainMs, yankMs, settleMs } = SEARCH_TUNING.recoil;
  const from = state.recoilFrom ?? ARENA_ANCHOR;
  if (state.clock < drainMs) return;
  if (state.clock < drainMs + yankMs) {
    const t = (state.clock - drainMs) / yankMs;
    const eased = t * t * t;
    state.avatar.feet = {
      x: from.x + (ARENA_ANCHOR.x - from.x) * eased,
      y: from.y + (ARENA_ANCHOR.y - from.y) * eased,
    };
    return;
  }
  if (state.recoilFrom) {
    state.avatar.feet = { ...ARENA_ANCHOR };
    state.recoilFrom = null;
    state.events.push({ type: "recoil_land", at: { ...ARENA_ANCHOR } });
  }
  if (state.clock >= drainMs + yankMs + settleMs) {
    state.avatar.guardPips = state.avatar.maxGuardPips;
    state.avatar.hurtMs = 1000;
    toRest(state);
  }
}

function stepOnce(state: SearchArena, ms: number, input: SearchInput) {
  if (state.freezeMs > 0) {
    state.freezeMs = Math.max(0, state.freezeMs - ms);
    return;
  }
  state.clock += ms;
  stepAvatarTimers(state.avatar, ms);

  const locked = state.stage === "door" || state.stage === "recoil";
  for (const event of stepAvatarMotion(state.avatar, input, ms, {
    canGuard: state.shieldTaken,
    locked,
  })) {
    state.events.push(event);
  }

  if (state.stage === "recoil") {
    updateRecoil(state);
    return;
  }
  if (state.stage === "door") {
    updateDoor(state);
    return;
  }

  // The shield: walk onto it, or press TAKE SHIELD once it is in reach.
  if (!state.shieldTaken) {
    const distance = stageDistance(state.avatar.feet, SHIELD_REST);
    if (
      distance <= SEARCH_TUNING.shieldAutoTakeReach ||
      (input.takeShield === true && distance <= SEARCH_TUNING.shieldPromptReach)
    ) {
      state.shieldTaken = true;
      state.stage = "rest";
      state.clock = SEARCH_TUNING.restMs - SEARCH_TUNING.firstVolleyDelayMs;
      state.events.push({ type: "shield_taken" });
    }
  }

  // A RETURN cannot hurt a projection. It can make it flicker out for a bit.
  if (state.shieldTaken && tryReturn(state.avatar)) {
    const cleared = state.projectiles.length;
    clearHazards(state);
    state.stage = "disrupted";
    state.clock = 0;
    state.freezeMs = 140;
    state.events.push({ type: "return", at: avatarTorso(state.avatar), cleared });
    return;
  }

  const slash = trySlash(state.avatar, state.projectiles);
  if (slash.swung) {
    state.projectiles = slash.remaining;
    state.events.push({ type: "slash", at: avatarTorso(state.avatar) });
    for (const shot of slash.parried) {
      state.events.push({ type: "parry", at: { x: shot.x, y: shot.y } });
    }
  }

  if (state.projectiles.length > 0) {
    const clocks = advanceProjectileClocks(state.projectiles, ms, avatarTorso(state.avatar));
    for (const event of clocks.events) {
      if (event.kind === "hang") state.events.push({ type: "hang", at: { x: event.x, y: event.y } });
      if (event.kind === "resume") state.events.push({ type: "resume", at: { x: event.x, y: event.y } });
    }
    const resolved = resolveBolts(state.avatar, clocks.projectiles, ms, CLOCKHEAD_CENTER, false);
    state.projectiles = resolved.projectiles;
    for (const event of resolved.events) {
      if (event.type === "block") state.freezeMs = Math.max(state.freezeMs, event.perfect ? 70 : 40);
      state.events.push(event);
    }
    for (const hit of resolved.hits) {
      hurt(state, hit, "bolt");
      if ((state.stage as SearchStage) === "recoil") return;
    }
  }

  // Doors trigger by walking into them — but not while dodging through.
  const door = state.avatar.dodgeMs > 0 ? null : doorAt(state.avatar.feet);
  if (door) {
    clearHazards(state);
    state.stage = "door";
    state.clock = 0;
    state.door = { id: door.id, clock: 0 };
    if (!state.doorsChecked.includes(door.id)) state.doorsChecked = [...state.doorsChecked, door.id];
    state.events.push({ type: "door_open", door: door.id });
    return;
  }

  switch (state.stage) {
    case "disrupted":
      if (state.clock >= SEARCH_TUNING.disruptedMs) toRest(state);
      break;
    case "rest":
      if (state.clock >= SEARCH_TUNING.restMs) {
        state.stage = "tell";
        state.clock = 0;
        state.pattern = SEARCH_PATTERNS[state.patternIndex % SEARCH_PATTERNS.length]!;
        state.events.push({ type: "tell", pattern: state.pattern });
      }
      break;
    case "tell":
      if (state.clock >= SEARCH_TUNING.tellMs) beginAttack(state);
      break;
    case "attack":
      updateSweep(state);
      if ((state.stage as SearchStage) === "recoil") return;
      if (state.clock >= attackMs(state.pattern)) {
        state.sweep = null;
        state.patternIndex += 1;
        toRest(state);
      }
      break;
    case "calm":
      break;
  }
}

export function stepSearchArena(previous: SearchArena, dt: number, input: SearchInput): SearchArena {
  const state: SearchArena = {
    ...previous,
    avatar: cloneAvatar(previous.avatar),
    projectiles: [...previous.projectiles],
    sweep: previous.sweep ? { ...previous.sweep } : null,
    door: previous.door ? { ...previous.door } : null,
    events: [],
  };
  bufferAvatarPresses(state.avatar, input);
  let remaining = Math.min(50, Math.max(0, dt));
  let first = true;
  while (remaining > 0.0001) {
    const ms = Math.min(1000 / 60, remaining);
    remaining -= ms;
    stepOnce(state, ms, first ? input : { ...input, takeShield: false });
    first = false;
  }
  return state;
}

/** Is the shield close enough to show the TAKE SHIELD prompt? */
export function shieldInReach(state: SearchArena): boolean {
  return (
    !state.shieldTaken &&
    stageDistance(state.avatar.feet, SHIELD_REST) <= SEARCH_TUNING.shieldPromptReach
  );
}

/** 0..1 through a door's opening sequence, for the renderer. */
export function doorProgress(state: SearchArena): { door: ColosseumDoor; t: number; revealed: boolean; closing: boolean } | null {
  if (!state.door) return null;
  const door = doorById(state.door.id);
  const reveal = door.painted ? SEARCH_TUNING.door.revealAtMs : SEARCH_TUNING.door.debatedRevealAtMs;
  return {
    door,
    t: Math.min(1, state.door.clock / doorDurationMs(door)),
    revealed: state.door.clock >= reveal,
    closing: door.painted && state.door.clock >= SEARCH_TUNING.door.closeAtMs,
  };
}
