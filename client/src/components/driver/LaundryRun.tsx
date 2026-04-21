import { useRef, useEffect, useState, useCallback } from "react";
import { sounds } from "./driverSounds";
import { haptics } from "./driverHaptics";
import playerRunUrl from "@/assets/driver/laundry-run/player-run.png";
import playerJumpUrl from "@/assets/driver/laundry-run/player-jump.png";
import playerSlideUrl from "@/assets/driver/laundry-run/player-slide.png";
import bgStreetUrl from "@/assets/driver/laundry-run/bg-street.png";

interface Props {
  onComplete: (score: number) => void;
}

type GameState = "idle" | "playing" | "complete";
type PlayerPose = "run" | "jump" | "slide";
type ObstacleType = "mailbox" | "hydrant" | "police";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PlayerState {
  y: number;
  vy: number;
  grounded: boolean;
  slideFrames: number;
  queuedSlide: boolean;
}

interface Obstacle {
  id: number;
  type: ObstacleType;
  x: number;
  y: number;
  w: number;
  h: number;
  hit: boolean;
}

interface LaundryBag {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  bobPhase: number;
  collected: boolean;
}

interface SpriteBank {
  run: HTMLImageElement | null;
  jump: HTMLImageElement | null;
  slide: HTMLImageElement | null;
  bg: HTMLImageElement | null;
}

const GAME_DURATION = 30;
const GROUND_Y_RATIO = 0.68;
const PLAYER_HEIGHT_RATIO = 0.252; // 10% smaller than previous 0.28
const START_SPEED_RATIO = 0.008;
const SPEED_ACCEL_RATIO = 0.00004;
const MAX_SPEED_RATIO = 0.018;
const OBSTACLE_MIN_FRAMES = 90;
const OBSTACLE_MAX_FRAMES = 140;
const BAG_MIN_FRAMES = 42;
const BAG_MAX_FRAMES = 78;
const SLIDE_DURATION_FRAMES = 45;
const MAILBOX_POLICE_SCALE = 1.35;
const LAUNDRY_BAG_SCALE = 1.75;
const BEST_DISTANCE_KEY = "laundry-run-best-distance";
const PLAYER_RUN_URL = playerRunUrl;
const PLAYER_JUMP_URL = playerJumpUrl;
const PLAYER_SLIDE_URL = playerSlideUrl;
const BG_STREET_URL = bgStreetUrl;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function shrinkRect(rect: Rect, ratio: number): Rect {
  const dx = rect.w * ratio;
  const dy = rect.h * ratio;
  return {
    x: rect.x + dx,
    y: rect.y + dy,
    w: rect.w - dx * 2,
    h: rect.h - dy * 2,
  };
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function drawRunnerGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string
) {
  const s = Math.max(6, size);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.8, s * 0.14);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.arc(x, y - s * 0.62, s * 0.18, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.45);
  ctx.lineTo(x - s * 0.08, y - s * 0.05);
  ctx.lineTo(x + s * 0.26, y + s * 0.14);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - s * 0.02, y - s * 0.25);
  ctx.lineTo(x + s * 0.3, y - s * 0.4);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - s * 0.05, y - s * 0.03);
  ctx.lineTo(x - s * 0.3, y + s * 0.25);
  ctx.moveTo(x + s * 0.24, y + s * 0.14);
  ctx.lineTo(x + s * 0.55, y + s * 0.3);
  ctx.stroke();
  ctx.restore();
}

function drawCheckeredFlag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number
) {
  const s = Math.max(10, size);
  ctx.save();
  ctx.strokeStyle = "#00ff88";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - s);
  ctx.stroke();

  const fw = s * 0.75;
  const fh = s * 0.55;
  const fx = x + 2;
  const fy = y - s;
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      ctx.fillStyle = (row + col) % 2 === 0 ? "#ffffff" : "#101010";
      ctx.fillRect(fx + (fw / 3) * col, fy + (fh / 2) * row, fw / 3, fh / 2);
    }
  }
  ctx.restore();
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  bg: HTMLImageElement | null,
  scroll: number
) {
  if (bg) {
    const scale = h / bg.height;
    const drawW = Math.ceil(bg.width * scale);
    const offset = ((Math.floor(scroll) % drawW) + drawW) % drawW;

    for (let x = -offset; x < w + drawW; x += drawW) {
      ctx.drawImage(bg, x, 0, drawW + 1, h);
    }
  } else {
    const skyGradient = ctx.createLinearGradient(0, 0, 0, h);
    skyGradient.addColorStop(0, "#96c7ff");
    skyGradient.addColorStop(0.5, "#e4f4ff");
    skyGradient.addColorStop(1, "#fef2cf");
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, w, h);
  }

  const warmTint = ctx.createLinearGradient(0, 0, 0, h);
  warmTint.addColorStop(0, "rgba(255, 187, 107, 0.08)");
  warmTint.addColorStop(1, "rgba(37, 20, 6, 0.08)");
  ctx.fillStyle = warmTint;
  ctx.fillRect(0, 0, w, h);
}

function drawMailbox(ctx: CanvasRenderingContext2D, obstacle: Obstacle) {
  const { x, y, w, h } = obstacle;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;

  ctx.fillStyle = "#1a5fa8";
  roundedRectPath(ctx, x, y + h * 0.18, w, h * 0.82, w * 0.08);
  ctx.fill();

  ctx.fillStyle = "#0d3d6e";
  roundedRectPath(ctx, x, y, w, h * 0.34, w * 0.15);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  roundedRectPath(ctx, x + w * 0.2, y + h * 0.34, w * 0.6, h * 0.08, h * 0.02);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `bold ${Math.max(9, w * 0.22)}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("USPS", x + w / 2, y + h * 0.65);

  ctx.fillStyle = "#0d3d6e";
  ctx.fillRect(x + w * 0.14, y + h * 0.9, w * 0.16, h * 0.1);
  ctx.fillRect(x + w * 0.7, y + h * 0.9, w * 0.16, h * 0.1);
  ctx.restore();
}

function drawHydrant(ctx: CanvasRenderingContext2D, obstacle: Obstacle) {
  const { x, y, w, h } = obstacle;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;

  ctx.fillStyle = "#f5c518";
  roundedRectPath(ctx, x + w * 0.14, y + h * 0.26, w * 0.72, h * 0.56, w * 0.22);
  ctx.fill();

  ctx.fillStyle = "#c9a010";
  roundedRectPath(ctx, x + w * 0.54, y + h * 0.26, w * 0.32, h * 0.56, w * 0.16);
  ctx.fill();

  ctx.fillStyle = "#f5c518";
  roundedRectPath(ctx, x + w * 0.2, y + h * 0.12, w * 0.6, h * 0.18, w * 0.22);
  ctx.fill();

  ctx.fillStyle = "#c9a010";
  roundedRectPath(ctx, x + w * 0.26, y + h * 0.02, w * 0.48, h * 0.14, w * 0.18);
  ctx.fill();

  roundedRectPath(ctx, x - w * 0.02, y + h * 0.4, w * 0.2, h * 0.16, w * 0.08);
  ctx.fill();
  roundedRectPath(ctx, x + w * 0.82, y + h * 0.4, w * 0.2, h * 0.16, w * 0.08);
  ctx.fill();

  ctx.restore();
}

function drawPoliceCar(
  ctx: CanvasRenderingContext2D,
  obstacle: Obstacle,
  frame: number
) {
  const { x, y, w, h } = obstacle;
  const flash = Math.floor(frame / 8) % 2 === 0;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.34)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;

  ctx.fillStyle = "#1a1a2e";
  roundedRectPath(ctx, x, y + h * 0.26, w, h * 0.58, h * 0.16);
  ctx.fill();

  ctx.fillStyle = "#111111";
  roundedRectPath(ctx, x + w * 0.2, y + h * 0.1, w * 0.42, h * 0.24, h * 0.12);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  roundedRectPath(ctx, x + w * 0.5, y + h * 0.34, w * 0.36, h * 0.28, h * 0.08);
  ctx.fill();

  ctx.fillStyle = "#111111";
  ctx.font = `bold ${Math.max(9, h * 0.22)}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("POLICE", x + w * 0.68, y + h * 0.48);

  const wheelR = h * 0.13;
  ctx.fillStyle = "#2f2f2f";
  ctx.beginPath();
  ctx.arc(x + w * 0.23, y + h * 0.84, wheelR, 0, Math.PI * 2);
  ctx.arc(x + w * 0.78, y + h * 0.84, wheelR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#111111";
  roundedRectPath(ctx, x + w * 0.4, y + h * 0.02, w * 0.24, h * 0.1, h * 0.04);
  ctx.fill();

  ctx.fillStyle = flash ? "#ff2244" : "#2244ff";
  roundedRectPath(ctx, x + w * 0.42, y + h * 0.025, w * 0.1, h * 0.08, h * 0.02);
  ctx.fill();
  ctx.fillStyle = flash ? "#2244ff" : "#ff2244";
  roundedRectPath(ctx, x + w * 0.52, y + h * 0.025, w * 0.1, h * 0.08, h * 0.02);
  ctx.fill();

  ctx.restore();
}

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  obstacle: Obstacle,
  frame: number
) {
  if (obstacle.type === "mailbox") {
    drawMailbox(ctx, obstacle);
    return;
  }
  if (obstacle.type === "hydrant") {
    drawHydrant(ctx, obstacle);
    return;
  }
  drawPoliceCar(ctx, obstacle, frame);
}

function drawLaundryBag(
  ctx: CanvasRenderingContext2D,
  bag: LaundryBag,
  frame: number
) {
  const bob = Math.sin(frame * 0.08 + bag.bobPhase) * 3;
  const cx = bag.x + bag.w * 0.5;
  const cy = bag.y + bag.h * 0.5 + bob;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.24)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;

  ctx.fillStyle = "#f0f0f0";
  ctx.beginPath();
  ctx.ellipse(cx, cy + bag.h * 0.12, bag.w * 0.34, bag.h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx - bag.w * 0.2, cy - bag.h * 0.08);
  ctx.quadraticCurveTo(cx - bag.w * 0.08, cy - bag.h * 0.32, cx, cy - bag.h * 0.22);
  ctx.quadraticCurveTo(cx + bag.w * 0.08, cy - bag.h * 0.32, cx + bag.w * 0.2, cy - bag.h * 0.08);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#e5d7c2";
  ctx.beginPath();
  ctx.ellipse(cx, cy - bag.h * 0.24, bag.w * 0.055, bag.h * 0.065, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawFallbackPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
) {
  ctx.save();
  ctx.fillStyle = "#111";
  roundedRectPath(ctx, x + w * 0.18, y + h * 0.28, w * 0.56, h * 0.62, w * 0.1);
  ctx.fill();
  ctx.fillStyle = "#f2a04a";
  ctx.beginPath();
  ctx.arc(x + w * 0.62, y + h * 0.24, h * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#000";
  roundedRectPath(ctx, x + w * 0.45, y + h * 0.08, w * 0.28, h * 0.14, h * 0.03);
  ctx.fill();
  ctx.restore();
}

function drawTopHud(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  distanceMeters: number,
  bestMeters: number,
  cash: number
) {
  const barHeight = h * 0.11;
  ctx.save();
  ctx.fillStyle = "rgba(6, 9, 8, 0.76)";
  ctx.fillRect(0, 0, w, barHeight);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, barHeight - 0.5);
  ctx.lineTo(w, barHeight - 0.5);
  ctx.stroke();

  const titleSize = Math.max(20, Math.min(46, w * 0.088));
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = `italic 900 ${titleSize}px Impact, "Arial Black", sans-serif`;
  ctx.fillText("LAUNDRY RUN", w * 0.03, barHeight * 0.53);
  drawRunnerGlyph(ctx, w * 0.31, barHeight * 0.54, barHeight * 0.28, "#00d26a");

  const statStartX = w * 0.44;
  const colWidth = w * 0.16;
  const labelY = barHeight * 0.32;
  const valueY = barHeight * 0.69;
  const labelFont = Math.max(9, barHeight * 0.17);
  const valueFont = Math.max(20, barHeight * 0.38);

  const drawStat = (
    x: number,
    label: string,
    value: string,
    valueColor: string
  ) => {
    ctx.textAlign = "left";
    ctx.fillStyle = "#aab3ad";
    ctx.font = `600 ${labelFont}px Arial, sans-serif`;
    ctx.fillText(label, x, labelY);
    ctx.fillStyle = valueColor;
    ctx.font = `bold ${valueFont}px Arial, sans-serif`;
    ctx.fillText(value, x, valueY);
  };

  drawStat(statStartX, "DISTANCE", `${distanceMeters}M`, "#00e36f");
  drawStat(statStartX + colWidth, "BEST", `${bestMeters}M`, "#ffffff");
  drawStat(statStartX + colWidth * 2, "CLEAN CASH", `$${cash}`, "#00e36f");

  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 2; i += 1) {
    const x = statStartX + colWidth * i - w * 0.025;
    ctx.beginPath();
    ctx.moveTo(x, barHeight * 0.15);
    ctx.lineTo(x, barHeight * 0.86);
    ctx.stroke();
  }

  const pauseW = Math.min(52, w * 0.085);
  const pauseH = barHeight * 0.58;
  const pauseX = w - pauseW - w * 0.03;
  const pauseY = barHeight * 0.21;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  roundedRectPath(ctx, pauseX, pauseY, pauseW, pauseH, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(pauseX + pauseW * 0.35, pauseY + pauseH * 0.25, pauseW * 0.1, pauseH * 0.5);
  ctx.fillRect(pauseX + pauseW * 0.55, pauseY + pauseH * 0.25, pauseW * 0.1, pauseH * 0.5);

  ctx.restore();
}

function drawBottomProgress(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  progress: number
) {
  const clamped = clamp(progress, 0, 1);
  const bottomInset = h * 0.04;
  const barX = w * 0.03;
  const barW = w * 0.94;
  const barH = Math.max(8, h * 0.012);
  const barY = h - bottomInset - barH;

  ctx.save();

  ctx.fillStyle = "rgba(0,0,0,0.56)";
  roundedRectPath(ctx, barX, barY, barW, barH, barH * 0.5);
  ctx.fill();

  const fillW = Math.max(barH, barW * clamped);
  ctx.fillStyle = "#00f07a";
  roundedRectPath(ctx, barX, barY, fillW, barH, barH * 0.5);
  ctx.fill();

  ctx.fillStyle = "#00ff88";
  ctx.font = `700 ${Math.max(10, h * 0.018)}px "Courier New", monospace`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("START", barX, barY - 8);

  ctx.textAlign = "right";
  ctx.fillText("DROP-OFF", barX + barW, barY - 8);
  drawCheckeredFlag(ctx, barX + barW - 2, barY - 2, Math.max(12, h * 0.022));

  ctx.fillStyle = "#00ff88";
  ctx.beginPath();
  ctx.arc(barX + fillW, barY + barH / 2, barH * 0.75, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function getObstacleSize(type: ObstacleType, canvasWidth: number): { w: number; h: number } {
  if (type === "mailbox") {
    return {
      w: canvasWidth * 0.08 * MAILBOX_POLICE_SCALE,
      h: canvasWidth * 0.14 * MAILBOX_POLICE_SCALE,
    };
  }
  if (type === "hydrant") {
    return { w: canvasWidth * 0.055, h: canvasWidth * 0.09 };
  }
  return {
    w: canvasWidth * 0.22 * MAILBOX_POLICE_SCALE,
    h: canvasWidth * 0.12 * MAILBOX_POLICE_SCALE,
  };
}

export default function LaundryRun({ onComplete }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const rafRef = useRef<number | null>(null);
  const completionTimeoutRef = useRef<number | null>(null);

  const viewportRef = useRef({ w: 1, h: 1, dpr: 1 });
  const spriteBankRef = useRef<SpriteBank>({
    run: null,
    jump: null,
    slide: null,
    bg: null,
  });

  const playerRef = useRef<PlayerState>({
    y: 0,
    vy: 0,
    grounded: true,
    slideFrames: 0,
    queuedSlide: false,
  });
  const obstaclesRef = useRef<Obstacle[]>([]);
  const bagsRef = useRef<LaundryBag[]>([]);

  const gameStateRef = useRef<GameState>("idle");
  const startMsRef = useRef(0);
  const frameRef = useRef(0);
  const obstacleSpawnTimerRef = useRef(0);
  const bagSpawnTimerRef = useRef(0);
  const bgScrollRef = useRef(0);
  const speedRef = useRef(0);
  const slowFramesRef = useRef(0);
  const hitFlashRef = useRef(0);
  const collectedRef = useRef(0);
  const distanceRef = useRef(0);
  const elapsedRef = useRef(0);
  const bestDistanceRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const obstacleIdRef = useRef(0);
  const bagIdRef = useRef(0);

  const [gameState, setGameState] = useState<GameState>("idle");
  const [completionLabel, setCompletionLabel] = useState("RUN COMPLETE");
  const [assetsReady, setAssetsReady] = useState(false);

  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    viewportRef.current = { w, h, dpr };

    const pixelW = Math.floor(w * dpr);
    const pixelH = Math.floor(h * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }

    const ctx = ctxRef.current || canvas.getContext("2d");
    if (!ctx) return;

    ctxRef.current = ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const groundY = h * GROUND_Y_RATIO;
    const playerH = h * PLAYER_HEIGHT_RATIO;
    if (playerRef.current.grounded) {
      playerRef.current.y = groundY - playerH;
    }
  }, []);

  const resetRuntime = useCallback(() => {
    const { w, h } = viewportRef.current;
    const groundY = h * GROUND_Y_RATIO;
    const playerHeight = h * PLAYER_HEIGHT_RATIO;

    playerRef.current = {
      y: groundY - playerHeight,
      vy: 0,
      grounded: true,
      slideFrames: 0,
      queuedSlide: false,
    };
    obstaclesRef.current = [];
    bagsRef.current = [];
    frameRef.current = 0;
    obstacleSpawnTimerRef.current = randomInt(45, 75);
    bagSpawnTimerRef.current = randomInt(24, 40);
    bgScrollRef.current = 0;
    speedRef.current = w * START_SPEED_RATIO;
    slowFramesRef.current = 0;
    hitFlashRef.current = 0;
    collectedRef.current = 0;
    distanceRef.current = 0;
    elapsedRef.current = 0;
    completedRef.current = false;
    startMsRef.current = performance.now();
  }, []);

  const finalizeRun = useCallback(
    (label: string, success: boolean) => {
      if (completedRef.current) return;
      completedRef.current = true;

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      const distanceMeters = Math.floor(distanceRef.current);
      if (distanceMeters > bestDistanceRef.current) {
        bestDistanceRef.current = distanceMeters;
        try {
          window.localStorage.setItem(BEST_DISTANCE_KEY, String(distanceMeters));
        } catch {
          // Local storage can fail in private mode; safe to ignore.
        }
      }

      if (completionTimeoutRef.current !== null) {
        window.clearTimeout(completionTimeoutRef.current);
      }

      if (success) {
        sounds.scanConfirm();
        haptics.slam();
      } else {
        sounds.crash();
        haptics.error();
      }

      setCompletionLabel(label);
      gameStateRef.current = "complete";
      setGameState("complete");

      const finalScore = collectedRef.current;
      completionTimeoutRef.current = window.setTimeout(() => {
        onComplete(finalScore);
      }, 700);
    },
    [onComplete]
  );

  const startGame = useCallback(() => {
    if (gameStateRef.current === "playing") return;
    if (completionTimeoutRef.current !== null) {
      window.clearTimeout(completionTimeoutRef.current);
      completionTimeoutRef.current = null;
    }
    resetRuntime();
    gameStateRef.current = "playing";
    setGameState("playing");
    sounds.tick();
    haptics.tap();
  }, [resetRuntime]);

  const triggerJump = useCallback(() => {
    if (gameStateRef.current === "idle") {
      startGame();
      return;
    }
    if (gameStateRef.current !== "playing") return;

    const player = playerRef.current;
    if (!player.grounded) return;

    player.slideFrames = 0;
    player.vy = -viewportRef.current.h * 0.022;
    player.grounded = false;
    sounds.press();
    haptics.tap();
  }, [startGame]);

  const triggerSlide = useCallback(() => {
    if (gameStateRef.current === "idle") {
      startGame();
      return;
    }
    if (gameStateRef.current !== "playing") return;

    const player = playerRef.current;
    if (player.grounded) {
      player.slideFrames = SLIDE_DURATION_FRAMES;
      sounds.press();
      haptics.tap();
      return;
    }
    player.queuedSlide = true;
  }, [startGame]);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    try {
      const savedBest = Number(window.localStorage.getItem(BEST_DISTANCE_KEY) || 0);
      if (Number.isFinite(savedBest) && savedBest > 0) {
        bestDistanceRef.current = Math.floor(savedBest);
      }
    } catch {
      bestDistanceRef.current = 0;
    }
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      const [runResult, jumpResult, slideResult, bgResult] = await Promise.allSettled([
        loadImage(PLAYER_RUN_URL),
        loadImage(PLAYER_JUMP_URL),
        loadImage(PLAYER_SLIDE_URL),
        loadImage(BG_STREET_URL),
      ]);

      if (!active) return;

      spriteBankRef.current.run = runResult.status === "fulfilled" ? runResult.value : null;
      spriteBankRef.current.jump =
        jumpResult.status === "fulfilled" ? jumpResult.value : null;
      spriteBankRef.current.slide =
        slideResult.status === "fulfilled" ? slideResult.value : null;
      spriteBankRef.current.bg = bgResult.status === "fulfilled" ? bgResult.value : null;

      setAssetsReady(true);
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    syncCanvasSize();
    window.addEventListener("resize", syncCanvasSize);
    return () => window.removeEventListener("resize", syncCanvasSize);
  }, [syncCanvasSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (event: TouchEvent) => {
      event.preventDefault();
      const touch = event.changedTouches[0];
      touchStartYRef.current = touch ? touch.clientY : null;
      triggerJump();
    };

    const onTouchEnd = (event: TouchEvent) => {
      event.preventDefault();
      const touch = event.changedTouches[0];
      if (touchStartYRef.current !== null && touch) {
        const deltaY = touch.clientY - touchStartYRef.current;
        if (deltaY > 40) {
          triggerSlide();
        }
      }
      touchStartYRef.current = null;
    };

    const onTouchCancel = (event: TouchEvent) => {
      event.preventDefault();
      touchStartYRef.current = null;
    };

    const onMouseDown = (event: MouseEvent) => {
      event.preventDefault();
      triggerJump();
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", onTouchCancel, { passive: false });
    canvas.addEventListener("mousedown", onMouseDown);

    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchCancel);
      canvas.removeEventListener("mousedown", onMouseDown);
    };
  }, [triggerJump, triggerSlide]);

  useEffect(() => {
    if (gameState !== "playing") return;
    const ctx = ctxRef.current;
    if (!ctx) return;

    let active = true;

    const tick = () => {
      if (!active || gameStateRef.current !== "playing") return;
      syncCanvasSize();

      const { w, h } = viewportRef.current;
      const groundY = h * GROUND_Y_RATIO;
      const playerHeight = h * PLAYER_HEIGHT_RATIO;
      const playerX = w * 0.18;

      frameRef.current += 1;
      const frame = frameRef.current;

      const elapsed = (performance.now() - startMsRef.current) / 1000;
      elapsedRef.current = elapsed;
      if (elapsed >= GAME_DURATION) {
        finalizeRun("RUN COMPLETE", true);
        return;
      }

      const baseSpeed = Math.min(
        w * START_SPEED_RATIO + frame * w * SPEED_ACCEL_RATIO,
        w * MAX_SPEED_RATIO
      );
      if (slowFramesRef.current > 0) {
        slowFramesRef.current -= 1;
      }
      const speed = slowFramesRef.current > 0 ? baseSpeed * 0.72 : baseSpeed;
      speedRef.current = speed;
      bgScrollRef.current += speed * 0.6;

      const player = playerRef.current;
      if (player.slideFrames > 0) {
        player.slideFrames -= 1;
      }
      if (!player.grounded) {
        player.vy += h * 0.0012;
        player.y += player.vy;
        const floorY = groundY - playerHeight;
        if (player.y >= floorY) {
          player.y = floorY;
          player.vy = 0;
          player.grounded = true;
          if (player.queuedSlide) {
            player.slideFrames = SLIDE_DURATION_FRAMES;
            player.queuedSlide = false;
          }
        }
      } else {
        player.y = groundY - playerHeight;
      }

      obstacleSpawnTimerRef.current -= 1;
      if (obstacleSpawnTimerRef.current <= 0) {
        const obstacleTypes: ObstacleType[] = ["mailbox", "hydrant", "police"];
        const type = obstacleTypes[randomInt(0, obstacleTypes.length - 1)];
        const size = getObstacleSize(type, w);
        obstaclesRef.current.push({
          id: obstacleIdRef.current++,
          type,
          x: w + size.w + randomRange(12, w * 0.12),
          y: groundY - size.h,
          w: size.w,
          h: size.h,
          hit: false,
        });
        obstacleSpawnTimerRef.current = randomInt(OBSTACLE_MIN_FRAMES, OBSTACLE_MAX_FRAMES);
      }

      bagSpawnTimerRef.current -= 1;
      if (bagSpawnTimerRef.current <= 0) {
        const bagW = Math.max(18 * LAUNDRY_BAG_SCALE, w * 0.04 * LAUNDRY_BAG_SCALE);
        const bagH = bagW * 1.12;
        const minY = h * 0.45;
        const maxY = Math.max(minY + 2, groundY - bagH);
        bagsRef.current.push({
          id: bagIdRef.current++,
          x: w + bagW + randomRange(10, w * 0.2),
          y: randomRange(minY, maxY),
          w: bagW,
          h: bagH,
          bobPhase: Math.random() * Math.PI * 2,
          collected: false,
        });
        bagSpawnTimerRef.current = randomInt(BAG_MIN_FRAMES, BAG_MAX_FRAMES);
      }

      obstaclesRef.current.forEach((obstacle) => {
        obstacle.x -= speed;
      });
      bagsRef.current.forEach((bag) => {
        bag.x -= speed;
      });

      const pose: PlayerPose =
        player.slideFrames > 0 ? "slide" : player.grounded ? "run" : "jump";
      const sprite =
        pose === "run"
          ? spriteBankRef.current.run
          : pose === "jump"
            ? spriteBankRef.current.jump
            : spriteBankRef.current.slide;
      const spriteRatio = sprite ? sprite.width / sprite.height : 0.8;
      const playerW = playerHeight * spriteRatio;
      const playerH = playerHeight;
      const playerDrawX = playerX - playerW * 0.1;
      const playerDrawY = player.y + (pose === "slide" ? playerH * 0.3 : 0);
      const playerRotation = pose === "run" ? (Math.floor(frame / 8) % 2 === 0 ? 3 : -3) : 0;

      let playerRect: Rect = {
        x: playerDrawX + playerW * 0.2,
        y: playerDrawY + playerH * 0.12,
        w: playerW * 0.56,
        h: playerH * 0.76,
      };
      if (pose === "slide") {
        playerRect = {
          x: playerDrawX + playerW * 0.24,
          y: playerDrawY + playerH * 0.46,
          w: playerW * 0.52,
          h: playerH * 0.36,
        };
      }
      const forgivingPlayerRect = shrinkRect(playerRect, 0.2);

      let hardFail = false;
      obstaclesRef.current.forEach((obstacle) => {
        if (obstacle.hit) return;
        const forgivingObstacleRect = shrinkRect(
          { x: obstacle.x, y: obstacle.y, w: obstacle.w, h: obstacle.h },
          0.2
        );
        if (!intersects(forgivingPlayerRect, forgivingObstacleRect)) return;

        obstacle.hit = true;
        if (obstacle.type === "police") {
          hitFlashRef.current = 16;
          hardFail = true;
          return;
        }

        slowFramesRef.current = 18;
        hitFlashRef.current = 9;
        if (collectedRef.current > 0) {
          collectedRef.current -= 1;
        }
        distanceRef.current = Math.max(0, distanceRef.current - 10);
        sounds.crash();
        haptics.error();
      });

      if (hardFail) {
        finalizeRun("BUSTED", false);
        return;
      }

      bagsRef.current.forEach((bag) => {
        if (bag.collected) return;
        const forgivingBagRect = shrinkRect(
          { x: bag.x, y: bag.y, w: bag.w, h: bag.h },
          0.16
        );
        if (!intersects(forgivingPlayerRect, forgivingBagRect)) return;
        bag.collected = true;
        collectedRef.current += 1;
        sounds.collect();
        haptics.impact();
      });

      obstaclesRef.current = obstaclesRef.current.filter(
        (obstacle) => !obstacle.hit && obstacle.x + obstacle.w > -w * 0.25
      );
      bagsRef.current = bagsRef.current.filter(
        (bag) => !bag.collected && bag.x + bag.w > -w * 0.2
      );

      distanceRef.current += speed * 0.02;
      const distanceMeters = Math.floor(distanceRef.current);
      const bestMeters = Math.max(bestDistanceRef.current, distanceMeters);
      const cash = collectedRef.current;

      ctx.clearRect(0, 0, w, h);
      drawBackground(ctx, w, h, spriteBankRef.current.bg, bgScrollRef.current);

      const lowerShade = ctx.createLinearGradient(0, groundY - h * 0.04, 0, h);
      lowerShade.addColorStop(0, "rgba(0, 0, 0, 0)");
      lowerShade.addColorStop(1, "rgba(0, 0, 0, 0.2)");
      ctx.fillStyle = lowerShade;
      ctx.fillRect(0, groundY - h * 0.04, w, h - (groundY - h * 0.04));

      bagsRef.current.forEach((bag) => drawLaundryBag(ctx, bag, frame));
      obstaclesRef.current.forEach((obstacle) => drawObstacle(ctx, obstacle, frame));

      ctx.save();
      ctx.globalAlpha = 0.23;
      ctx.fillStyle = "#000000";
      ctx.beginPath();
      ctx.ellipse(
        playerDrawX + playerW * 0.48,
        groundY + playerH * 0.02,
        playerW * 0.25,
        playerH * 0.07,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(playerDrawX + playerW * 0.5, playerDrawY + playerH * 0.5);
      ctx.rotate((playerRotation * Math.PI) / 180);
      if (sprite) {
        ctx.drawImage(sprite, -playerW * 0.5, -playerH * 0.5, playerW, playerH);
      } else {
        drawFallbackPlayer(ctx, -playerW * 0.5, -playerH * 0.5, playerW, playerH);
      }
      ctx.restore();

      drawTopHud(ctx, w, h, distanceMeters, bestMeters, cash);
      drawBottomProgress(ctx, w, h, elapsed / GAME_DURATION);

      if (hitFlashRef.current > 0) {
        const intensity = hitFlashRef.current / 16;
        ctx.fillStyle = `rgba(255, 60, 60, ${0.12 * intensity})`;
        ctx.fillRect(0, 0, w, h);
        hitFlashRef.current -= 1;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [finalizeRun, gameState, syncCanvasSize]);

  useEffect(() => {
    if (gameState === "playing") return;
    const ctx = ctxRef.current;
    if (!ctx) return;

    syncCanvasSize();
    const { w, h } = viewportRef.current;
    const groundY = h * GROUND_Y_RATIO;
    const playerH = h * PLAYER_HEIGHT_RATIO;
    const runSprite = spriteBankRef.current.run;
    const ratio = runSprite ? runSprite.width / runSprite.height : 0.8;
    const playerW = playerH * ratio;
    const playerX = w * 0.18 - playerW * 0.1;
    const playerY = groundY - playerH;

    const distanceMeters = Math.floor(distanceRef.current);
    const bestMeters = Math.max(bestDistanceRef.current, distanceMeters);

    ctx.clearRect(0, 0, w, h);
    drawBackground(ctx, w, h, spriteBankRef.current.bg, bgScrollRef.current);

    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(
      playerX + playerW * 0.48,
      groundY + playerH * 0.02,
      playerW * 0.25,
      playerH * 0.07,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.restore();

    if (runSprite) {
      ctx.drawImage(runSprite, playerX, playerY, playerW, playerH);
    } else {
      drawFallbackPlayer(ctx, playerX, playerY, playerW, playerH);
    }

    drawTopHud(ctx, w, h, distanceMeters, bestMeters, collectedRef.current);
    drawBottomProgress(ctx, w, h, gameState === "complete" ? 1 : 0);
  }, [assetsReady, gameState, syncCanvasSize]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      if (completionTimeoutRef.current !== null) {
        window.clearTimeout(completionTimeoutRef.current);
      }
    };
  }, []);

  const buttonLabelStyle = {
    color: "#00ff88",
    fontFamily: '"Courier New", monospace',
    fontSize: "16px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textShadow: "0 0 8px rgba(0,255,136,0.45)",
  } as const;

  const controlButtonStyle = {
    width: "72px",
    height: "72px",
    borderRadius: "9999px",
    border: "2px solid #00ff88",
    background: "rgba(0,0,0,0.7)",
    color: "#ffffff",
    fontSize: "46px",
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 0 16px rgba(0,255,136,0.25)",
    userSelect: "none",
  } as const;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      <canvas ref={canvasRef} className="block w-full h-full" style={{ touchAction: "none" }} />

      {gameState === "idle" && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="rounded-xl bg-black/45 px-6 py-4 text-center">
            <p className="text-white text-2xl font-black tracking-wide">TAP TO START</p>
            <p className="mt-2 text-xs text-emerald-300 tracking-[0.18em]">
              {assetsReady ? "READY" : "LOADING ASSETS..."}
            </p>
          </div>
        </div>
      )}

      {gameState === "complete" && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/25">
          <div className="rounded-xl bg-black/55 px-8 py-6 text-center">
            <p className="text-white text-3xl font-black tracking-wide">{completionLabel}</p>
            <p className="mt-2 text-emerald-300 text-sm tracking-[0.2em] uppercase">
              Laundry Bags: {collectedRef.current}
            </p>
          </div>
        </div>
      )}

      {gameState === "playing" && (
        <>
          <div
            className="absolute z-30 flex flex-col items-center gap-2"
            style={{ left: "15%", bottom: "18%" }}
          >
            <span style={buttonLabelStyle}>JUMP</span>
            <button
              type="button"
              aria-label="Jump"
              style={controlButtonStyle}
              onMouseDown={(event) => {
                event.preventDefault();
                triggerJump();
              }}
              onTouchStart={(event) => {
                event.preventDefault();
                triggerJump();
              }}
            >
              ↑
            </button>
          </div>

          <div
            className="absolute z-30 flex flex-col items-center gap-2"
            style={{ right: "15%", bottom: "18%" }}
          >
            <span style={buttonLabelStyle}>SLIDE</span>
            <button
              type="button"
              aria-label="Slide"
              style={controlButtonStyle}
              onMouseDown={(event) => {
                event.preventDefault();
                triggerSlide();
              }}
              onTouchStart={(event) => {
                event.preventDefault();
                triggerSlide();
              }}
            >
              ↓
            </button>
          </div>
        </>
      )}
    </div>
  );
}
