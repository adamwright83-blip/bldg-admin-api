import type { ButtTarget, RallyState } from "./rallyEngine";
import { RallyEngine } from "./rallyEngine";
import { RALLY_CONFIG } from "./rallyConfig";

export type RallyStudioBumper = {
  side: "spark" | "clockhead";
  ax: number;
  ay: number;
  bx: number;
  by: number;
  nx: number;
  ny: number;
};

const length = (x: number, y: number) => Math.hypot(x, y);
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const getRallyStudioBumpers = (): RallyStudioBumper[] => {
  const { width } = RALLY_CONFIG.arena;
  const top = RALLY_CONFIG.duel.bumperTopY;
  const bottom = RALLY_CONFIG.duel.bumperBottomY;
  const inset = RALLY_CONFIG.duel.bumperInset;
  const reach = RALLY_CONFIG.duel.bumperReach;
  const diagonal = Math.SQRT1_2;

  return [
    {
      side: "spark",
      ax: inset,
      ay: bottom,
      bx: inset + reach,
      by: top,
      nx: diagonal,
      ny: diagonal,
    },
    {
      side: "clockhead",
      ax: width - inset - reach,
      ay: top,
      bx: width - inset,
      by: bottom,
      nx: -diagonal,
      ny: diagonal,
    },
  ];
};

type ExcuseLike = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bankState: boolean;
};

export function resolveRallyStudioBumper(
  excuse: ExcuseLike,
  target: ButtTarget,
  bumper: RallyStudioBumper,
  radius = RALLY_CONFIG.duel.excuseRadius
) {
  const abx = bumper.bx - bumper.ax;
  const aby = bumper.by - bumper.ay;
  const denominator = abx * abx + aby * aby;
  const projection = clamp(
    ((excuse.x - bumper.ax) * abx + (excuse.y - bumper.ay) * aby) / denominator,
    0,
    1
  );
  const closestX = bumper.ax + abx * projection;
  const closestY = bumper.ay + aby * projection;
  const collisionRadius = radius + RALLY_CONFIG.duel.bumperThickness;
  const dx = excuse.x - closestX;
  const dy = excuse.y - closestY;
  if (length(dx, dy) >= collisionRadius) return false;

  const velocityIntoBumper = excuse.vx * bumper.nx + excuse.vy * bumper.ny;
  if (velocityIntoBumper >= 0) return false;

  excuse.x = closestX + bumper.nx * collisionRadius;
  excuse.y = closestY + bumper.ny * collisionRadius;

  const reflectedX = excuse.vx - 2 * velocityIntoBumper * bumper.nx;
  const reflectedY = excuse.vy - 2 * velocityIntoBumper * bumper.ny;
  const incomingSpeed = Math.max(1, length(reflectedX, reflectedY));
  const aimX = target.x - excuse.x;
  const aimY = target.y - excuse.y;
  const aimLength = Math.max(1, length(aimX, aimY));
  const blend = RALLY_CONFIG.duel.bumperAimAssist;
  const steeredX = (reflectedX / incomingSpeed) * (1 - blend) + (aimX / aimLength) * blend;
  const steeredY = (reflectedY / incomingSpeed) * (1 - blend) + (aimY / aimLength) * blend;
  const steeredLength = Math.max(1, length(steeredX, steeredY));
  const nextSpeed = Math.min(
    RALLY_CONFIG.duel.maxSpeed,
    incomingSpeed * RALLY_CONFIG.duel.bumperRestitution
  );

  excuse.vx = (steeredX / steeredLength) * nextSpeed;
  excuse.vy = (steeredY / steeredLength) * nextSpeed;
  excuse.bankState = true;
  return true;
}

type RallyEnginePrivate = {
  state: RallyState;
  resolveDuelStraightWalls(): void;
  updateDuelExcuse(dt: number): void;
  updateRegulationClock(dtMs: number): void;
  maybeTriggerDuelRescue(): void;
  openRescue(): void;
  acceptRescue(): boolean;
  emit(
    type: "bumper_bank",
    x?: number,
    y?: number,
    side?: "spark" | "clockhead"
  ): unknown;
  addHitStop(durationMs: number): void;
  addTrauma(amount: number): void;
};

type HeldDeathScroll = {
  vx: number;
  vy: number;
};

const rescueHolds = new WeakMap<object, HeldDeathScroll>();
const prototype = RallyEngine.prototype as unknown as RallyEnginePrivate;
const resolveStraightWalls = prototype.resolveDuelStraightWalls;
const updateDuelExcuse = prototype.updateDuelExcuse;
const updateRegulationClock = prototype.updateRegulationClock;
const acceptRescue = prototype.acceptRescue;

prototype.resolveDuelStraightWalls = function resolveStudioWalls() {
  resolveStraightWalls.call(this);
  const state = this.state;
  const excuse = state.excuse;
  if (!excuse.inPlay || state.controlMode !== "duel" || state.ceremony) return;

  for (const bumper of getRallyStudioBumpers()) {
    const target = state.buttTargets[bumper.side];
    if (!resolveRallyStudioBumper(excuse, target, bumper)) continue;
    this.addHitStop(RALLY_CONFIG.feel.bumperHitStopMs);
    this.addTrauma(RALLY_CONFIG.feel.traumaBank);
    this.emit("bumper_bank", excuse.x, excuse.y, bumper.side);
    break;
  }
};

prototype.updateRegulationClock = function preserveTheSixtySecondContract(dtMs) {
  if (this.state.controlMode === "duel" && this.state.mission.status === "ready") return;
  updateRegulationClock.call(this, dtMs);
};

prototype.acceptRescue = function acceptStudioRescue() {
  const state = this.state;
  if (state.mission.status !== "ready") return false;

  const previousStatus = state.status;
  if (previousStatus !== "victory" && previousStatus !== "defeat") {
    state.status = "playing";
  }

  const accepted = acceptRescue.call(this);
  if (!accepted) {
    state.status = previousStatus;
    return false;
  }

  state.status = "playing";
  state.message = "MISSION ACCEPTED — Closer returned the Death Scroll.";
  return true;
};

prototype.updateDuelExcuse = function holdTheDeathScroll(dt) {
  const state = this.state;
  const excuse = state.excuse;
  const existingHold = rescueHolds.get(this as unknown as object);

  if (state.mission.status === "ready" && excuse.inPlay && !state.ceremony) {
    if (!existingHold) {
      rescueHolds.set(this as unknown as object, { vx: excuse.vx, vy: excuse.vy });
      excuse.trailX.fill(excuse.x);
      excuse.trailY.fill(excuse.y);
      excuse.trailHead = 0;
    }

    const target = state.buttTargets.spark;
    const minimumX = target.x + target.radius + RALLY_CONFIG.duel.excuseRadius + 48;
    const maximumX = state.spark.x + 178;
    const heldX = clamp(excuse.x, minimumX, Math.max(minimumX, maximumX));
    const heldY = clamp(
      excuse.y,
      150,
      RALLY_CONFIG.duel.groundY - RALLY_CONFIG.duel.excuseRadius - 28
    );

    excuse.prevX = heldX;
    excuse.prevY = heldY;
    excuse.x = heldX;
    excuse.y = heldY;
    excuse.vx = 0;
    excuse.vy = 0;
    excuse.stallMs = 0;
    return;
  }

  if (existingHold) {
    if (state.mission.status === "expired" && excuse.inPlay && !state.ceremony) {
      excuse.vx = existingHold.vx;
      excuse.vy = existingHold.vy;
      excuse.lastTouchAt = state.timeMs;
    } else if (
      state.mission.status === "accepted" &&
      excuse.inPlay &&
      !state.ceremony &&
      length(excuse.vx, excuse.vy) < 1
    ) {
      const counterSpeed = Math.min(
        RALLY_CONFIG.duel.maxSpeed,
        Math.max(RALLY_CONFIG.duel.strikeFlatSpeed, length(existingHold.vx, existingHold.vy)) *
          RALLY_CONFIG.rescue.returnForceMultiplier
      );
      excuse.vx = counterSpeed;
      excuse.vy = -Math.max(120, Math.abs(existingHold.vy));
      excuse.lastTouchedBy = "spark";
      excuse.lastTouchAt = state.timeMs;
    }
    rescueHolds.delete(this as unknown as object);
  }

  updateDuelExcuse.call(this, dt);
};

prototype.maybeTriggerDuelRescue = function openMissionOnlyAtPeakThreat() {
  const state = this.state;
  const { excuse, mission, spark } = state;
  if (
    state.controlMode !== "duel" ||
    mission.status !== "locked" ||
    state.ceremony ||
    !excuse.inPlay ||
    state.timeMs < RALLY_CONFIG.rescue.minimumMatchAgeMs ||
    state.timeMs >= spark.frozenUntil ||
    excuse.lastTouchedBy !== "clockhead" ||
    excuse.vx >= -RALLY_CONFIG.rescue.minimumInboundSpeed
  ) {
    return;
  }

  const target = state.buttTargets.spark;
  const secondsToTarget = (excuse.x - target.x) / -excuse.vx;
  if (
    secondsToTarget < RALLY_CONFIG.rescue.minimumThreatEtaSeconds ||
    secondsToTarget > RALLY_CONFIG.rescue.maximumThreatEtaSeconds
  ) {
    return;
  }

  const projectedY =
    excuse.y +
    excuse.vy * secondsToTarget +
    0.5 *
      RALLY_CONFIG.duel.gravity *
      RALLY_CONFIG.duel.ballGravScale *
      secondsToTarget *
      secondsToTarget;
  const verticalMiss = Math.abs(projectedY - target.y);
  const scorePressure = state.clockheadScore >= state.sparkScore;
  const speedPressure = excuse.speedTier >= 2;
  const clockPressure = state.regulationRemainingMs <= RALLY_CONFIG.rescue.clutchClockMs;

  if (
    verticalMiss <= target.radius + RALLY_CONFIG.rescue.projectedMissAllowance &&
    (scorePressure || speedPressure || clockPressure)
  ) {
    this.openRescue();
  }
};

if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerup",
    event => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest(".rally-rescue button");
      if (!(button instanceof HTMLButtonElement)) return;

      event.preventDefault();
      queueMicrotask(() => button.click());
    },
    { capture: true }
  );
}
