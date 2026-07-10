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
  maybeTriggerDuelRescue(): void;
  openRescue(): void;
  emit(
    type: "bumper_bank",
    x?: number,
    y?: number,
    side?: "spark" | "clockhead"
  ): unknown;
  addHitStop(durationMs: number): void;
  addTrauma(amount: number): void;
};

const prototype = RallyEngine.prototype as unknown as RallyEnginePrivate;
const resolveStraightWalls = prototype.resolveDuelStraightWalls;

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
