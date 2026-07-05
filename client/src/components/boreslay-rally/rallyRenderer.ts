import arenaBackgroundUrl from "@/assets/boreslay-rally/arena-background.webp";
import clockheadSheetUrl from "@/assets/boreslay-rally/clockhead-sheet.webp";
import excuseSheetUrl from "@/assets/boreslay-rally/excuse-sheet.webp";
import sparkSheetUrl from "@/assets/boreslay-rally/spark-sheet.webp";
import type { RallyState } from "./rallyEngine";
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
    context.translate(-RALLY_CONFIG.arena.width / 2, -RALLY_CONFIG.arena.height / 2);
    this.drawBackground(context, state);
    this.drawGateThreats(context, state);
    this.drawBreath(context, state, alpha);
    this.drawTrail(context, state);
    this.drawTelegraph(context, state, alpha);
    this.drawSpark(context, state, alpha);
    this.drawClockhead(context, state, alpha);
    this.drawExcuse(context, state, alpha);
    particles.draw(context);
    this.drawArenaVignette(context);
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
    if (!state.excuse.inPlay) return;
    const leftThreat = state.excuse.vx < 0 && state.excuse.x < RALLY_CONFIG.arena.gateThreatDistance;
    const rightThreat =
      state.excuse.vx > 0 &&
      RALLY_CONFIG.arena.width - state.excuse.x < RALLY_CONFIG.arena.gateThreatDistance;
    const pulse = 0.55 + Math.sin(state.timeMs * 0.018) * 0.35;
    if (leftThreat) this.drawGateGlow(context, 0, "#ff572d", pulse);
    if (rightThreat) this.drawGateGlow(context, RALLY_CONFIG.arena.width, "#38bdff", pulse);
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
    const length = RALLY_CONFIG.spark.breathRange;
    const gradient = context.createRadialGradient(sparkX, sparkY, 8, sparkX, sparkY, length);
    gradient.addColorStop(0, "rgba(255,245,170,0.96)");
    gradient.addColorStop(0.3, `rgba(255,122,38,${0.72 + charge * 0.18})`);
    gradient.addColorStop(1, "rgba(235,44,18,0)");
    context.save();
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(sparkX, sparkY);
    context.arc(sparkX, sparkY, length, angle - halfAngle, angle + halfAngle);
    context.closePath();
    context.fill();
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
    if (state.spark.facing.x < 0) context.scale(-1, 1);
    const recoil = state.spark.breathing ? 1 - Math.sin(state.timeMs * 0.035) * 0.035 : 1;
    context.scale(recoil, 2 - recoil);
    this.drawSheetFrame(context, this.assets.spark, frame, 4, 2, 190, 213, 0, 14);
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
    this.drawSheetFrame(context, this.assets.clockhead, frame, 4, 2, 220, 248, 0, 8);
    context.restore();
  }

  private drawExcuse(context: CanvasRenderingContext2D, state: RallyState, alpha: number) {
    const excuse = state.excuse;
    if (!excuse.inPlay) return;
    const x = lerp(excuse.prevX, excuse.x, alpha);
    const y = lerp(excuse.prevY, excuse.y, alpha);
    const angle = Math.atan2(excuse.vy, excuse.vx);
    const speed = Math.hypot(excuse.vx, excuse.vy);
    const speedRatio = Math.min(1, speed / RALLY_CONFIG.excuse.maxSpeed);
    const stretch = 1 + (RALLY_CONFIG.feel.maxStretch - 1) * speedRatio;
    const squash = 1 - (1 - RALLY_CONFIG.feel.minSquash) * speedRatio;
    const frame = Math.floor(excuse.spin) % 8;

    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.scale(stretch, squash);
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

  private drawArenaVignette(context: CanvasRenderingContext2D) {
    const gradient = context.createRadialGradient(600, 320, 190, 600, 320, 720);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.78, "rgba(0,0,0,0.04)");
    gradient.addColorStop(1, "rgba(0,0,0,0.42)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, RALLY_CONFIG.arena.width, RALLY_CONFIG.arena.height);
  }
}
