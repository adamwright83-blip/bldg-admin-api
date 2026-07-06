import arenaBackgroundUrl from "@/assets/boreslay-rally/arena-background.webp";
import clockheadSheetUrl from "@/assets/boreslay-rally/clockhead-sheet.webp";
import excuseSheetUrl from "@/assets/boreslay-rally/excuse-sheet.webp";
import sparkSheetUrl from "@/assets/boreslay-rally/spark-sheet.webp";
import type { RallyState, RallyVec } from "./rallyEngine";
import { RALLY_CONFIG } from "./rallyConfig";
import type { RallyParticlePool } from "./rallyParticles";

type RallyAssets = {
  background: HTMLImageElement;
  spark: HTMLImageElement;
  clockhead: HTMLImageElement;
  excuse: HTMLImageElement;
};

const TAU = Math.PI * 2;
const lerp = (from: number, to: number, alpha: number) => from + (to - from) * alpha;

const loadImage = (source: string, onLoad: () => void) => {
  const image = new Image();
  image.onload = onLoad;
  image.src = source;
  return image;
};

export function predictReceiptPath(state: RallyState) {
  const points: RallyVec[] = [];
  let x = state.excuse.x;
  let y = state.excuse.y;
  let vx = state.excuse.vx;
  let vy = state.excuse.vy;
  const radius = RALLY_CONFIG.excuse.radius;
  const { width, height, cornerLeg, wallRestitution, bumperRestitution } = RALLY_CONFIG.arena;
  const bumpers = [
    { ax: 0, ay: cornerLeg, bx: cornerLeg, by: 0, nx: 1, ny: 1 },
    { ax: width - cornerLeg, ay: 0, bx: width, by: cornerLeg, nx: -1, ny: 1 },
    { ax: 0, ay: height - cornerLeg, bx: cornerLeg, by: height, nx: 1, ny: -1 },
    { ax: width - cornerLeg, ay: height, bx: width, by: height - cornerLeg, nx: -1, ny: -1 },
  ];
  for (let step = 0; step < RALLY_CONFIG.powers.receipts.lookaheadSteps; step += 1) {
    x += vx * RALLY_CONFIG.powers.receipts.lookaheadStepSeconds;
    y += vy * RALLY_CONFIG.powers.receipts.lookaheadStepSeconds;
    if (y < radius) { y = radius; vy = Math.abs(vy) * wallRestitution; }
    if (y > height - radius) { y = height - radius; vy = -Math.abs(vy) * wallRestitution; }
    if (x < radius) { x = radius; vx = Math.abs(vx) * wallRestitution; }
    if (x > width - radius) { x = width - radius; vx = -Math.abs(vx) * wallRestitution; }
    for (const bumper of bumpers) {
      const abx = bumper.bx - bumper.ax;
      const aby = bumper.by - bumper.ay;
      const t = Math.max(0, Math.min(1, ((x - bumper.ax) * abx + (y - bumper.ay) * aby) / (abx ** 2 + aby ** 2)));
      const closestX = bumper.ax + abx * t;
      const closestY = bumper.ay + aby * t;
      const dx = x - closestX;
      const dy = y - closestY;
      if (Math.hypot(dx, dy) >= radius) continue;
      const magnitude = Math.hypot(bumper.nx, bumper.ny);
      const nx = bumper.nx / magnitude;
      const ny = bumper.ny / magnitude;
      const dot = vx * nx + vy * ny;
      if (dot >= 0) continue;
      x = closestX + nx * radius;
      y = closestY + ny * radius;
      vx = (vx - 2 * dot * nx) * bumperRestitution;
      vy = (vy - 2 * dot * ny) * bumperRestitution;
    }
    points.push({ x, y });
  }
  return points;
}

export class RallyRenderer {
  private assets: RallyAssets;
  private loaded = 0;

  constructor(onReady?: () => void) {
    const onLoad = () => {
      this.loaded += 1;
      if (this.loaded === 4) onReady?.();
    };
    this.assets = {
      background: loadImage(arenaBackgroundUrl, onLoad),
      spark: loadImage(sparkSheetUrl, onLoad),
      clockhead: loadImage(clockheadSheetUrl, onLoad),
      excuse: loadImage(excuseSheetUrl, onLoad),
    };
  }

  render(
    canvas: HTMLCanvasElement,
    state: RallyState,
    alpha: number,
    particles: RallyParticlePool
  ) {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetWidth = Math.round(bounds.width * dpr);
    const targetHeight = Math.round(bounds.height * dpr);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    const scaleX = bounds.width / RALLY_CONFIG.arena.width;
    const scaleY = bounds.height / RALLY_CONFIG.arena.height;
    context.setTransform(dpr * scaleX, 0, 0, dpr * scaleY, 0, 0);
    context.clearRect(0, 0, RALLY_CONFIG.arena.width, RALLY_CONFIG.arena.height);
    context.imageSmoothingEnabled = true;

    const shake = state.reducedMotion ? 0 : state.trauma * state.trauma;
    const shakeX = Math.sin(state.timeMs * 0.061) * shake * 13;
    const shakeY = Math.cos(state.timeMs * 0.047) * shake * 9;
    const shakeRotation = Math.sin(state.timeMs * 0.033) * shake * 0.006;

    context.save();
    context.translate(RALLY_CONFIG.arena.width / 2 + shakeX, RALLY_CONFIG.arena.height / 2 + shakeY);
    context.rotate(shakeRotation);
    const tierZoom = !state.reducedMotion && state.excuse.speedTier === 3
      ? RALLY_CONFIG.juice.tierThreeZoom
      : 1;
    context.scale(tierZoom, tierZoom);
    context.translate(-RALLY_CONFIG.arena.width / 2, -RALLY_CONFIG.arena.height / 2);
    this.drawBackground(context, state);
    this.drawSealedWalls(context, state);
    this.drawGateThreats(context, state);
    this.drawButtTargets(context, state, alpha);
    this.drawPowerSurfaces(context, state);
    this.drawReceipts(context, state);
    this.drawBreath(context, state, alpha);
    this.drawTrail(context, state);
    this.drawTelegraph(context, state, alpha);
    this.drawSpark(context, state, alpha);
    this.drawClockhead(context, state, alpha);
    this.drawExcuse(context, state, alpha);
    this.drawCeremonyGoalMask(context, state);
    particles.draw(context);
    this.drawCeremonyOverlay(context, state);
    this.drawFirstServeCue(context, state);
    this.drawArenaVignette(context, state);
    context.restore();
  }

  private drawBackground(context: CanvasRenderingContext2D, state: RallyState) {
    if (this.assets.background.complete && this.assets.background.naturalWidth > 0) {
      context.drawImage(
        this.assets.background,
        0,
        0,
        RALLY_CONFIG.arena.width,
        RALLY_CONFIG.arena.height
      );
    } else {
      const gradient = context.createLinearGradient(0, 0, RALLY_CONFIG.arena.width, 0);
      gradient.addColorStop(0, "#3a1420");
      gradient.addColorStop(0.5, "#19162b");
      gradient.addColorStop(1, "#071a39");
      context.fillStyle = gradient;
      context.fillRect(0, 0, RALLY_CONFIG.arena.width, RALLY_CONFIG.arena.height);
    }

    const pulse = 0.5 + Math.sin(state.timeMs * 0.003) * 0.5;
    context.fillStyle = `rgba(255, 80, 30, ${0.025 + pulse * 0.02})`;
    context.fillRect(0, 0, RALLY_CONFIG.arena.width / 2, RALLY_CONFIG.arena.height);
    context.fillStyle = `rgba(30, 110, 255, ${0.03 + (1 - pulse) * 0.02})`;
    context.fillRect(
      RALLY_CONFIG.arena.width / 2,
      0,
      RALLY_CONFIG.arena.width / 2,
      RALLY_CONFIG.arena.height
    );
  }

  private drawGateThreats(context: CanvasRenderingContext2D, state: RallyState) {
    if (state.scoringMode !== "portal" || !state.excuse.inPlay) return;
    const leftThreat = state.excuse.vx < 0 && state.excuse.x < RALLY_CONFIG.arena.gateThreatDistance;
    const rightThreat =
      state.excuse.vx > 0 &&
      RALLY_CONFIG.arena.width - state.excuse.x < RALLY_CONFIG.arena.gateThreatDistance;
    const pulse = 0.55 + Math.sin(state.timeMs * 0.018) * 0.35;
    if (leftThreat) this.drawGateGlow(context, 0, "#ff572d", pulse);
    if (rightThreat) this.drawGateGlow(context, RALLY_CONFIG.arena.width, "#38bdff", pulse);
  }

  private drawSealedWalls(context: CanvasRenderingContext2D, state: RallyState) {
    if (state.scoringMode !== "buttHybrid") return;
    const { width, gateTop, gateBottom } = RALLY_CONFIG.arena;
    context.save();
    context.strokeStyle = "rgba(242, 192, 91, 0.9)";
    context.shadowColor = "rgba(255, 127, 42, 0.7)";
    context.shadowBlur = 18;
    context.lineWidth = 18;
    context.beginPath();
    context.moveTo(1, gateTop);
    context.lineTo(1, gateBottom);
    context.moveTo(width - 1, gateTop);
    context.lineTo(width - 1, gateBottom);
    context.stroke();
    context.restore();
  }

  private drawButtTargets(
    context: CanvasRenderingContext2D,
    state: RallyState,
    alpha: number
  ) {
    if (state.scoringMode !== "buttHybrid") return;
    for (const side of ["spark", "clockhead"] as const) {
      const target = state.buttTargets[side];
      const x = lerp(target.prevX, target.x, alpha);
      const y = lerp(target.prevY, target.y, alpha);
      const speed = Math.hypot(target.wobble.vx, target.wobble.vy);
      const squash = state.reducedMotion ? 0 : Math.min(0.12, speed * 0.004);
      const warm = side === "spark";
      context.save();
      context.translate(x, y);
      context.scale(1 + squash, 1 - squash);
      context.shadowColor = warm ? "#ff6738" : "#54b9ff";
      context.shadowBlur = 20;
      context.fillStyle = warm ? "#d9543b" : "#5b86b8";
      context.strokeStyle = "#f5d49a";
      context.lineWidth = 5;
      context.beginPath();
      context.arc(0, 0, target.radius, 0, TAU);
      context.fill();
      context.stroke();
      context.shadowBlur = 0;
      context.strokeStyle = warm ? "#5b1420" : "#152d5e";
      context.lineWidth = 7;
      context.beginPath();
      context.arc(0, 0, target.radius * 0.52, 0, TAU);
      context.stroke();
      context.fillStyle = "#fff0bd";
      context.beginPath();
      context.arc(0, 0, 7, 0, TAU);
      context.fill();
      context.restore();
    }
  }

  private drawPowerSurfaces(context: CanvasRenderingContext2D, state: RallyState) {
    const { powers } = state;
    const targetShield = (side: "spark" | "clockhead") => {
      if (powers.hardNoUntil[side] <= state.timeMs) return;
      const target = state.buttTargets[side];
      const pulse = state.reducedMotion ? 0 : Math.sin(state.timeMs * 0.018) * 3;
      context.save();
      context.strokeStyle = side === "spark" ? "#ffcb69" : "#75d4ff";
      context.fillStyle = side === "spark" ? "rgba(255,97,45,0.16)" : "rgba(62,154,255,0.16)";
      context.lineWidth = 8;
      context.beginPath();
      context.arc(
        target.x,
        target.y,
        target.radius + RALLY_CONFIG.powers.hardNo.domePadding + pulse,
        Math.PI,
        TAU
      );
      context.fill();
      context.stroke();
      context.fillStyle = "#fff3c6";
      context.font = "900 19px Impact, sans-serif";
      context.textAlign = "center";
      context.fillText("HARD NO.", target.x, target.y - target.radius - 26);
      context.restore();
    };
    targetShield("spark");
    targetShield("clockhead");

    const tape = powers.redTape;
    if (tape) {
      const live = state.timeMs >= tape.liveAt;
      context.save();
      context.translate(tape.x, tape.y);
      context.rotate(tape.angle);
      context.globalAlpha = tape.consumed ? 0.22 : 1;
      context.strokeStyle = live ? "#f2c84b" : "rgba(242,200,75,0.45)";
      context.lineWidth = RALLY_CONFIG.powers.redTape.collisionRadius * 2;
      if (!live) context.setLineDash([22, 15]);
      context.beginPath();
      context.moveTo(-RALLY_CONFIG.powers.redTape.length / 2, 0);
      context.lineTo(RALLY_CONFIG.powers.redTape.length / 2, 0);
      context.stroke();
      context.fillStyle = "#28160a";
      context.font = "900 16px Impact, sans-serif";
      context.textAlign = "center";
      context.fillText("RED TAPE", 0, 5);
      context.restore();
    }

    const stamp = powers.deadlineStamp;
    if (stamp) {
      const telegraph = Math.min(
        1,
        1 - (stamp.impactAt - state.timeMs) / RALLY_CONFIG.powers.deadlineStamp.telegraphMs
      );
      context.save();
      context.translate(stamp.x, stamp.y);
      context.globalAlpha = stamp.slammed ? 0.92 : 0.3 + telegraph * 0.5;
      context.fillStyle = stamp.slammed ? "rgba(160,34,31,0.34)" : "rgba(16,5,9,0.5)";
      context.strokeStyle = "#ff7460";
      context.lineWidth = 5;
      context.beginPath();
      context.arc(0, 0, RALLY_CONFIG.powers.deadlineStamp.zoneRadius, 0, TAU);
      context.fill();
      context.stroke();
      context.fillStyle = "#fff0bd";
      context.font = `900 ${Math.round(22 + telegraph * 16)}px Impact, sans-serif`;
      context.textAlign = "center";
      context.fillText(stamp.slammed ? "SLAM" : "DEADLINE", 0, 8);
      if (stamp.slammed) {
        context.rotate(stamp.angle);
        context.strokeStyle = "#ffb05e";
        context.lineWidth = RALLY_CONFIG.powers.deadlineStamp.collisionRadius * 2;
        context.beginPath();
        context.moveTo(-RALLY_CONFIG.powers.deadlineStamp.surfaceLength / 2, 0);
        context.lineTo(RALLY_CONFIG.powers.deadlineStamp.surfaceLength / 2, 0);
        context.stroke();
      }
      context.restore();
    }

    const placement = powers.placement;
    if (placement) {
      context.save();
      context.strokeStyle = "rgba(255,244,190,0.82)";
      context.setLineDash([10, 9]);
      context.lineWidth = 4;
      context.beginPath();
      context.arc(placement.x, placement.y, 64, 0, TAU);
      context.stroke();
      context.fillStyle = "#fff0bd";
      context.font = "900 22px Impact, sans-serif";
      context.textAlign = "center";
      context.fillText("RELEASE TO PLACE", placement.x, placement.y - 78);
      context.restore();
    }
  }

  private drawReceipts(context: CanvasRenderingContext2D, state: RallyState) {
    if (state.powers.receiptsUntil <= state.timeMs || !state.excuse.inPlay) return;
    const path = predictReceiptPath(state);
    context.save();
    context.fillStyle = "rgba(215,248,255,0.68)";
    for (let index = 0; index < path.length; index += RALLY_CONFIG.powers.receipts.dotStride) {
      const point = path[index];
      context.globalAlpha = 0.72 * (1 - index / path.length) + 0.14;
      context.beginPath();
      context.arc(point.x, point.y, 5, 0, TAU);
      context.fill();
    }
    context.restore();
  }

  private drawGateGlow(
    context: CanvasRenderingContext2D,
    x: number,
    color: string,
    pulse: number
  ) {
    const centerY = (RALLY_CONFIG.arena.gateTop + RALLY_CONFIG.arena.gateBottom) / 2;
    const gradient = context.createRadialGradient(x, centerY, 10, x, centerY, 190);
    gradient.addColorStop(0, `${color}cc`);
    gradient.addColorStop(0.42, `${color}44`);
    gradient.addColorStop(1, `${color}00`);
    context.save();
    context.globalAlpha = pulse;
    context.fillStyle = gradient;
    context.fillRect(x === 0 ? 0 : x - 220, centerY - 220, 220, 440);
    context.restore();
  }

  private drawBreath(context: CanvasRenderingContext2D, state: RallyState, alpha: number) {
    if (!state.spark.breathing || state.timeMs < state.spark.frozenUntil) return;
    const sparkX = lerp(state.spark.prevX, state.spark.x, alpha);
    const sparkY = lerp(state.spark.prevY, state.spark.y, alpha);
    const facing = state.spark.facing;
    const angle = Math.atan2(facing.y, facing.x);
    const halfAngle = (RALLY_CONFIG.spark.breathHalfAngleDegrees * Math.PI) / 180;
    const charge = Math.min(1, state.spark.breathHeldMs / RALLY_CONFIG.spark.chargedBreathMs);
    const anticipation = Math.min(
      1,
      state.spark.breathHeldMs / RALLY_CONFIG.spark.breathAnticipationMs
    );
    const streamLength = RALLY_CONFIG.spark.breathRange * (0.35 + anticipation * 0.65);
    const widthMultiplier =
      1 + charge * (RALLY_CONFIG.spark.chargedBreathWidthMultiplier - 1);
    const mouthX = sparkX + facing.x * RALLY_CONFIG.spark.mouthOffset;
    const mouthY = sparkY + facing.y * RALLY_CONFIG.spark.mouthOffset;
    const normalX = -facing.y;
    const normalY = facing.x;
    const flameClock = state.timeMs + state.spark.breathHeldMs;
    context.save();
    context.globalCompositeOperation = "lighter";
    const mouthGlow = context.createRadialGradient(
      mouthX,
      mouthY,
      0,
      mouthX,
      mouthY,
      RALLY_CONFIG.fire.mouthGlowRadius
    );
    mouthGlow.addColorStop(0, charge > 0.92 ? "rgba(220,248,255,0.98)" : "rgba(255,251,205,0.98)");
    mouthGlow.addColorStop(1, "rgba(255,86,20,0)");
    context.fillStyle = mouthGlow;
    context.beginPath();
    context.arc(mouthX, mouthY, RALLY_CONFIG.fire.mouthGlowRadius, 0, TAU);
    context.fill();

    for (let layer = 0; layer < 5; layer += 1) {
      const layerRatio = layer / 4;
      const phase = flameClock * 0.024 + layer * 1.73;
      const wave = Math.sin(phase) * (8 + layerRatio * 16);
      const spread = Math.tan(halfAngle) * streamLength * widthMultiplier;
      const endX = mouthX + facing.x * streamLength + normalX * wave;
      const endY = mouthY + facing.y * streamLength + normalY * wave;
      const startOffset = (layer - 2) * RALLY_CONFIG.fire.coreWidth * 0.22;
      const gradient = context.createLinearGradient(mouthX, mouthY, endX, endY);
      gradient.addColorStop(0, charge > 0.92 ? "rgba(218,248,255,0.98)" : "rgba(255,252,220,0.98)");
      gradient.addColorStop(0.45, `rgba(255,${Math.round(164 - layerRatio * 60)},32,${0.9 - layerRatio * 0.08})`);
      gradient.addColorStop(1, "rgba(229,35,12,0)");
      context.strokeStyle = gradient;
      context.lineCap = "round";
      context.lineWidth =
        RALLY_CONFIG.fire.coreWidth +
        layerRatio * RALLY_CONFIG.fire.bodyWidth * widthMultiplier;
      context.beginPath();
      context.moveTo(mouthX + normalX * startOffset, mouthY + normalY * startOffset);
      context.bezierCurveTo(
        mouthX + facing.x * streamLength * 0.34 + normalX * wave * 0.3,
        mouthY + facing.y * streamLength * 0.34 + normalY * wave * 0.3,
        mouthX + facing.x * streamLength * 0.72 - normalX * wave * 0.25,
        mouthY + facing.y * streamLength * 0.72 - normalY * wave * 0.25,
        endX + normalX * spread * (layerRatio - 0.5) * 0.24,
        endY + normalY * spread * (layerRatio - 0.5) * 0.24
      );
      context.stroke();
    }

    for (let index = 0; index < RALLY_CONFIG.fire.emberCount; index += 1) {
      const noise = this.noise(flameClock * 0.001 + index * 19.37);
      const along = 0.12 + noise * 0.88;
      const flutter =
        (this.noise(flameClock * 0.0017 + index * 7.11) - 0.5) *
        Math.tan(halfAngle) *
        streamLength *
        along;
      const x = mouthX + facing.x * streamLength * along + normalX * flutter;
      const y = mouthY + facing.y * streamLength * along + normalY * flutter;
      context.fillStyle = charge > 0.92 && index % 3 === 0 ? "#dffbff" : "#ffb43d";
      context.beginPath();
      context.arc(x, y, 1.5 + noise * 3.5, 0, TAU);
      context.fill();
    }
    context.globalCompositeOperation = "source-over";
    for (let index = 0; index < RALLY_CONFIG.fire.smokeCount; index += 1) {
      const along = (index + 1) / (RALLY_CONFIG.fire.smokeCount + 1);
      const curl = Math.sin(flameClock * 0.008 + index * 2.3) * 18;
      const x = mouthX + facing.x * streamLength * along + normalX * curl;
      const y = mouthY + facing.y * streamLength * along + normalY * curl - along * 18;
      context.fillStyle = `rgba(58,31,38,${0.12 * (1 - along)})`;
      context.beginPath();
      context.arc(x, y, 7 + along * 10, 0, TAU);
      context.fill();
    }
    context.restore();
  }

  private drawTrail(context: CanvasRenderingContext2D, state: RallyState) {
    if (state.reducedMotion || !state.excuse.inPlay || state.excuse.speedTier === 0) return;
    const excuse = state.excuse;
    const colors = ["#f4d28a", "#ffd866", "#ff8a35", "#fff2a4"];
    const count = excuse.trailX.length;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    for (let pass = 0; pass < 2; pass += 1) {
      context.beginPath();
      for (let index = 0; index < count; index += 1) {
        const trailIndex = (excuse.trailHead + 1 + index) % count;
        const x = excuse.trailX[trailIndex];
        const y = excuse.trailY[trailIndex];
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.globalAlpha = pass === 0 ? 0.18 : 0.78;
      context.strokeStyle = colors[excuse.speedTier];
      context.lineWidth =
        (pass === 0 ? 27 : 5) + excuse.speedTier * (pass === 0 ? 7 : 2.5);
      context.stroke();
    }
    context.restore();
  }

  private drawTelegraph(context: CanvasRenderingContext2D, state: RallyState, alpha: number) {
    const clockhead = state.clockhead;
    if (clockhead.telegraph === "none") return;
    const x = lerp(clockhead.prevX, clockhead.x, alpha);
    const y = lerp(clockhead.prevY, clockhead.y, alpha);
    const remaining = Math.max(0, clockhead.telegraphUntil - state.timeMs);
    const duration =
      clockhead.telegraph === "freeze"
        ? RALLY_CONFIG.clockhead.freezeTelegraphMs
        : RALLY_CONFIG.clockhead.swatTelegraphMs;
    const progress = 1 - remaining / duration;
    const color = clockhead.telegraph === "freeze" ? "#6be2ff" : "#ffd56a";
    context.save();
    context.strokeStyle = color;
    context.lineWidth = 8;
    context.globalAlpha = 0.45 + progress * 0.45;
    context.beginPath();
    context.arc(x, y, 90 + progress * 50, -Math.PI / 2, -Math.PI / 2 + TAU * progress);
    context.stroke();
    context.setLineDash([12, 10]);
    context.lineWidth = 3;
    context.beginPath();
    context.arc(x, y, 116, 0, TAU);
    context.stroke();
    context.restore();
  }

  private drawSpark(context: CanvasRenderingContext2D, state: RallyState, alpha: number) {
    const x = lerp(state.spark.prevX, state.spark.x, alpha);
    const y = lerp(state.spark.prevY, state.spark.y, alpha);
    let frame = Math.floor(state.timeMs / 360) % 2;
    if (state.status === "victory") frame = 7;
    else if (state.timeMs < state.spark.frozenUntil) frame = 6;
    else if (state.timeMs < state.spark.dashUntil) frame = 4;
    else if (state.spark.breathing) frame = 3;
    else if (Math.hypot(state.spark.x - state.spark.prevX, state.spark.y - state.spark.prevY) > 0.2) frame = 2;

    context.save();
    context.translate(x, y);
    this.applyCeremonyReaction(context, state, "spark");
    if (state.spark.facing.x < 0) context.scale(-1, 1);
    const recoil = state.spark.breathing ? 1 - Math.sin(state.timeMs * 0.035) * 0.035 : 1;
    const dashProgress = state.timeMs < state.spark.dashUntil && !state.reducedMotion
      ? Math.sin(((state.spark.dashUntil - state.timeMs) / RALLY_CONFIG.spark.dashDurationMs) * Math.PI)
      : 0;
    context.scale(
      recoil * (1 + dashProgress * RALLY_CONFIG.juice.dashSquash),
      (2 - recoil) * (1 - dashProgress * RALLY_CONFIG.juice.dashSquash)
    );
    this.drawSheetFrame(context, this.assets.spark, frame, 4, 2, 190, 213, 0, 14);
    if (state.timeMs < state.spark.frozenUntil) {
      context.globalCompositeOperation = "source-atop";
      context.fillStyle = "rgba(111, 220, 255, 0.38)";
      context.fillRect(-95, -92, 190, 213);
    }
    context.restore();

    if (state.timeMs < state.spark.frozenUntil) this.drawIcePrison(context, x, y);
  }

  private drawClockhead(context: CanvasRenderingContext2D, state: RallyState, alpha: number) {
    const x = lerp(state.clockhead.prevX, state.clockhead.x, alpha);
    const y = lerp(state.clockhead.prevY, state.clockhead.y, alpha);
    let frame = Math.floor(state.timeMs / 420) % 2;
    if (state.status === "victory") frame = 6;
    else if (state.timeMs < state.clockhead.staggerUntil) frame = 5;
    else if (state.timeMs < state.clockhead.whiffUntil) frame = 7;
    else if (state.clockhead.telegraph === "freeze") frame = 4;
    else if (state.clockhead.telegraph === "swat") {
      const progress =
        1 -
        Math.max(0, state.clockhead.telegraphUntil - state.timeMs) /
          RALLY_CONFIG.clockhead.swatTelegraphMs;
      frame = progress > 0.72 ? 3 : 2;
    }
    context.save();
    context.translate(x, y);
    this.applyCeremonyReaction(context, state, "clockhead");
    if (state.clockhead.telegraph === "swat" && !state.reducedMotion) {
      context.rotate(-RALLY_CONFIG.juice.swatLeanRadians);
    }
    this.drawSheetFrame(context, this.assets.clockhead, frame, 4, 2, 220, 248, 0, 8);
    context.restore();
  }

  private drawExcuse(context: CanvasRenderingContext2D, state: RallyState, alpha: number) {
    const excuse = state.excuse;
    if (!excuse.inPlay) return;
    let x = lerp(excuse.prevX, excuse.x, alpha);
    let y = lerp(excuse.prevY, excuse.y, alpha);
    const angle = Math.atan2(excuse.vy, excuse.vx);
    const speed = Math.hypot(excuse.vx, excuse.vy);
    const speedRatio = Math.min(1, speed / RALLY_CONFIG.excuse.maxSpeed);
    const stretch = 1 + (RALLY_CONFIG.feel.maxStretch - 1) * speedRatio;
    const squash = 1 - (1 - RALLY_CONFIG.feel.minSquash) * speedRatio;
    const frame = Math.floor(excuse.spin) % 8;

    let ceremonyScale = 1;
    if (state.ceremony) {
      const { snapshot } = state.ceremony;
      const progress = Math.min(
        1,
        state.ceremony.elapsedRealMs / RALLY_CONFIG.ceremony.ingestionMs
      );
      const eased = 1 - (1 - progress) ** 3;
      const spiral = Math.sin(progress * TAU * RALLY_CONFIG.ceremony.ingestionTurns) *
        RALLY_CONFIG.excuse.radius * (1 - progress);
      const normal = snapshot.x === 0 ? 1 : -1;
      x = lerp(snapshot.startX, snapshot.x, eased);
      y = lerp(snapshot.startY, snapshot.y, eased) + spiral * normal;
      ceremonyScale = Math.max(
        RALLY_CONFIG.ceremony.ingestionMinScale,
        1 - eased
      );
      if (state.ceremony.elapsedRealMs > RALLY_CONFIG.ceremony.ingestionMs) return;
    }

    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.scale(
      stretch * ceremonyScale,
      squash * ceremonyScale *
        (state.ceremony ? RALLY_CONFIG.ceremony.ingestionSquash : 1)
    );
    if (excuse.ignitedUntil > state.timeMs) {
      context.shadowColor = "#ff5b21";
      context.shadowBlur = 30;
      context.fillStyle = "rgba(255,108,28,0.35)";
      context.beginPath();
      context.ellipse(0, 0, 62, 38, 0, 0, TAU);
      context.fill();
    }
    this.drawSheetFrame(context, this.assets.excuse, frame, 4, 2, 196, 220, 0, 0);
    if (frame === 0 || frame === 7) {
      context.rotate(-0.025);
      context.fillStyle = "#4f2815";
      context.font = "700 10px system-ui, sans-serif";
      context.textAlign = "center";
      context.fillText("DO IT", 0, -3);
      context.fillText("TOMORROW", 0, 8);
    }
    context.restore();
  }

  private drawSheetFrame(
    context: CanvasRenderingContext2D,
    image: HTMLImageElement,
    frame: number,
    columns: number,
    rows: number,
    drawWidth: number,
    drawHeight: number,
    offsetX: number,
    offsetY: number
  ) {
    if (!image.complete || image.naturalWidth <= 0) return;
    const cellWidth = image.naturalWidth / columns;
    const cellHeight = image.naturalHeight / rows;
    const sourceX = (frame % columns) * cellWidth;
    const sourceY = Math.floor(frame / columns) * cellHeight;
    context.drawImage(
      image,
      sourceX,
      sourceY,
      cellWidth,
      cellHeight,
      -drawWidth / 2 + offsetX,
      -drawHeight / 2 + offsetY,
      drawWidth,
      drawHeight
    );
  }

  private drawIcePrison(context: CanvasRenderingContext2D, x: number, y: number) {
    context.save();
    context.translate(x, y + 62);
    context.fillStyle = "rgba(112, 222, 255, 0.68)";
    context.strokeStyle = "rgba(226, 251, 255, 0.92)";
    context.lineWidth = 2;
    for (let index = 0; index < 7; index += 1) {
      const offset = (index - 3) * 18;
      const height = 55 + (index % 3) * 22;
      context.beginPath();
      context.moveTo(offset - 13, 16);
      context.lineTo(offset, -height);
      context.lineTo(offset + 13, 16);
      context.closePath();
      context.fill();
      context.stroke();
    }
    context.restore();
  }

  private applyCeremonyReaction(
    context: CanvasRenderingContext2D,
    state: RallyState,
    side: "spark" | "clockhead"
  ) {
    const ceremony = state.ceremony;
    if (!ceremony || ceremony.snapshot.victim !== side || state.reducedMotion) return;
    const reactionStart =
      RALLY_CONFIG.ceremony.ingestionMs + RALLY_CONFIG.ceremony.hitStopMs;
    const progress = Math.max(
      0,
      Math.min(
        1,
        (ceremony.elapsedRealMs - reactionStart) / RALLY_CONFIG.ceremony.reactionMs
      )
    );
    if (progress <= 0) return;
    const wobble = Math.sin(progress * Math.PI * 5) * (1 - progress);
    context.rotate(wobble * 0.22);
    context.scale(1 + Math.abs(wobble) * 0.16, 1 - Math.abs(wobble) * 0.12);
  }

  private drawCeremonyGoalMask(context: CanvasRenderingContext2D, state: RallyState) {
    const ceremony = state.ceremony;
    if (!ceremony) return;
    const { snapshot } = ceremony;
    const progress = Math.min(
      1,
      ceremony.elapsedRealMs / RALLY_CONFIG.ceremony.ingestionMs
    );
    const color = snapshot.victim === "spark" ? "255,91,38" : "66,173,255";
    if (snapshot.mode === "buttHybrid") {
      context.save();
      context.translate(snapshot.x, snapshot.y);
      const target = context.createRadialGradient(0, 0, 2, 0, 0, 72);
      target.addColorStop(0, "rgba(0,0,0,0.98)");
      target.addColorStop(0.46, `rgba(${color},0.5)`);
      target.addColorStop(0.72, `rgba(${color},0.96)`);
      target.addColorStop(1, `rgba(${color},0)`);
      context.fillStyle = target;
      context.beginPath();
      context.arc(0, 0, 74, 0, TAU);
      context.fill();
      context.restore();
      return;
    }
    const inward = snapshot.x === 0 ? 1 : -1;
    context.save();
    context.translate(snapshot.x + inward * 8, snapshot.y);
    context.scale(0.4, 1);
    const portal = context.createRadialGradient(0, 0, 2, 0, 0, 98);
    portal.addColorStop(0, "rgba(0,0,0,0.98)");
    portal.addColorStop(0.58, `rgba(${color},${0.24 + progress * 0.34})`);
    portal.addColorStop(0.83, `rgba(${color},0.92)`);
    portal.addColorStop(1, `rgba(${color},0)`);
    context.fillStyle = portal;
    context.beginPath();
    context.arc(0, 0, 104, 0, TAU);
    context.fill();
    context.restore();
  }

  private drawCeremonyOverlay(context: CanvasRenderingContext2D, state: RallyState) {
    const ceremony = state.ceremony;
    if (!ceremony) return;
    const impactAt =
      RALLY_CONFIG.ceremony.ingestionMs + RALLY_CONFIG.ceremony.hitStopMs;
    const bannerAt = impactAt + RALLY_CONFIG.ceremony.reactionMs;
    const beatAt = bannerAt + RALLY_CONFIG.ceremony.bannerMs;
    const serveAt = beatAt + RALLY_CONFIG.ceremony.beatMs;
    if (ceremony.elapsedRealMs >= bannerAt && ceremony.elapsedRealMs < serveAt) {
      const raw = Math.min(
        1,
        (ceremony.elapsedRealMs - bannerAt) / RALLY_CONFIG.ceremony.bannerMs
      );
      const overshoot =
        raw < 0.72
          ? (raw / 0.72) * RALLY_CONFIG.ceremony.bannerOvershoot
          : lerp(RALLY_CONFIG.ceremony.bannerOvershoot, 1, (raw - 0.72) / 0.28);
      context.save();
      context.translate(RALLY_CONFIG.arena.width / 2, RALLY_CONFIG.arena.height * 0.69);
      if (!state.reducedMotion) {
        context.rotate((RALLY_CONFIG.ceremony.bannerTiltDegrees * Math.PI) / 180);
      }
      context.scale(overshoot, overshoot);
      context.fillStyle = "rgba(12,8,12,0.94)";
      context.strokeStyle = "#f0aa39";
      context.lineWidth = 5;
      context.beginPath();
      context.roundRect(-330, -74, 660, 148, 18);
      context.fill();
      context.stroke();
      context.fillStyle = "#fff1bd";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "900 52px Impact, Haettenschweiler, sans-serif";
      const headline = ceremony.snapshot.bark ?? (
        ceremony.snapshot.mode === "buttHybrid"
          ? ceremony.snapshot.banked ? "BUTT BASH!" : "EXPOSED!"
          : "REALITY GATE SHATTERED!"
      );
      context.fillText(headline, 0, -22);
      context.fillStyle = "#ffb345";
      context.font = "900 26px Impact, Haettenschweiler, sans-serif";
      const subline = ceremony.snapshot.banked
        ? `RETURNED TO SENDER · +${ceremony.snapshot.points}`
        : `+${ceremony.snapshot.points}`;
      context.fillText(subline, 0, 35);
      context.restore();
    }

    if (ceremony.elapsedRealMs >= serveAt) {
      const remaining = Math.max(
        0,
        RALLY_CONFIG.ceremony.serveTelegraphMs -
          (ceremony.elapsedRealMs - serveAt)
      );
      const tick = Math.max(
        1,
        Math.ceil((remaining / RALLY_CONFIG.ceremony.serveTelegraphMs) * 3)
      );
      const direction = ceremony.snapshot.victim === "spark" ? 1 : -1;
      context.save();
      context.translate(RALLY_CONFIG.arena.width / 2, RALLY_CONFIG.arena.height / 2);
      context.fillStyle = "rgba(5,6,12,0.78)";
      context.beginPath();
      context.arc(0, 0, 58, 0, TAU);
      context.fill();
      context.fillStyle = "#fff1bd";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "900 58px Impact, Haettenschweiler, sans-serif";
      context.fillText(String(tick), 0, 0);
      context.strokeStyle = ceremony.snapshot.victim === "spark" ? "#ff6b3c" : "#5db8ff";
      context.lineWidth = 10;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(-95 * direction, 0);
      context.lineTo(-155 * direction, 0);
      context.lineTo(-135 * direction, -18);
      context.moveTo(-155 * direction, 0);
      context.lineTo(-135 * direction, 18);
      context.stroke();
      context.restore();
    }
  }

  private drawFirstServeCue(context: CanvasRenderingContext2D, state: RallyState) {
    if (
      state.scoringMode !== "buttHybrid" ||
      state.firstPlayerContact ||
      state.tutorialSlowUntil <= state.timeMs
    ) return;
    const target = state.buttTargets.clockhead;
    const pulse = 0.5 + Math.sin(state.timeMs * 0.02) * 0.5;
    context.save();
    context.strokeStyle = `rgba(255, 231, 128, ${0.55 + pulse * 0.4})`;
    context.lineWidth = 7;
    context.beginPath();
    context.arc(
      target.x,
      target.y,
      RALLY_CONFIG.buttTarget.tutorialPulseRadius + pulse * 10,
      0,
      TAU
    );
    context.stroke();
    context.fillStyle = "#fff0bd";
    context.textAlign = "center";
    context.font = "900 34px Impact, Haettenschweiler, sans-serif";
    context.fillText("HIT THE TARGET", target.x - 10, target.y - 92);
    context.strokeStyle = "#fff0bd";
    context.lineWidth = 8;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(target.x - 118, target.y - 38);
    context.lineTo(target.x - 56, target.y - 12);
    context.lineTo(target.x - 74, target.y - 38);
    context.moveTo(target.x - 56, target.y - 12);
    context.lineTo(target.x - 86, target.y - 4);
    context.stroke();
    context.restore();
  }

  private noise(value: number) {
    const sine = Math.sin(value * 12.9898) * 43758.5453;
    return sine - Math.floor(sine);
  }

  private drawArenaVignette(context: CanvasRenderingContext2D, state: RallyState) {
    const gradient = context.createRadialGradient(600, 320, 190, 600, 320, 720);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.78, "rgba(0,0,0,0.04)");
    gradient.addColorStop(1, "rgba(0,0,0,0.42)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, RALLY_CONFIG.arena.width, RALLY_CONFIG.arena.height);
    if (
      state.sparkScore >= RALLY_CONFIG.scoring.winScore - 1 ||
      state.clockheadScore >= RALLY_CONFIG.scoring.winScore - 1
    ) {
      context.fillStyle = `rgba(102, 10, 16, ${RALLY_CONFIG.juice.matchPointVignetteAlpha})`;
      context.fillRect(0, 0, RALLY_CONFIG.arena.width, RALLY_CONFIG.arena.height);
    }
  }
}
