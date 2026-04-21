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
import hudBackgroundUrl from "@/assets/driver/signal-override/hud-background.png";
import timingMeterPanelUrl from "@/assets/driver/signal-override/timing-meter-panel.png";
import portraitCardUrl from "@/assets/driver/signal-override/portrait-card.png";
import grungeTextureUrl from "@/assets/driver/signal-override/grunge-texture.png";

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
  const lastTouchAtRef = useRef(0);

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

    // Evaluate against the rendered marker position users are reacting to.
    const inSweet = Math.abs(barPosition - sweetSpotCenter) <= SWEET_SPOT_WIDTH / 2;

    if (inSweet) {
      cancelAnimationFrame(animRef.current);
      setResult("success");
      setPhase("result");
      sounds.overrideSuccess();
      haptics.slam();
    } else {
      cancelAnimationFrame(animRef.current);
      setMisses((m) => m + 1);
      setResult("fail");
      setPhase("result");
      sounds.overrideFail();
      haptics.error();
    }
  }, [phase, barPosition, sweetSpotCenter]);

  const dangerZone = timeLeft < 3;
  const attemptsRemaining = Math.max(0, 3 - misses);
  const sweetSpotLeft = (sweetSpotCenter - SWEET_SPOT_WIDTH / 2) * 100;

  return (
    <div
      className="min-h-screen bg-black relative overflow-hidden flex items-stretch justify-center text-white"
      onTouchStart={(event) => {
        event.preventDefault();
        lastTouchAtRef.current = Date.now();
        handleTap();
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        if (Date.now() - lastTouchAtRef.current < 450) return;
        handleTap();
      }}
      style={{ touchAction: "none" }}
    >
      <div className="absolute inset-0 pointer-events-none">
        <img
          src={hudBackgroundUrl}
          alt=""
          className="h-full w-full object-cover opacity-[0.85]"
          draggable={false}
        />
        <div className="absolute inset-0 bg-black/35" />
        <div
          className="absolute inset-0 opacity-[0.16] mix-blend-screen"
          style={{
            backgroundImage: `url(${grungeTextureUrl})`,
            backgroundSize: "420px auto",
            backgroundRepeat: "repeat",
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.35) 2px, rgba(255,255,255,0.35) 3px)",
          }}
        />
      </div>

      {phase === "active" && dangerZone && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            boxShadow:
              "inset 0 0 90px rgba(255, 22, 22, 0.22), inset 0 0 180px rgba(255, 22, 22, 0.14)",
          }}
        />
      )}

      <div className="relative z-10 w-full max-w-[960px] min-h-screen px-4 py-5 sm:px-8 flex flex-col">
        <div className="flex items-start justify-between text-[11px] sm:text-[12px] tracking-[0.14em] uppercase">
          <div className="space-y-2">
            <p className="text-red-500">
              Target: <span className="text-zinc-300">10982 Roebling</span>
            </p>
            <p className="text-emerald-400">
              Payload: <span className="text-zinc-300">1 of 3</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-zinc-400">Attempts Remaining</p>
            <div className="mt-2 flex gap-2 justify-end">
              {[0, 1, 2].map((idx) => (
                <span
                  key={idx}
                  className="h-4 w-4 rounded-full"
                  style={{
                    backgroundColor: idx < attemptsRemaining ? "#ff1f1f" : "rgba(255,31,31,0.2)",
                    boxShadow:
                      idx < attemptsRemaining
                        ? "0 0 8px rgba(255,31,31,0.7)"
                        : "inset 0 0 0 1px rgba(255,31,31,0.35)",
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 sm:mt-6 text-center">
          <p className="text-[12px] sm:text-[14px] tracking-[0.28em] text-red-500 uppercase">
            Signal Intercept
          </p>
          <h1 className="mt-4 text-[54px] leading-none sm:text-[88px] font-black tracking-[0.1em] text-emerald-400 drop-shadow-[0_0_22px_rgba(16,255,159,0.55)]">
            SIGNAL OVERRIDE
          </h1>
          <p className="mt-3 text-zinc-300 text-[16px] sm:text-[22px] tracking-[0.2em] uppercase">
            Timing Is Everything
          </p>
        </div>

        <AnimatePresence>
          {phase === "intro" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mt-6 sm:mt-8 text-center"
            >
              <p className="text-red-500 text-[14px] sm:text-[18px] tracking-[0.14em] uppercase">
                Syncing Override Channel...
              </p>
              <p className="mt-3 text-zinc-300 text-[13px] sm:text-[16px] tracking-[0.16em] uppercase">
                Hold focus. One tap decides the payload.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {phase === "active" && (
          <>
            <div className="mt-5 sm:mt-7 text-center">
              <p className="text-zinc-200 text-[18px] sm:text-[26px] leading-tight tracking-[0.12em] uppercase">
                Tap when the bar enters the <span className="text-emerald-400">green zone</span>
              </p>
            </div>

            <div className="mt-4 sm:mt-6 text-center">
              <p className="text-red-500 text-[15px] sm:text-[22px] tracking-[0.16em] uppercase">
                Time Remaining
              </p>
              <p
                className={`mt-1 text-[88px] sm:text-[150px] leading-none font-black tabular-nums ${
                  dangerZone ? "text-red-500" : "text-red-500"
                } drop-shadow-[0_0_20px_rgba(255,20,20,0.5)]`}
              >
                {timeLeft.toFixed(1)}
              </p>
            </div>

            <div className="mt-2 sm:mt-4">
              <div className="relative mx-auto w-full max-w-[900px]">
                <img
                  src={timingMeterPanelUrl}
                  alt=""
                  className="w-full h-auto pointer-events-none select-none"
                  draggable={false}
                />

                <div className="absolute left-[4.4%] right-[4.4%] top-[23.5%] bottom-[18.5%]">
                  <div className="absolute -top-8 left-0 right-0 flex justify-between text-[10px] sm:text-[14px] tracking-[0.14em] uppercase">
                    <span className="text-red-500">Too Early</span>
                    <span className="text-emerald-400">Green Zone</span>
                    <span className="text-red-500">Too Late</span>
                  </div>

                  <div
                    className="absolute top-0 bottom-0 border-x-2 border-emerald-400/80"
                    style={{
                      left: `${sweetSpotLeft}%`,
                      width: `${SWEET_SPOT_WIDTH * 100}%`,
                      background:
                        "linear-gradient(90deg, rgba(0,255,145,0.22), rgba(0,255,145,0.14))",
                      boxShadow: "0 0 20px rgba(0,255,145,0.2)",
                    }}
                  />

                  <motion.div
                    className="absolute top-[-8%] bottom-[-8%] w-[3px] bg-white"
                    style={{
                      left: `calc(${barPosition * 100}% - 1px)`,
                      boxShadow: "0 0 12px #fff, 0 0 24px rgba(255,255,255,0.75)",
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 sm:mt-6 text-center">
              <p className="text-[52px] sm:text-[74px] leading-none font-black tracking-[0.2em] text-emerald-400 drop-shadow-[0_0_18px_rgba(16,255,159,0.4)]">
                TAP NOW
              </p>
              <p className="mt-2 text-zinc-300 text-[16px] sm:text-[26px] tracking-[0.16em] uppercase">
                Commit The Override
              </p>
            </div>
          </>
        )}

        <div className="mt-auto mb-4 border border-red-500/40 bg-black/70 grid grid-cols-12 overflow-hidden">
          <div className="col-span-4 border-r border-red-500/35 min-h-[110px]">
            <img
              src={portraitCardUrl}
              alt=""
              className="h-full w-full object-cover opacity-[0.85]"
              draggable={false}
            />
          </div>
          <div className="col-span-5 p-3 sm:p-4">
            <p className="text-red-500 text-[18px] sm:text-[34px] tracking-[0.12em] uppercase font-bold">
              Warning
            </p>
            <p className="mt-1 text-zinc-300 text-[11px] sm:text-[16px] tracking-[0.11em] uppercase">
              Failure will reset payload loop
            </p>
            <p className="mt-1 text-red-500 text-[11px] sm:text-[16px] tracking-[0.12em] uppercase">
              You will lose this opportunity
            </p>
          </div>
          <div className="col-span-3 border-l border-red-500/35 p-3 sm:p-4 text-right">
            <p className="text-emerald-400 text-[10px] sm:text-[14px] tracking-[0.12em] uppercase">
              Success Window
            </p>
            <p className="text-emerald-400 text-[34px] sm:text-[54px] leading-none font-black">0.8s</p>
            <p className="mt-2 text-zinc-300 text-[10px] sm:text-[12px] tracking-[0.08em] uppercase">
              Connection Stability
            </p>
            <p className="text-amber-400 text-[30px] sm:text-[46px] leading-none font-black">62%</p>
          </div>
        </div>
      </div>

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
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", damping: 12, delay: 0.2 }}
              className="absolute inset-0 z-40 flex flex-col items-center justify-center text-center px-6"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: 0.5, scale: 1.1 }}
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
              <p className="relative z-10 text-emerald-400 text-[26px] sm:text-[40px] tracking-[0.15em] uppercase font-bold">
                Override Successful
              </p>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {result === "fail" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-40 flex flex-col items-center justify-center text-center px-6"
          >
            <motion.div
              animate={{ x: [0, -6, 6, -4, 4, 0] }}
              transition={{ duration: 0.4 }}
              className="rounded-lg border border-red-500/40 bg-black/75 px-6 py-6"
            >
              <p className="text-red-500 text-[28px] sm:text-[42px] font-black tracking-[0.12em] uppercase">
                Signal Lost
              </p>
              <p className="mt-3 text-zinc-300 text-[12px] sm:text-[16px] tracking-[0.11em] uppercase">
                Payload loop reset. Restart from payload 1.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
