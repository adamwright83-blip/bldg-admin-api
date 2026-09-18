import type { RallyState } from "./rallyEngine";
import { RALLY_CONFIG } from "./rallyConfig";
import { RallyRenderer } from "./rallyRenderer";
import { getRallyStudioBumpers } from "./rallyStudioPhysics";

const TAU = Math.PI * 2;
const mix = (from: number, to: number, alpha: number) => from + (to - from) * alpha;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const roundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
};

type RallyRendererPrivate = {
  drawBackground(context: CanvasRenderingContext2D, state: RallyState): void;
  drawButtTargets(context: CanvasRenderingContext2D, state: RallyState, alpha: number): void;
  drawSpark(context: CanvasRenderingContext2D, state: RallyState, alpha: number): void;
  drawClockhead(context: CanvasRenderingContext2D, state: RallyState, alpha: number): void;
  drawTelegraph(context: CanvasRenderingContext2D, state: RallyState, alpha: number): void;
  drawCeremonyOverlay(context: CanvasRenderingContext2D, state: RallyState): void;
  applyCeremonyReaction(
    context: CanvasRenderingContext2D,
    state: RallyState,
    side: "spark" | "clockhead"
  ): void;
};

const prototype = RallyRenderer.prototype as unknown as RallyRendererPrivate;
const drawBackground = prototype.drawBackground;
const drawButtTargets = prototype.drawButtTargets;
const drawSpark = prototype.drawSpark;
const drawClockhead = prototype.drawClockhead;
const drawTelegraph = prototype.drawTelegraph;
const drawCeremonyOverlay = prototype.drawCeremonyOverlay;
const applyCeremonyReaction = prototype.applyCeremonyReaction;

function drawBumper(
  context: CanvasRenderingContext2D,
  bumper: ReturnType<typeof getRallyStudioBumpers>[number],
  state: RallyState
) {
  const threatened =
    state.excuse.inPlay &&
    ((bumper.side === "spark" && state.excuse.vx < 0) ||
      (bumper.side === "clockhead" && state.excuse.vx > 0));
  const pulse = state.reducedMotion ? 0 : Math.sin(state.timeMs * 0.018) * 0.5 + 0.5;
  const warm = bumper.side === "spark";

  context.save();
  context.lineCap = "round";
  context.shadowColor = warm ? "#ff6b35" : "#59c7ff";
  context.shadowBlur = threatened ? 24 + pulse * 14 : 10;
  context.strokeStyle = "rgba(5, 8, 15, 0.92)";
  context.lineWidth = RALLY_CONFIG.duel.bumperThickness * 2 + 16;
  context.beginPath();
  context.moveTo(bumper.ax, bumper.ay);
  context.lineTo(bumper.bx, bumper.by);
  context.stroke();

  const rail = context.createLinearGradient(bumper.ax, bumper.ay, bumper.bx, bumper.by);
  rail.addColorStop(0, warm ? "#ff592f" : "#43adff");
  rail.addColorStop(0.48, "#ffd360");
  rail.addColorStop(1, warm ? "#b82825" : "#2455b5");
  context.strokeStyle = rail;
  context.lineWidth = RALLY_CONFIG.duel.bumperThickness * 2;
  context.beginPath();
  context.moveTo(bumper.ax, bumper.ay);
  context.lineTo(bumper.bx, bumper.by);
  context.stroke();

  context.setLineDash([14, 13]);
  context.lineDashOffset = -(state.timeMs * 0.06) % 27;
  context.strokeStyle = `rgba(255, 247, 190, ${threatened ? 0.74 + pulse * 0.24 : 0.44})`;
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(bumper.ax, bumper.ay);
  context.lineTo(bumper.bx, bumper.by);
  context.stroke();
  context.restore();
}

prototype.drawBackground = function drawStudioBackground(context, state) {
  drawBackground.call(this, context, state);
  if (state.controlMode !== "duel") return;

  const deckTop = RALLY_CONFIG.duel.groundY + RALLY_CONFIG.duel.groundPad;
  const deck = context.createLinearGradient(0, deckTop, 0, RALLY_CONFIG.arena.height);
  deck.addColorStop(0, "rgba(13, 18, 29, 0.82)");
  deck.addColorStop(0.2, "rgba(8, 10, 17, 0.94)");
  deck.addColorStop(1, "rgba(4, 5, 9, 0.99)");
  context.fillStyle = deck;
  context.fillRect(0, deckTop, RALLY_CONFIG.arena.width, RALLY_CONFIG.arena.height - deckTop);
  context.fillStyle = "rgba(255, 191, 73, 0.72)";
  context.fillRect(0, deckTop, RALLY_CONFIG.arena.width, 4);

  for (const bumper of getRallyStudioBumpers()) drawBumper(context, bumper, state);
};

function drawCollisionSlot(
  context: CanvasRenderingContext2D,
  back: number,
  color: string,
  state: RallyState
) {
  const angle = (RALLY_CONFIG.duel.slotAngleDeg * Math.PI) / 180;
  const ux = back * Math.cos(angle);
  const uy = -Math.sin(angle);
  const half = RALLY_CONFIG.duel.slotLen / 2;
  const pulse = state.reducedMotion ? 0 : Math.sin(state.timeMs * 0.022) * 0.5 + 0.5;
  context.save();
  context.lineCap = "round";
  context.shadowColor = color;
  context.shadowBlur = 10 + pulse * 8;
  context.strokeStyle = "#090b10";
  context.lineWidth = 13;
  context.beginPath();
  context.moveTo(-ux * half, -uy * half);
  context.lineTo(ux * half, uy * half);
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(-ux * half, -uy * half);
  context.lineTo(ux * half, uy * half);
  context.stroke();
  context.restore();
}

function drawCoinSlotTarget(
  context: CanvasRenderingContext2D,
  back: number,
  state: RallyState
) {
  const metal = context.createLinearGradient(-42, -48, 42, 48);
  metal.addColorStop(0, "#fff0a8");
  metal.addColorStop(0.22, "#c5892d");
  metal.addColorStop(0.52, "#5b3418");
  metal.addColorStop(0.76, "#db9f35");
  metal.addColorStop(1, "#fff0a8");
  context.save();
  context.shadowColor = "#ff6a32";
  context.shadowBlur = 18;
  roundedRect(context, -43, -50, 86, 100, 22);
  context.fillStyle = "rgba(26, 18, 13, 0.96)";
  context.fill();
  context.lineWidth = 7;
  context.strokeStyle = metal;
  context.stroke();
  context.shadowBlur = 0;

  roundedRect(context, -31, -37, 62, 28, 8);
  context.fillStyle = "#d9ab4c";
  context.fill();
  context.strokeStyle = "#2a180d";
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = "#24140c";
  context.font = "1000 18px Impact, Haettenschweiler, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("25¢", 0, -22);

  context.fillStyle = "#f5d982";
  context.font = "900 8px ui-monospace, Menlo, monospace";
  context.fillText("INSERT", 0, 38);
  drawCollisionSlot(context, back, "#ffd75f", state);
  context.restore();
}

function drawCuckooTarget(
  context: CanvasRenderingContext2D,
  back: number,
  state: RallyState
) {
  const pulse = state.reducedMotion ? 0 : Math.sin(state.timeMs * 0.017) * 0.5 + 0.5;
  context.save();
  context.shadowColor = "#55c2ff";
  context.shadowBlur = 14 + pulse * 6;
  context.fillStyle = "#3a1f13";
  context.strokeStyle = "#d6a047";
  context.lineWidth = 6;
  context.beginPath();
  context.moveTo(-46, 48);
  context.lineTo(-46, -23);
  context.quadraticCurveTo(-46, -52, 0, -61);
  context.quadraticCurveTo(46, -52, 46, -23);
  context.lineTo(46, 48);
  context.closePath();
  context.fill();
  context.stroke();
  context.shadowBlur = 0;

  roundedRect(context, -30, -31, 60, 58, 10);
  context.fillStyle = "#090b10";
  context.fill();
  context.strokeStyle = "#9f6c2e";
  context.lineWidth = 4;
  context.stroke();

  const chickenOut =
    state.ceremony?.snapshot.victim === "clockhead"
      ? clamp(state.ceremony.elapsedRealMs / 360, 0, 1)
      : 0;
  if (chickenOut > 0) {
    context.save();
    context.translate(0, mix(15, -18, chickenOut));
    context.fillStyle = "#f6d64e";
    context.strokeStyle = "#2a1a12";
    context.lineWidth = 3;
    context.beginPath();
    context.ellipse(0, 0, 18, 15, 0, 0, TAU);
    context.fill();
    context.stroke();
    context.fillStyle = "#d93d2f";
    context.beginPath();
    context.moveTo(-8, -11);
    context.lineTo(0, -24);
    context.lineTo(8, -11);
    context.fill();
    context.fillStyle = "#111";
    context.beginPath();
    context.arc(-6, -2, 2.5, 0, TAU);
    context.arc(6, -2, 2.5, 0, TAU);
    context.fill();
    context.restore();
  }

  context.fillStyle = "#f4cf76";
  context.font = "900 8px ui-monospace, Menlo, monospace";
  context.textAlign = "center";
  context.fillText("CUCKOO CHUTE", 0, 42);
  drawCollisionSlot(context, back, "#6bd4ff", state);
  context.restore();
}

prototype.drawButtTargets = function drawThemedTargets(context, state, alpha) {
  if (state.controlMode !== "duel" || state.scoringMode !== "buttHybrid") {
    drawButtTargets.call(this, context, state, alpha);
    return;
  }

  for (const side of ["spark", "clockhead"] as const) {
    const target = state.buttTargets[side];
    const fighter = side === "spark" ? state.spark : state.clockhead;
    const x = mix(target.prevX, target.x, alpha);
    const y = mix(target.prevY, target.y, alpha);
    const back = fighter.facing.x >= 0 ? -1 : 1;
    const wobble = state.reducedMotion ? 0 : Math.sin(state.timeMs * 0.012 + (side === "spark" ? 0 : 1.6)) * 2;
    context.save();
    context.translate(x, y + wobble);
    if (side === "spark") drawCoinSlotTarget(context, back, state);
    else drawCuckooTarget(context, back, state);
    context.restore();
  }
};

prototype.applyCeremonyReaction = function applyStudioReaction(context, state, side) {
  applyCeremonyReaction.call(this, context, state, side);
  const ceremony = state.ceremony;
  if (!ceremony || ceremony.snapshot.victim !== side || state.reducedMotion) return;
  const impactAt = RALLY_CONFIG.ceremony.ingestionMs;
  const progress = clamp(
    (ceremony.elapsedRealMs - impactAt) / Math.max(1, RALLY_CONFIG.duel.ceremonyMs - impactAt),
    0,
    1
  );
  if (progress <= 0) return;
  const recoil = Math.sin(Math.min(1, progress * 1.85) * Math.PI);
  const direction = side === "spark" ? 1 : -1;
  context.translate(-direction * recoil * 24, -recoil * 14);
  context.rotate(direction * recoil * 0.16);
  context.scale(1 + recoil * 0.18, 1 - recoil * 0.14);
};

function drawPainBurst(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  color: string,
  progress: number
) {
  const scale = Math.min(1, progress * 4);
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.rotate(Math.sin(progress * 18) * 0.04);
  context.fillStyle = "rgba(7, 8, 13, 0.92)";
  context.strokeStyle = color;
  context.lineWidth = 5;
  roundedRect(context, -76, -35, 152, 70, 18);
  context.fill();
  context.stroke();
  context.fillStyle = "#fff2bd";
  context.font = "1000 28px Impact, Haettenschweiler, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 0, 2);
  context.restore();
}

prototype.drawSpark = function drawLargerSpark(context, state, alpha) {
  const x = mix(state.spark.prevX, state.spark.x, alpha);
  const y = mix(state.spark.prevY, state.spark.y, alpha);
  context.save();
  context.translate(x, y);
  context.scale(RALLY_CONFIG.duel.sparkVisualScale, RALLY_CONFIG.duel.sparkVisualScale);
  context.translate(-x, -y);
  drawSpark.call(this, context, state, alpha);
  context.restore();

  const ceremony = state.ceremony;
  if (ceremony?.snapshot.victim === "spark") {
    const progress = clamp(ceremony.elapsedRealMs / RALLY_CONFIG.duel.ceremonyMs, 0, 1);
    drawPainBurst(context, x, y - 142, "25¢?!", "#ff7a3f", progress);
  }
};

prototype.drawClockhead = function drawStudioClockhead(context, state, alpha) {
  drawClockhead.call(this, context, state, alpha);
  const ceremony = state.ceremony;
  if (ceremony?.snapshot.victim !== "clockhead") return;
  const x = mix(state.clockhead.prevX, state.clockhead.x, alpha);
  const y = mix(state.clockhead.prevY, state.clockhead.y, alpha);
  const progress = clamp(ceremony.elapsedRealMs / RALLY_CONFIG.duel.ceremonyMs, 0, 1);
  drawPainBurst(context, x, y - 174, "CUCK-OW!", "#62c8ff", progress);
};

function drawRescueInterceptor(context: CanvasRenderingContext2D, state: RallyState) {
  if (state.mission.status !== "ready") return;
  const spark = state.spark;
  const excuse = state.excuse;
  const incoming = excuse.inPlay ? excuse : spark;
  const x = clamp(mix(spark.x, incoming.x, 0.44), spark.x + 64, spark.x + 170);
  const y = clamp(mix(spark.y - 54, incoming.y, 0.34), 175, RALLY_CONFIG.duel.groundY - 58);
  const remaining = Math.max(0, (state.mission.acceptDeadline ?? state.timeMs) - state.timeMs);
  const ratio = clamp(remaining / RALLY_CONFIG.rescue.acceptWindowMs, 0, 1);
  const pulse = state.reducedMotion ? 0 : Math.sin(state.timeMs * 0.025) * 0.5 + 0.5;

  context.save();
  context.translate(x, y);
  context.shadowColor = "#7be8ff";
  context.shadowBlur = 22 + pulse * 12;
  context.fillStyle = "rgba(44, 191, 224, 0.18)";
  context.strokeStyle = "#8af0ff";
  context.lineWidth = 8;
  context.beginPath();
  context.arc(0, 0, 72, -Math.PI * 0.62, Math.PI * 0.62);
  context.stroke();
  context.fill();
  context.shadowBlur = 0;

  context.fillStyle = "#8c5e37";
  context.strokeStyle = "#1b1515";
  context.lineWidth = 4;
  context.beginPath();
  context.arc(0, -8, 30, 0, TAU);
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(-24, -29);
  context.lineTo(-17, -52);
  context.lineTo(-4, -33);
  context.moveTo(24, -29);
  context.lineTo(17, -52);
  context.lineTo(4, -33);
  context.fill();
  context.stroke();

  context.fillStyle = "#24202a";
  context.beginPath();
  context.ellipse(-11, -10, 13, 8, -0.18, 0, TAU);
  context.ellipse(11, -10, 13, 8, 0.18, 0, TAU);
  context.fill();
  context.fillStyle = "#dffaff";
  context.beginPath();
  context.arc(-10, -11, 3, 0, TAU);
  context.arc(10, -11, 3, 0, TAU);
  context.fill();

  context.fillStyle = "#dd7f3c";
  context.beginPath();
  context.moveTo(-19, 20);
  context.quadraticCurveTo(0, 47, 21, 20);
  context.lineTo(12, 62);
  context.lineTo(-13, 62);
  context.closePath();
  context.fill();
  context.stroke();

  context.strokeStyle = "rgba(255,255,255,0.22)";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(0, 0, 88, -Math.PI / 2, -Math.PI / 2 + TAU * ratio);
  context.stroke();
  context.restore();
}

prototype.drawTelegraph = function drawStudioTelegraph(context, state, alpha) {
  drawTelegraph.call(this, context, state, alpha);
  if (state.controlMode === "duel") drawRescueInterceptor(context, state);
};

prototype.drawCeremonyOverlay = function drawStudioCeremony(context, state) {
  drawCeremonyOverlay.call(this, context, state);
  const ceremony = state.ceremony;
  if (!ceremony || state.controlMode !== "duel") return;
  const progress = clamp(ceremony.elapsedRealMs / RALLY_CONFIG.duel.ceremonyMs, 0, 1);
  if (progress < 0.18 || progress > 0.92) return;

  const headline = ceremony.snapshot.victim === "clockhead"
    ? ceremony.snapshot.banked ? "BUMPER BANK · CUCKOOED" : "CUCKOO CHUTE HIT"
    : ceremony.snapshot.banked ? "BUMPER BANK · 25¢ ACCEPTED" : "25¢ SLOT HIT";
  const width = 540;
  const reveal = Math.min(1, (progress - 0.18) * 5);
  context.save();
  context.translate(RALLY_CONFIG.arena.width / 2, 116);
  context.scale(reveal, reveal);
  context.fillStyle = "rgba(5, 7, 12, 0.9)";
  context.strokeStyle = ceremony.snapshot.victim === "clockhead" ? "#69d5ff" : "#ff7840";
  context.lineWidth = 5;
  roundedRect(context, -width / 2, -34, width, 68, 15);
  context.fill();
  context.stroke();
  context.fillStyle = "#fff0b8";
  context.font = "1000 30px Impact, Haettenschweiler, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(headline, 0, 1);
  context.restore();
};
