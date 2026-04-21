/**
 * LAUNDRY RUN — Side-scrolling mini-game (Tactical Noir vector runner).
 * 30-second loop: tap to jump over obstacles, hold to vacuum laundry.
 * Reports the final score up via `onComplete(score)` so the reducer can
 * dispatch `COMPLETE_LAUNDRY_RUN` and advance to the mission briefing.
 *
 * VISUAL DESIGN: Neon-outlined delivery van on a dark cyberpunk cityscape.
 * Collectibles are glowing laundry bag shapes. Obstacles are red barrier blocks.
 * Background uses a generated cityscape image with parallax scrolling.
 */
import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { sounds } from "./driverSounds";
import { haptics } from "./driverHaptics";

interface Props {
  onComplete: (score: number) => void;
}

const GAME_DURATION = 30;
const GROUND_Y_RATIO = 0.82;
const GRAVITY = 0.0012;
const JUMP_FORCE = -0.018;
const SCROLL_SPEED = 0.003;
const OBSTACLE_INTERVAL = 100;
const LAUNDRY_INTERVAL = 45;
const VACUUM_RANGE = 0.15;

interface Entity {
  x: number;
  y: number;
  w: number;
  h: number;
  type: "obstacle" | "laundry";
  collected?: boolean;
  color?: string;
  bobPhase?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface TrailDot {
  x: number;
  y: number;
  alpha: number;
}

const LAUNDRY_COLORS = [
  "#00ff88",
  "#00ddff",
  "#ffaa00",
  "#ff6688",
  "#aa88ff",
];

const BG_IMAGE_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663281332025/bVTWnxw2cr9EUVzVBCF5PW/laundry-run-bg-layers-3rV9FKhr2n9GB6EBh8u7Ux.webp";

/** Draw a delivery van shape (neon outlined) */
function drawVan(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  glowIntensity: number
) {
  const cabW = w * 0.35;
  const bodyH = h * 0.65;
  const cabH = h * 0.45;
  const wheelR = h * 0.12;

  // Glow
  ctx.shadowColor = "#00ff88";
  ctx.shadowBlur = 8 + glowIntensity * 6;

  // Van body (rear cargo)
  ctx.fillStyle = "rgba(0, 20, 10, 0.7)";
  ctx.strokeStyle = "#00ff88";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(x, y + h - bodyH - wheelR * 2, w - cabW, bodyH);
  ctx.fill();
  ctx.stroke();

  // Cab (front, shorter)
  ctx.beginPath();
  ctx.rect(x + w - cabW, y + h - cabH - wheelR * 2, cabW, cabH);
  ctx.fill();
  ctx.stroke();

  // Windshield
  ctx.fillStyle = "rgba(0, 255, 136, 0.15)";
  ctx.strokeStyle = "rgba(0, 255, 136, 0.6)";
  ctx.lineWidth = 1;
  const wsX = x + w - cabW + 3;
  const wsY = y + h - cabH - wheelR * 2 + 3;
  const wsW = cabW - 6;
  const wsH = cabH * 0.45;
  ctx.beginPath();
  ctx.moveTo(wsX, wsY + wsH);
  ctx.lineTo(wsX + 2, wsY);
  ctx.lineTo(wsX + wsW, wsY);
  ctx.lineTo(wsX + wsW, wsY + wsH);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Cargo lines (horizontal stripes on body)
  ctx.strokeStyle = "rgba(0, 255, 136, 0.15)";
  ctx.lineWidth = 0.5;
  const cargoTop = y + h - bodyH - wheelR * 2;
  for (let ly = cargoTop + 6; ly < cargoTop + bodyH - 4; ly += 7) {
    ctx.beginPath();
    ctx.moveTo(x + 3, ly);
    ctx.lineTo(x + w - cabW - 3, ly);
    ctx.stroke();
  }

  // Wheels
  ctx.shadowBlur = 4;
  ctx.fillStyle = "#0a0a0a";
  ctx.strokeStyle = "#00ff88";
  ctx.lineWidth = 1.5;
  const wheelY = y + h - wheelR;
  // Rear wheel
  ctx.beginPath();
  ctx.arc(x + w * 0.2, wheelY, wheelR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Front wheel
  ctx.beginPath();
  ctx.arc(x + w * 0.75, wheelY, wheelR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Headlight
  ctx.fillStyle = "#00ff88";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(x + w - 1, y + h - wheelR * 2 - cabH * 0.3, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
}

/** Draw a laundry bag shape */
function drawLaundryBag(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
  bobOffset: number
) {
  const s = size;
  const by = cy + bobOffset;

  ctx.shadowColor = color;
  ctx.shadowBlur = 10;

  // Bag body (rounded bottom)
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.35, by - s * 0.15);
  ctx.quadraticCurveTo(cx - s * 0.4, by + s * 0.45, cx, by + s * 0.5);
  ctx.quadraticCurveTo(cx + s * 0.4, by + s * 0.45, cx + s * 0.35, by - s * 0.15);
  ctx.closePath();
  ctx.fill();

  // Bag top (cinched)
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.35, by - s * 0.15);
  ctx.quadraticCurveTo(cx - s * 0.15, by - s * 0.35, cx, by - s * 0.25);
  ctx.quadraticCurveTo(cx + s * 0.15, by - s * 0.35, cx + s * 0.35, by - s * 0.15);
  ctx.fill();

  // Tie knot
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, by - s * 0.3, s * 0.08, 0, Math.PI * 2);
  ctx.fill();

  // Inner shine
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.1, by + s * 0.05, s * 0.08, s * 0.15, -0.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

/** Draw a red barrier obstacle */
function drawBarrier(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frame: number
) {
  ctx.shadowColor = "#ff2244";
  ctx.shadowBlur = 8;

  // Main barrier body
  ctx.fillStyle = "rgba(255, 34, 68, 0.15)";
  ctx.strokeStyle = "rgba(255, 34, 68, 0.7)";
  ctx.lineWidth = 1.5;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);

  // Hazard stripes
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = "rgba(255, 34, 68, 0.35)";
  ctx.lineWidth = 2;
  const stripeSpacing = 8;
  for (let i = -h; i < w + h; i += stripeSpacing) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  ctx.restore();

  // Pulsing top warning light
  const pulse = 0.4 + Math.sin(frame * 0.12) * 0.4;
  ctx.fillStyle = `rgba(255, 34, 68, ${pulse})`;
  ctx.beginPath();
  ctx.arc(x + w / 2, y - 2, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
}

export default function LaundryRun({ onComplete }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<
    "countdown" | "playing" | "done"
  >("countdown");
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);

  const playerRef = useRef({ y: 0, vy: 0, grounded: true });
  const entitiesRef = useRef<Entity[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const trailRef = useRef<TrailDot[]>([]);
  const frameRef = useRef(0);
  const scoreRef = useRef(0);
  const holdingRef = useRef(false);
  const scrollRef = useRef(0);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef(0);
  const bgImageRef = useRef<HTMLImageElement | null>(null);

  // Preload background image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = BG_IMAGE_URL;
    img.onload = () => {
      bgImageRef.current = img;
    };
  }, []);

  useEffect(() => {
    if (gameState !== "countdown") return;
    if (countdown <= 0) {
      setGameState("playing");
      return;
    }
    sounds.tick();
    haptics.tap();
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, gameState]);

  // Ref so the native touch listeners can always read the latest gameState
  // without being re-registered on every state change.
  const gameStateRef = useRef(gameState);
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  const handlePointerDown = useCallback(() => {
    if (gameStateRef.current !== "playing") return;
    const p = playerRef.current;
    if (p.grounded) {
      p.vy = JUMP_FORCE;
      p.grounded = false;
      sounds.press();
      haptics.tap();
    }
    holdingRef.current = true;
  }, []);

  const handlePointerUp = useCallback(() => {
    holdingRef.current = false;
  }, []);

  // Native touch listeners on the canvas element — registered once on mount.
  // This is the fix for iOS/Android where pointer events on a canvas with
  // touchAction:none don't reliably bubble up to the parent div.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault(); // prevent scroll and double-tap zoom
      handlePointerDown();
    };
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      handlePointerUp();
    };
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", onTouchEnd, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [handlePointerDown, handlePointerUp]);

  useEffect(() => {
    if (gameState !== "playing") return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;
    const groundY = H * GROUND_Y_RATIO;
    const vanW = W * 0.16;
    const vanH = W * 0.1;
    const playerX = W * 0.12;

    playerRef.current = { y: groundY - vanH, vy: 0, grounded: true };
    entitiesRef.current = [];
    particlesRef.current = [];
    trailRef.current = [];
    frameRef.current = 0;
    scoreRef.current = 0;
    scrollRef.current = 0;
    startTimeRef.current = Date.now();

    function spawnParticles(
      x: number,
      y: number,
      color: string,
      count: number
    ) {
      for (let i = 0; i < count; i++) {
        particlesRef.current.push({
          x,
          y,
          vx: (Math.random() - 0.5) * 4,
          vy: (Math.random() - 1) * 3,
          life: 1,
          maxLife: 0.4 + Math.random() * 0.6,
          color,
          size: 2 + Math.random() * 4,
        });
      }
    }

    function drawFrame() {
      if (!ctx) return;
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const remaining = Math.max(0, GAME_DURATION - elapsed);
      setTimeLeft(Math.ceil(remaining));

      if (remaining <= 0) {
        setScore(scoreRef.current);
        setGameState("done");
        return;
      }

      const p = playerRef.current;
      const frame = frameRef.current++;
      const speed = SCROLL_SPEED * W;
      scrollRef.current += speed;

      // Physics
      if (!p.grounded) {
        p.vy += GRAVITY * H;
        p.y += p.vy;
        if (p.y >= groundY - vanH) {
          p.y = groundY - vanH;
          p.vy = 0;
          p.grounded = true;
        }
      }

      // Spawn entities
      if (frame % OBSTACLE_INTERVAL === 0 && frame > 40) {
        const h = H * (0.05 + Math.random() * 0.06);
        entitiesRef.current.push({
          x: W + 20,
          y: groundY - h,
          w: W * 0.05,
          h,
          type: "obstacle",
        });
      }
      if (frame % LAUNDRY_INTERVAL === 0) {
        entitiesRef.current.push({
          x: W + 20 + Math.random() * W * 0.3,
          y: groundY - H * (0.12 + Math.random() * 0.25),
          w: W * 0.06,
          h: W * 0.06,
          type: "laundry",
          collected: false,
          color:
            LAUNDRY_COLORS[Math.floor(Math.random() * LAUNDRY_COLORS.length)],
          bobPhase: Math.random() * Math.PI * 2,
        });
      }

      // Move entities
      entitiesRef.current = entitiesRef.current.filter((e) => {
        e.x -= speed;
        return e.x > -80;
      });

      // Collision detection
      const px = playerX;
      const py = p.y;
      const vacuumRange = W * VACUUM_RANGE;

      entitiesRef.current.forEach((e) => {
        if (e.type === "obstacle") {
          if (
            px + vanW > e.x + 4 &&
            px < e.x + e.w - 4 &&
            py + vanH > e.y + 4
          ) {
            p.vy = JUMP_FORCE * 0.5;
            p.grounded = false;
            sounds.crash();
            haptics.error();
            spawnParticles(px + vanW, py + vanH / 2, "#ff2244", 8);
          }
        }
        if (e.type === "laundry" && !e.collected) {
          const cx = e.x + e.w / 2;
          const cy = e.y + e.h / 2;
          const dist = Math.hypot(
            px + vanW / 2 - cx,
            py + vanH / 2 - cy
          );
          if (holdingRef.current && dist < vacuumRange) {
            e.x += (px + vanW / 2 - e.x) * 0.12;
            e.y += (py + vanH / 2 - e.y) * 0.12;
          }
          if (dist < vanW * 0.6) {
            e.collected = true;
            scoreRef.current++;
            setScore(scoreRef.current);
            sounds.collect();
            haptics.tap();
            spawnParticles(cx, cy, e.color || "#00ff88", 10);
          }
        }
      });

      // Update particles
      particlesRef.current = particlesRef.current.filter((pt) => {
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.vy += 0.1; // gravity on particles
        pt.life -= 1 / 60 / pt.maxLife;
        return pt.life > 0;
      });

      // Trail dots behind van
      if (frame % 2 === 0) {
        trailRef.current.push({
          x: px - 2,
          y: py + vanH * 0.7 + (Math.random() - 0.5) * 4,
          alpha: 0.6,
        });
      }
      trailRef.current = trailRef.current.filter((t) => {
        t.x -= speed * 0.5;
        t.alpha -= 0.015;
        return t.alpha > 0 && t.x > -20;
      });

      // === RENDER ===

      // Background image or fallback gradient
      if (bgImageRef.current) {
        const img = bgImageRef.current;
        const imgW = img.width;
        const imgH = img.height;
        // Parallax scroll the background
        const bgScale = H / imgH;
        const scaledW = imgW * bgScale;
        const offset = -(scrollRef.current * 0.15) % scaledW;
        ctx.drawImage(img, offset, 0, scaledW, H);
        ctx.drawImage(img, offset + scaledW, 0, scaledW, H);
        if (offset + scaledW * 2 < W) {
          ctx.drawImage(img, offset + scaledW * 2, 0, scaledW, H);
        }
      } else {
        // Fallback gradient
        const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
        skyGrad.addColorStop(0, "#050508");
        skyGrad.addColorStop(0.6, "#080a10");
        skyGrad.addColorStop(1, "#0a0e12");
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, W, H);
      }

      // Ground overlay (darken below ground line for road)
      const groundGrad = ctx.createLinearGradient(0, groundY - 4, 0, H);
      groundGrad.addColorStop(0, "rgba(8, 12, 8, 0.9)");
      groundGrad.addColorStop(0.3, "rgba(6, 10, 6, 0.95)");
      groundGrad.addColorStop(1, "#050805");
      ctx.fillStyle = groundGrad;
      ctx.fillRect(0, groundY - 4, W, H - groundY + 4);

      // Road surface line
      ctx.strokeStyle = "rgba(0, 255, 136, 0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(W, groundY);
      ctx.stroke();

      // Road dashes (scrolling)
      ctx.strokeStyle = "rgba(0, 255, 136, 0.15)";
      ctx.lineWidth = 2;
      ctx.setLineDash([20, 30]);
      ctx.lineDashOffset = -scrollRef.current;
      ctx.beginPath();
      ctx.moveTo(0, groundY + (H - groundY) * 0.45);
      ctx.lineTo(W, groundY + (H - groundY) * 0.45);
      ctx.stroke();
      ctx.setLineDash([]);

      // Bottom road edge
      ctx.strokeStyle = "rgba(0, 255, 136, 0.2)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, H - 2);
      ctx.lineTo(W, H - 2);
      ctx.stroke();

      // Vacuum beam (when holding)
      if (holdingRef.current) {
        const beamGrad = ctx.createRadialGradient(
          px + vanW / 2,
          py + vanH / 2,
          0,
          px + vanW / 2,
          py + vanH / 2,
          vacuumRange
        );
        beamGrad.addColorStop(0, "rgba(0, 255, 136, 0.1)");
        beamGrad.addColorStop(0.5, "rgba(0, 255, 136, 0.04)");
        beamGrad.addColorStop(1, "rgba(0, 255, 136, 0)");
        ctx.fillStyle = beamGrad;
        ctx.beginPath();
        ctx.arc(px + vanW / 2, py + vanH / 2, vacuumRange, 0, Math.PI * 2);
        ctx.fill();

        // Pulsing vacuum ring
        const ringRadius = vacuumRange * (0.5 + Math.sin(frame * 0.08) * 0.2);
        ctx.strokeStyle = `rgba(0, 255, 136, ${0.12 + Math.sin(frame * 0.1) * 0.08})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px + vanW / 2, py + vanH / 2, ringRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Scan lines when vacuuming
        ctx.globalAlpha = 0.04;
        for (let i = 0; i < 3; i++) {
          const ly = groundY * (0.3 + Math.random() * 0.5);
          ctx.strokeStyle = "#00ff88";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, ly);
          ctx.lineTo(W * (0.15 + Math.random() * 0.25), ly);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Trail dots
      trailRef.current.forEach((t) => {
        ctx.globalAlpha = t.alpha * 0.6;
        ctx.fillStyle = "#00ff88";
        ctx.beginPath();
        ctx.arc(t.x, t.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      // Draw obstacles
      entitiesRef.current.forEach((e) => {
        if (e.type === "obstacle") {
          drawBarrier(ctx, e.x, e.y, e.w, e.h, frame);
        }
      });

      // Draw laundry bags
      entitiesRef.current.forEach((e) => {
        if (e.type === "laundry" && !e.collected) {
          const bob = Math.sin(frame * 0.04 + (e.bobPhase || 0)) * 4;
          drawLaundryBag(
            ctx,
            e.x + e.w / 2,
            e.y + e.h / 2,
            e.w,
            e.color || "#00ff88",
            bob
          );
        }
      });

      // Draw particles
      particlesRef.current.forEach((pt) => {
        ctx.globalAlpha = pt.life;
        ctx.shadowColor = pt.color;
        ctx.shadowBlur = 4;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size / 2, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // Draw the van
      const glowPulse = holdingRef.current ? 0.5 + Math.sin(frame * 0.1) * 0.5 : 0;
      drawVan(ctx, px, py, vanW, vanH, glowPulse);

      // Jump trail
      if (!p.grounded) {
        for (let i = 1; i <= 4; i++) {
          ctx.globalAlpha = 0.12 - i * 0.025;
          ctx.fillStyle = "#00ff88";
          ctx.beginPath();
          ctx.arc(px + vanW * 0.2 - i * 5, py + vanH * 0.8, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // HUD: Timer
      ctx.textAlign = "left";
      const timerColor =
        remaining < 10
          ? "#ff2244"
          : remaining < 20
            ? "#ffaa00"
            : "rgba(255,255,255,0.7)";
      ctx.fillStyle = timerColor;
      ctx.font = `bold ${W * 0.055}px "Barlow Condensed", sans-serif`;
      ctx.fillText(`${Math.ceil(remaining)}s`, 16, 40);

      // HUD: Score
      ctx.textAlign = "right";
      ctx.fillStyle = "#00ff88";
      ctx.font = `bold ${W * 0.06}px "Barlow Condensed", sans-serif`;
      ctx.fillText(`${scoreRef.current}`, W - 16, 40);
      ctx.font = `${W * 0.022}px "JetBrains Mono", monospace`;
      ctx.fillStyle = "rgba(0, 255, 136, 0.45)";
      ctx.fillText("COLLECTED", W - 16, 56);

      // HUD: Vacuum status
      if (holdingRef.current) {
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0, 255, 136, 0.6)";
        ctx.font = `bold ${W * 0.02}px "JetBrains Mono", monospace`;
        ctx.fillText("◆ VACUUM ACTIVE ◆", W / 2, H - 12);
      }

      animRef.current = requestAnimationFrame(drawFrame);
    }

    animRef.current = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(animRef.current);
  }, [gameState]);

  useEffect(() => {
    if (gameState !== "done") return;
    sounds.scanConfirm();
    haptics.slam();
    const finalScore = scoreRef.current;
    const t = setTimeout(() => onComplete(finalScore), 2800);
    return () => clearTimeout(t);
  }, [gameState, onComplete]);

  return (
    <div className="min-h-screen bg-black relative overflow-hidden flex flex-col">
      <div className="heartbeat-bar w-full" />

      <AnimatePresence>
        {gameState === "countdown" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/90"
          >
            <div
              className="absolute inset-0 opacity-[0.03]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,0.1) 2px, rgba(0,255,136,0.1) 4px)",
              }}
            />
            <p className="text-[9px] tracking-[0.4em] text-neon/50 uppercase mb-4 font-semibold">
              Laundry Run
            </p>
            <motion.span
              key={countdown}
              initial={{ scale: 2.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.3, opacity: 0 }}
              transition={{ type: "spring", damping: 10 }}
              className="font-display font-extrabold text-9xl text-neon glow-neon"
            >
              {countdown || "GO"}
            </motion.span>
            <p className="text-[10px] text-muted-foreground mt-8 max-w-[220px] text-center leading-relaxed">
              Tap to jump over obstacles. Hold to vacuum laundry.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {gameState === "done" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/85"
          >
            <motion.div
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", damping: 10 }}
              className="text-center"
            >
              <p className="text-[9px] tracking-[0.4em] text-neon/50 uppercase mb-3 font-semibold">
                Run Complete
              </p>
              <p className="font-display font-extrabold text-7xl text-neon glow-neon mb-2">
                {score}
              </p>
              <p className="text-[10px] text-muted-foreground tracking-wider">
                Laundry Collected
              </p>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: "100%" }}
                transition={{ delay: 0.5, duration: 0.8 }}
                className="h-px bg-neon/30 mt-6 mx-auto max-w-[120px]"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <canvas
        ref={canvasRef}
        className="flex-1 w-full"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{ touchAction: "none" }}
      />

      {gameState === "playing" && (
        <div className="bg-void px-4 py-2.5 flex items-center justify-between border-t border-border/10">
          <span className="text-[9px] text-muted-foreground tracking-[0.15em] uppercase">
            Tap: Jump
          </span>
          <span className="text-[9px] text-neon/70 tracking-[0.15em] uppercase font-semibold">
            Hold: Vacuum
          </span>
        </div>
      )}
    </div>
  );
}
