/**
 * MISSION BRIEFING — bridge to the IRL flyer mission.
 * Displays the real `MissionTarget` derived from `driverMissionModel`.
 * Navigate button opens Google Maps; CTA confirms flyer posted and starts
 * the Flyer Proof capture gate before Signal Override.
 */
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Navigation,
  MapPin,
  Crosshair,
  ExternalLink,
  Radar,
} from "lucide-react";
import type { GameMissionTarget } from "./driverGameTypes";
import { sounds } from "./driverSounds";
import { haptics } from "./driverHaptics";

const BRIEFING_BG =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663281332025/bVTWnxw2cr9EUVzVBCF5PW/mission-briefing-bg-jmkSHSaQsAxCSTHWVfjiTD.webp";

interface Props {
  mission: GameMissionTarget;
  onFlyerPosted: () => void;
}

export default function MissionBriefing({ mission, onFlyerPosted }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [showProtocol, setShowProtocol] = useState(false);
  const [showActions, setShowActions] = useState(false);

  useEffect(() => {
    sounds.missionAssign();
    haptics.countdown();
    const t1 = setTimeout(() => setRevealed(true), 900);
    const t2 = setTimeout(() => setShowProtocol(true), 1600);
    const t3 = setTimeout(() => setShowActions(true), 2200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  const handleNavigate = () => {
    if (!mission.mapsUrl) return;
    sounds.press();
    haptics.impact();
    window.open(mission.mapsUrl, "_blank", "noopener,noreferrer");
  };

  const handleFlyerPosted = () => {
    sounds.press();
    haptics.slam();
    onFlyerPosted();
  };

  const protocolSteps = [
    "Navigate to the target address",
    "Post the BLDG flyer at the lobby or entrance",
    "Capture proof photo to unlock override",
    "Begin signal override",
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-black relative overflow-hidden flex flex-col"
    >
      <div className="heartbeat-bar w-full" />

      <div
        className="absolute inset-x-0 top-0 h-[320px] pointer-events-none opacity-[0.20]"
        style={{
          backgroundImage: `url(${BRIEFING_BG})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          maskImage:
            "linear-gradient(180deg, black 0%, black 35%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(180deg, black 0%, black 35%, transparent 100%)",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,0.1) 2px, rgba(0,255,136,0.1) 4px)",
        }}
      />

      <div className="relative z-10 flex-1 flex flex-col justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex items-center gap-2 mb-8"
        >
          <Crosshair className="w-4 h-4 text-danger animate-pulse-neon" />
          <span className="text-[9px] tracking-[0.5em] text-danger uppercase font-bold">
            Nearby Target Detected
          </span>
        </motion.div>

        {revealed ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <h1 className="font-display font-extrabold text-[40px] uppercase tracking-wide text-foreground leading-[1.05] mb-4">
              {mission.label}
            </h1>

            {mission.address ? (
              <div className="flex items-start gap-2 mb-5">
                <MapPin className="w-4 h-4 text-neon/60 mt-0.5 shrink-0" />
                <p className="text-[13px] text-muted-foreground">
                  {mission.address}
                </p>
              </div>
            ) : null}

            <p className="text-[10px] tracking-[0.25em] text-neon/70 uppercase mb-6 font-semibold">
              {mission.intel}
            </p>

            <div className="flex items-center gap-3 mb-2">
              <div className="border border-border/30 bg-void-light/30 px-4 py-3 flex-1">
                <div className="flex items-center gap-1 mb-1">
                  <Radar className="w-3 h-3 text-amber/70" />
                  <p className="text-[7px] tracking-[0.2em] text-muted-foreground uppercase">
                    Proximity
                  </p>
                </div>
                <p className="text-[13px] font-bold text-amber uppercase tracking-wider leading-none">
                  {mission.distance}
                </p>
              </div>
              <div className="border border-border/30 bg-void-light/30 px-4 py-3 flex-1">
                <p className="text-[7px] tracking-[0.2em] text-muted-foreground uppercase mb-1">
                  Reward
                </p>
                <p className="text-xl font-bold text-neon">
                  +{mission.reward} XP
                </p>
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="h-48 flex items-center justify-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="w-8 h-8 border-2 border-neon/30 border-t-neon"
              style={{ clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" }}
            />
          </div>
        )}

        {showProtocol && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-8"
          >
            <div className="h-px bg-gradient-to-r from-border/30 to-transparent mb-6" />

            <p className="text-[9px] tracking-[0.4em] text-muted-foreground uppercase mb-4 font-semibold">
              Mission Protocol
            </p>
            <div className="space-y-2.5">
              {protocolSteps.map((step, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.12 }}
                  className="flex items-center gap-3"
                >
                  <span className="text-[9px] text-neon/40 font-mono w-5 shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {step}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {showActions && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 space-y-3"
          >
            {mission.mapsUrl ? (
              <button
                onClick={handleNavigate}
                className="w-full border border-neon/30 hover:border-neon py-4 flex items-center justify-center gap-3
                           transition-all duration-200 active:bg-neon/10 group"
              >
                <Navigation className="w-5 h-5 text-neon/70 group-hover:text-neon transition-colors" />
                <span className="font-display font-bold text-lg uppercase tracking-wider text-neon/70 group-hover:text-neon transition-colors">
                  Navigate to Target
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-neon/30" />
              </button>
            ) : null}

            <button
              onClick={handleFlyerPosted}
              className="w-full bg-neon text-void py-4 font-display font-extrabold text-base uppercase tracking-wider
                         active:scale-[0.98] transition-transform shadow-[0_0_24px_oklch(0.85_0.25_155/0.35)]
                         flex flex-col items-center leading-tight"
            >
              <span>Flyer Posted — Capture Proof</span>
              <span className="text-[9px] tracking-[0.3em] opacity-70 font-bold mt-0.5">
                Only tap once the flyer is up
              </span>
            </button>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
