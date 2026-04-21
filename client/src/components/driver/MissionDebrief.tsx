/**
 * MISSION DEBRIEF — payoff screen after a successful Signal Override.
 *
 * Renders on `verify_success` and on the terminal `mission_complete` phase.
 * `onReturn` fires ADVANCE_AFTER_VERIFY_SUCCESS (next payload) or
 * BACK_TO_COMMAND_CENTER (if the whole mission / day is done).
 */
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Trophy,
  Flame,
  ArrowRight,
  Zap,
  Shield,
  Target,
} from "lucide-react";
import type {
  GameMissionTarget,
  GameStateSnapshot,
} from "./driverGameTypes";
import { sounds } from "./driverSounds";
import { haptics } from "./driverHaptics";

interface Props {
  state: GameStateSnapshot;
  mission: GameMissionTarget;
  onReturn: () => void;
  ctaLabel?: string;
}

function getRank(missions: number): {
  name: string;
  next: number;
  prev: number;
} {
  if (missions >= 20) return { name: "COMMANDER", next: 999, prev: 20 };
  if (missions >= 12) return { name: "FIELD CAPTAIN", next: 20, prev: 12 };
  if (missions >= 6) return { name: "AGENT II", next: 12, prev: 6 };
  if (missions >= 2) return { name: "AGENT I", next: 6, prev: 2 };
  return { name: "RECRUIT", next: 2, prev: 0 };
}

export default function MissionDebrief({
  state,
  mission,
  onReturn,
  ctaLabel,
}: Props) {
  const [xpDisplayed, setXpDisplayed] = useState(0);
  const [showStats, setShowStats] = useState(false);
  const [showRank, setShowRank] = useState(false);
  const [showNext, setShowNext] = useState(false);

  const xpEarned = state.overrideSuccess ? mission.reward : 10;
  const rank = getRank(state.missionsCompleted);
  const rankProgress = Math.min(
    1,
    Math.max(
      0,
      (state.missionsCompleted - rank.prev) / (rank.next - rank.prev)
    )
  );

  useEffect(() => {
    const target = xpEarned;
    let current = 0;
    const step = Math.max(1, Math.floor(target / 25));
    const interval = setInterval(() => {
      current += step;
      if (current >= target) {
        current = target;
        clearInterval(interval);
        haptics.impact();
      }
      setXpDisplayed(current);
      sounds.xpTick();
    }, 60);

    const t1 = setTimeout(() => {
      setShowStats(true);
      haptics.tap();
    }, 1600);
    const t2 = setTimeout(() => {
      setShowRank(true);
    }, 2200);
    const t3 = setTimeout(() => {
      setShowNext(true);
    }, 2800);

    return () => {
      clearInterval(interval);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [xpEarned]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-black relative overflow-hidden flex flex-col"
    >
      <div className="heartbeat-bar w-full" />

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-12">
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 12 }}
          className="text-center mb-6"
        >
          <p className="text-[9px] tracking-[0.5em] uppercase mb-3 text-neon/50 font-semibold">
            Mission Debrief
          </p>
          <h1 className="font-display font-extrabold text-[38px] uppercase tracking-wider text-foreground leading-none">
            {state.overrideSuccess ? "Payload Diffused" : "Partial Success"}
          </h1>
          <div className="flex items-center justify-center gap-2 mt-3">
            <Target className="w-3.5 h-3.5 text-muted-foreground/50" />
            <p className="text-[12px] text-muted-foreground">{mission.label}</p>
          </div>
        </motion.div>

        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3, type: "spring", damping: 10 }}
          className="text-center mb-8"
        >
          <div className="flex items-center justify-center gap-3 mb-1">
            <Zap className="w-7 h-7 text-neon" />
            <span className="font-display font-extrabold text-8xl text-neon glow-neon tabular-nums">
              +{xpDisplayed}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground tracking-[0.3em] uppercase">
            XP Earned
          </p>
        </motion.div>

        {showStats && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-xs mb-6"
          >
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  icon: Trophy,
                  label: "Missions",
                  value: state.missionsCompleted,
                  color: "text-amber",
                },
                {
                  icon: Flame,
                  label: "Streak",
                  value: state.streak,
                  color:
                    state.streak > 0 ? "text-danger" : "text-muted-foreground",
                },
                {
                  icon: Zap,
                  label: "Total XP",
                  value: state.totalXP,
                  color: "text-neon",
                },
              ].map(({ icon: Icon, label, value, color }, i) => (
                <motion.div
                  key={label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="border border-border/20 bg-void-light/30 p-3 text-center"
                >
                  <Icon className={`w-4 h-4 mx-auto mb-1.5 opacity-60 ${color}`} />
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                  <p className="text-[7px] tracking-[0.15em] text-muted-foreground uppercase mt-0.5">
                    {label}
                  </p>
                </motion.div>
              ))}
            </div>

            {state.laundryScore > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="border border-border/15 bg-void-light/20 p-3 flex items-center justify-between mt-2"
              >
                <span className="text-[9px] text-muted-foreground tracking-wider uppercase">
                  Laundry Collected
                </span>
                <span className="text-sm font-bold text-neon">
                  {state.laundryScore}
                </span>
              </motion.div>
            )}

            <div className="border border-border/15 bg-void-light/20 p-3 flex items-center justify-between mt-2">
              <span className="text-[9px] text-muted-foreground tracking-wider uppercase">
                Mission Progress
              </span>
              <span className="text-sm font-bold text-foreground">
                {state.currentPayloadIndex}/{state.payloadCount}
              </span>
            </div>
          </motion.div>
        )}

        {showRank && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full max-w-xs mb-8"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-neon/50" />
                <span className="text-[8px] tracking-[0.2em] text-neon/60 uppercase font-semibold">
                  {rank.name}
                </span>
              </div>
              <span className="text-[8px] text-muted-foreground/50">
                {state.missionsCompleted}/{rank.next}
              </span>
            </div>
            <div className="h-1 bg-void-lighter overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${rankProgress * 100}%` }}
                transition={{ delay: 0.3, duration: 0.8, ease: "easeOut" }}
                className="h-full bg-gradient-to-r from-neon/60 to-neon"
              />
            </div>
          </motion.div>
        )}

        {showNext && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-xs"
          >
            <button
              onClick={() => {
                sounds.press();
                haptics.impact();
                onReturn();
              }}
              className="w-full bg-neon text-void py-4 font-display font-extrabold text-lg uppercase tracking-wider
                         flex items-center justify-center gap-3 active:scale-[0.98] transition-transform
                         shadow-[0_0_24px_oklch(0.85_0.25_155/0.3)]"
            >
              <span>{ctaLabel ?? "Next Payload"}</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
