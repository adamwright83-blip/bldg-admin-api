/**
 * SIGNAL OVERRIDE — 8-second bar-timing climax.
 *
 * Failure is DELIBERATELY sharp: the switchboard wires `onComplete(false)` to
 * the reducer's `RESOLVE_VERIFY_FAILURE`, which hard-resets the payload loop
 * to 1 (Decision A). This screen must not soften that consequence in any way.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { sounds } from "./driverSounds";
import { haptics } from "./driverHaptics";

const REWARD_BURST =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663281332025/bVTWnxw2cr9EUVzVBCF5PW/reward-burst-e4UbdjcEQqGPVjeTGQDyXs.webp";

interface Props {
  onComplete: (success: boolean) => void;
}

const GAME_DURATION = 8;
const SWEET_SPOT_WIDTH = 0.14;
const BASE_SPEED = 0.016;

export default function SignalOverride({ onComplete }: Props) {
  const [phase, setPhase] = useState<"intro" | "active" | "result">("intro");
  const [barPosition, setBarPosition] = useState(0);
  const [sweetSpotCenter] = useState(() => 0.25 + Math.random() * 0.5);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const [result, setResult] = useState<"success" | "fail" | null>(null);
  const [misses, setMisses] = useState(0);
  const animRef = useRef<number>(0);
  const startRef = useRef(0);
  const dirRef = useRef(1);
  const posRef = useRef(0);

  useEffect(() => {
    sounds.missionAssign();
    haptics.countdown();
    const t = setTimeout(() => {
      setPhase("active");
      startRef.current = Date.now();
    }, 1800);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (phase !== "active") return;

    function tick() {
      const elapsed = (Date.now() - startRef.current) / 1000;
      const remaining = Math.max(0, GAME_DURATION - elapsed);
      setTimeLeft(remaining);

      if (remaining <= 0) {
        setResult("fail");
        setPhase("result");
        sounds.overrideFail();
        haptics.error();
        return;
      }

      const urgency = 1 + (elapsed / GAME_DURATION) * 0.8;
      const speed = BASE_SPEED * urgency;

      posRef.current += speed * dirRef.current;
      if (posRef.current >= 1) {
        posRef.current = 1;
        dirRef.current = -1;
      }
      if (posRef.current <= 0) {
        posRef.current = 0;
        dirRef.current = 1;
      }
      setBarPosition(posRef.current);

      animRef.current = requestAnimationFrame(tick);
    }

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase]);

  useEffect(() => {
    if (phase !== "result" || result === null) return;
    const t = setTimeout(() => onComplete(result === "success"), 2200);
    return () => clearTimeout(t);
  }, [phase, result, onComplete]);

  const handleTap = useCallback(() => {
    if (phase !== "active") return;

    const pos = posRef.current;
    const inSweet = Math.abs(pos - sweetSpotCenter) < SWEET_SPOT_WIDTH / 2;

    if (inSweet) {
      cancelAnimationFrame(animRef.current);
      setResult("success");
      setPhase("result");
      sounds.overrideSuccess();
      haptics.slam();
    } else {
      setMisses((m) => m + 1);
      haptics.error();
      sounds.crash();
    }
  }, [phase, sweetSpotCenter]);

  const dangerZone = timeLeft < 3;

  return (
    <div
      className="min-h-screen bg-black relative overflow-hidden flex flex-col items-center justify-center"
      onClick={handleTap}
      style={{ touchAction: "none" }}
    >
      {phase === "active" && dangerZone && (
        <div
          className="absolute inset-0 pointer-events-none animate-pulse-neon"
          style={{
            boxShadow:
              "inset 0 0 60px oklch(0.65 0.28 25 / 0.3), inset 0 0 120px oklch(0.65 0.28 25 / 0.1)",
          }}
        />
      )}

      <AnimatePresence>
        {phase === "intro" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex flex-col items-center justify-center"
          >
            <div
              className="absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,0.15) 2px, rgba(0,255,136,0.15) 4px)",
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="text-center relative z-10"
            >
              <p className="text-[9px] tracking-[0.5em] text-danger/60 uppercase mb-4 font-semibold">
                Override Required
              </p>
              <p className="font-display font-extrabold text-4xl uppercase tracking-wider text-neon glow-neon">
                Signal Override
              </p>
              <p className="text-[10px] text-muted-foreground mt-4 max-w-[220px] mx-auto">
                Tap when the bar enters the green zone
              </p>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: "100%" }}
                transition={{ delay: 0.8, duration: 0.8 }}
                className="h-px bg-neon/30 mt-6 mx-auto max-w-[200px]"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {result === "success" && (
          <>
            <motion.div
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 z-40 bg-white"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", damping: 10, delay: 0.2 }}
              className="absolute inset-0 z-30 flex flex-col items-center justify-center"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: 0.45, scale: 1.1 }}
                transition={{ duration: 1.2, ease: "easeOut", delay: 0.1 }}
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage: `url(${REWARD_BURST})`,
                  backgroundSize: "120% auto",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                  maskImage:
                    "radial-gradient(ellipse at center, black 0%, black 35%, transparent 70%)",
                  WebkitMaskImage:
                    "radial-gradient(ellipse at center, black 0%, black 35%, transparent 70%)",
                }}
              />
              <div className="relative z-10 text-center">
                <motion.p
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="font-display font-extrabold text-3xl uppercase tracking-wider text-neon glow-neon mb-2"
                >
                  Override
                </motion.p>
                <motion.p
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="font-display font-extrabold text-5xl uppercase tracking-wider text-foreground"
                >
                  Successful
                </motion.p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {result === "fail" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-30 flex flex-col items-center justify-center"
          >
            <motion.div
              animate={{ x: [0, -6, 6, -4, 4, 0] }}
              transition={{ duration: 0.4 }}
              className="text-center"
            >
              <p className="font-display font-extrabold text-4xl uppercase tracking-wider text-danger">
                Signal Lost
              </p>
              <p className="text-[11px] text-muted-foreground mt-3">
                Payload loop reset — restart from payload 1
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {phase === "active" && (
        <div className="w-full px-6 relative z-10">
          <div className="text-center mb-10">
            <p className="text-[8px] tracking-[0.4em] text-muted-foreground uppercase mb-2">
              Time Remaining
            </p>
            <p
              className={`font-display font-extrabold text-6xl tabular-nums ${
                dangerZone ? "text-danger animate-pulse-neon" : "text-amber"
              }`}
            >
              {timeLeft.toFixed(1)}
            </p>
          </div>

          <div className="relative">
            <div className="relative h-20 bg-void-light border border-border/20 overflow-hidden">
              <div
                className="absolute top-0 bottom-0 border-x-2 border-neon/60"
                style={{
                  left: `${(sweetSpotCenter - SWEET_SPOT_WIDTH / 2) * 100}%`,
                  width: `${SWEET_SPOT_WIDTH * 100}%`,
                  background:
                    "linear-gradient(180deg, oklch(0.85 0.25 155 / 0.15), oklch(0.85 0.25 155 / 0.08))",
                }}
              >
                <div className="absolute -top-5 left-1/2 -translate-x-1/2">
                  <span className="text-[7px] text-neon/60 tracking-wider uppercase">
                    Target
                  </span>
                </div>
              </div>

              <motion.div
                className="absolute top-0 bottom-0 w-[3px]"
                style={{
                  left: `${barPosition * 100}%`,
                  background: "white",
                  boxShadow:
                    "0 0 12px white, 0 0 24px oklch(0.85 0.25 155 / 0.5)",
                }}
              />

              {[0.25, 0.5, 0.75].map((pos) => (
                <div
                  key={pos}
                  className="absolute top-0 bottom-0 w-px bg-border/10"
                  style={{ left: `${pos * 100}%` }}
                />
              ))}
            </div>

            {misses > 0 && (
              <p className="text-center text-[9px] text-danger/60 mt-2 tracking-wider">
                {misses} miss{misses > 1 ? "es" : ""}
              </p>
            )}
          </div>

          <p className="text-center text-[11px] text-muted-foreground mt-8 tracking-wider animate-pulse-neon">
            TAP NOW
          </p>
        </div>
      )}
    </div>
  );
}
