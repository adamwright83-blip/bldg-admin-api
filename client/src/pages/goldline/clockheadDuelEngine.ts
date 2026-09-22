/**
 * The Clockhead finale, as a pure deterministic simulation.
 *
 * TRUTH BOUNDARY
 *
 * This engine is fiction end to end. It is only ever mounted after the real
 * campaign is already complete, it takes no person, target, visit or outcome
 * as input, and nothing it produces is written anywhere except the fantasy
 * unlock the controller persists after `onDefeated`. Winning here records no
 * visit, sale or revenue — and losing costs nothing real either.
 *
 * DESIGN (docs/goldline/WORLD_BIBLE.md §14, §23, §24, §26)
 *
 * Clockhead's mechanics express him before dialogue does:
 *   AIMED BOLT       hangs in place, then suddenly resumes — re-aimed.
 *   CLOCK FAN        several bolts on staggered timing.
 *   SECOND HAND      a huge spectral sweep. Cannot be blocked; dodge it.
 *   DEADLINE         the floor where you stand, then a slam. In the final
 *                    hour the damage is DEFERRED and lands twice.
 *   BORROWED MINUTE  he rewinds: the fan comes back from behind while the
 *                    next bolt is already on its way.
 * After every attack he must wind himself. That window is the only time the
 * Lineblade can reach his mainspring. Perfect blocks store force; three
 * release as RETURN. Losing is not GAME OVER: the Line catches Trailblazer
 * and RECOIL throws her back to the anchor at the start of the current hour.
 */
import {
  advanceProjectileClocks,
  secondHandHits,
  spawnHangingBolt,
  spawnStaggeredFan,
  type ColosseumProjectile,
  type CombatGeometry,
} from "./colosseumCombat";
import {
  AVATAR_TUNING,
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
  CLOCKHEAD_WINDING_CENTER,
  floorDistance,
  slideWithinFloor,
  stageDistance,
  type StagePoint,
} from "./colosseumStage";

export type ClockPattern = "aimed" | "fan" | "sweep" | "deadline" | "rewind";
export type DuelPhase = 1 | 2 | 3;
export type DuelStage = "tell" | "attack" | "exposed" | "phase_break" | "won" | "lost";

export type SecondHand = {
  /** 1 sweeps left→right across the floor, -1 right→left. */
  direction: 1 | -1;
  passes: 1 | 2;
  angle: number;
  /** Which pass is live (null between passes / after the last). */
  livePass: number | null;
  /** Passes that already hurt her — one hit per pass at most. */
  hitPasses: number[];
};

export type DeadlineMark = {
  id: string;
  at: StagePoint;
  fuseMs: number;
  fuseTotalMs: number;
  /** In the final hour a mark lands, then lands again (Deferred Damage). */
  slamsRemaining: number;
};

export type DuelEvent =
  | AvatarEvent
  | { type: "tell"; pattern: ClockPattern }
  | { type: "launch"; pattern: ClockPattern; at: StagePoint }
  | { type: "hang"; at: StagePoint }
  | { type: "resume"; at: StagePoint }
  | { type: "rewind" }
  | { type: "sweep"; direction: 1 | -1 }
  | { type: "deadline_mark"; count: number }
  | { type: "deadline_slam"; at: StagePoint; deferred: boolean }
  | { type: "slash"; at: StagePoint; hit: boolean; combo: number }
  | { type: "strike_hit"; at: StagePoint; combo: number; finisher: boolean }
  | { type: "return"; at: StagePoint; cleared: number }
  | { type: "exposed"; staggered: boolean }
  | { type: "recovered" }
  | { type: "phase_break"; phase: DuelPhase }
  | { type: "defeated" }
  | { type: "recoil" };

export type DuelStats = {
  elapsedMs: number;
  perfectBlocks: number;
  hitsTaken: number;
  returns: number;
  strikes: number;
  recoils: number;
};

export type ClockDuel = {
  avatar: Avatar;
  /** Mirrors of avatar fields kept for callers and tests of the first duel. */
  player: StagePoint;
  hp: number;
  dodgeMs: number;
  dodgeCooldown: number;
  hurtMs: number;

  bossHp: number;
  bossMaxHp: number;
  phase: DuelPhase;
  stage: DuelStage;
  pattern: ClockPattern;
  patternIndex: number;
  clock: number;
  sequence: number;
  projectiles: ColosseumProjectile[];
  sweep: SecondHand | null;
  deadlines: DeadlineMark[];
  rewound: boolean;
  /** Attacks thrown since he last wound himself. */
  volley: number;
  windowHits: number;
  staggerMs: number;
  freezeMs: number;
  /** Boss health at the start of the current hour — the RECOIL anchor. */
  anchorBossHp: number;
  /** RECOILs since that anchor was set; each one steadies the next attempt. */
  anchorRecoils: number;
  /** Increments whenever something noteworthy happened (legacy consumers). */
  cue: number;
  /** Everything that happened during the most recent step, for the renderer. */
  events: DuelEvent[];
  line: string;
  stats: DuelStats;
};

export const DUEL_BOSS_HP = 12;
/** A phase ends the moment his health reaches its floor. */
export const PHASE_FLOOR: Record<DuelPhase, number> = { 1: 8, 2: 4, 3: 0 };
export const CLOCK_PHASE_NAMES: Record<DuelPhase, string> = {
  1: "BORROWED TIME",
  2: "OVERTIME",
  3: "THE FINAL HOUR",
};

/**
 * The final hour OPENS with a Borrowed Minute: it is his signature, and a
 * player strong enough to finish the hour in two windows must still see it.
 */
export const PHASE_PATTERNS: Record<DuelPhase, readonly ClockPattern[]> = {
  1: ["aimed", "fan", "aimed"],
  2: ["fan", "sweep", "aimed", "deadline"],
  3: ["rewind", "deadline", "sweep", "fan"],
};

/** The World Bible's names for his attacks, shown only after the shape. */
export const CLOCK_ATTACK_NAMES: Record<ClockPattern, string> = {
  aimed: "AIMED BOLT",
  fan: "CLOCK FAN",
  sweep: "SECOND HAND",
  deadline: "DEADLINE",
  rewind: "BORROWED MINUTE",
};

/** What to do about each one, in as few words as possible. */
export const CLOCK_ATTACK_ANSWERS: Record<ClockPattern, string> = {
  aimed: "GUARD AS IT RESUMES",
  fan: "SLIP THROUGH THE GAP",
  sweep: "DODGE THROUGH THE HAND",
  deadline: "LEAVE THE MARK",
  rewind: "IT COMES BACK — WATCH BEHIND",
};

export const CLOCK_TELLS: Record<ClockPattern, string> = {
  aimed: "Hold still. I’m putting you on my calendar.",
  fan: "Several appointments. None of them optional.",
  sweep: "Mind the hand. It takes the long way round.",
  deadline: "Your deadline is exactly where you’re standing.",
  rewind: "Let’s go back a minute. I wasn’t finished.",
};

const PHASE_LINES: Record<DuelPhase, string> = {
  1: "It isn’t time.",
  2: "Overtime. Nobody leaves until I say so.",
  3: "The final hour. It never ends, you know. That’s the point.",
};

const STRIKE_LINES = [
  "That was not on the agenda!",
  "Unscheduled! Entirely unscheduled!",
  "Put that in writing first!",
];

export const DUEL_TUNING = {
  tellMs: { 1: 1000, 2: 860, 3: 760 } as Record<DuelPhase, number>,
  /**
   * Attacks per wind. From Overtime on he chains two before he has to stop
   * and wind himself — "Nobody leaves until I say so."
   */
  volleysPerWind: { 1: 1, 2: 2, 3: 2 } as Record<DuelPhase, number>,
  /**
   * Winding windows, including the ~260ms it takes him to sink into reach.
   * Long enough that closing in from mid-floor is a decision, not a sprint.
   */
  exposedMs: { 1: 2100, 2: 1900, 3: 1700 } as Record<DuelPhase, number>,
  returnStaggerMs: 700,
  phaseBreakMs: 1700,
  strikeReach: 18,
  maxWindowHits: 3,
  returnDamage: 2,
  boltSpeed: 62,
  hangAtMs: 300,
  hangForMs: { 1: 620, 2: 480, 3: 360 } as Record<DuelPhase, number>,
  resumeSpeed: { 1: 96, 2: 108, 3: 118 } as Record<DuelPhase, number>,
  fanCount: { 1: 3, 2: 5, 3: 5 } as Record<DuelPhase, number>,
  fanSpread: { 1: 0.62, 2: 0.9, 3: 1.0 } as Record<DuelPhase, number>,
  fanStaggerMs: { 1: 140, 2: 110, 3: 90 } as Record<DuelPhase, number>,
  fanSpeed: { 1: 58, 2: 64, 3: 70 } as Record<DuelPhase, number>,
  sweepPassMs: { 1: 1250, 2: 1250, 3: 1050 } as Record<DuelPhase, number>,
  sweepPauseMs: 220,
  sweepFromDeg: 18,
  sweepToDeg: 162,
  secondHandLength: 150,
  secondHandHalfWidth: 2.6,
  deadlineRadius: 11,
  deadlineFuseMs: 1150,
  deferredFuseMs: 700,
  rewindAtMs: 1250,
} as const;

function bossGeometry(speed: number): Partial<CombatGeometry> {
  return { origin: CLOCKHEAD_CENTER, speed };
}

function phaseForHp(bossHp: number): DuelPhase {
  if (bossHp > PHASE_FLOOR[1]) return 1;
  if (bossHp > PHASE_FLOOR[2]) return 2;
  return 3;
}

function emptyStats(): DuelStats {
  return { elapsedMs: 0, perfectBlocks: 0, hitsTaken: 0, returns: 0, strikes: 0, recoils: 0 };
}

/**
 * The Line holds tighter each time it catches her in the same hour: one more
 * guard pip per RECOIL there, up to five. Failing is information, not shame.
 */
export const RECOIL_GUARD_BONUS_MAX = 2;

function freshAt(bossHp: number, stats: DuelStats, anchorRecoils = 0): ClockDuel {
  const phase = phaseForHp(bossHp);
  const pattern = PHASE_PATTERNS[phase][0]!;
  const avatar = createAvatar(
    ARENA_ANCHOR,
    AVATAR_TUNING.maxGuardPips + Math.min(RECOIL_GUARD_BONUS_MAX, anchorRecoils)
  );
  return syncMirrors({
    avatar,
    player: avatar.feet,
    hp: avatar.guardPips,
    dodgeMs: 0,
    dodgeCooldown: 0,
    hurtMs: 0,
    bossHp,
    bossMaxHp: DUEL_BOSS_HP,
    phase,
    stage: "tell",
    pattern,
    patternIndex: 0,
    clock: 0,
    sequence: 0,
    projectiles: [],
    sweep: null,
    deadlines: [],
    rewound: false,
    volley: 0,
    windowHits: 0,
    staggerMs: 0,
    freezeMs: 0,
    anchorBossHp: bossHp,
    anchorRecoils,
    cue: 0,
    events: [],
    line: bossHp === DUEL_BOSS_HP ? PHASE_LINES[1] : PHASE_LINES[phase],
    stats,
  });
}

export function createClockDuel(): ClockDuel {
  return freshAt(DUEL_BOSS_HP, emptyStats());
}

/**
 * RECOIL (WORLD_BIBLE §26): the Line catches her and throws her back to the
 * most recent anchor — the start of the hour she fell in, not the start of
 * the fight. Guard is restored; the stats remember that it happened.
 */
export function recoilToAnchor(state: ClockDuel): ClockDuel {
  const stats = { ...state.stats, recoils: state.stats.recoils + 1 };
  const next = freshAt(state.anchorBossHp, stats, state.anchorRecoils + 1);
  next.line = "Back already? Shall we reschedule?";
  return next;
}

function syncMirrors(state: ClockDuel): ClockDuel {
  state.player = state.avatar.feet;
  state.hp = state.avatar.guardPips;
  state.dodgeMs = state.avatar.dodgeMs;
  state.dodgeCooldown = state.avatar.dodgeCooldownMs;
  state.hurtMs = state.avatar.hurtMs;
  return state;
}

function emit(state: ClockDuel, event: DuelEvent) {
  state.events.push(event);
  state.cue += 1;
}

function clearHazards(state: ClockDuel) {
  state.projectiles = [];
  state.sweep = null;
  state.deadlines = [];
}

function fighting(state: ClockDuel): boolean {
  return state.stage === "tell" || state.stage === "attack" || state.stage === "exposed";
}

export function attackDurationMs(pattern: ClockPattern, phase: DuelPhase): number {
  switch (pattern) {
    case "aimed":
      return DUEL_TUNING.hangAtMs + DUEL_TUNING.hangForMs[phase] + 1500;
    case "fan":
      return DUEL_TUNING.fanCount[phase] * DUEL_TUNING.fanStaggerMs[phase] + 1500;
    case "sweep": {
      const passes = phase === 3 ? 2 : 1;
      return passes * DUEL_TUNING.sweepPassMs[phase] + (passes - 1) * DUEL_TUNING.sweepPauseMs + 260;
    }
    case "deadline":
      return DUEL_TUNING.deadlineFuseMs + (phase === 3 ? DUEL_TUNING.deferredFuseMs : 0) + 380;
    case "rewind":
      return 2700;
  }
}

function damageTrailblazer(state: ClockDuel, source: "bolt" | "sweep" | "deadline", at: StagePoint) {
  if (state.stage === "phase_break") return;
  if (!hurtAvatar(state.avatar)) return;
  state.freezeMs = Math.max(state.freezeMs, 90);
  state.stats.hitsTaken += 1;
  emit(state, { type: "hurt", at, source });
  if (state.avatar.guardPips <= 0) {
    state.stage = "lost";
    clearHazards(state);
    state.line = "Time’s up. Shall we reschedule?";
    emit(state, { type: "recoil" });
  } else {
    state.line = "Late again. Try moving before the bell.";
  }
}

function dealBossDamage(state: ClockDuel, amount: number) {
  const floor = PHASE_FLOOR[state.phase];
  state.bossHp = Math.max(floor, state.bossHp - amount);
  if (state.bossHp === 0) {
    state.stage = "won";
    clearHazards(state);
    state.freezeMs = 420;
    state.line = "Impossible. It isn’t… it’s… time.";
    emit(state, { type: "defeated" });
    return;
  }
  if (state.bossHp === floor) {
    const next = (state.phase + 1) as DuelPhase;
    state.phase = next;
    state.stage = "phase_break";
    state.clock = 0;
    state.patternIndex = 0;
    state.volley = 0;
    state.windowHits = 0;
    state.staggerMs = 0;
    state.anchorBossHp = state.bossHp;
    state.anchorRecoils = 0;
    clearHazards(state);
    state.avatar.hurtMs = Math.max(state.avatar.hurtMs, DUEL_TUNING.phaseBreakMs);
    state.line = PHASE_LINES[next];
    emit(state, { type: "phase_break", phase: next });
  }
}

function beginTell(state: ClockDuel) {
  state.stage = "tell";
  state.clock = 0;
  state.staggerMs = 0;
  state.line = CLOCK_TELLS[state.pattern];
  emit(state, { type: "tell", pattern: state.pattern });
}

function deadlineMarks(state: ClockDuel): DeadlineMark[] {
  const feet = state.avatar.feet;
  const offsets = state.phase === 3 ? [0, 18, -18] : [0];
  const fuse = DUEL_TUNING.deadlineFuseMs;
  return offsets.map((dx, index) => ({
    id: `deadline-${state.sequence}-${index}`,
    at: dx === 0 ? { ...feet } : slideWithinFloor(feet, { x: feet.x + dx, y: feet.y }),
    fuseMs: fuse,
    fuseTotalMs: fuse,
    slamsRemaining: state.phase === 3 ? 2 : 1,
  }));
}

function beginAttack(state: ClockDuel) {
  state.stage = "attack";
  state.clock = 0;
  state.sequence += 1;
  state.rewound = false;
  const phase = state.phase;
  const torso = avatarTorso(state.avatar);
  switch (state.pattern) {
    case "aimed":
      state.projectiles.push(
        spawnHangingBolt({
          player: torso,
          sequence: state.sequence,
          hangAtMs: DUEL_TUNING.hangAtMs,
          hangForMs: DUEL_TUNING.hangForMs[phase],
          resumeSpeed: DUEL_TUNING.resumeSpeed[phase],
          geometry: bossGeometry(DUEL_TUNING.boltSpeed),
        })
      );
      break;
    case "fan":
    case "rewind":
      state.projectiles.push(
        ...spawnStaggeredFan({
          player: torso,
          sequence: state.sequence,
          count: DUEL_TUNING.fanCount[phase],
          spreadRadians: DUEL_TUNING.fanSpread[phase],
          staggerMs: DUEL_TUNING.fanStaggerMs[phase],
          order: state.sequence % 2 === 0 ? 1 : -1,
          geometry: bossGeometry(DUEL_TUNING.fanSpeed[phase]),
        })
      );
      break;
    case "sweep": {
      const direction: 1 | -1 = state.sequence % 2 === 0 ? 1 : -1;
      state.sweep = {
        direction,
        passes: phase === 3 ? 2 : 1,
        angle: direction === 1 ? DUEL_TUNING.sweepFromDeg : DUEL_TUNING.sweepToDeg,
        livePass: 0,
        hitPasses: [],
      };
      emit(state, { type: "sweep", direction });
      break;
    }
    case "deadline":
      state.deadlines = deadlineMarks(state);
      emit(state, { type: "deadline_mark", count: state.deadlines.length });
      break;
  }
  if (state.pattern !== "sweep" && state.pattern !== "deadline") {
    emit(state, { type: "launch", pattern: state.pattern, at: { ...CLOCKHEAD_CENTER } });
  }
}

function beginExposed(state: ClockDuel, staggered: boolean) {
  state.stage = "exposed";
  state.clock = 0;
  state.windowHits = 0;
  state.staggerMs = staggered ? DUEL_TUNING.returnStaggerMs : 0;
  state.sweep = null;
  state.deadlines = [];
  state.line = staggered
    ? "You— that was MY minute!"
    : "A moment. I need to wind myself—";
  emit(state, { type: "exposed", staggered });
}

function advancePattern(state: ClockDuel) {
  state.patternIndex += 1;
  const patterns = PHASE_PATTERNS[state.phase];
  state.pattern = patterns[state.patternIndex % patterns.length]!;
}

function nextPattern(state: ClockDuel) {
  advancePattern(state);
  emit(state, { type: "recovered" });
  beginTell(state);
}

/** After an attack: chain the next one, or stop to wind. */
function endAttack(state: ClockDuel) {
  state.volley += 1;
  if (state.volley < DUEL_TUNING.volleysPerWind[state.phase]) {
    advancePattern(state);
    beginTell(state);
    return;
  }
  state.volley = 0;
  beginExposed(state, false);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function updateSweep(state: ClockDuel) {
  const sweep = state.sweep;
  if (!sweep) return;
  const passMs = DUEL_TUNING.sweepPassMs[state.phase];
  const pause = DUEL_TUNING.sweepPauseMs;
  const t = state.clock;
  let pass: number | null = null;
  let progress = 1;
  if (t < passMs) {
    pass = 0;
    progress = t / passMs;
  } else if (sweep.passes === 2 && t >= passMs + pause && t < 2 * passMs + pause) {
    pass = 1;
    progress = (t - passMs - pause) / passMs;
  } else if (sweep.passes === 2 && t < passMs + pause) {
    progress = 1;
  }
  const from = sweep.direction === 1 ? DUEL_TUNING.sweepFromDeg : DUEL_TUNING.sweepToDeg;
  const to = sweep.direction === 1 ? DUEL_TUNING.sweepToDeg : DUEL_TUNING.sweepFromDeg;
  const eased = easeInOut(Math.max(0, Math.min(1, progress)));
  const secondPass = pass === 1 || (sweep.passes === 2 && t >= 2 * passMs + pause);
  sweep.angle = secondPass ? to + (from - to) * eased : from + (to - from) * eased;
  sweep.livePass = pass;

  if (pass == null || sweep.hitPasses.includes(pass)) return;
  const torso = avatarTorso(state.avatar);
  const radius = (avatarGeometry(state.avatar, CLOCKHEAD_CENTER).playerRadius ?? 3) as number;
  if (
    secondHandHits({
      origin: CLOCKHEAD_CENTER,
      angleDegrees: sweep.angle,
      length: DUEL_TUNING.secondHandLength,
      halfWidth: DUEL_TUNING.secondHandHalfWidth,
      target: torso,
      targetRadius: radius,
    }) &&
    !avatarInvulnerable(state.avatar)
  ) {
    sweep.hitPasses.push(pass);
    damageTrailblazer(state, "sweep", torso);
  }
}

function updateDeadlines(state: ClockDuel, ms: number) {
  if (state.deadlines.length === 0) return;
  const survivors: DeadlineMark[] = [];
  for (const mark of state.deadlines) {
    const next = { ...mark, fuseMs: mark.fuseMs - ms };
    if (next.fuseMs > 0) {
      survivors.push(next);
      continue;
    }
    const rearm = next.slamsRemaining > 1;
    // The second landing of a final-hour mark is the Deferred Damage.
    emit(state, {
      type: "deadline_slam",
      at: { ...next.at },
      deferred: mark.fuseTotalMs === DUEL_TUNING.deferredFuseMs,
    });
    if (
      floorDistance(state.avatar.feet, next.at) <= DUEL_TUNING.deadlineRadius &&
      !avatarInvulnerable(state.avatar)
    ) {
      damageTrailblazer(state, "deadline", avatarTorso(state.avatar));
      if (state.stage === "lost") return;
    }
    if (rearm) {
      survivors.push({
        ...next,
        fuseMs: DUEL_TUNING.deferredFuseMs,
        fuseTotalMs: DUEL_TUNING.deferredFuseMs,
        slamsRemaining: next.slamsRemaining - 1,
      });
    }
  }
  state.deadlines = survivors;
}

function updateRewind(state: ClockDuel) {
  if (state.pattern !== "rewind" || state.rewound || state.clock < DUEL_TUNING.rewindAtMs) return;
  state.rewound = true;
  state.projectiles = state.projectiles.map(shot =>
    shot.reversed ? shot : { ...shot, vx: -shot.vx, vy: -shot.vy, reversed: true, delayMs: 0 }
  );
  state.projectiles.push(
    spawnHangingBolt({
      player: avatarTorso(state.avatar),
      sequence: state.sequence * 100 + 1,
      hangAtMs: 250,
      hangForMs: 320,
      resumeSpeed: DUEL_TUNING.resumeSpeed[3],
      geometry: bossGeometry(DUEL_TUNING.boltSpeed),
    })
  );
  emit(state, { type: "rewind" });
}

function updateProjectiles(state: ClockDuel, ms: number) {
  if (state.projectiles.length === 0) return;
  const torso = avatarTorso(state.avatar);
  const clocks = advanceProjectileClocks(state.projectiles, ms, torso);
  for (const event of clocks.events) {
    if (event.kind === "hang") emit(state, { type: "hang", at: { x: event.x, y: event.y } });
    if (event.kind === "resume") emit(state, { type: "resume", at: { x: event.x, y: event.y } });
  }
  const resolved = resolveBolts(
    state.avatar,
    clocks.projectiles,
    ms,
    CLOCKHEAD_CENTER,
    state.stage === "phase_break"
  );
  state.projectiles = resolved.projectiles;
  for (const event of resolved.events) {
    if (event.type === "block") {
      if (event.perfect) state.stats.perfectBlocks += 1;
      state.freezeMs = Math.max(state.freezeMs, event.perfect ? 70 : 40);
    }
    emit(state, event);
  }
  for (const hit of resolved.hits) {
    damageTrailblazer(state, "bolt", hit);
    if (state.stage === "lost") return;
  }
}

function updateStrike(state: ClockDuel) {
  const slash = trySlash(state.avatar, state.projectiles);
  if (!slash.swung) return;
  state.projectiles = slash.remaining;
  for (const shot of slash.parried) emit(state, { type: "parry", at: { x: shot.x, y: shot.y } });
  const torso = avatarTorso(state.avatar);
  const inReach = stageDistance(torso, CLOCKHEAD_WINDING_CENTER) <= DUEL_TUNING.strikeReach;
  if (
    state.stage === "exposed" &&
    inReach &&
    state.windowHits < DUEL_TUNING.maxWindowHits
  ) {
    state.windowHits += 1;
    const finisher = state.windowHits === DUEL_TUNING.maxWindowHits;
    state.avatar.slashCombo = state.windowHits;
    state.stats.strikes += 1;
    state.freezeMs = Math.max(state.freezeMs, finisher ? 150 : 70);
    if (finisher) state.avatar.strikeRecoveryMs = AVATAR_TUNING.finisherRecoveryMs;
    state.line = STRIKE_LINES[(state.windowHits - 1) % STRIKE_LINES.length]!;
    emit(state, {
      type: "strike_hit",
      at: { ...CLOCKHEAD_WINDING_CENTER },
      combo: state.windowHits,
      finisher,
    });
    dealBossDamage(state, 1);
    // A finisher knocks him out of the window early; he rewinds himself up.
    if (finisher && state.stage === "exposed") {
      const total = DUEL_TUNING.exposedMs[state.phase] + state.staggerMs;
      state.clock = Math.max(state.clock, total - 380);
    }
  } else {
    state.avatar.slashCombo = 0;
    emit(state, { type: "slash", at: torso, hit: false, combo: 0 });
  }
}

function updateReturn(state: ClockDuel) {
  if (!fighting(state)) return;
  if (!tryReturn(state.avatar)) return;
  const cleared = state.projectiles.length;
  clearHazards(state);
  state.stats.returns += 1;
  state.freezeMs = Math.max(state.freezeMs, 140);
  emit(state, { type: "return", at: avatarTorso(state.avatar), cleared });
  dealBossDamage(state, DUEL_TUNING.returnDamage);
  if (fighting(state)) {
    state.volley = 0;
    beginExposed(state, true);
  }
}

function stepOnce(state: ClockDuel, ms: number, input: AvatarInput) {
  if (state.freezeMs > 0) {
    state.freezeMs = Math.max(0, state.freezeMs - ms);
    return;
  }
  if (state.stage === "won" || state.stage === "lost") return;

  state.stats.elapsedMs += ms;
  state.clock += ms;
  stepAvatarTimers(state.avatar, ms);
  for (const event of stepAvatarMotion(state.avatar, input, ms, {
    canGuard: true,
    locked: state.stage === "phase_break",
  })) {
    emit(state, event);
  }

  updateReturn(state);
  if (!fighting(state)) {
    if (state.stage === "phase_break" && state.clock >= DUEL_TUNING.phaseBreakMs) {
      state.pattern = PHASE_PATTERNS[state.phase][0]!;
      beginTell(state);
    }
    return;
  }

  updateStrike(state);
  if (!fighting(state)) return;

  updateProjectiles(state, ms);
  // A bolt may have just ended the fight; TypeScript cannot see that mutation.
  if ((state.stage as DuelStage) === "lost") return;

  switch (state.stage) {
    case "tell":
      if (state.clock >= DUEL_TUNING.tellMs[state.phase]) beginAttack(state);
      break;
    case "attack":
      updateRewind(state);
      updateSweep(state);
      if ((state.stage as DuelStage) === "lost") return;
      updateDeadlines(state, ms);
      if ((state.stage as DuelStage) === "lost") return;
      if (state.clock >= attackDurationMs(state.pattern, state.phase)) endAttack(state);
      break;
    case "exposed":
      if (state.clock >= DUEL_TUNING.exposedMs[state.phase] + state.staggerMs) nextPattern(state);
      break;
  }
}

/**
 * Advance the duel by `dt` milliseconds. Long frames are split into ≤17ms
 * sub-steps so fast bolts can never tunnel through her; anything over 50ms
 * (a backgrounded tab) is simply not simulated.
 */
export function stepClockDuel(previous: ClockDuel, dt: number, input: AvatarInput): ClockDuel {
  if (previous.stage === "won" || previous.stage === "lost") {
    return previous.events.length === 0 ? previous : { ...previous, events: [] };
  }
  // Copy every collection this step may push into: `previous` is React state
  // and must never be mutated.
  const state: ClockDuel = {
    ...previous,
    avatar: cloneAvatar(previous.avatar),
    projectiles: [...previous.projectiles],
    sweep: previous.sweep ? { ...previous.sweep, hitPasses: [...previous.sweep.hitPasses] } : null,
    deadlines: [...previous.deadlines],
    stats: { ...previous.stats },
    events: [],
  };
  bufferAvatarPresses(state.avatar, input);
  let remaining = Math.min(50, Math.max(0, dt));
  while (remaining > 0.0001) {
    const ms = Math.min(1000 / 60, remaining);
    remaining -= ms;
    stepOnce(state, ms, input);
    if (state.stage === "won" || state.stage === "lost") break;
  }
  return syncMirrors(state);
}

/** 0..1 through the current wind-up, for the renderer's tell. */
export function tellProgress(state: ClockDuel): number {
  if (state.stage !== "tell") return 0;
  return Math.min(1, state.clock / DUEL_TUNING.tellMs[state.phase]);
}

/** Can the Lineblade reach his mainspring from where she stands right now? */
export function mainspringInReach(state: ClockDuel): boolean {
  return (
    state.stage === "exposed" &&
    state.windowHits < DUEL_TUNING.maxWindowHits &&
    stageDistance(avatarTorso(state.avatar), CLOCKHEAD_WINDING_CENTER) <= DUEL_TUNING.strikeReach
  );
}
