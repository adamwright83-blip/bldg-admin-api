import {
  BrowserLocalBoreslayDemoAdapter,
  type PublicBoreslayDemoAdapter,
  type SimulatedCrewMissionDeployment,
  type SimulatedCrewMissionResult,
} from "../boreslay-demo/PublicBoreslayDemoAdapter";
import type { DemoStatus } from "../boreslay-demo/engine";
import { FIXED_STEP_MS, RALLY_CONFIG } from "./rallyConfig";

export type RallySide = "spark" | "clockhead";
export type RallyControlMode = "duel" | "flight";
export type RallyPowerId = "redTape" | "hardNo" | "deadlineStamp" | "receipts";
export type RallyTelegraph = "none" | "swat" | "freeze";
export type RallyMissionStatus = "locked" | "ready" | "accepted" | "expired";
export type RallyStrikeKind = "flat" | "arc" | "spike" | "lob";
export type RallyDuelIntent = "PRESSURE" | "CONTEST" | "GUARD" | "BAIT";
export type RallyEventType =
  | "serve"
  | "jump"
  | "strike_crack"
  | "strike_whiff"
  | "contact_dink"
  | "contact_header"
  | "crossover"
  | "breath_start"
  | "breath_loop"
  | "breath_contact"
  | "breath_exhausted"
  | "charged_release"
  | "return"
  | "wall_bounce"
  | "bumper_bank"
  | "ignite"
  | "freeze_cast"
  | "freeze_break"
  | "rescue_ready"
  | "rescue_accepted"
  | "score_sealed"
  | "gate_score_for"
  | "gate_score_against"
  | "ceremony_complete"
  | "regulation_expired"
  | "sudden_death"
  | "victory"
  | "defeat"
  | "dash"
  | "power_selected"
  | "power_cast"
  | "tape_place"
  | "tape_sling"
  | "shield_up"
  | "shield_break"
  | "stamp_tick"
  | "stamp_slam"
  | "receipts_on"
  | "status";

export type RallyEvent = {
  type: RallyEventType;
  at: number;
  x?: number;
  y?: number;
  tier?: 0 | 1 | 2 | 3;
  side?: RallySide;
  points?: number;
  banked?: boolean;
  message?: string;
  power?: RallyPowerId;
  variation?: number;
};

export type RallyPlacedSurface = {
  x: number;
  y: number;
  angle: number;
  liveAt: number;
  expiresAt: number;
  consumed: boolean;
};

export type RallyVec = { x: number; y: number };

export type RallyScoreSnapshot = {
  victim: RallySide;
  scorer: RallySide;
  points: number;
  banked: boolean;
  mode: "portal" | "buttHybrid";
  x: number;
  y: number;
  startX: number;
  startY: number;
  vx: number;
  vy: number;
  tick: number;
  ignited: boolean;
  bark: string | null;
};

const CLOCKHEAD_SCORE_BARKS = [
  "FILED UNDER: TOMORROW.",
  "SNOOZE BUTTON WINS.",
  "DEADLINE? WHAT DEADLINE?",
] as const;

export type RallyCeremony = {
  elapsedRealMs: number;
  committed: boolean;
  outcome: "victory" | "defeat" | null;
  snapshot: RallyScoreSnapshot;
};

export type RallyExcuse = RallyVec & {
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  spin: number;
  speedTier: 0 | 1 | 2 | 3;
  ignitedUntil: number;
  lastTouchedBy: RallySide | null;
  lastTouchAt: number;
  rallyCount: number;
  bankState: boolean;
  inPlay: boolean;
  stallMs: number;
  trailX: Float32Array;
  trailY: Float32Array;
  trailHead: number;
};

export type RallyDuelFighter = {
  vy: number;
  grounded: boolean;
  coyoteMs: number;
  jumpBufferMs: number;
  moveDir: number;
  vxInst: number;
  strikeCooldownUntil: number;
  swingUntil: number;
  swingKind: RallyStrikeKind | null;
  squash: number;
  meter: number;
  surgeUntil: number;
};

export type ButtTarget = RallyVec & {
  prevX: number;
  prevY: number;
  radius: number;
  wobble: RallyVec & { vx: number; vy: number };
};

export type RallyState = {
  tick: number;
  timeMs: number;
  status: DemoStatus;
  message: string;
  controlMode: RallyControlMode;
  scoringMode: "portal" | "buttHybrid";
  reducedMotion: boolean;
  trauma: number;
  spark: RallyVec & {
    prevX: number;
    prevY: number;
    facing: RallyVec;
    energy: number;
    frozenUntil: number;
    dashUntil: number;
    invulnerableUntil: number;
    dashReadyAt: number;
    breathHeldMs: number;
    breathing: boolean;
    lastBreathContactAt: number;
    exhaustedNotified: boolean;
  };
  clockhead: RallyVec & {
    prevX: number;
    prevY: number;
    facing: RallyVec;
    staggerUntil: number;
    telegraph: RallyTelegraph;
    telegraphUntil: number;
    reactionReadyAt: number;
    whiffUntil: number;
    freezeReadyAt: number;
    freezeUses: number;
    exposedUntil: number;
  };
  duel: {
    spark: RallyDuelFighter;
    clockhead: RallyDuelFighter;
    aiIntent: RallyDuelIntent;
    aiIntentUntil: number;
    aiTilt: number;
    aiThinkAt: number;
    aiPendingStrikeAt: number;
    aiPendingStrikeKind: 0 | 1;
    playerHabits: Record<RallyStrikeKind | "header", number>;
  };
  buttTargets: Record<RallySide, ButtTarget>;
  excuse: RallyExcuse;
  sparkScore: number;
  clockheadScore: number;
  regulationRemainingMs: number;
  suddenDeath: boolean;
  regulationExpired: boolean;
  tutorialSlowUntil: number;
  firstPlayerContact: boolean;
  powers: {
    loadout: RallyPowerId[];
    aiLoadout: RallyPowerId[];
    spent: Record<RallyPowerId, boolean>;
    aiSpent: Record<RallyPowerId, boolean>;
    placement: { power: RallyPowerId; startedAt: number; startedTick: number; x: number; y: number } | null;
    hardNoUntil: Record<RallySide, number>;
    redTape: RallyPlacedSurface | null;
    deadlineStamp: (RallyPlacedSurface & { impactAt: number; slammed: boolean }) | null;
    receiptsUntil: number;
  };
  influence: number;
  serveAt: number | null;
  servingSide: RallySide;
  ceremony: RallyCeremony | null;
  mission: {
    status: RallyMissionStatus;
    readyAt: number | null;
    acceptDeadline: number | null;
    deployment: SimulatedCrewMissionDeployment | null;
    simulated: true;
  };
};

export type RallyEngineOptions = {
  reducedMotion?: boolean;
  seed?: number;
  controlMode?: RallyControlMode;
  scoringMode?: "portal" | "buttHybrid";
  adapter?: PublicBoreslayDemoAdapter;
  replay?: boolean;
};

export type RallyInputEvent = {
  tick: number;
  order: number;
  type:
    | "start"
    | "movement"
    | "aim"
    | "jump"
    | "strike"
    | "breath"
    | "dash"
    | "power_selected"
    | "power_cast"
    | "mission_accept"
    | "ai_power"
    | "ai_decision";
  payload?: Record<string, unknown>;
};

export type RallyReplayRecord = {
  seed: number;
  controlMode: RallyControlMode;
  scoringMode: "portal" | "buttHybrid";
  initialConfigHash: string;
  initialRngState: number;
  inputLog: RallyInputEvent[];
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const length = (x: number, y: number) => Math.hypot(x, y);

const normalize = (x: number, y: number): RallyVec => {
  const magnitude = length(x, y) || 1;
  return { x: x / magnitude, y: y / magnitude };
};

const rotate = (vector: RallyVec, radians: number): RallyVec => ({
  x: vector.x * Math.cos(radians) - vector.y * Math.sin(radians),
  y: vector.x * Math.sin(radians) + vector.y * Math.cos(radians),
});

export function configHash() {
  const source = JSON.stringify(RALLY_CONFIG);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createExcuse(): RallyExcuse {
  const points = RALLY_CONFIG.excuse.trailPoints;
  return {
    x: RALLY_CONFIG.clockhead.spawnX - 70,
    y: RALLY_CONFIG.clockhead.spawnY,
    prevX: RALLY_CONFIG.clockhead.spawnX - 70,
    prevY: RALLY_CONFIG.clockhead.spawnY,
    vx: 0,
    vy: 0,
    spin: 0,
    speedTier: 0,
    ignitedUntil: 0,
    lastTouchedBy: null,
    lastTouchAt: -Infinity,
    rallyCount: 0,
    bankState: false,
    inPlay: false,
    stallMs: 0,
    trailX: new Float32Array(points),
    trailY: new Float32Array(points),
    trailHead: 0,
  };
}

const createButtTarget = (x: number, y: number): ButtTarget => ({
  x,
  y,
  prevX: x,
  prevY: y,
  radius: RALLY_CONFIG.buttTarget.radius,
  wobble: { x: 0, y: 0, vx: 0, vy: 0 },
});

const createDuelFighter = (): RallyDuelFighter => ({
  vy: 0,
  grounded: true,
  coyoteMs: RALLY_CONFIG.duel.coyoteMs,
  jumpBufferMs: 0,
  moveDir: 0,
  vxInst: 0,
  strikeCooldownUntil: 0,
  swingUntil: 0,
  swingKind: null,
  squash: 0,
  meter: 0,
  surgeUntil: 0,
});

export function createRallyState(
  reducedMotion = false,
  controlModeOrScoringMode: RallyControlMode | "portal" | "buttHybrid" = RALLY_CONFIG.controls,
  scoringModeOverride?: "portal" | "buttHybrid"
): RallyState {
  const controlMode: RallyControlMode =
    controlModeOrScoringMode === "flight" || controlModeOrScoringMode === "duel"
      ? controlModeOrScoringMode
      : RALLY_CONFIG.controls;
  const scoringMode: "portal" | "buttHybrid" =
    scoringModeOverride ??
    (controlModeOrScoringMode === "portal" || controlModeOrScoringMode === "buttHybrid"
      ? controlModeOrScoringMode
      : RALLY_CONFIG.scoring.mode);
  return {
    tick: 0,
    timeMs: 0,
    status: "idle",
    message: scoringMode === "buttHybrid"
      ? "Bank the Excuse and hit the target behind Clockhead."
      : "Keep the Excuse out of your Gate. Fire it into his.",
    controlMode,
    scoringMode,
    reducedMotion,
    trauma: 0,
    spark: {
      x: RALLY_CONFIG.spark.spawnX,
      y: RALLY_CONFIG.spark.spawnY,
      prevX: RALLY_CONFIG.spark.spawnX,
      prevY: RALLY_CONFIG.spark.spawnY,
      facing: { x: 1, y: 0 },
      energy: RALLY_CONFIG.spark.energyMax,
      frozenUntil: 0,
      dashUntil: 0,
      invulnerableUntil: 0,
      dashReadyAt: 0,
      breathHeldMs: 0,
      breathing: false,
      lastBreathContactAt: -Infinity,
      exhaustedNotified: false,
    },
    clockhead: {
      x: RALLY_CONFIG.clockhead.spawnX,
      y: RALLY_CONFIG.clockhead.spawnY,
      prevX: RALLY_CONFIG.clockhead.spawnX,
      prevY: RALLY_CONFIG.clockhead.spawnY,
      facing: { x: -1, y: 0 },
      staggerUntil: 0,
      telegraph: "none",
      telegraphUntil: 0,
      reactionReadyAt: 0,
      whiffUntil: 0,
      freezeReadyAt: 0,
      freezeUses: 0,
      exposedUntil: 0,
    },
    duel: {
      spark: createDuelFighter(),
      clockhead: createDuelFighter(),
      aiIntent: "CONTEST",
      aiIntentUntil: 0,
      aiTilt: 0,
      aiThinkAt: 0,
      aiPendingStrikeAt: 0,
      aiPendingStrikeKind: 0,
      playerHabits: { flat: 0, arc: 0, spike: 0, lob: 0, header: 0 },
    },
    buttTargets: {
      spark: createButtTarget(
        RALLY_CONFIG.spark.spawnX - RALLY_CONFIG.buttTarget.offset,
        RALLY_CONFIG.spark.spawnY
      ),
      clockhead: createButtTarget(
        RALLY_CONFIG.clockhead.spawnX + RALLY_CONFIG.buttTarget.offset,
        RALLY_CONFIG.clockhead.spawnY
      ),
    },
    excuse: createExcuse(),
    sparkScore: 0,
    clockheadScore: 0,
    regulationRemainingMs: RALLY_CONFIG.scoring.regulationMs,
    suddenDeath: false,
    regulationExpired: false,
    tutorialSlowUntil: 0,
    firstPlayerContact: false,
    powers: {
      loadout: ["redTape", "hardNo"],
      aiLoadout: [],
      spent: { redTape: false, hardNo: false, deadlineStamp: false, receipts: false },
      aiSpent: { redTape: false, hardNo: false, deadlineStamp: false, receipts: false },
      placement: null,
      hardNoUntil: { spark: 0, clockhead: 0 },
      redTape: null,
      deadlineStamp: null,
      receiptsUntil: 0,
    },
    influence: RALLY_CONFIG.scoring.startingInfluence,
    serveAt: null,
    servingSide: "clockhead",
    ceremony: null,
    mission: {
      status: "locked",
      readyAt: null,
      acceptDeadline: null,
      deployment: null,
      simulated: true,
    },
  };
}

export class RallyEngine {
  state: RallyState;
  private accumulatorMs = 0;
  private hitStopRemainingMs = 0;
  private movement: RallyVec = { x: 0, y: 0 };
  private aim: RallyVec = { x: 1, y: 0 };
  private powerAim: RallyVec = {
    x: RALLY_CONFIG.arena.width / 2,
    y: RALLY_CONFIG.arena.height / 2,
  };
  private breathRequested = false;
  private events: RallyEvent[] = [];
  private adapter: PublicBoreslayDemoAdapter;
  private initialSeed: number;
  private randomState: number;
  private replayMode: boolean;
  private inputLog: RallyInputEvent[] = [];
  private inputOrder = 0;
  private initialRngState = 0;

  constructor(options: RallyEngineOptions = {}) {
    this.initialSeed = options.seed ?? RALLY_CONFIG.simulation.seed;
    this.randomState = this.initialSeed >>> 0;
    this.replayMode = options.replay ?? false;
    this.state = createRallyState(
      options.reducedMotion ?? false,
      options.controlMode ?? RALLY_CONFIG.controls,
      options.scoringMode ?? RALLY_CONFIG.scoring.mode
    );
    this.adapter = options.adapter ?? new BrowserLocalBoreslayDemoAdapter();
    this.chooseAiLoadout();
    this.initialRngState = this.randomState;
  }

  get interpolationAlpha() {
    return clamp(this.accumulatorMs / FIXED_STEP_MS, 0, 1);
  }

  get hitStopMs() {
    return this.hitStopRemainingMs;
  }

  start() {
    if (this.state.status !== "idle" && this.state.status !== "paused") return;
    this.state.status = "playing";
    this.state.message = this.state.scoringMode === "buttHybrid"
      ? "Hit the target behind Clockhead. Bank shots score double."
      : "Rally the Excuse into Clockhead's Reality Gate.";
    if (!this.state.excuse.inPlay && this.state.serveAt === null) {
      this.state.serveAt = this.state.timeMs +
        (this.state.controlMode === "duel" ? RALLY_CONFIG.duel.serveMs : 480);
      this.state.servingSide = "clockhead";
    }
    this.emit("status");
    this.recordInput("start");
  }

  pause() {
    if (this.state.status !== "playing") return;
    this.state.status = "paused";
    this.state.message = "Rally paused. The arena is holding its breath.";
    this.emit("status");
  }

  reset() {
    const reducedMotion = this.state.reducedMotion;
    const controlMode = this.state.controlMode;
    const scoringMode = this.state.scoringMode;
    this.state = createRallyState(reducedMotion, controlMode, scoringMode);
    this.accumulatorMs = 0;
    this.hitStopRemainingMs = 0;
    this.movement = { x: 0, y: 0 };
    this.aim = { x: 1, y: 0 };
    this.powerAim = { x: RALLY_CONFIG.arena.width / 2, y: RALLY_CONFIG.arena.height / 2 };
    this.breathRequested = false;
    this.events = [];
    this.randomState = this.initialSeed >>> 0;
    this.chooseAiLoadout();
    this.initialRngState = this.randomState;
    this.inputLog = [];
    this.inputOrder = 0;
    this.adapter.reset(`boreslay-rally-${this.initialSeed}`);
  }

  setReducedMotion(reducedMotion: boolean) {
    this.state.reducedMotion = reducedMotion;
    if (reducedMotion) this.state.trauma = 0;
  }

  setMovement(x: number, y: number) {
    if (x === 0 && y === 0) {
      this.movement = { x: 0, y: 0 };
      this.recordInput("movement", { x: 0, y: 0 });
      return;
    }
    this.movement = normalize(x, y);
    this.state.spark.facing = { ...this.movement };
    this.recordInput("movement", { x, y });
  }

  setAim(x: number, y: number) {
    this.powerAim = {
      x: clamp(x, 0, RALLY_CONFIG.arena.width),
      y: clamp(y, 0, RALLY_CONFIG.arena.height),
    };
    this.aim = normalize(x - this.state.spark.x, y - this.state.spark.y);
    this.state.spark.facing = { ...this.aim };
    this.recordInput("aim", { x, y });
  }

  jump() {
    if (this.state.controlMode !== "duel" || this.state.status !== "playing") return false;
    this.state.duel.spark.jumpBufferMs = RALLY_CONFIG.duel.bufferMs;
    this.recordInput("jump");
    return true;
  }

  duelStrike(kind: "strike" | "loft") {
    if (this.state.controlMode !== "duel") return false;
    return this.tryDuelStrike("spark", kind === "loft" ? 1 : 0);
  }

  selectPower(power: RallyPowerId) {
    if (this.state.status !== "idle") return false;
    const loadout = this.state.powers.loadout;
    const existing = loadout.indexOf(power);
    if (existing >= 0) {
      loadout.splice(existing, 1);
      this.recordInput("power_selected", { power });
      return true;
    }
    if (loadout.length >= RALLY_CONFIG.powers.slots) loadout.shift();
    loadout.push(power);
    this.emit("power_selected", undefined, undefined, "spark", undefined, undefined, power);
    this.recordInput("power_selected", { power });
    return true;
  }

  beginPower(slot: number, x = this.powerAim.x, y = this.powerAim.y) {
    const power = this.state.powers.loadout[slot];
    if (
      this.state.status !== "playing" ||
      !power ||
      this.state.powers.spent[power] ||
      this.state.powers.placement
    ) return false;
    if (power === "redTape" || power === "deadlineStamp") {
      this.state.powers.placement = {
        power,
        startedAt: this.state.timeMs,
        startedTick: this.state.tick,
        x: clamp(x, 0, RALLY_CONFIG.arena.width),
        y: clamp(y, 0, RALLY_CONFIG.arena.height),
      };
      return true;
    }
    this.activatePower(power, x, y, "spark");
    return true;
  }

  updatePowerAim(x: number, y: number) {
    const placement = this.state.powers.placement;
    if (!placement) return;
    placement.x = clamp(x, 0, RALLY_CONFIG.arena.width);
    placement.y = clamp(y, 0, RALLY_CONFIG.arena.height);
  }

  confirmPower(x?: number, y?: number) {
    const placement = this.state.powers.placement;
    if (!placement) return false;
    if (x !== undefined && y !== undefined) this.updatePowerAim(x, y);
    this.state.powers.placement = null;
    this.activatePower(placement.power, placement.x, placement.y, "spark");
    return true;
  }

  setBreath(active: boolean) {
    if (this.breathRequested === active) return;
    if (!active && this.state.spark.breathHeldMs >= RALLY_CONFIG.spark.chargedBreathMs) {
      this.state.excuse.ignitedUntil = this.state.timeMs + RALLY_CONFIG.excuse.igniteMs;
      this.state.message = "CHARGED IGNITE — the Excuse burns hotter.";
      this.emit("ignite", this.state.excuse.x, this.state.excuse.y);
      this.emit("charged_release", this.state.spark.x, this.state.spark.y);
    }
    this.breathRequested = active;
    if (
      active &&
      this.state.status === "playing" &&
      this.state.timeMs >= this.state.spark.frozenUntil &&
      this.state.spark.energy > 0
    ) {
      const mouth = this.sparkMouthPosition();
      this.state.spark.exhaustedNotified = false;
      this.emit("breath_start", mouth.x, mouth.y);
    }
    if (!active) {
      this.state.spark.breathing = false;
      this.state.spark.breathHeldMs = 0;
      this.state.spark.exhaustedNotified = false;
    }
    this.recordInput("breath", { active });
  }

  dash() {
    const { spark, timeMs, status } = this.state;
    if (
      status !== "playing" ||
      timeMs < spark.dashReadyAt ||
      timeMs < spark.frozenUntil ||
      spark.energy < RALLY_CONFIG.spark.dashEnergyCost
    ) {
      return false;
    }
    const direction =
      this.movement.x !== 0 || this.movement.y !== 0
        ? this.movement
        : spark.facing;
    spark.x = clamp(
      spark.x + direction.x * RALLY_CONFIG.spark.dashDistance,
      RALLY_CONFIG.spark.minX,
      RALLY_CONFIG.spark.maxX
    );
    spark.y = clamp(
      spark.y + direction.y * RALLY_CONFIG.spark.dashDistance,
      RALLY_CONFIG.spark.minY,
      RALLY_CONFIG.spark.maxY
    );
    spark.energy -= RALLY_CONFIG.spark.dashEnergyCost;
    spark.dashUntil = timeMs + RALLY_CONFIG.spark.dashDurationMs;
    spark.invulnerableUntil = timeMs + RALLY_CONFIG.spark.dashInvulnerabilityMs;
    spark.dashReadyAt = timeMs + RALLY_CONFIG.spark.dashCooldownMs;
    this.emit("dash", spark.x, spark.y, "spark");
    this.recordInput("dash");

    const excuse = this.state.excuse;
    if (
      excuse.inPlay &&
      length(excuse.x - spark.x, excuse.y - spark.y) <=
        RALLY_CONFIG.spark.dashDeflectRange + RALLY_CONFIG.excuse.radius
    ) {
      this.returnExcuse("spark", direction, RALLY_CONFIG.spark.dashDeflectMultiplier);
    }
    return true;
  }

  acceptRescue() {
    const mission = this.state.mission;
    if (
      this.state.status !== "playing" ||
      mission.status !== "ready" ||
      mission.acceptDeadline === null ||
      this.state.timeMs > mission.acceptDeadline
    ) {
      return false;
    }
    mission.deployment = this.adapter.deployCrewMission(
      this.state.timeMs,
      `boreslay-rally-rescue-${this.initialSeed}`
    );
    const result = this.adapter.resolveCrewMission(mission.deployment);
    this.applyMissionResult(result);
    this.recordInput("mission_accept", { result: result as unknown as Record<string, unknown> });
    return true;
  }

  applyRecordedMission(result: SimulatedCrewMissionResult) {
    this.state.mission.status = "ready";
    this.applyMissionResult(result);
  }

  private applyMissionResult(result: SimulatedCrewMissionResult) {
    const mission = this.state.mission;
    const effects = result.combatRewards.rallyEffects;
    mission.status = "accepted";
    if (effects?.breakFreeze) this.state.spark.frozenUntil = this.state.timeMs;

    const multiplier = effects?.returnForceMultiplier ?? RALLY_CONFIG.rescue.returnForceMultiplier;
    if (this.state.excuse.inPlay) {
      const target = normalize(
        RALLY_CONFIG.arena.width - this.state.excuse.x,
        RALLY_CONFIG.clockhead.spawnY - this.state.excuse.y
      );
      this.returnExcuse("spark", target, multiplier);
    }
    this.state.message = "SIMULATED MISSION ACCEPTED — Closer broke the freeze.";
    this.emit("freeze_break", this.state.spark.x, this.state.spark.y);
    this.emit("rescue_accepted");
  }

  getReplayRecord(): RallyReplayRecord {
    return {
      seed: this.initialSeed,
      controlMode: this.state.controlMode,
      scoringMode: this.state.scoringMode,
      initialConfigHash: configHash(),
      initialRngState: this.initialRngState,
      inputLog: this.inputLog.map(event => ({
        ...event,
        payload: event.payload ? structuredClone(event.payload) : undefined,
      })),
    };
  }

  serializeRandomState() {
    return this.randomState;
  }

  restoreRandomState(randomState: number) {
    if (!this.replayMode) return false;
    this.randomState = randomState >>> 0;
    return true;
  }

  applyReplayInput(event: RallyInputEvent) {
    const payload = event.payload ?? {};
    switch (event.type) {
      case "start": this.start(); break;
      case "movement": this.setMovement(Number(payload.x), Number(payload.y)); break;
      case "aim": this.setAim(Number(payload.x), Number(payload.y)); break;
      case "jump": this.jump(); break;
      case "strike": this.duelStrike(payload.kind === "loft" ? "loft" : "strike"); break;
      case "breath": this.setBreath(Boolean(payload.active)); break;
      case "dash": this.dash(); break;
      case "power_selected": this.selectPower(payload.power as RallyPowerId); break;
      case "power_cast":
        this.activatePower(
          payload.power as RallyPowerId,
          Number(payload.x),
          Number(payload.y),
          "spark"
        );
        break;
      case "mission_accept":
        this.applyRecordedMission(payload.result as unknown as SimulatedCrewMissionResult);
        break;
      case "ai_power":
      case "ai_decision":
        break;
    }
  }

  advanceFrame(frameMs: number) {
    if (this.state.status === "paused" || this.state.status === "idle") return;
    if (this.state.ceremony) {
      this.advanceCeremony(frameMs);
      return;
    }
    if (this.state.status !== "playing") return;
    let remaining = clamp(frameMs, 0, RALLY_CONFIG.simulation.maxFrameMs);
    if (this.hitStopRemainingMs > 0) {
      const consumed = Math.min(remaining, this.hitStopRemainingMs);
      this.hitStopRemainingMs -= consumed;
      remaining -= consumed;
    }
    this.accumulatorMs += remaining;
    while (this.accumulatorMs >= FIXED_STEP_MS) {
      this.stepFixed(FIXED_STEP_MS);
      this.accumulatorMs -= FIXED_STEP_MS;
    }
  }

  advanceFixedSteps(steps: number) {
    for (let index = 0; index < steps; index += 1) this.stepFixed(FIXED_STEP_MS);
  }

  consumeEvents() {
    const pending = this.events;
    this.events = [];
    return pending;
  }

  stateHash() {
    const { state } = this;
    const values = [
      state.timeMs,
      state.tick,
      state.controlMode === "duel" ? 1 : 0,
      state.spark.x,
      state.spark.y,
      state.spark.energy,
      state.spark.frozenUntil,
      state.duel.spark.vy,
      state.duel.spark.grounded ? 1 : 0,
      state.duel.spark.strikeCooldownUntil,
      state.duel.spark.meter,
      state.clockhead.x,
      state.clockhead.y,
      state.clockhead.staggerUntil,
      state.clockhead.whiffUntil,
      state.duel.clockhead.vy,
      state.duel.clockhead.grounded ? 1 : 0,
      state.duel.clockhead.strikeCooldownUntil,
      state.duel.clockhead.meter,
      state.duel.aiTilt,
      state.excuse.x,
      state.excuse.y,
      state.excuse.vx,
      state.excuse.vy,
      state.excuse.rallyCount,
      state.excuse.bankState ? 1 : 0,
      state.excuse.stallMs,
      state.sparkScore,
      state.clockheadScore,
      state.regulationRemainingMs,
      state.suddenDeath ? 1 : 0,
      state.powers.hardNoUntil.spark,
      state.powers.hardNoUntil.clockhead,
      state.powers.redTape?.expiresAt ?? 0,
      state.powers.deadlineStamp?.expiresAt ?? 0,
      state.powers.receiptsUntil,
      ...state.powers.loadout.map(power => state.powers.spent[power] ? 1 : 0),
      state.influence,
      state.ceremony?.committed ? 1 : 0,
      this.randomState,
    ].map(value => Math.round(value * 1000));
    return values.join(":");
  }

  private stepFixed(dtMs: number) {
    const state = this.state;
    if (state.status !== "playing" || state.ceremony) return;
    if (state.controlMode === "duel") {
      this.stepDuelFixed(dtMs);
      return;
    }
    const tutorialSlow =
      !state.firstPlayerContact &&
      state.tutorialSlowUntil > state.timeMs;
    const placementSlow = state.powers.placement !== null;
    const scaledDtMs =
      dtMs * Math.min(
        tutorialSlow ? RALLY_CONFIG.scoring.firstServeTimeScale : 1,
        placementSlow ? RALLY_CONFIG.powers.placementTimeScale : 1
      );
    const dt = scaledDtMs / 1000;
    state.tick += 1;
    state.timeMs += scaledDtMs;
    this.updateRegulationClock(scaledDtMs);
    if (state.status !== "playing") return;
    if (!state.reducedMotion) {
      state.trauma = Math.max(
        0,
        state.trauma - RALLY_CONFIG.feel.traumaDecayPerSecond * dt
      );
    } else {
      state.trauma = 0;
    }

    state.spark.prevX = state.spark.x;
    state.spark.prevY = state.spark.y;
    state.clockhead.prevX = state.clockhead.x;
    state.clockhead.prevY = state.clockhead.y;
    state.buttTargets.spark.prevX = state.buttTargets.spark.x;
    state.buttTargets.spark.prevY = state.buttTargets.spark.y;
    state.buttTargets.clockhead.prevX = state.buttTargets.clockhead.x;
    state.buttTargets.clockhead.prevY = state.buttTargets.clockhead.y;
    state.excuse.prevX = state.excuse.x;
    state.excuse.prevY = state.excuse.y;

    this.updateMission();
    this.updateServe();
    this.updateSpark(dt, scaledDtMs);
    this.updateClockhead(dt);
    this.updateButtTargets(dt);
    this.updatePowers();
    this.updateExcuse(dt);
    this.maybeTriggerRescue();
  }

  private stepDuelFixed(dtMs: number) {
    const state = this.state;
    const dt = dtMs / 1000;
    state.tick += 1;
    state.timeMs += dtMs;
    this.updateRegulationClock(dtMs);
    if (state.status !== "playing") return;
    if (!state.reducedMotion) {
      state.trauma = Math.max(
        0,
        state.trauma - RALLY_CONFIG.feel.traumaDecayPerSecond * dt
      );
    } else {
      state.trauma = 0;
    }

    state.spark.prevX = state.spark.x;
    state.spark.prevY = state.spark.y;
    state.clockhead.prevX = state.clockhead.x;
    state.clockhead.prevY = state.clockhead.y;
    state.buttTargets.spark.prevX = state.buttTargets.spark.x;
    state.buttTargets.spark.prevY = state.buttTargets.spark.y;
    state.buttTargets.clockhead.prevX = state.buttTargets.clockhead.x;
    state.buttTargets.clockhead.prevY = state.buttTargets.clockhead.y;
    state.excuse.prevX = state.excuse.x;
    state.excuse.prevY = state.excuse.y;

    this.updateMission();
    this.updateServe();
    this.updateDuelAi(dt);
    this.updateDuelFighter("spark", dt, this.movement.x);
    this.updateDuelFighter("clockhead", dt, state.duel.clockhead.moveDir);
    this.resolveDuelFighterPush();
    this.updateDuelFacing();
    this.updateButtTargets(dt);
    this.updateDuelExcuse(dt);
    this.maybeTriggerRescue();
  }

  private resetDuelFightersForServe() {
    const { groundY } = RALLY_CONFIG.duel;
    this.state.spark.x = 300;
    this.state.spark.y = groundY;
    this.state.spark.prevX = this.state.spark.x;
    this.state.spark.prevY = this.state.spark.y;
    this.state.spark.facing = { x: 1, y: 0 };
    this.state.spark.frozenUntil = 0;
    this.state.clockhead.x = 900;
    this.state.clockhead.y = groundY;
    this.state.clockhead.prevX = this.state.clockhead.x;
    this.state.clockhead.prevY = this.state.clockhead.y;
    this.state.clockhead.facing = { x: -1, y: 0 };
    this.state.clockhead.telegraph = "none";
    this.state.clockhead.telegraphUntil = 0;
    this.state.duel.spark = { ...createDuelFighter(), meter: this.state.duel.spark.meter };
    this.state.duel.clockhead = { ...createDuelFighter(), meter: this.state.duel.clockhead.meter };
  }

  private updateDuelFighter(side: RallySide, dt: number, moveX: number) {
    const fighter = side === "spark" ? this.state.spark : this.state.clockhead;
    const duel = this.state.duel[side];
    const radius = side === "spark" ? RALLY_CONFIG.spark.radius : RALLY_CONFIG.clockhead.radius;
    const speed = side === "spark" ? RALLY_CONFIG.duel.moveSpeedP : RALLY_CONFIG.duel.moveSpeedAI;
    const frozen = side === "spark" && this.state.timeMs < fighter.frozenUntil;
    const moveDir = frozen ? 0 : clamp(moveX, -1, 1);
    duel.moveDir = moveDir;
    duel.vxInst = moveDir * speed;
    fighter.x = clamp(fighter.x + duel.vxInst * dt, radius + 42, RALLY_CONFIG.arena.width - radius - 42);

    if (duel.grounded) duel.coyoteMs = RALLY_CONFIG.duel.coyoteMs;
    else duel.coyoteMs = Math.max(0, duel.coyoteMs - dt * 1000);
    if (frozen) duel.jumpBufferMs = 0;
    else duel.jumpBufferMs = Math.max(0, duel.jumpBufferMs - dt * 1000);
    if (duel.jumpBufferMs > 0 && (duel.grounded || duel.coyoteMs > 0)) {
      duel.vy = -RALLY_CONFIG.duel.jumpVelocity;
      duel.grounded = false;
      duel.coyoteMs = 0;
      duel.jumpBufferMs = 0;
      this.emit("jump", fighter.x, fighter.y, side);
    }

    if (!duel.grounded) {
      duel.vy += RALLY_CONFIG.duel.gravity * dt;
      fighter.y += duel.vy * dt;
      if (fighter.y >= RALLY_CONFIG.duel.groundY) {
        fighter.y = RALLY_CONFIG.duel.groundY;
        duel.vy = 0;
        duel.grounded = true;
        duel.squash = Math.max(duel.squash, 0.5);
      }
    }
    duel.swingUntil = Math.max(0, duel.swingUntil - dt * 1000);
    if (duel.swingUntil === 0) duel.swingKind = null;
    duel.squash = Math.max(0, duel.squash - dt * 3);
    if (duel.surgeUntil > 0) duel.surgeUntil = Math.max(0, duel.surgeUntil - dt * 1000);
  }

  private updateDuelFacing() {
    const gap = this.state.clockhead.x - this.state.spark.x;
    if (gap > RALLY_CONFIG.duel.fighterDeadband && this.state.spark.facing.x !== 1) {
      this.state.spark.facing = { x: 1, y: 0 };
      this.state.clockhead.facing = { x: -1, y: 0 };
      this.state.duel.aiTilt = clamp(this.state.duel.aiTilt + RALLY_CONFIG.duel.tiltCrossover, 0, 1);
      this.emit("crossover", this.state.spark.x, this.state.spark.y, "spark");
    } else if (gap < -RALLY_CONFIG.duel.fighterDeadband && this.state.spark.facing.x !== -1) {
      this.state.spark.facing = { x: -1, y: 0 };
      this.state.clockhead.facing = { x: 1, y: 0 };
      this.state.duel.aiTilt = clamp(this.state.duel.aiTilt + RALLY_CONFIG.duel.tiltCrossover, 0, 1);
      this.emit("crossover", this.state.spark.x, this.state.spark.y, "spark");
    }
  }

  private resolveDuelFighterPush() {
    const spark = this.state.spark;
    const clockhead = this.state.clockhead;
    const dx = clockhead.x - spark.x;
    const dy = (clockhead.y - RALLY_CONFIG.clockhead.radius * 0.2) -
      (spark.y - RALLY_CONFIG.spark.radius * 0.2);
    const min = (RALLY_CONFIG.spark.radius + RALLY_CONFIG.clockhead.radius) *
      RALLY_CONFIG.duel.fighterSoftMinScale;
    const distance = length(dx, dy);
    if (distance <= 0 || distance >= min || Math.abs(dy) >= min * RALLY_CONFIG.duel.fighterSoftOverlap) return;
    const push = ((min - distance) * 0.5) * Math.sign(dx || 1);
    spark.x = clamp(spark.x - push, RALLY_CONFIG.spark.radius + 42, RALLY_CONFIG.arena.width - RALLY_CONFIG.spark.radius - 42);
    clockhead.x = clamp(clockhead.x + push, RALLY_CONFIG.clockhead.radius + 42, RALLY_CONFIG.arena.width - RALLY_CONFIG.clockhead.radius - 42);
  }

  private updateDuelAi(dt: number) {
    const duel = this.state.duel;
    if (this.state.timeMs >= duel.aiIntentUntil) {
      this.rollDuelAiIntent();
    }
    duel.aiTilt = Math.max(0, duel.aiTilt - RALLY_CONFIG.duel.tiltDecayPerSecond * dt);
    if (this.state.timeMs >= duel.aiThinkAt) {
      duel.aiThinkAt = this.state.timeMs + 90;
      const targetX = this.duelAiTargetX();
      const delta = targetX - this.state.clockhead.x;
      duel.clockhead.moveDir = Math.abs(delta) > 14 ? Math.sign(delta) : 0;
      const blocked =
        duel.clockhead.grounded &&
        duel.clockhead.moveDir !== 0 &&
        Math.sign(this.state.spark.x - this.state.clockhead.x) === duel.clockhead.moveDir &&
        Math.abs(this.state.spark.x - this.state.clockhead.x) <
          RALLY_CONFIG.spark.radius + RALLY_CONFIG.clockhead.radius + 26 &&
        this.state.duel.spark.grounded;
      const headerSeek =
        duel.aiIntent === "PRESSURE" &&
        duel.clockhead.grounded &&
        Math.abs(this.state.excuse.x - this.state.clockhead.x) < 120 &&
        this.state.excuse.y < this.state.clockhead.y - 40 &&
        this.state.excuse.y > 60;
      if (blocked || headerSeek) duel.clockhead.jumpBufferMs = RALLY_CONFIG.duel.bufferMs;
    }
    const inRange =
      this.state.excuse.inPlay &&
      length(this.state.excuse.x - this.state.clockhead.x, this.state.excuse.y - this.state.clockhead.y) <=
        RALLY_CONFIG.duel.strikeRange + RALLY_CONFIG.duel.excuseRadius;
    if (duel.aiPendingStrikeAt > 0 && this.state.timeMs >= duel.aiPendingStrikeAt) {
      duel.aiPendingStrikeAt = 0;
      if (inRange) this.tryDuelStrike("clockhead", duel.aiPendingStrikeKind);
    } else if (
      inRange &&
      this.state.timeMs >= duel.clockhead.strikeCooldownUntil &&
      this.state.timeMs - this.state.excuse.lastTouchAt > 250
    ) {
      const kind = this.state.duel.spark.grounded ? (this.random() < 0.62 ? 1 : 0) : 0;
      if (duel.aiIntent === "BAIT" && this.random() < 0.6) {
        duel.aiPendingStrikeAt =
          this.state.timeMs +
          RALLY_CONFIG.duel.aiBaitDelayMinMs +
          this.random() * (RALLY_CONFIG.duel.aiBaitDelayMaxMs - RALLY_CONFIG.duel.aiBaitDelayMinMs);
        duel.aiPendingStrikeKind = kind;
        this.recordInput("ai_decision", { intent: duel.aiIntent, pendingStrikeAt: duel.aiPendingStrikeAt, kind });
      } else {
        this.tryDuelStrike("clockhead", kind);
      }
    }
  }

  private duelAiTargetX() {
    const { aiIntent } = this.state.duel;
    const { width } = RALLY_CONFIG.arena;
    switch (aiIntent) {
      case "PRESSURE":
        return clamp(this.state.excuse.x + (this.state.excuse.x > this.state.clockhead.x ? 20 : -20), 110, width - 110);
      case "GUARD":
        return clamp(this.state.excuse.x + 130, width * 0.55, width - 120);
      case "BAIT":
        return width * 0.62 + Math.sin(this.state.timeMs / 300) * 26;
      case "CONTEST":
      default:
        return clamp(this.state.excuse.x + 40, width * 0.3, width - 110);
    }
  }

  private rollDuelAiIntent() {
    const duel = this.state.duel;
    const diff = this.state.clockheadScore - this.state.sparkScore;
    const seconds = this.state.regulationRemainingMs / 1000;
    const tilt = duel.aiTilt;
    const weights: Record<RallyDuelIntent, number> = {
      PRESSURE: 0.28 * RALLY_CONFIG.duel.aiAggro + tilt * 0.25,
      CONTEST: 0.32,
      GUARD: 0.22 - tilt * 0.08,
      BAIT: 0.18 - tilt * 0.05,
    };
    if (diff < 0) weights.PRESSURE += 0.14;
    if (diff > 1) {
      weights.GUARD += 0.12;
      weights.BAIT += 0.06;
    }
    if (seconds < 20 && diff <= 0) weights.PRESSURE += 0.22;
    if (this.state.excuse.x < RALLY_CONFIG.arena.width * 0.42) weights.CONTEST += 0.1;
    let total = 0;
    for (const intent of Object.keys(weights) as RallyDuelIntent[]) {
      weights[intent] = Math.max(0.02, weights[intent]);
      total += weights[intent];
    }
    let roll = this.random() * total;
    for (const intent of Object.keys(weights) as RallyDuelIntent[]) {
      roll -= weights[intent];
      if (roll <= 0) {
        duel.aiIntent = intent;
        break;
      }
    }
    duel.aiIntentUntil =
      this.state.timeMs +
      RALLY_CONFIG.duel.aiIntentMinMs +
      this.random() * (RALLY_CONFIG.duel.aiIntentMaxMs - RALLY_CONFIG.duel.aiIntentMinMs);
    this.recordInput("ai_decision", { intent: duel.aiIntent, until: duel.aiIntentUntil });
  }

  private tryDuelStrike(side: RallySide, strikeButton: 0 | 1) {
    if (this.state.status !== "playing" || !this.state.excuse.inPlay) return false;
    const actor = side === "spark" ? this.state.spark : this.state.clockhead;
    const duel = this.state.duel[side];
    if (side === "spark" && this.state.timeMs < actor.frozenUntil) return false;
    if (this.state.timeMs < duel.strikeCooldownUntil) return false;
    const grounded = duel.grounded;
    const kind: RallyStrikeKind = grounded
      ? strikeButton === 0 ? "flat" : "arc"
      : strikeButton === 0 ? "spike" : "lob";
    duel.strikeCooldownUntil = this.state.timeMs + RALLY_CONFIG.duel.strikeCooldownMs;
    duel.swingUntil = 140;
    duel.swingKind = kind;
    if (side === "spark") {
      this.state.duel.playerHabits[kind] += 1;
      this.recordInput("strike", { kind: strikeButton === 0 ? "strike" : "loft", cell: kind });
    } else {
      this.recordInput("ai_decision", { action: "strike", cell: kind });
    }
    const dx = this.state.excuse.x - actor.x;
    const dy = this.state.excuse.y - actor.y;
    if (length(dx, dy) > RALLY_CONFIG.duel.strikeRange + RALLY_CONFIG.duel.excuseRadius) {
      this.emit("strike_whiff", actor.x, actor.y, side);
      return false;
    }

    const { speed, angle } = this.duelStrikeSpec(kind);
    const multiplier = side === "spark" && duel.surgeUntil > 0 ? RALLY_CONFIG.duel.surgeMultiplier : 1;
    const radians = (angle * Math.PI) / 180;
    const direction = actor.facing.x >= 0 ? 1 : -1;
    this.state.excuse.vx = Math.cos(radians) * speed * multiplier * direction;
    this.state.excuse.vy = -Math.sin(radians) * speed * multiplier;
    this.state.excuse.spin = 8 * direction;
    this.state.excuse.lastTouchedBy = side;
    this.state.excuse.lastTouchAt = this.state.timeMs;
    this.state.excuse.rallyCount += 1;
    this.state.excuse.bankState = false;
    this.state.excuse.stallMs = 0;
    this.state.excuse.speedTier = this.speedTier(length(this.state.excuse.vx, this.state.excuse.vy));
    if (side === "spark") this.state.firstPlayerContact = true;
    duel.meter = clamp(duel.meter + RALLY_CONFIG.duel.powerRate, 0, 100);
    this.addHitStop(RALLY_CONFIG.feel.returnHitStopMs);
    this.addTrauma(RALLY_CONFIG.feel.traumaReturn);
    this.emit("strike_crack", this.state.excuse.x, this.state.excuse.y, side);
    return true;
  }

  private duelStrikeSpec(kind: RallyStrikeKind) {
    switch (kind) {
      case "flat":
        return { speed: RALLY_CONFIG.duel.strikeFlatSpeed, angle: RALLY_CONFIG.duel.strikeFlatAngle };
      case "arc":
        return { speed: RALLY_CONFIG.duel.strikeArcSpeed, angle: RALLY_CONFIG.duel.strikeArcAngle };
      case "spike":
        return { speed: RALLY_CONFIG.duel.strikeSpikeSpeed, angle: RALLY_CONFIG.duel.strikeSpikeAngle };
      case "lob":
        return { speed: RALLY_CONFIG.duel.strikeLobSpeed, angle: RALLY_CONFIG.duel.strikeLobAngle };
    }
  }

  private updateDuelExcuse(dt: number) {
    const excuse = this.state.excuse;
    if (!excuse.inPlay) return;
    const speedBeforeStep = length(excuse.vx, excuse.vy);
    const collisionSteps =
      speedBeforeStep >= RALLY_CONFIG.excuse.continuousCollisionSpeed
        ? 3
        : speedBeforeStep >= RALLY_CONFIG.buttTarget.highSpeedSubstepThreshold
          ? 2
          : 1;
    const collisionDt = dt / collisionSteps;
    for (let step = 0; step < collisionSteps; step += 1) {
      excuse.vy += RALLY_CONFIG.duel.gravity * RALLY_CONFIG.duel.ballGravScale * collisionDt;
      excuse.vx *= 1 - RALLY_CONFIG.duel.drag * collisionDt;
      this.capDuelExcuseSpeed();
      const beforeX = excuse.x;
      const beforeY = excuse.y;
      excuse.x += excuse.vx * collisionDt;
      excuse.y += excuse.vy * collisionDt;
      if (this.state.scoringMode === "buttHybrid") {
        if (this.resolveButtTargetSweep(beforeX, beforeY)) return;
      }
      this.resolveDuelFighterContact();
      this.resolveDuelStraightWalls();
      this.capDuelExcuseSpeed();
    }
    const speed = length(excuse.vx, excuse.vy);
    if (speed < 90 && excuse.y > RALLY_CONFIG.duel.groundY - 40) {
      excuse.stallMs += dt * 1000;
      if (excuse.stallMs > RALLY_CONFIG.duel.antiStallMs) {
        excuse.vy = -640;
        excuse.vx = (this.random() < 0.5 ? -1 : 1) * 220;
        excuse.stallMs = 0;
      }
    } else {
      excuse.stallMs = 0;
    }
    excuse.spin += length(excuse.vx, excuse.vy) * dt * 0.008;
    this.updateTrail();
    excuse.speedTier = this.speedTier(length(excuse.vx, excuse.vy));
  }

  private resolveDuelStraightWalls() {
    const excuse = this.state.excuse;
    const radius = RALLY_CONFIG.duel.excuseRadius;
    const floorY = RALLY_CONFIG.duel.groundY + RALLY_CONFIG.duel.groundPad - radius;
    if (excuse.x < radius) {
      excuse.x = radius;
      excuse.vx = Math.abs(excuse.vx) * RALLY_CONFIG.duel.restWall;
      this.wallBounce();
    } else if (excuse.x > RALLY_CONFIG.arena.width - radius) {
      excuse.x = RALLY_CONFIG.arena.width - radius;
      excuse.vx = -Math.abs(excuse.vx) * RALLY_CONFIG.duel.restWall;
      this.wallBounce();
    }
    if (excuse.y < radius) {
      excuse.y = radius;
      excuse.vy = Math.abs(excuse.vy) * RALLY_CONFIG.duel.restWall;
      this.wallBounce();
    } else if (excuse.y > floorY) {
      excuse.y = floorY;
      excuse.vy = -Math.abs(excuse.vy) * RALLY_CONFIG.duel.restFloor;
      if (Math.abs(excuse.vx) < 70) {
        excuse.vx = (70 + this.random() * 40) * Math.sign(excuse.vx || (this.random() < 0.5 ? -1 : 1));
      }
      this.emit("wall_bounce", excuse.x, excuse.y);
    }
  }

  private resolveDuelFighterContact() {
    if (this.state.timeMs - this.state.excuse.lastTouchAt < RALLY_CONFIG.excuse.contactLockMs) return;
    if (this.resolveDuelBodyContact("spark")) return;
    this.resolveDuelBodyContact("clockhead");
  }

  private resolveDuelBodyContact(side: RallySide) {
    const fighter = side === "spark" ? this.state.spark : this.state.clockhead;
    const duel = this.state.duel[side];
    const fighterRadius = side === "spark" ? RALLY_CONFIG.spark.radius : RALLY_CONFIG.clockhead.radius;
    const fx = fighter.x;
    const fy = fighter.y - fighterRadius * 0.2;
    const excuse = this.state.excuse;
    const dx = excuse.x - fx;
    const dy = excuse.y - fy;
    const distance = length(dx, dy);
    const minimum = RALLY_CONFIG.duel.excuseRadius + fighterRadius;
    if (distance <= 0 || distance >= minimum) return false;
    const nx = dx / distance;
    const ny = dy / distance;
    excuse.x = fx + nx * minimum;
    excuse.y = fy + ny * minimum;
    const relVx = excuse.vx - duel.vxInst;
    const relVy = excuse.vy - duel.vy;
    const dot = relVx * nx + relVy * ny;
    if (dot >= 0) return false;
    excuse.vx = (relVx - 2 * dot * nx) * 0.82 + duel.vxInst * RALLY_CONFIG.duel.headerPower;
    excuse.vy = (relVy - 2 * dot * ny) * 0.82 + duel.vy * 0.9 * RALLY_CONFIG.duel.headerPower;
    const standingDink = duel.grounded && Math.abs(duel.vxInst) < 1 && Math.abs(duel.vy) < 1;
    if (standingDink) {
      const speed = length(excuse.vx, excuse.vy);
      if (speed > RALLY_CONFIG.duel.maxDinkSpeed) {
        const scale = RALLY_CONFIG.duel.maxDinkSpeed / speed;
        excuse.vx *= scale;
        excuse.vy *= scale;
      }
    }
    excuse.lastTouchedBy = side;
    excuse.lastTouchAt = this.state.timeMs;
    excuse.rallyCount += 1;
    excuse.bankState = false;
    excuse.stallMs = 0;
    if (side === "spark") this.state.firstPlayerContact = true;
    duel.meter = clamp(duel.meter + RALLY_CONFIG.duel.powerRate * RALLY_CONFIG.duel.touchPowerScale, 0, 100);
    const header = !duel.grounded || Math.abs(duel.vxInst) > 60;
    if (side === "spark" && header) this.state.duel.playerHabits.header += 1;
    const speed = length(excuse.vx, excuse.vy);
    excuse.speedTier = this.speedTier(speed);
    this.emit(header ? "contact_header" : "contact_dink", excuse.x, excuse.y, side);
    if (header && speed > RALLY_CONFIG.buttTarget.highSpeedSubstepThreshold) {
      this.addTrauma(RALLY_CONFIG.feel.traumaReturn * 0.5);
    }
    return true;
  }

  private capDuelExcuseSpeed() {
    const excuse = this.state.excuse;
    const speed = length(excuse.vx, excuse.vy);
    if (speed <= RALLY_CONFIG.duel.maxSpeed) return;
    const scale = RALLY_CONFIG.duel.maxSpeed / speed;
    excuse.vx *= scale;
    excuse.vy *= scale;
  }

  private updateRegulationClock(dtMs: number) {
    const state = this.state;
    if (state.regulationExpired || state.suddenDeath) return;
    state.regulationRemainingMs = Math.max(0, state.regulationRemainingMs - dtMs);
    if (state.regulationRemainingMs > 0) return;
    state.regulationExpired = true;
    this.emit("regulation_expired");
    if (state.sparkScore === state.clockheadScore) {
      state.suddenDeath = true;
      state.message = "SUDDEN DEATH — next score takes the contract.";
      this.emit("sudden_death");
      return;
    }
    const sparkWins = state.sparkScore > state.clockheadScore;
    state.status = sparkWins ? "victory" : "defeat";
    state.message = sparkWins
      ? "CONTRACT WON. Reality outscored the Excuse."
      : "CONTRACT LOST. The Excuse owned the clock.";
    this.emit(sparkWins ? "victory" : "defeat");
  }

  private updateMission() {
    const mission = this.state.mission;
    if (
      mission.status === "ready" &&
      mission.acceptDeadline !== null &&
      this.state.timeMs > mission.acceptDeadline
    ) {
      mission.status = "expired";
      this.state.message = "The rescue window closed. Hold the gate.";
      this.emit("status");
    }
  }

  private updatePowers() {
    const powers = this.state.powers;
    if (
      powers.placement &&
      (this.state.tick - powers.placement.startedTick) * FIXED_STEP_MS >=
        RALLY_CONFIG.powers.placementMaxMs
    ) this.confirmPower();

    if (powers.redTape && this.state.timeMs >= powers.redTape.expiresAt) {
      powers.redTape = null;
    }
    const stamp = powers.deadlineStamp;
    if (stamp && !stamp.slammed && this.state.timeMs >= stamp.impactAt) {
      stamp.slammed = true;
      this.emit("stamp_slam", stamp.x, stamp.y, "spark", undefined, undefined, "deadlineStamp");
      const excuse = this.state.excuse;
      if (
        excuse.inPlay &&
        length(excuse.x - stamp.x, excuse.y - stamp.y) <=
          RALLY_CONFIG.powers.deadlineStamp.zoneRadius + RALLY_CONFIG.excuse.radius
      ) {
        const side: RallySide = stamp.x < RALLY_CONFIG.arena.width / 2 ? "spark" : "clockhead";
        const direction = normalize(side === "spark" ? 1 : -1, (excuse.y - stamp.y) * 0.01);
        this.returnExcuse(side, direction, RALLY_CONFIG.powers.deadlineStamp.launchMultiplier);
      }
    }
    if (stamp && this.state.timeMs >= stamp.expiresAt) powers.deadlineStamp = null;
    this.maybeUseAiPower();
  }

  private chooseAiLoadout() {
    const pool: RallyPowerId[] = ["redTape", "hardNo", "deadlineStamp", "receipts"];
    const first = Math.floor(this.random() * pool.length);
    const firstPower = pool.splice(first, 1)[0];
    const secondPower = pool.splice(Math.floor(this.random() * pool.length), 1)[0];
    this.state.powers.aiLoadout = [firstPower, secondPower];
  }

  private maybeUseAiPower() {
    const { excuse, powers } = this.state;
    if (!excuse.inPlay || excuse.vx <= 0 || excuse.speedTier < 2) return;
    const power = powers.aiLoadout.find(candidate => !powers.aiSpent[candidate]);
    if (!power) return;
    const target = this.state.buttTargets.clockhead;
    const x = power === "deadlineStamp" ? excuse.x : target.x - 110;
    const y = power === "deadlineStamp" ? excuse.y : target.y;
    this.activatePower(power, x, y, "clockhead");
  }

  private activatePower(power: RallyPowerId, x: number, y: number, side: RallySide) {
    const powers = this.state.powers;
    const spent = side === "spark" ? powers.spent : powers.aiSpent;
    if (spent[power]) return;
    spent[power] = true;
    if (power === "redTape") {
      const angle = side === "spark" ? -0.34 : Math.PI + 0.34;
      powers.redTape = {
        x,
        y,
        angle,
        liveAt: this.state.timeMs + RALLY_CONFIG.powers.redTape.telegraphMs,
        expiresAt: this.state.timeMs + RALLY_CONFIG.powers.redTape.lifetimeMs,
        consumed: false,
      };
      this.emit("tape_place", x, y, side, undefined, undefined, power);
    } else if (power === "hardNo") {
      powers.hardNoUntil[side] = this.state.timeMs + RALLY_CONFIG.powers.hardNo.maxMs;
      this.emit("shield_up", x, y, side, undefined, undefined, power);
    } else if (power === "deadlineStamp") {
      const impactAt = this.state.timeMs + RALLY_CONFIG.powers.deadlineStamp.telegraphMs;
      powers.deadlineStamp = {
        x,
        y,
        angle: side === "spark"
          ? RALLY_CONFIG.powers.deadlineStamp.surfaceAngleRadians
          : Math.PI - RALLY_CONFIG.powers.deadlineStamp.surfaceAngleRadians,
        liveAt: impactAt,
        impactAt,
        expiresAt: impactAt + RALLY_CONFIG.powers.deadlineStamp.surfaceLifetimeMs,
        consumed: false,
        slammed: false,
      };
      this.emit("stamp_tick", x, y, side, undefined, undefined, power);
    } else {
      powers.receiptsUntil = this.state.timeMs + RALLY_CONFIG.powers.receipts.lifetimeMs;
      this.emit("receipts_on", this.state.excuse.x, this.state.excuse.y, side, undefined, undefined, power);
    }
    this.emit("power_cast", x, y, side, undefined, undefined, power);
    this.recordInput(side === "spark" ? "power_cast" : "ai_power", { power, x, y });
  }

  private updateServe() {
    if (this.state.serveAt === null || this.state.timeMs < this.state.serveAt) return;
    this.launchServe(this.state.servingSide);
  }

  private launchServe(side: RallySide) {
    if (this.state.controlMode === "duel") {
      this.launchDuelServe(side);
      return;
    }
    const excuse = this.state.excuse;
    const firstServe = this.state.timeMs < 2000 && excuse.rallyCount === 0;
    excuse.x = side === "clockhead" ? RALLY_CONFIG.clockhead.spawnX - 75 : RALLY_CONFIG.spark.spawnX + 75;
    excuse.y = side === "clockhead" ? RALLY_CONFIG.clockhead.spawnY : RALLY_CONFIG.spark.spawnY;
    excuse.prevX = excuse.x;
    excuse.prevY = excuse.y;
    excuse.vx = (side === "clockhead" ? -1 : 1) * RALLY_CONFIG.excuse.serveSpeed;
    excuse.vy = firstServe ? 38 : (this.random() - 0.5) * 170;
    excuse.spin = 0;
    excuse.speedTier = 0;
    excuse.ignitedUntil = 0;
    excuse.lastTouchedBy = side;
    excuse.lastTouchAt = this.state.timeMs;
    excuse.rallyCount = 0;
    excuse.bankState = false;
    excuse.inPlay = true;
    excuse.trailX.fill(excuse.x);
    excuse.trailY.fill(excuse.y);
    excuse.trailHead = 0;
    this.state.serveAt = null;
    if (firstServe) {
      this.state.tutorialSlowUntil =
        this.state.timeMs + RALLY_CONFIG.scoring.firstServeSlowMs;
    }
    this.state.message = side === "clockhead" ? "Clockhead serves the Excuse." : "Spark serves with fire.";
    this.emit("serve", excuse.x, excuse.y);
  }

  private launchDuelServe(side: RallySide) {
    const excuse = this.state.excuse;
    this.resetDuelFightersForServe();
    excuse.x = side === "clockhead" ? 880 : 320;
    excuse.y = 170;
    excuse.prevX = excuse.x;
    excuse.prevY = excuse.y;
    excuse.vx = 0;
    excuse.vy = 0;
    excuse.spin = 0;
    excuse.speedTier = 0;
    excuse.ignitedUntil = 0;
    excuse.lastTouchedBy = side;
    excuse.lastTouchAt = this.state.timeMs;
    excuse.rallyCount = 0;
    excuse.bankState = false;
    excuse.inPlay = true;
    excuse.stallMs = 0;
    excuse.trailX.fill(excuse.x);
    excuse.trailY.fill(excuse.y);
    excuse.trailHead = 0;
    this.state.serveAt = null;
    this.state.message = side === "clockhead" ? "Clockhead serves the Excuse." : "Spark serves the Excuse.";
    this.emit("serve", excuse.x, excuse.y);
  }

  private updateSpark(dt: number, dtMs: number) {
    const spark = this.state.spark;
    const frozen = this.state.timeMs < spark.frozenUntil;
    if (!frozen) {
      spark.x = clamp(
        spark.x + this.movement.x * RALLY_CONFIG.spark.moveSpeed * dt,
        RALLY_CONFIG.spark.minX,
        RALLY_CONFIG.spark.maxX
      );
      spark.y = clamp(
        spark.y + this.movement.y * RALLY_CONFIG.spark.moveSpeed * dt,
        RALLY_CONFIG.spark.minY,
        RALLY_CONFIG.spark.maxY
      );
    }

    if (this.breathRequested && !frozen && spark.energy > 0) {
      spark.breathing = true;
      spark.breathHeldMs += dtMs;
      spark.energy = Math.max(
        0,
        spark.energy - RALLY_CONFIG.spark.breathEnergyPerSecond * dt
      );
      const excuse = this.state.excuse;
      const toExcuse = normalize(excuse.x - spark.x, excuse.y - spark.y);
      const distanceToExcuse = length(excuse.x - spark.x, excuse.y - spark.y);
      const alignment = clamp(toExcuse.x * this.aim.x + toExcuse.y * this.aim.y, -1, 1);
      const angle = Math.acos(alignment);
      if (
        excuse.inPlay &&
        distanceToExcuse <= RALLY_CONFIG.spark.breathRange &&
        angle <= (RALLY_CONFIG.spark.breathHalfAngleDegrees * Math.PI) / 180
      ) {
        const charged = spark.breathHeldMs >= RALLY_CONFIG.spark.chargedBreathMs;
        const acceleration =
          RALLY_CONFIG.spark.breathAcceleration *
          (charged ? RALLY_CONFIG.spark.chargedBreathForceMultiplier : 1);
        excuse.vx += this.aim.x * acceleration * dt;
        excuse.vy += this.aim.y * acceleration * dt;
        excuse.bankState = false;
        this.state.firstPlayerContact = true;
        this.capExcuseSpeed();
        if (
          this.state.timeMs - spark.lastBreathContactAt >=
          RALLY_CONFIG.spark.breathContactEventIntervalMs
        ) {
          spark.lastBreathContactAt = this.state.timeMs;
          this.emit("breath_contact", excuse.x, excuse.y);
        }
      }
      if (
        Math.floor((spark.breathHeldMs - dtMs) / RALLY_CONFIG.spark.breathEventIntervalMs) !==
        Math.floor(spark.breathHeldMs / RALLY_CONFIG.spark.breathEventIntervalMs)
      ) {
        const mouth = this.sparkMouthPosition();
        this.emit("breath_loop", mouth.x, mouth.y);
      }
      if (
        spark.energy < RALLY_CONFIG.spark.breathExhaustedThreshold &&
        !spark.exhaustedNotified
      ) {
        spark.exhaustedNotified = true;
        const mouth = this.sparkMouthPosition();
        this.emit("breath_exhausted", mouth.x, mouth.y);
      }
    } else {
      spark.breathing = false;
      spark.energy = Math.min(
        RALLY_CONFIG.spark.energyMax,
        spark.energy + RALLY_CONFIG.spark.energyRegenPerSecond * dt
      );
      if (spark.energy >= RALLY_CONFIG.spark.breathExhaustedThreshold) {
        spark.exhaustedNotified = false;
      }
    }
  }

  private updateClockhead(dt: number) {
    const clockhead = this.state.clockhead;
    if (this.state.timeMs < clockhead.staggerUntil) return;

    if (this.state.timeMs < clockhead.exposedUntil) {
      clockhead.facing = { x: 1, y: 0 };
    } else {
      const focus = this.state.excuse.inPlay ? this.state.excuse : this.state.spark;
      clockhead.facing = normalize(focus.x - clockhead.x, focus.y - clockhead.y);
    }

    const targetY = clamp(
      this.state.excuse.inPlay ? this.state.excuse.y : RALLY_CONFIG.clockhead.spawnY,
      RALLY_CONFIG.clockhead.minY,
      RALLY_CONFIG.clockhead.maxY
    );
    const deltaY = targetY - clockhead.y;
    clockhead.y += clamp(
      deltaY,
      -RALLY_CONFIG.clockhead.moveSpeed * dt,
      RALLY_CONFIG.clockhead.moveSpeed * dt
    );

    if (clockhead.telegraph !== "none") {
      if (this.state.timeMs >= clockhead.telegraphUntil) {
        const completed = clockhead.telegraph;
        clockhead.telegraph = "none";
        if (completed === "swat") this.resolveClockSwat();
        else this.resolveFreeze();
      }
      return;
    }

    const excuse = this.state.excuse;
    if (
      excuse.inPlay &&
      excuse.vx > 0 &&
      excuse.x > 690 &&
      this.state.timeMs >= clockhead.reactionReadyAt
    ) {
      clockhead.telegraph = "swat";
      clockhead.telegraphUntil = this.state.timeMs + RALLY_CONFIG.clockhead.swatTelegraphMs;
    }
  }

  private resolveClockSwat() {
    const clockhead = this.state.clockhead;
    const excuse = this.state.excuse;
    const inRange =
      excuse.inPlay &&
      length(excuse.x - clockhead.x, excuse.y - clockhead.y) <=
        RALLY_CONFIG.clockhead.swatRadius;
    const forcedPlayableSwat = excuse.rallyCount < 2;
    const guaranteedOpening = excuse.rallyCount >= 7 && excuse.rallyCount % 8 === 7;
    const whiffs =
      !forcedPlayableSwat &&
      (guaranteedOpening || this.random() < RALLY_CONFIG.clockhead.whiffChance);
    if (!inRange || whiffs) {
      clockhead.whiffUntil = this.state.timeMs + RALLY_CONFIG.clockhead.whiffRecoveryMs;
      clockhead.reactionReadyAt = this.state.timeMs + 120;
      return;
    }

    const cornerY = this.random() < 0.5
      ? RALLY_CONFIG.arena.gateTop + 24
      : RALLY_CONFIG.arena.gateBottom - 24;
    const accuracy = this.state.excuse.speedTier / 3;
    const error = (this.random() - 0.5) * (110 - accuracy * 70);
    const direction = normalize(-excuse.x, cornerY + error - excuse.y);
    this.returnExcuse("clockhead", direction, RALLY_CONFIG.clockhead.swatMultiplier);
    clockhead.exposedUntil =
      this.state.timeMs + RALLY_CONFIG.buttTarget.clockheadExposureMs;
    clockhead.facing = { x: 1, y: 0 };

    if (
      clockhead.freezeUses === 0 &&
      excuse.rallyCount >= RALLY_CONFIG.clockhead.scriptedFreezeRally &&
      this.state.timeMs >= clockhead.freezeReadyAt
    ) {
      clockhead.telegraph = "freeze";
      clockhead.telegraphUntil = this.state.timeMs + RALLY_CONFIG.clockhead.freezeTelegraphMs;
      this.emit("freeze_cast", clockhead.x, clockhead.y);
    }
  }

  private resolveFreeze() {
    const clockhead = this.state.clockhead;
    clockhead.freezeUses += 1;
    clockhead.freezeReadyAt = this.state.timeMs + RALLY_CONFIG.clockhead.freezeCooldownMs;
    this.state.spark.frozenUntil = this.state.timeMs + RALLY_CONFIG.spark.freezeMs;
    this.state.message = "FREEZE — the Excuse is still moving!";
    this.openRescue();
  }

  private openRescue() {
    const mission = this.state.mission;
    if (mission.status === "accepted" || mission.status === "ready") return;
    mission.status = "ready";
    mission.readyAt = this.state.timeMs;
    mission.acceptDeadline = this.state.timeMs + RALLY_CONFIG.rescue.acceptWindowMs;
    this.emit("rescue_ready");
  }

  private maybeTriggerRescue() {
    const { excuse, mission, spark, clockheadScore } = this.state;
    if (mission.status !== "locked" || !excuse.inPlay || excuse.vx >= 0) return;
    const frozenAndInbound =
      this.state.timeMs < spark.frozenUntil &&
      this.isButtTargetExposed("spark") &&
      excuse.x < RALLY_CONFIG.arena.width / 2;
    const desperateGate = clockheadScore >= RALLY_CONFIG.scoring.winScore - 1;
    const tierThreeInbound = excuse.speedTier === 3;
    if (frozenAndInbound || desperateGate || tierThreeInbound) this.openRescue();
  }

  private updateButtTargets(dt: number) {
    const { width, height } = RALLY_CONFIG.arena;
    const { radius, offset, wallInset, springStiffness, springDamping } =
      RALLY_CONFIG.buttTarget;
    const update = (side: RallySide) => {
      const fighter = side === "spark" ? this.state.spark : this.state.clockhead;
      const target = this.state.buttTargets[side];
      const desiredX = clamp(
        fighter.x - fighter.facing.x * offset,
        wallInset + radius,
        width - wallInset - radius
      );
      const desiredY = clamp(
        fighter.y - fighter.facing.y * offset,
        wallInset + radius,
        height - wallInset - radius
      );
      target.wobble.vx += (desiredX - target.x) * springStiffness * dt;
      target.wobble.vy += (desiredY - target.y) * springStiffness * dt;
      const damping = Math.exp(-springDamping * dt);
      target.wobble.vx *= damping;
      target.wobble.vy *= damping;
      target.wobble.x = clamp(target.wobble.x + target.wobble.vx * dt, -8, 8);
      target.wobble.y = clamp(target.wobble.y + target.wobble.vy * dt, -8, 8);
      target.x = desiredX;
      target.y = desiredY;
    };
    update("spark");
    update("clockhead");
  }

  private isButtTargetExposed(side: RallySide) {
    if (this.state.scoringMode !== "buttHybrid") return true;
    const target = this.state.buttTargets[side];
    const excuse = this.state.excuse;
    const fighter = side === "spark" ? this.state.spark : this.state.clockhead;
    const toTarget = normalize(target.x - excuse.x, target.y - excuse.y);
    const toBody = normalize(fighter.x - excuse.x, fighter.y - excuse.y);
    return toTarget.x * toBody.x + toTarget.y * toBody.y < 0.995;
  }

  private updateExcuse(dt: number) {
    const excuse = this.state.excuse;
    if (!excuse.inPlay) return;
    const speedBeforeStep = length(excuse.vx, excuse.vy);
    const collisionSteps =
      speedBeforeStep >= RALLY_CONFIG.excuse.continuousCollisionSpeed
        ? 3
        : speedBeforeStep >= RALLY_CONFIG.buttTarget.highSpeedSubstepThreshold
          ? 2
          : 1;
    const collisionDt = dt / collisionSteps;
    for (let step = 0; step < collisionSteps; step += 1) {
      const beforeX = excuse.x;
      const beforeY = excuse.y;
      excuse.x += excuse.vx * collisionDt;
      excuse.y += excuse.vy * collisionDt;
      if (this.state.scoringMode === "buttHybrid") {
        if (this.resolveButtTargetSweep(beforeX, beforeY)) return;
      } else if (this.resolveGateCrossing(beforeX)) return;
      this.resolveFighterContact();
      this.resolvePowerSurfaces();
      this.resolveBumpers();
      this.resolveStraightWalls();
      if (this.state.scoringMode === "portal") this.resolveGatePosts();
      this.capExcuseSpeed();
    }
    excuse.spin += length(excuse.vx, excuse.vy) * dt * 0.008;
    this.updateTrail();
    excuse.speedTier = this.speedTier(length(excuse.vx, excuse.vy));
  }

  private resolveButtTargetSweep(startX: number, startY: number) {
    const excuse = this.state.excuse;
    const candidates = (["spark", "clockhead"] as const)
      .map(side => {
        const target = this.state.buttTargets[side];
        const relativeStartX = startX - target.prevX;
        const relativeStartY = startY - target.prevY;
        const relativeEndX = excuse.x - target.x;
        const relativeEndY = excuse.y - target.y;
        const dx = relativeEndX - relativeStartX;
        const dy = relativeEndY - relativeStartY;
        const hitRadius = target.radius + RALLY_CONFIG.excuse.radius;
        const c = relativeStartX ** 2 + relativeStartY ** 2 - hitRadius ** 2;
        if (c <= 0) return { side, t: 0 };
        const a = dx ** 2 + dy ** 2;
        if (a <= Number.EPSILON) return null;
        const b = 2 * (relativeStartX * dx + relativeStartY * dy);
        const discriminant = b ** 2 - 4 * a * c;
        if (discriminant < 0) return null;
        const t = (-b - Math.sqrt(discriminant)) / (2 * a);
        return t >= 0 && t <= 1 ? { side, t } : null;
      })
      .filter((candidate): candidate is { side: RallySide; t: number } => candidate !== null)
      .sort((left, right) => left.t - right.t);
    if (candidates.length === 0) return false;
    if (
      candidates.length > 1 &&
      Math.abs(candidates[0].t - candidates[1].t) <= RALLY_CONFIG.buttTarget.tieEpsilon
    ) return false;
    const hit = candidates[0];
    const target = this.state.buttTargets[hit.side];
    excuse.x = startX + (excuse.x - startX) * hit.t;
    excuse.y = startY + (excuse.y - startY) * hit.t;
    if (this.state.powers.hardNoUntil[hit.side] > this.state.timeMs) {
      this.state.powers.hardNoUntil[hit.side] = 0;
      const direction = { x: hit.side === "spark" ? 1 : -1, y: 0 };
      this.returnExcuse(hit.side, direction, RALLY_CONFIG.powers.redTape.forceMultiplier);
      this.state.message = "HARD NO. Score denied.";
      this.emit("shield_break", target.x, target.y, hit.side, undefined, undefined, "hardNo");
      return true;
    }
    this.sealScore(hit.side, "buttHybrid", target.x, target.y);
    return true;
  }

  private resolvePowerSurfaces() {
    const powers = this.state.powers;
    const tape = powers.redTape;
    if (
      tape &&
      !tape.consumed &&
      this.state.timeMs >= tape.liveAt &&
      this.resolvePlacedSurface(
        tape,
        RALLY_CONFIG.powers.redTape.length,
        RALLY_CONFIG.powers.redTape.collisionRadius,
        RALLY_CONFIG.powers.redTape.forceMultiplier,
        RALLY_CONFIG.powers.redTape.tangentBias
      )
    ) {
      tape.consumed = true;
      this.state.excuse.bankState = true;
      this.emit("tape_sling", tape.x, tape.y, undefined, undefined, undefined, "redTape");
    }
    const stamp = powers.deadlineStamp;
    if (stamp?.slammed) {
      this.resolvePlacedSurface(
        stamp,
        RALLY_CONFIG.powers.deadlineStamp.surfaceLength,
        RALLY_CONFIG.powers.deadlineStamp.collisionRadius,
        1,
        0
      );
    }
  }

  private resolvePlacedSurface(
    surface: RallyPlacedSurface,
    surfaceLength: number,
    collisionRadius: number,
    forceMultiplier: number,
    tangentBias: number
  ) {
    const excuse = this.state.excuse;
    const tangent = { x: Math.cos(surface.angle), y: Math.sin(surface.angle) };
    const normal = { x: -tangent.y, y: tangent.x };
    const half = surfaceLength / 2;
    const ax = surface.x - tangent.x * half;
    const ay = surface.y - tangent.y * half;
    const projection = clamp(
      (excuse.x - ax) * tangent.x + (excuse.y - ay) * tangent.y,
      0,
      surfaceLength
    );
    const closestX = ax + tangent.x * projection;
    const closestY = ay + tangent.y * projection;
    const minimum = RALLY_CONFIG.excuse.radius + collisionRadius;
    const dx = excuse.x - closestX;
    const dy = excuse.y - closestY;
    if (length(dx, dy) >= minimum) return false;
    const collisionNormal = normalize(dx || normal.x, dy || normal.y);
    const into = excuse.vx * collisionNormal.x + excuse.vy * collisionNormal.y;
    if (into >= 0) return false;
    const speed = Math.min(
      RALLY_CONFIG.excuse.maxSpeed,
      length(excuse.vx, excuse.vy) * forceMultiplier
    );
    let reflected = normalize(
      excuse.vx - 2 * into * collisionNormal.x,
      excuse.vy - 2 * into * collisionNormal.y
    );
    if (tangentBias > 0) {
      const opponentSign = excuse.lastTouchedBy === "clockhead" ? -1 : 1;
      const biasedTangent = tangent.x * opponentSign < 0
        ? { x: -tangent.x, y: -tangent.y }
        : tangent;
      reflected = normalize(
        reflected.x + biasedTangent.x * tangentBias,
        reflected.y + biasedTangent.y * tangentBias
      );
    }
    excuse.x = closestX + collisionNormal.x * minimum;
    excuse.y = closestY + collisionNormal.y * minimum;
    excuse.vx = reflected.x * speed;
    excuse.vy = reflected.y * speed;
    return true;
  }

  private updateTrail() {
    const excuse = this.state.excuse;
    excuse.trailHead = (excuse.trailHead + 1) % excuse.trailX.length;
    excuse.trailX[excuse.trailHead] = excuse.x;
    excuse.trailY[excuse.trailHead] = excuse.y;
  }

  private resolveGateCrossing(beforeX: number) {
    const excuse = this.state.excuse;
    const withinGate = excuse.y >= RALLY_CONFIG.arena.gateTop && excuse.y <= RALLY_CONFIG.arena.gateBottom;
    if (withinGate && beforeX >= 0 && excuse.x < 0 && excuse.vx < 0) {
      this.sealPortalScore("spark");
      return true;
    }
    if (
      withinGate &&
      beforeX <= RALLY_CONFIG.arena.width &&
      excuse.x > RALLY_CONFIG.arena.width &&
      excuse.vx > 0
    ) {
      this.sealPortalScore("clockhead");
      return true;
    }
    return false;
  }

  private resolveStraightWalls() {
    const excuse = this.state.excuse;
    const radius = RALLY_CONFIG.excuse.radius;
    const { width, height, cornerLeg, gateTop, gateBottom, wallRestitution } = RALLY_CONFIG.arena;
    if (excuse.y < radius && excuse.x >= cornerLeg && excuse.x <= width - cornerLeg) {
      excuse.y = radius;
      excuse.vy = Math.abs(excuse.vy) * wallRestitution;
      this.wallBounce();
    } else if (
      excuse.y > height - radius &&
      excuse.x >= cornerLeg &&
      excuse.x <= width - cornerLeg
    ) {
      excuse.y = height - radius;
      excuse.vy = -Math.abs(excuse.vy) * wallRestitution;
      this.wallBounce();
    }

    const besideGate =
      this.state.scoringMode === "buttHybrid" || excuse.y < gateTop || excuse.y > gateBottom;
    if (
      besideGate &&
      excuse.x < radius &&
      excuse.y >= cornerLeg &&
      excuse.y <= height - cornerLeg
    ) {
      excuse.x = radius;
      excuse.vx = Math.abs(excuse.vx) * wallRestitution;
      this.wallBounce();
    } else if (
      besideGate &&
      excuse.x > width - radius &&
      excuse.y >= cornerLeg &&
      excuse.y <= height - cornerLeg
    ) {
      excuse.x = width - radius;
      excuse.vx = -Math.abs(excuse.vx) * wallRestitution;
      this.wallBounce();
    }
  }

  private resolveBumpers() {
    const { width, height, cornerLeg } = RALLY_CONFIG.arena;
    this.resolveSegment(0, cornerLeg, cornerLeg, 0, normalize(1, 1));
    this.resolveSegment(width - cornerLeg, 0, width, cornerLeg, normalize(-1, 1));
    this.resolveSegment(0, height - cornerLeg, cornerLeg, height, normalize(1, -1));
    this.resolveSegment(width - cornerLeg, height, width, height - cornerLeg, normalize(-1, -1));
  }

  private resolveSegment(ax: number, ay: number, bx: number, by: number, inward: RallyVec) {
    const excuse = this.state.excuse;
    const abx = bx - ax;
    const aby = by - ay;
    const t = clamp(
      ((excuse.x - ax) * abx + (excuse.y - ay) * aby) / (abx * abx + aby * aby),
      0,
      1
    );
    const closestX = ax + abx * t;
    const closestY = ay + aby * t;
    const distanceToSegment = length(excuse.x - closestX, excuse.y - closestY);
    if (distanceToSegment >= RALLY_CONFIG.excuse.radius) return;
    const velocityIntoWall = excuse.vx * inward.x + excuse.vy * inward.y;
    if (velocityIntoWall >= 0) return;

    excuse.x = closestX + inward.x * RALLY_CONFIG.excuse.radius;
    excuse.y = closestY + inward.y * RALLY_CONFIG.excuse.radius;
    const dot = excuse.vx * inward.x + excuse.vy * inward.y;
    let reflected = {
      x: excuse.vx - 2 * dot * inward.x,
      y: excuse.vy - 2 * dot * inward.y,
    };
    const jitter =
      ((this.random() * 2 - 1) * RALLY_CONFIG.arena.bumperJitterDegrees * Math.PI) /
      180;
    reflected = rotate(reflected, jitter);
    excuse.vx = reflected.x * RALLY_CONFIG.arena.bumperRestitution;
    excuse.vy = reflected.y * RALLY_CONFIG.arena.bumperRestitution;
    this.addHitStop(RALLY_CONFIG.feel.bumperHitStopMs);
    this.addTrauma(RALLY_CONFIG.feel.traumaBank);
    excuse.bankState = true;
    this.emit("bumper_bank", excuse.x, excuse.y);
  }

  private resolveGatePosts() {
    const { width, gateTop, gateBottom, gatePostRadius } = RALLY_CONFIG.arena;
    for (const [x, y] of [
      [0, gateTop],
      [0, gateBottom],
      [width, gateTop],
      [width, gateBottom],
    ] as const) {
      const excuse = this.state.excuse;
      const dx = excuse.x - x;
      const dy = excuse.y - y;
      const minimum = RALLY_CONFIG.excuse.radius + gatePostRadius;
      const distanceToPost = length(dx, dy);
      if (distanceToPost === 0 || distanceToPost >= minimum) continue;
      const normal = normalize(dx, dy);
      const dot = excuse.vx * normal.x + excuse.vy * normal.y;
      if (dot >= 0) continue;
      excuse.x = x + normal.x * minimum;
      excuse.y = y + normal.y * minimum;
      excuse.vx = (excuse.vx - 2 * dot * normal.x) * RALLY_CONFIG.arena.wallRestitution;
      excuse.vy = (excuse.vy - 2 * dot * normal.y) * RALLY_CONFIG.arena.wallRestitution;
      this.wallBounce();
    }
  }

  private resolveFighterContact() {
    const excuse = this.state.excuse;
    if (this.state.timeMs - excuse.lastTouchAt < RALLY_CONFIG.excuse.contactLockMs) return;

    const sparkDistance = length(excuse.x - this.state.spark.x, excuse.y - this.state.spark.y);
    if (sparkDistance < RALLY_CONFIG.spark.radius + RALLY_CONFIG.excuse.radius) {
      const direction = normalize(
        Math.max(0.35, excuse.x - this.state.spark.x),
        excuse.y - this.state.spark.y
      );
      const dashMultiplier = this.state.timeMs < this.state.spark.dashUntil
        ? RALLY_CONFIG.spark.dashDeflectMultiplier
        : 1;
      this.returnExcuse("spark", direction, dashMultiplier);
      return;
    }

    const clockDistance = length(
      excuse.x - this.state.clockhead.x,
      excuse.y - this.state.clockhead.y
    );
    if (clockDistance < RALLY_CONFIG.clockhead.radius + RALLY_CONFIG.excuse.radius) {
      if (this.state.timeMs < this.state.clockhead.whiffUntil) return;
      if (excuse.rallyCount >= 7 && excuse.rallyCount % 8 === 7) {
        this.state.clockhead.whiffUntil =
          this.state.timeMs + RALLY_CONFIG.clockhead.whiffRecoveryMs;
        return;
      }
      const direction = normalize(
        Math.min(-0.35, excuse.x - this.state.clockhead.x),
        excuse.y - this.state.clockhead.y
      );
      this.returnExcuse("clockhead", direction, 1);
    }
  }

  private returnExcuse(side: RallySide, direction: RallyVec, forceMultiplier: number) {
    const excuse = this.state.excuse;
    if (!excuse.inPlay) return;
    const incomingSpeed = Math.max(RALLY_CONFIG.excuse.serveSpeed, length(excuse.vx, excuse.vy));
    const dampedSpeed = incomingSpeed * RALLY_CONFIG.excuse.bodyDamping;
    const rallyImpulse = RALLY_CONFIG.excuse.returnMultiplier / RALLY_CONFIG.excuse.bodyDamping;
    const nextSpeed = Math.min(
      RALLY_CONFIG.excuse.maxSpeed,
      dampedSpeed * rallyImpulse * forceMultiplier
    );
    const normalized = normalize(direction.x, direction.y);
    excuse.vx = normalized.x * nextSpeed;
    excuse.vy = normalized.y * nextSpeed;
    excuse.lastTouchedBy = side;
    excuse.lastTouchAt = this.state.timeMs;
    excuse.rallyCount += 1;
    excuse.bankState = false;
    if (side === "spark") this.state.firstPlayerContact = true;
    excuse.speedTier = this.speedTier(nextSpeed);
    if (side === "spark") {
      this.state.influence = clamp(
        this.state.influence + RALLY_CONFIG.scoring.influencePerReturn,
        0,
        100
      );
      this.state.clockhead.reactionReadyAt =
        this.state.timeMs + this.reactionDelay(excuse.speedTier);
    }
    this.addHitStop(RALLY_CONFIG.feel.returnHitStopMs);
    this.addTrauma(RALLY_CONFIG.feel.traumaReturn);
    this.emit("return", excuse.x, excuse.y, side);
  }

  private sealPortalScore(victim: RallySide) {
    const x = victim === "spark" ? 0 : RALLY_CONFIG.arena.width;
    this.sealScore(victim, "portal", x, this.state.excuse.y);
  }

  private sealScore(
    victim: RallySide,
    mode: "portal" | "buttHybrid",
    x: number,
    y: number
  ) {
    if (this.state.ceremony) return;
    const excuse = this.state.excuse;
    const scorer: RallySide = victim === "spark" ? "clockhead" : "spark";
    const banked = excuse.bankState;
    const points = banked ? 2 : 1;
    this.state.ceremony = {
      elapsedRealMs: 0,
      committed: false,
      outcome: null,
      snapshot: {
        victim,
        scorer,
        points,
        banked,
        mode,
        x,
        y,
        startX: excuse.x,
        startY: excuse.y,
        vx: excuse.vx,
        vy: excuse.vy,
        tick: this.state.tick,
        ignited: excuse.ignitedUntil > this.state.timeMs,
        bark: victim === "spark"
          ? CLOCKHEAD_SCORE_BARKS[Math.floor(this.random() * CLOCKHEAD_SCORE_BARKS.length)]
          : null,
      },
    };
    this.state.message = mode === "portal" ? "REALITY GATE SHATTERED!" : "BUTT BASH!";
    this.emit("score_sealed", x, y, victim, points, banked);
  }

  private advanceCeremony(frameMs: number) {
    const ceremony = this.state.ceremony;
    if (!ceremony) return;
    ceremony.elapsedRealMs += Math.max(0, frameMs);
    const impactAt =
      RALLY_CONFIG.ceremony.ingestionMs + RALLY_CONFIG.ceremony.hitStopMs;
    if (!ceremony.committed && ceremony.elapsedRealMs >= impactAt) {
      this.commitCeremonyScore(ceremony);
    }
    if (ceremony.elapsedRealMs >= this.ceremonyTotalMs()) {
      this.finishCeremony(ceremony);
    }
  }

  private commitCeremonyScore(ceremony: RallyCeremony) {
    if (ceremony.committed) return;
    ceremony.committed = true;
    const { snapshot } = ceremony;
    if (snapshot.victim === "spark") {
      this.state.clockheadScore += snapshot.points;
      if (snapshot.bark) this.state.message = snapshot.bark;
      this.state.influence = clamp(
        this.state.influence + RALLY_CONFIG.scoring.influenceWhenScoredOn,
        0,
        100
      );
      this.emit(
        "gate_score_against",
        snapshot.x,
        snapshot.y,
        snapshot.victim,
        snapshot.points,
        snapshot.banked
      );
    } else {
      this.state.sparkScore += snapshot.points;
      this.state.influence = clamp(
        this.state.influence + RALLY_CONFIG.scoring.influenceOnScore,
        0,
        100
      );
      this.emit(
        "gate_score_for",
        snapshot.x,
        snapshot.y,
        snapshot.victim,
        snapshot.points,
        snapshot.banked
      );
    }
    this.addTrauma(RALLY_CONFIG.feel.traumaScore);
    if (
      this.state.sparkScore >= RALLY_CONFIG.scoring.winScore ||
      (this.state.suddenDeath && snapshot.scorer === "spark")
    ) ceremony.outcome = "victory";
    if (
      this.state.clockheadScore >= RALLY_CONFIG.scoring.winScore ||
      (this.state.suddenDeath && snapshot.scorer === "clockhead")
    ) ceremony.outcome = "defeat";
  }

  private finishCeremony(ceremony: RallyCeremony) {
    if (!ceremony.committed) this.commitCeremonyScore(ceremony);
    const { snapshot, outcome } = ceremony;
    this.state.excuse.inPlay = false;
    this.state.excuse.ignitedUntil = 0;
    this.state.ceremony = null;
    this.emit("ceremony_complete", snapshot.x, snapshot.y, snapshot.victim);
    if (outcome === "victory") {
      this.state.status = "victory";
      this.state.message = "CONTRACT WON. Reality beats the Excuse.";
      this.emit("victory");
      return;
    }
    if (outcome === "defeat") {
      this.state.status = "defeat";
      this.state.message = "The Excuse got through. Rally again.";
      this.emit("defeat");
      return;
    }
    this.state.servingSide = snapshot.victim;
    this.state.serveAt = this.state.timeMs;
    this.state.message =
      snapshot.victim === "clockhead"
        ? snapshot.mode === "buttHybrid" ? "BUTT BASH!" : "REALITY GATE SHATTERED!"
        : snapshot.mode === "buttHybrid" ? "Target hit. Take the serve back." : "Gate hit. Take the serve back.";
  }

  private ceremonyTotalMs() {
    return (
      RALLY_CONFIG.ceremony.ingestionMs +
      RALLY_CONFIG.ceremony.hitStopMs +
      RALLY_CONFIG.ceremony.reactionMs +
      RALLY_CONFIG.ceremony.bannerMs +
      RALLY_CONFIG.ceremony.beatMs +
      RALLY_CONFIG.ceremony.serveTelegraphMs
    );
  }

  private wallBounce() {
    const excuse = this.state.excuse;
    excuse.bankState = true;
    this.emit("wall_bounce", excuse.x, excuse.y);
  }

  private capExcuseSpeed() {
    const excuse = this.state.excuse;
    const speed = length(excuse.vx, excuse.vy);
    if (speed <= RALLY_CONFIG.excuse.maxSpeed) return;
    const scale = RALLY_CONFIG.excuse.maxSpeed / speed;
    excuse.vx *= scale;
    excuse.vy *= scale;
  }

  private speedTier(speed: number): 0 | 1 | 2 | 3 {
    const [, tier1, tier2, tier3] = RALLY_CONFIG.excuse.speedTiers;
    if (speed >= tier3) return 3;
    if (speed >= tier2) return 2;
    if (speed >= tier1) return 1;
    return 0;
  }

  private reactionDelay(tier: 0 | 1 | 2 | 3) {
    const { tier0, tier3 } = RALLY_CONFIG.clockhead.reactionDelayMs;
    return tier0 + ((tier3 - tier0) * tier) / 3;
  }

  private sparkMouthPosition() {
    return {
      x: this.state.spark.x + this.state.spark.facing.x * RALLY_CONFIG.spark.mouthOffset,
      y: this.state.spark.y + this.state.spark.facing.y * RALLY_CONFIG.spark.mouthOffset,
    };
  }

  private addHitStop(durationMs: number) {
    this.hitStopRemainingMs = Math.max(this.hitStopRemainingMs, durationMs);
  }

  private addTrauma(amount: number) {
    if (this.state.reducedMotion) return;
    this.state.trauma = clamp(this.state.trauma + amount, 0, 1);
  }

  private emit(
    type: RallyEventType,
    x?: number,
    y?: number,
    side?: RallySide,
    points?: number,
    banked?: boolean,
    power?: RallyPowerId
  ) {
    this.events.push({
      type,
      at: this.state.timeMs,
      x,
      y,
      side,
      points,
      banked,
      tier: this.state.excuse.speedTier,
      message: this.state.message,
      power,
      variation: this.random() * 2 - 1,
    });
  }

  private random() {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
    return this.randomState / 0x100000000;
  }

  private recordInput(type: RallyInputEvent["type"], payload?: Record<string, unknown>) {
    if (this.replayMode) return;
    this.inputLog.push({
      tick: this.state.tick,
      order: this.inputOrder++,
      type,
      payload,
    });
  }
}
