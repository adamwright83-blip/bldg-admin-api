/**
 * ORDER DETAIL — Mission Intel view with Google Maps handoff.
 * Bottom CTA advances the machine from `order_detail` → prep tier 1 so the
 * reducer invariants (prep secured before any game phase) still hold.
 */
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Navigation,
  MapPin,
  Package,
  Clock,
  ExternalLink,
  Building2,
  Home,
} from "lucide-react";
import type { GameOrder } from "./driverGameTypes";
import { sounds } from "./driverSounds";
import { haptics } from "./driverHaptics";

const BRIEFING_BG =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663281332025/bVTWnxw2cr9EUVzVBCF5PW/mission-briefing-bg-jmkSHSaQsAxCSTHWVfjiTD.webp";

interface Props {
  order: GameOrder;
  onStartVerification: () => void;
  onSkipGames: () => void;
  onBack: () => void;
}

export default function OrderDetail({
  order,
  onStartVerification,
  onSkipGames,
  onBack,
}: Props) {
  const [showObjectives, setShowObjectives] = useState(false);
  const [showActions, setShowActions] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setShowObjectives(true), 400);
    const t2 = setTimeout(() => setShowActions(true), 800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    order.address + (order.unit ? `, Unit ${order.unit}` : "")
  )}`;

  const handleNavigate = () => {
    sounds.press();
    haptics.impact();
    window.open(mapsUrl, "_blank", "noopener,noreferrer");
  };

  const handleDelivered = () => {
    sounds.scanConfirm();
    haptics.slam();
    onStartVerification();
  };

  const handleSkipGames = () => {
    onSkipGames();
  };

  const objectives = [
    "Navigate to location",
    order.type === "PICKUP" ? "Collect items" : "Deliver items",
    `Confirm ${order.type.toLowerCase()}`,
    "Initiate field operation",
  ];

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.25 }}
      className="min-h-screen bg-void relative overflow-hidden"
    >
      <div className="heartbeat-bar w-full" />

      <div
        className="absolute inset-x-0 top-0 h-[280px] pointer-events-none opacity-[0.12]"
        style={{
          backgroundImage: `url(${BRIEFING_BG})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          maskImage:
            "linear-gradient(180deg, black 0%, black 40%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(180deg, black 0%, black 40%, transparent 100%)",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,0.1) 2px, rgba(0,255,136,0.1) 4px)",
        }}
      />

      <div className="relative z-10 px-4 pt-4 pb-32">
        <button
          onClick={() => {
            sounds.press();
            haptics.tap();
            onBack();
          }}
          className="flex items-center gap-2 text-muted-foreground hover:text-neon transition-colors mb-6 py-2 -ml-1"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-[10px] tracking-[0.2em] uppercase font-semibold">
            Back
          </span>
        </button>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-3"
        >
          <span
            className={`text-[9px] tracking-[0.2em] uppercase px-3 py-1 font-bold ${
              order.type === "PICKUP"
                ? "bg-neon/10 text-neon border border-neon/30"
                : "bg-amber/10 text-amber border border-amber/30"
            }`}
          >
            {order.type}
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="font-display font-extrabold text-[42px] uppercase tracking-wide text-foreground leading-[1.05] mb-3"
        >
          {order.customerName}
        </motion.h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="flex items-start gap-2 mb-2"
        >
          <MapPin className="w-4 h-4 text-neon/60 mt-0.5 shrink-0" />
          <p className="text-[13px] text-muted-foreground">
            {order.address}
            {order.unit ? ` · Unit ${order.unit}` : ""}
          </p>
        </motion.div>

        {order.buildingName ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="flex items-center gap-2 ml-6 mb-8"
          >
            <Building2 className="w-3.5 h-3.5 text-neon/70" />
            <p className="text-[10px] tracking-[0.25em] text-neon/80 uppercase font-semibold">
              {order.buildingName}
            </p>
          </motion.div>
        ) : (
          <div className="mb-8" />
        )}

        <div className="h-px bg-gradient-to-r from-border/40 to-transparent mb-6" />

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="grid grid-cols-3 gap-3 mb-8"
        >
          <div className="border border-border/30 bg-void-light/40 p-3">
            <p className="text-[8px] tracking-[0.2em] text-muted-foreground uppercase mb-2">
              Items
            </p>
            <div className="flex items-center gap-1.5">
              <Package className="w-4 h-4 text-neon/60" />
              <span className="text-2xl font-bold text-foreground">
                {order.items}
              </span>
            </div>
          </div>
          <div className="border border-border/30 bg-void-light/40 p-3">
            <p className="text-[8px] tracking-[0.2em] text-muted-foreground uppercase mb-2">
              Window
            </p>
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber/60" />
              <span className="text-sm font-bold text-foreground">
                {order.timeWindow}
              </span>
            </div>
          </div>
          <div className="border border-border/30 bg-void-light/40 p-3">
            <p className="text-[8px] tracking-[0.2em] text-muted-foreground uppercase mb-2">
              Date
            </p>
            <span className="text-sm font-bold text-neon uppercase">
              {order.dateLabel}
            </span>
          </div>
        </motion.div>

        {showObjectives && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="border border-border/20 bg-void-light/30 p-4 mb-8"
          >
            <p className="text-[9px] tracking-[0.3em] text-muted-foreground uppercase mb-3 font-semibold">
              Objectives
            </p>
            {objectives.map((obj, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className="flex items-center gap-3 py-2"
              >
                <div className="w-2 h-2 border border-neon/40 rotate-45 shrink-0" />
                <span className="text-[11px] text-muted-foreground">{obj}</span>
              </motion.div>
            ))}
          </motion.div>
        )}

        {showActions && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <button
              onClick={handleNavigate}
              className="w-full border border-neon/30 hover:border-neon py-4 flex items-center justify-center gap-3
                         transition-all duration-200 active:bg-neon/10 group"
            >
              <Navigation className="w-5 h-5 text-neon/80 group-hover:text-neon transition-colors" />
              <span className="font-display font-bold text-lg uppercase tracking-wider text-neon/80 group-hover:text-neon transition-colors">
                Start Navigation
              </span>
              <ExternalLink className="w-3.5 h-3.5 text-neon/40" />
            </button>
          </motion.div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-20">
        <div className="h-16 bg-gradient-to-t from-void to-transparent" />
        <div className="bg-void px-4 pb-6 pt-2 space-y-2">
          <button
            onClick={handleDelivered}
            className="w-full bg-neon text-void py-4 font-display font-extrabold text-lg uppercase tracking-wider
                       active:scale-[0.98] transition-transform shadow-[0_0_20px_oklch(0.85_0.25_155/0.3)]"
          >
            Order {order.type === "PICKUP" ? "Picked Up" : "Delivered"}
          </button>
          <button
            type="button"
            onClick={handleSkipGames}
            className="w-full border border-neon/35 bg-neon/[0.04] py-3.5 font-display font-extrabold text-sm uppercase tracking-[0.16em] text-neon
                       active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            <Home className="w-4 h-4" />
            <span>Skip Games & Return Home</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}
