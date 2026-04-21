/**
 * TERRITORY LEADERBOARD — The FOMO machine.
 *
 * Shows a dark tactical heat map of the city with claimed/contested/unclaimed
 * zones, weekly league standings, city-level rankings, and streak boards.
 * Designed to make laundromat owners feel like they're losing ground if they
 * don't sign up.
 *
 * V1: All data is mocked (front-end only). Future: wire to real driver stats API.
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Trophy,
  Flame,
  MapPin,
  ChevronRight,
  Crown,
  TrendingUp,
  TrendingDown,
  Minus,
  Shield,
  Target,
  ArrowLeft,
  Zap,
} from "lucide-react";
import { sounds } from "./driverSounds";
import { haptics } from "./driverHaptics";

const TERRITORY_MAP_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663281332025/bVTWnxw2cr9EUVzVBCF5PW/laundry-run-territory-map-6rywxGwtdkWgVDtHuH7tfD.webp";

// --- Mock Data ---

interface LeaderboardDriver {
  rank: number;
  callsign: string;
  company: string;
  xp: number;
  missions: number;
  streak: number;
  territory: string;
  trend: "up" | "down" | "same";
  isYou?: boolean;
}

interface Territory {
  name: string;
  status: "claimed" | "contested" | "unclaimed";
  claimedBy?: string;
  drivers: number;
  missions: number;
}

const MOCK_WEEKLY_LEAGUE: LeaderboardDriver[] = [
  { rank: 1, callsign: "GHOST-7", company: "CleanStar LA", xp: 4250, missions: 47, streak: 21, territory: "DTLA Corridor", trend: "up" },
  { rank: 2, callsign: "VIPER-12", company: "FreshFold West", xp: 3890, missions: 42, streak: 18, territory: "Westside Sector", trend: "up" },
  { rank: 3, callsign: "PHANTOM-3", company: "SpinCycle Pro", xp: 3640, missions: 39, streak: 15, territory: "Hollywood Grid", trend: "same" },
  { rank: 4, callsign: "RAVEN-9", company: "CleanStar LA", xp: 3210, missions: 35, streak: 12, territory: "Valley North", trend: "down" },
  { rank: 5, callsign: "HAWK-1", company: "BLDG Laundry", xp: 2980, missions: 32, streak: 14, territory: "Century Park", trend: "up", isYou: true },
  { rank: 6, callsign: "WOLF-6", company: "LaundryNow", xp: 2750, missions: 30, streak: 9, territory: "Koreatown", trend: "down" },
  { rank: 7, callsign: "COBRA-2", company: "FreshFold West", xp: 2540, missions: 28, streak: 11, territory: "Silver Lake", trend: "same" },
  { rank: 8, callsign: "EAGLE-5", company: "WashPro", xp: 2310, missions: 25, streak: 7, territory: "Venice Beach", trend: "up" },
  { rank: 9, callsign: "STORM-4", company: "SpinCycle Pro", xp: 2100, missions: 23, streak: 6, territory: "Culver City", trend: "down" },
  { rank: 10, callsign: "BLADE-8", company: "CleanStar LA", xp: 1890, missions: 21, streak: 4, territory: "Inglewood", trend: "same" },
];

const MOCK_TERRITORIES: Territory[] = [
  { name: "DTLA Corridor", status: "claimed", claimedBy: "CleanStar LA", drivers: 4, missions: 89 },
  { name: "Westside Sector", status: "claimed", claimedBy: "FreshFold West", drivers: 3, missions: 72 },
  { name: "Hollywood Grid", status: "contested", drivers: 5, missions: 65 },
  { name: "Valley North", status: "claimed", claimedBy: "CleanStar LA", drivers: 2, missions: 48 },
  { name: "Century Park", status: "contested", drivers: 3, missions: 41 },
  { name: "Koreatown", status: "unclaimed", drivers: 1, missions: 18 },
  { name: "Silver Lake", status: "unclaimed", drivers: 1, missions: 12 },
  { name: "Venice Beach", status: "contested", drivers: 2, missions: 34 },
  { name: "Culver City", status: "unclaimed", drivers: 0, missions: 0 },
  { name: "Inglewood", status: "unclaimed", drivers: 0, missions: 0 },
];

type Tab = "league" | "territory" | "streak";

interface Props {
  onBack: () => void;
}

function TrendIcon({ trend }: { trend: "up" | "down" | "same" }) {
  if (trend === "up") return <TrendingUp className="w-3 h-3 text-neon" />;
  if (trend === "down") return <TrendingDown className="w-3 h-3 text-danger" />;
  return <Minus className="w-3 h-3 text-muted-foreground" />;
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Crown className="w-4 h-4 text-amber-400" />;
  if (rank === 2) return <Crown className="w-4 h-4 text-gray-400" />;
  if (rank === 3) return <Crown className="w-4 h-4 text-amber-700" />;
  return (
    <span className="text-[11px] font-mono text-muted-foreground w-4 text-center">
      {rank}
    </span>
  );
}

function StatusDot({ status }: { status: Territory["status"] }) {
  const colors = {
    claimed: "bg-neon",
    contested: "bg-amber-500",
    unclaimed: "bg-gray-600",
  };
  return (
    <span className={`inline-block w-2 h-2 ${colors[status]}`} style={{
      boxShadow: status === "claimed"
        ? "0 0 6px rgba(0,255,136,0.6)"
        : status === "contested"
          ? "0 0 6px rgba(255,170,0,0.6)"
          : "none",
    }} />
  );
}

export default function TerritoryLeaderboard({ onBack }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("league");
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    sounds.missionAssign();
    haptics.impact();
  }, []);

  const claimedCount = MOCK_TERRITORIES.filter(t => t.status === "claimed").length;
  const contestedCount = MOCK_TERRITORIES.filter(t => t.status === "contested").length;
  const unclaimedCount = MOCK_TERRITORIES.filter(t => t.status === "unclaimed").length;

  return (
    <div className="min-h-screen bg-void relative overflow-hidden">
      {/* Scan lines overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03] z-10"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,136,0.15) 2px, rgba(0,255,136,0.15) 4px)",
        }}
      />

      {/* Heartbeat bar */}
      <div className="heartbeat-bar w-full relative z-20" />

      {/* Header */}
      <div className="relative z-20 px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => {
              sounds.press();
              haptics.tap();
              onBack();
            }}
            className="w-8 h-8 border border-border/20 flex items-center justify-center
                       hover:border-neon/30 transition-colors active:bg-neon/5"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <div>
            <h1 className="font-display font-extrabold text-xl uppercase tracking-wider text-foreground leading-none">
              Operations Board
            </h1>
            <p className="text-[9px] tracking-[0.4em] text-neon/50 uppercase mt-0.5 font-semibold">
              Los Angeles · Week 16
            </p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 border border-border/15">
          {(["league", "territory", "streak"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                sounds.press();
                haptics.tap();
                setActiveTab(tab);
              }}
              className={`flex-1 py-2.5 text-[10px] tracking-[0.2em] uppercase font-semibold transition-all
                ${activeTab === tab
                  ? "bg-neon/[0.08] text-neon border-b-2 border-neon"
                  : "text-muted-foreground hover:text-foreground"
                }`}
            >
              {tab === "league" && "League"}
              {tab === "territory" && "Territory"}
              {tab === "streak" && "Streaks"}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="relative z-20 px-4 pb-8">
        <AnimatePresence mode="wait">
          {activeTab === "league" && (
            <motion.div
              key="league"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <LeagueTab />
            </motion.div>
          )}
          {activeTab === "territory" && (
            <motion.div
              key="territory"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <TerritoryTab
                claimedCount={claimedCount}
                contestedCount={contestedCount}
                unclaimedCount={unclaimedCount}
              />
            </motion.div>
          )}
          {activeTab === "streak" && (
            <motion.div
              key="streak"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <StreakTab />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function LeagueTab() {
  return (
    <div>
      {/* League info banner */}
      <div className="border border-neon/15 bg-neon/[0.03] p-3 mb-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Shield className="w-3.5 h-3.5 text-neon" />
          <span className="text-[10px] tracking-[0.3em] text-neon uppercase font-semibold">
            Silver League
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Top 5 promote to Gold. Bottom 3 demote. Resets Monday 00:00.
        </p>
        <div className="flex items-center gap-4 mt-2">
          <span className="text-[9px] text-muted-foreground font-mono">
            30 DRIVERS · 4 DAYS LEFT
          </span>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="space-y-0">
        {MOCK_WEEKLY_LEAGUE.map((driver, i) => (
          <motion.div
            key={driver.callsign}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className={`flex items-center gap-3 py-3 border-b border-border/8
              ${driver.isYou ? "bg-neon/[0.04] -mx-4 px-4 border-l-2 border-l-neon" : ""}
              ${driver.rank <= 5 ? "" : "opacity-70"}`}
          >
            <RankBadge rank={driver.rank} />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`font-display font-bold text-[13px] uppercase tracking-wide
                  ${driver.isYou ? "text-neon" : "text-foreground"}`}>
                  {driver.callsign}
                </span>
                {driver.isYou && (
                  <span className="text-[8px] tracking-[0.3em] text-neon/70 uppercase font-semibold border border-neon/30 px-1.5 py-0.5">
                    You
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[9px] text-muted-foreground font-mono truncate">
                  {driver.company}
                </span>
                <span className="text-[8px] text-muted-foreground/50">·</span>
                <span className="text-[9px] text-muted-foreground/70 font-mono">
                  {driver.territory}
                </span>
              </div>
            </div>

            <div className="text-right flex items-center gap-2">
              <div>
                <p className="text-[13px] font-display font-bold text-neon tabular-nums">
                  {driver.xp.toLocaleString()}
                </p>
                <p className="text-[8px] text-muted-foreground font-mono">
                  {driver.missions} MISSIONS
                </p>
              </div>
              <TrendIcon trend={driver.trend} />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Promotion zone indicator */}
      <div className="mt-4 flex items-center gap-2">
        <div className="flex-1 h-px bg-neon/20" />
        <span className="text-[8px] tracking-[0.3em] text-neon/50 uppercase font-semibold">
          Promotion Zone ↑
        </span>
        <div className="flex-1 h-px bg-neon/20" />
      </div>
    </div>
  );
}

function TerritoryTab({
  claimedCount,
  contestedCount,
  unclaimedCount,
}: {
  claimedCount: number;
  contestedCount: number;
  unclaimedCount: number;
}) {
  return (
    <div>
      {/* Territory map image */}
      <div className="relative mb-4 border border-border/15 overflow-hidden" style={{ aspectRatio: "9/12" }}>
        <img
          src={TERRITORY_MAP_URL}
          alt="Territory Map"
          className="w-full h-full object-cover"
          loading="eager"
        />
        {/* Overlay gradient for readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-void via-transparent to-void/30" />

        {/* Map legend overlay */}
        <div className="absolute bottom-3 left-3 right-3 flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <StatusDot status="claimed" />
            <span className="text-[9px] text-foreground font-mono">{claimedCount} CLAIMED</span>
          </div>
          <div className="flex items-center gap-1.5">
            <StatusDot status="contested" />
            <span className="text-[9px] text-amber-400 font-mono">{contestedCount} CONTESTED</span>
          </div>
          <div className="flex items-center gap-1.5">
            <StatusDot status="unclaimed" />
            <span className="text-[9px] text-muted-foreground font-mono">{unclaimedCount} OPEN</span>
          </div>
        </div>

        {/* Radar sweep animation */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "conic-gradient(from 0deg, transparent 0deg, rgba(0,255,136,0.06) 30deg, transparent 60deg)",
            transformOrigin: "60% 40%",
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
        />
      </div>

      {/* Territory list */}
      <div className="space-y-0">
        {MOCK_TERRITORIES.map((territory, i) => (
          <motion.div
            key={territory.name}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className="flex items-center gap-3 py-3 border-b border-border/8"
          >
            <StatusDot status={territory.status} />

            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-[12px] uppercase tracking-wide text-foreground">
                {territory.name}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                {territory.claimedBy ? (
                  <span className="text-[9px] text-neon font-mono">
                    {territory.claimedBy}
                  </span>
                ) : territory.status === "contested" ? (
                  <span className="text-[9px] text-amber-400 font-mono">
                    Multiple operators
                  </span>
                ) : (
                  <span className="text-[9px] text-muted-foreground/50 font-mono italic">
                    No presence
                  </span>
                )}
              </div>
            </div>

            <div className="text-right">
              <p className="text-[11px] font-mono text-foreground tabular-nums">
                {territory.drivers} <span className="text-muted-foreground text-[9px]">DRV</span>
              </p>
              <p className="text-[9px] font-mono text-muted-foreground tabular-nums">
                {territory.missions} msn
              </p>
            </div>

            {territory.status === "unclaimed" && territory.drivers === 0 && (
              <div className="border border-amber-500/30 px-2 py-1">
                <span className="text-[8px] tracking-[0.2em] text-amber-400 uppercase font-semibold">
                  Open
                </span>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* FOMO banner */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mt-5 border border-amber-500/20 bg-amber-500/[0.04] p-3"
      >
        <div className="flex items-start gap-2">
          <Target className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-[10px] text-amber-400 font-display font-bold uppercase tracking-wider mb-1">
              4 Territories Unclaimed
            </p>
            <p className="text-[9px] text-muted-foreground leading-relaxed">
              Culver City and Inglewood have zero driver presence.
              First operator to deploy gets exclusive territory claim.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function StreakTab() {
  const streakLeaders = useMemo(() =>
    [...MOCK_WEEKLY_LEAGUE]
      .sort((a, b) => b.streak - a.streak)
      .map((d, i) => ({ ...d, rank: i + 1 })),
    []
  );

  return (
    <div>
      {/* Streak explanation */}
      <div className="border border-border/15 bg-void-light p-3 mb-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Flame className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[10px] tracking-[0.3em] text-amber-400 uppercase font-semibold">
            Consistency Wins
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Complete at least 1 mission per day to maintain your streak.
          Longest active streak earns bonus XP multiplier.
        </p>
      </div>

      {/* Streak multiplier tiers */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { days: "7+", mult: "1.2x", active: true },
          { days: "14+", mult: "1.5x", active: true },
          { days: "21+", mult: "2.0x", active: false },
          { days: "30+", mult: "3.0x", active: false },
        ].map((tier) => (
          <div
            key={tier.days}
            className={`border p-2 text-center
              ${tier.active
                ? "border-neon/30 bg-neon/[0.04]"
                : "border-border/10 opacity-40"
              }`}
          >
            <p className="text-[10px] font-display font-bold text-foreground">
              {tier.mult}
            </p>
            <p className="text-[8px] font-mono text-muted-foreground mt-0.5">
              {tier.days}
            </p>
          </div>
        ))}
      </div>

      {/* Streak leaderboard */}
      <div className="space-y-0">
        {streakLeaders.map((driver, i) => (
          <motion.div
            key={driver.callsign}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className={`flex items-center gap-3 py-3 border-b border-border/8
              ${driver.isYou ? "bg-neon/[0.04] -mx-4 px-4 border-l-2 border-l-neon" : ""}`}
          >
            <span className="text-[11px] font-mono text-muted-foreground w-4 text-center">
              {driver.rank}
            </span>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`font-display font-bold text-[13px] uppercase tracking-wide
                  ${driver.isYou ? "text-neon" : "text-foreground"}`}>
                  {driver.callsign}
                </span>
                {driver.isYou && (
                  <span className="text-[8px] tracking-[0.3em] text-neon/70 uppercase font-semibold border border-neon/30 px-1.5 py-0.5">
                    You
                  </span>
                )}
              </div>
              <span className="text-[9px] text-muted-foreground font-mono">
                {driver.company}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <Flame className={`w-4 h-4 ${driver.streak >= 14 ? "text-amber-400" : "text-amber-600/60"}`} />
              <span className="font-display font-bold text-[16px] text-foreground tabular-nums">
                {driver.streak}
              </span>
              <span className="text-[8px] text-muted-foreground font-mono">
                DAYS
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
