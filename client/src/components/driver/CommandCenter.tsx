/**
 * COMMAND CENTER — order queue for the Tactical Noir driver game.
 * Ported from the Manus prototype; wired to real TRPC-derived orders through
 * `DriverPrepMechanic`. Renders inside `.driver-game` so Tactical Noir tokens
 * apply without touching admin/customer/vendor themes.
 */
import { motion } from "framer-motion";
import {
  MapPin,
  Package,
  Clock,
  ChevronRight,
  Shield,
  Flame,
  Zap,
  Trophy,
} from "lucide-react";
import type { GameOrder, GameStateSnapshot } from "./driverGameTypes";
import { sounds } from "./driverSounds";
import { haptics } from "./driverHaptics";

interface Props {
  orders: GameOrder[];
  state: GameStateSnapshot;
  onSelectOrder: (order: GameOrder) => void;
  isLoading?: boolean;
}

function getRank(missions: number): { name: string } {
  if (missions >= 20) return { name: "COMMANDER" };
  if (missions >= 12) return { name: "FIELD CAPTAIN" };
  if (missions >= 6) return { name: "AGENT II" };
  if (missions >= 2) return { name: "AGENT I" };
  return { name: "RECRUIT" };
}

export default function CommandCenter({
  orders,
  state,
  onSelectOrder,
  isLoading,
}: Props) {
  const handleSelect = (order: GameOrder) => {
    sounds.press();
    haptics.tap();
    onSelectOrder(order);
  };

  const rank = getRank(state.missionsCompleted);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-void relative overflow-hidden"
    >
      <div className="heartbeat-bar w-full" />

      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,0.1) 2px, rgba(0,255,136,0.1) 4px)",
        }}
      />

      <div className="relative z-10 px-4 pt-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-6"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[9px] tracking-[0.4em] text-neon/50 uppercase mb-1">
                BLDG Operations
              </p>
              <h1 className="font-display font-extrabold text-4xl uppercase tracking-wide text-foreground leading-none">
                Command Center
              </h1>
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <Shield className="w-3.5 h-3.5 text-neon/60" />
              <span className="text-[8px] tracking-[0.2em] text-neon/60 uppercase">
                {rank.name}
              </span>
            </div>
          </div>
          <div className="mt-3 h-px bg-gradient-to-r from-neon/50 via-neon/20 to-transparent" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="grid grid-cols-3 gap-2 mb-8"
        >
          <div className="border border-border/40 bg-void-light/50 p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Trophy className="w-3 h-3 text-neon/50" />
              <p className="text-[8px] tracking-[0.2em] text-muted-foreground uppercase">
                Missions
              </p>
            </div>
            <p className="text-2xl font-bold text-neon">
              {state.missionsCompleted}
            </p>
          </div>
          <div className="border border-border/40 bg-void-light/50 p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Flame className="w-3 h-3 text-danger/60" />
              <p className="text-[8px] tracking-[0.2em] text-muted-foreground uppercase">
                Streak
              </p>
            </div>
            <p className="text-2xl font-bold text-amber">{state.streak}</p>
          </div>
          <div className="border border-border/40 bg-void-light/50 p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Zap className="w-3 h-3 text-foreground/40" />
              <p className="text-[8px] tracking-[0.2em] text-muted-foreground uppercase">
                Total XP
              </p>
            </div>
            <p className="text-2xl font-bold text-foreground">
              {state.totalXP}
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="flex items-center gap-2 mb-4"
        >
          <div
            className="w-1.5 h-1.5 bg-neon animate-pulse-neon"
            style={{
              clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
            }}
          />
          <p className="text-[9px] tracking-[0.3em] text-neon/80 uppercase font-semibold">
            Active Bounties — {orders.length}
          </p>
        </motion.div>

        {isLoading ? (
          <p className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase py-6 text-center">
            Loading queue…
          </p>
        ) : orders.length === 0 ? (
          <p className="text-[10px] tracking-[0.3em] text-muted-foreground uppercase py-6 text-center">
            {state.missionCompletedForDay
              ? "Daily mission complete — stand by."
              : "No active bounties. Queue is clean."}
          </p>
        ) : (
          <div className="space-y-2">
            {orders.map((order, i) => (
              <motion.button
                key={order.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.08, duration: 0.3 }}
                onClick={() => handleSelect(order)}
                className="w-full text-left border border-border/30 hover:border-neon/40
                           transition-all duration-200 active:bg-void-lighter group relative overflow-hidden"
              >
                <div
                  className="absolute inset-0 bg-gradient-to-r from-neon/0 via-neon/[0.02] to-neon/0
                             opacity-0 group-hover:opacity-100 transition-opacity"
                />

                <div className="p-4 relative">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-muted-foreground/60" />
                        <span className="text-[10px] text-muted-foreground">
                          {order.timeWindow}
                        </span>
                      </div>
                      <span
                        className={`text-[8px] tracking-[0.15em] uppercase px-2 py-0.5 font-bold ${
                          order.type === "PICKUP"
                            ? "bg-neon/10 text-neon border border-neon/30"
                            : "bg-amber/10 text-amber border border-amber/30"
                        }`}
                      >
                        {order.type}
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-neon transition-colors" />
                  </div>

                  <p className="font-display font-bold text-[15px] text-foreground mb-1 uppercase tracking-wide">
                    {order.customerName}
                  </p>
                  <div className="flex items-start gap-1.5">
                    <MapPin className="w-3 h-3 text-neon/40 mt-0.5 shrink-0" />
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {order.address}
                      {order.unit ? ` · Unit ${order.unit}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/20">
                    <div className="flex items-center gap-1.5">
                      <Package className="w-3 h-3 text-muted-foreground/50" />
                      <span className="text-[10px] text-muted-foreground">
                        {order.items} {order.items === 1 ? "bag" : "bags"}
                      </span>
                    </div>
                    <span className="font-display text-[11px] font-bold text-neon tracking-wider uppercase">
                      {order.dateLabel}
                    </span>
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
