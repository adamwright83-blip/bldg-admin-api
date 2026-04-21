/**
 * LAUNDRY RUN — Side-scrolling mini-game (Tactical Noir vector runner).
 * 30-second loop: tap to jump over obstacles, hold to vacuum laundry.
 * Reports the final score up via `onComplete(score)` so the reducer can
 * dispatch `COMPLETE_LAUNDRY_RUN` and advance to the mission briefing.
 */
import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { sounds } from "./driverSounds";
import { haptics } from "./driverHaptics";

interface Props {
  onComplete: (score: number) => void;
}

const GAME_DURATION = 30;
const GROUND_Y_RATIO = 0.78;
const PLAYER_SIZE = 0.06;
const GRAVITY = 0.0012;
const JUMP_FORCE = -0.018;
const SCROLL_SPEED = 0.004;
const OBSTACLE_INTERVAL = 90;
const LAUNDRY_INTERVAL = 40;
const VACUUM_RANGE = 0.15;

interface Entity {
  x: number;
  y: number;
  w: number;
  h: number;
  type: "obstacle" | "laundry";
  collected?: boolean;
  color?: string;
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

const LAUNDRY_COLORS = [
  "#00ff88",
  "#00ddff",
  "#ffaa00",
  "#ff6688",
  "#aa88ff",
];

export default function LaundryRun({ onComplete }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<
    "countdown" | "playing" | "done"
  >("countdown");
  const [countdown, setCountdown] = useState(3);
  const [score, setScore] = useState(0);
  const [, setTimeLeft] = useState(GAME_DURATION);

  const playerRef = useRef({ y: 0, vy: 0, grounded: true });
  const entitiesRef = useRef<Entity[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const frameRef = useRef(0);
  const scoreRef = useRef(0);
  const holdingRef = useRef(false);
  const scrollRef = useRef(0);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef(0);

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

  const handlePointerDown = useCallback(() => {
    if (gameState !== "playing") return;
    const p = playerRef.current;
    if (p.grounded) {
      p.vy = JUMP_FORCE;
      p.grounded = false;
      sounds.press();
      haptics.tap();
    }
    holdingRef.current = true;
  }, [gameState]);

  const handlePointerUp = useCallback(() => {
    holdingRef.current = false;
  }, []);

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
    const playerSize = W * PLAYER_SIZE;
    const playerX = W * 0.15;

    playerRef.current = { y: groundY - playerSize, vy: 0, grounded: true };
    entitiesRef.current = [];
    particlesRef.current = [];
    frameRef.current = 0;
    scoreRef.current = 0;
    scrollRef.current = 0;
    startTimeRef.current = Date.now();

    const buildings: { x: number; w: number; h: number; shade: number }[] = [];
    for (let i = 0; i < 25; i++) {
      buildings.push({
        x: i * (W / 8) - W * 0.1,
        w: W * (0.05 + Math.random() * 0.09),
        h: H * (0.12 + Math.random() * 0.4),
        shade: 0.06 + Math.random() * 0.05,
      });
    }

    const stars: { x: number; y: number; brightness: number }[] = [];
    for (let i = 0; i < 40; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * groundY * 0.6,
        brightness: 0.1 + Math.random() * 0.3,
      });
    }

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
          vx: (Math.random() - 0.5) * 3,
          vy: (Math.random() - 0.5) * 3,
          life: 1,
          maxLife: 0.5 + Math.random() * 0.5,
          color,
          size: 2 + Math.random() * 3,
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

      if (!p.grounded) {
        p.vy += GRAVITY * H;
        p.y += p.vy;
        if (p.y >= groundY - playerSize) {
          p.y = groundY - playerSize;
          p.vy = 0;
          p.grounded = true;
        }
      }

      if (frame % OBSTACLE_INTERVAL === 0 && frame > 30) {
        const h = H * (0.04 + Math.random() * 0.06);
        entitiesRef.current.push({
          x: W + 20,
          y: groundY - h,
          w: W * 0.04,
          h,
          type: "obstacle",
        });
      }
      if (frame % LAUNDRY_INTERVAL === 0) {
        entitiesRef.current.push({
          x: W + 20 + Math.random() * W * 0.3,
          y: groundY - H * (0.15 + Math.random() * 0.3),
          w: W * 0.03,
          h: W * 0.03,
          type: "laundry",
          collected: false,
          color:
            LAUNDRY_COLORS[Math.floor(Math.random() * LAUNDRY_COLORS.length)],
        });
      }

      entitiesRef.current = entitiesRef.current.filter((e) => {
        e.x -= speed;
        return e.x > -50;
      });

      const px = playerX;
      const py = p.y;
      const vacuumRange = W * VACUUM_RANGE;

      entitiesRef.current.forEach((e) => {
        if (e.type === "obstacle") {
          if (
            px + playerSize > e.x &&
            px < e.x + e.w &&
            py + playerSize > e.y
          ) {
            p.vy = JUMP_FORCE * 0.5;
            p.grounded = false;
            sounds.crash();
            haptics.error();
            spawnParticles(
              px + playerSize,
              py + playerSize / 2,
              "#ff2244",
              6
            );
          }
        }
        if (e.type === "laundry" && !e.collected) {
          const cx = e.x + e.w / 2;
          const cy = e.y + e.h / 2;
          const dist = Math.hypot(
            px + playerSize / 2 - cx,
            py + playerSize / 2 - cy
          );
          if (holdingRef.current && dist < vacuumRange) {
            e.x += (px - e.x) * 0.15;
            e.y += (py - e.y) * 0.15;
          }
          if (dist < playerSize) {
            e.collected = true;
            scoreRef.current++;
            setScore(scoreRef.current);
            sounds.collect();
            haptics.tap();
            spawnParticles(cx, cy, e.color || "#00ff88", 8);
          }
        }
      });

      particlesRef.current = particlesRef.current.filter((pt) => {
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.life -= 1 / 60 / pt.maxLife;
        return pt.life > 0;
      });

      const skyGrad = ctx.createLinearGradient(0, 0, 0, groundY);
      skyGrad.addColorStop(0, "#050508");
      skyGrad.addColorStop(0.6, "#080a10");
      skyGrad.addColorStop(1, "#0a0e12");
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H);

      stars.forEach((s) => {
        const flicker = s.brightness + Math.sin(frame * 0.03 + s.x) * 0.05;
        ctx.fillStyle = `rgba(0, 255, 136, ${flicker})`;
        ctx.fillRect(s.x, s.y, 1.5, 1.5);
      });

      const parallax = scrollRef.current * 0.3;
      buildings.forEach((b) => {
        const bx = ((b.x - parallax) % (W * 3)) + W * 0.3;
        const adjustedBx = bx < -b.w ? bx + W * 3 : bx;
        ctx.fillStyle = `rgba(12, 18, 14, ${b.shade * 12})`;
        ctx.fillRect(adjustedBx, groundY - b.h, b.w, b.h);
        ctx.strokeStyle = "rgba(0, 255, 136, 0.04)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(adjustedBx, groundY - b.h);
        ctx.lineTo(adjustedBx + b.w, groundY - b.h);
        ctx.stroke();
        for (let wy = groundY - b.h + 10; wy < groundY - 6; wy += 16) {
          for (let wx = adjustedBx + 4; wx < adjustedBx + b.w - 4; wx += 12) {
            if (Math.random() > 0.55) {
              ctx.fillStyle = `rgba(0, 255, 136, ${0.08 + Math.random() * 0.12})`;
              ctx.fillRect(wx, wy, 5, 7);
            }
          }
        }
      });

      const groundGrad = ctx.createLinearGradient(0, groundY, 0, H);
      groundGrad.addColorStop(0, "#0c120e");
      groundGrad.addColorStop(1, "#080a08");
      ctx.fillStyle = groundGrad;
      ctx.fillRect(0, groundY, W, H - groundY);

      ctx.strokeStyle = "rgba(0, 255, 136, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(W, groundY);
      ctx.stroke();

      ctx.strokeStyle = "rgba(0, 255, 136, 0.12)";
      ctx.lineWidth = 2;
      ctx.setLineDash([24, 36]);
      ctx.lineDashOffset = -scrollRef.current;
      ctx.beginPath();
      ctx.moveTo(0, groundY + (H - groundY) * 0.5);
      ctx.lineTo(W, groundY + (H - groundY) * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      if (holdingRef.current) {
        ctx.globalAlpha = 0.08;
        for (let i = 0; i < 5; i++) {
          const ly = groundY * (0.3 + Math.random() * 0.5);
          ctx.strokeStyle = "#00ff88";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, ly);
          ctx.lineTo(W * (0.1 + Math.random() * 0.3), ly);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      entitiesRef.current.forEach((e) => {
        if (e.type === "obstacle") {
          ctx.shadowColor = "#ff2244";
          ctx.shadowBlur = 6;
          ctx.fillStyle = "rgba(255, 34, 68, 0.5)";
          ctx.fillRect(e.x, e.y, e.w, e.h);
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "rgba(255, 34, 68, 0.7)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(e.x, e.y, e.w, e.h);
          ctx.fillStyle = "rgba(255, 34, 68, 0.3)";
          for (let sy = e.y + 3; sy < e.y + e.h - 3; sy += 6) {
            ctx.fillRect(e.x + 2, sy, e.w - 4, 2);
          }
        }
      });

      entitiesRef.current.forEach((e) => {
        if (e.type === "laundry" && !e.collected) {
          const cx = e.x + e.w / 2;
          const cy = e.y + e.h / 2;
          ctx.shadowColor = e.color || "#00ff88";
          ctx.shadowBlur = 10;
          ctx.fillStyle = e.color || "#00ff88";
          ctx.globalAlpha = 0.85;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(
            Math.PI / 4 + Math.sin(frame * 0.04 + e.x) * 0.25
          );
          ctx.fillRect(-e.w / 2, -e.h / 2, e.w, e.h);
          ctx.restore();
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;
        }
      });

      if (holdingRef.current) {
        const beamGrad = ctx.createRadialGradient(
          px + playerSize / 2,
          py + playerSize / 2,
          0,
          px + playerSize / 2,
          py + playerSize / 2,
          vacuumRange
        );
        beamGrad.addColorStop(0, "rgba(0, 255, 136, 0.12)");
        beamGrad.addColorStop(0.4, "rgba(0, 255, 136, 0.06)");
        beamGrad.addColorStop(1, "rgba(0, 255, 136, 0)");
        ctx.fillStyle = beamGrad;
        ctx.beginPath();
        ctx.arc(
          px + playerSize / 2,
          py + playerSize / 2,
          vacuumRange,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.strokeStyle = `rgba(0, 255, 136, ${
          0.15 + Math.sin(frame * 0.1) * 0.1
        })`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(
          px + playerSize / 2,
          py + playerSize / 2,
          vacuumRange * (0.5 + Math.sin(frame * 0.08) * 0.2),
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }

      particlesRef.current.forEach((pt) => {
        ctx.globalAlpha = pt.life;
        ctx.fillStyle = pt.color;
        ctx.fillRect(
          pt.x - pt.size / 2,
          pt.y - pt.size / 2,
          pt.size,
          pt.size
        );
      });
      ctx.globalAlpha = 1;

      ctx.fillStyle = "#00ff88";
      ctx.shadowColor = "#00ff88";
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(px, py + playerSize);
      ctx.lineTo(px, py + playerSize * 0.35);
      ctx.lineTo(px + playerSize * 0.35, py);
      ctx.lineTo(px + playerSize, py + playerSize * 0.25);
      ctx.lineTo(px + playerSize, py + playerSize);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.beginPath();
      ctx.moveTo(px + playerSize * 0.15, py + playerSize * 0.35);
      ctx.lineTo(px + playerSize * 0.35, py + playerSize * 0.1);
      ctx.lineTo(px + playerSize * 0.7, py + playerSize * 0.25);
      ctx.lineTo(px + playerSize * 0.55, py + playerSize * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      if (!p.grounded) {
        ctx.fillStyle = "rgba(0, 255, 136, 0.15)";
        for (let i = 1; i <= 3; i++) {
          const trailAlpha = 0.15 - i * 0.04;
          ctx.globalAlpha = trailAlpha;
          ctx.fillRect(
            px - i * 6,
            py + playerSize * 0.3,
            4,
            playerSize * 0.4
          );
        }
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = "#00ff88";
      ctx.font = `bold ${W * 0.055}px "Barlow Condensed", sans-serif`;
      ctx.textAlign = "right";
      ctx.fillText(`${scoreRef.current}`, W - 16, 38);
      ctx.font = `${W * 0.02}px "JetBrains Mono", monospace`;
      ctx.fillStyle = "rgba(0, 255, 136, 0.4)";
      ctx.fillText("COLLECTED", W - 16, 54);

      ctx.textAlign = "left";
      const timerColor =
        remaining < 10
          ? "#ff2244"
          : remaining < 20
            ? "#ffaa00"
            : "rgba(255,255,255,0.6)";
      ctx.fillStyle = timerColor;
      ctx.font = `bold ${W * 0.045}px "Barlow Condensed", sans-serif`;
      ctx.fillText(`${Math.ceil(remaining)}s`, 16, 38);

      if (holdingRef.current) {
        ctx.fillStyle = "rgba(0, 255, 136, 0.5)";
        ctx.font = `bold ${W * 0.018}px "JetBrains Mono", monospace`;
        ctx.textAlign = "center";
        ctx.fillText("◆ VACUUM ACTIVE ◆", W / 2, H - 16);
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
    <div
      className="min-h-screen bg-black relative overflow-hidden flex flex-col"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
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
