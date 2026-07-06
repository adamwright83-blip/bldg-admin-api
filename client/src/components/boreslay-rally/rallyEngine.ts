import {
  BrowserLocalBoreslayDemoAdapter,
  type PublicBoreslayDemoAdapter,
  type SimulatedCrewMissionDeployment,
} from "../boreslay-demo/PublicBoreslayDemoAdapter";
import type { DemoStatus } from "../boreslay-demo/engine";
import { FIXED_STEP_MS, RALLY_CONFIG } from "./rallyConfig";

export type RallySide = "spark" | "clockhead";
export type RallyTelegraph = "none" | "swat" | "freeze";
export type RallyMissionStatus = "locked" | "ready" | "accepted" | "expired";
export type RallyEventType =
  | "serve"
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
};

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
  trailX: Float32Array;
  trailY: Float32Array;
  trailHead: number;
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
  buttTargets: Record<RallySide, ButtTarget>;
  excuse: RallyExcuse;
  sparkScore: number;
  clockheadScore: number;
  regulationRemainingMs: number;
  suddenDeath: boolean;
  regulationExpired: boolean;
  tutorialSlowUntil: number;
  firstPlayerContact: boolean;
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
  scoringMode?: "portal" | "buttHybrid";
  adapter?: PublicBoreslayDemoAdapter;
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

export function createRallyState(
  reducedMotion = false,
  scoringMode: "portal" | "buttHybrid" = RALLY_CONFIG.scoring.mode
): RallyState {
  return {
    tick: 0,
    timeMs: 0,
    status: "idle",
    message: scoringMode === "buttHybrid"
      ? "Bank the Excuse and hit the target behind Clockhead."
      : "Keep the Excuse out of your Gate. Fire it into his.",
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
  private breathRequested = false;
  private events: RallyEvent[] = [];
  private adapter: PublicBoreslayDemoAdapter;
  private initialSeed: number;
  private randomState: number;

  constructor(options: RallyEngineOptions = {}) {
    this.initialSeed = options.seed ?? RALLY_CONFIG.simulation.seed;
    this.randomState = this.initialSeed >>> 0;
    this.state = createRallyState(
      options.reducedMotion ?? false,
      options.scoringMode ?? RALLY_CONFIG.scoring.mode
    );
    this.adapter = options.adapter ?? new BrowserLocalBoreslayDemoAdapter();
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
      this.state.serveAt = this.state.timeMs + 480;
      this.state.servingSide = "clockhead";
    }
    this.emit("status");
  }

  pause() {
    if (this.state.status !== "playing") return;
    this.state.status = "paused";
    this.state.message = "Rally paused. The arena is holding its breath.";
    this.emit("status");
  }

  reset() {
    const reducedMotion = this.state.reducedMotion;
    const scoringMode = this.state.scoringMode;
    this.state = createRallyState(reducedMotion, scoringMode);
    this.accumulatorMs = 0;
    this.hitStopRemainingMs = 0;
    this.movement = { x: 0, y: 0 };
    this.aim = { x: 1, y: 0 };
    this.breathRequested = false;
    this.events = [];
    this.randomState = this.initialSeed >>> 0;
    this.adapter.reset(`boreslay-rally-${this.initialSeed}`);
  }

  setReducedMotion(reducedMotion: boolean) {
    this.state.reducedMotion = reducedMotion;
    if (reducedMotion) this.state.trauma = 0;
  }

  setMovement(x: number, y: number) {
    if (x === 0 && y === 0) {
      this.movement = { x: 0, y: 0 };
      return;
    }
    this.movement = normalize(x, y);
    this.state.spark.facing = { ...this.movement };
  }

  setAim(x: number, y: number) {
    this.aim = normalize(x - this.state.spark.x, y - this.state.spark.y);
    this.state.spark.facing = { ...this.aim };
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
    return true;
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
      state.spark.x,
      state.spark.y,
      state.spark.energy,
      state.spark.frozenUntil,
      state.clockhead.x,
      state.clockhead.y,
      state.clockhead.staggerUntil,
      state.clockhead.whiffUntil,
      state.excuse.x,
      state.excuse.y,
      state.excuse.vx,
      state.excuse.vy,
      state.excuse.rallyCount,
      state.excuse.bankState ? 1 : 0,
      state.sparkScore,
      state.clockheadScore,
      state.regulationRemainingMs,
      state.suddenDeath ? 1 : 0,
      state.influence,
      state.ceremony?.committed ? 1 : 0,
      this.randomState,
    ].map(value => Math.round(value * 1000));
    return values.join(":");
  }

  private stepFixed(dtMs: number) {
    const state = this.state;
    if (state.status !== "playing" || state.ceremony) return;
    const tutorialSlow =
      !state.firstPlayerContact &&
      state.tutorialSlowUntil > state.timeMs;
    const scaledDtMs =
      dtMs * (tutorialSlow ? RALLY_CONFIG.scoring.firstServeTimeScale : 1);
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
    this.updateExcuse(dt);
    this.maybeTriggerRescue();
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

  private updateServe() {
    if (this.state.serveAt === null || this.state.timeMs < this.state.serveAt) return;
    this.launchServe(this.state.servingSide);
  }

  private launchServe(side: RallySide) {
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
    this.sealScore(hit.side, "buttHybrid", target.x, target.y);
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
    banked?: boolean
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
    });
  }

  private random() {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
    return this.randomState / 0x100000000;
  }
}
