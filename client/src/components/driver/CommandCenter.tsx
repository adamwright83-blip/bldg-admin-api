/**
 * COMMAND CENTER — order queue for the Tactical Noir driver game.
 * Ported from the Manus prototype; wired to real TRPC-derived orders through
 * `DriverPrepMechanic`. Renders inside `.driver-game` so Tactical Noir tokens
 * apply without touching admin/customer/vendor themes.
 */
import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin,
  Package,
  Clock,
  ChevronRight,
  Shield,
  Plus,
  Camera,
  Flame,
  Zap,
  Trophy,
  Building2,
  CalendarDays,
  ChevronLeft,
  CheckCircle2,
  Loader2,
  ReceiptText,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { GameOrder, GameStateSnapshot } from "./driverGameTypes";
import { sounds } from "./driverSounds";
import { haptics } from "./driverHaptics";
import TerritoryLeaderboard from "./TerritoryLeaderboard";
import { QuickNewOrderSheet } from "./QuickNewOrderSheet";
import { compressImageForMissionPreview } from "./driverMissionStorage";

const HERO_CITYSCAPE =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663281332025/bVTWnxw2cr9EUVzVBCF5PW/hero-cityscape-ibzWyN4yDNboMUDQd8P4Lh.webp";

interface Props {
  orders: GameOrder[];
  state: GameStateSnapshot;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  pickupCount: number;
  deliveryCount: number;
  onSelectOrder: (order: GameOrder) => void;
  onOrderCreated?: () => Promise<void> | void;
  isLoading?: boolean;
}

/** Leaderboard overlay state — lives inside CommandCenter so it doesn't
 *  pollute the main game state machine. */
function useLeaderboardToggle() {
  const [open, setOpen] = React.useState(false);
  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
}

function getRank(missions: number): { name: string } {
  if (missions >= 20) return { name: "COMMANDER" };
  if (missions >= 12) return { name: "FIELD CAPTAIN" };
  if (missions >= 6) return { name: "AGENT II" };
  if (missions >= 2) return { name: "AGENT I" };
  return { name: "RECRUIT" };
}

function localYmd(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseYmd(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(value: string, days: number): string {
  const date = parseYmd(value);
  date.setDate(date.getDate() + days);
  return localYmd(date);
}

function formatSelectedDate(value: string): string {
  return parseYmd(value).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function buildDateRail(selectedDate: string) {
  return Array.from({ length: 7 }, (_, i) => {
    const offset = i - 3;
    const value = addDays(selectedDate, offset);
    const date = parseYmd(value);
    return {
      value,
      day: date.toLocaleDateString("en-US", { weekday: "short" }),
      date: date.toLocaleDateString("en-US", { day: "numeric" }),
      isToday: value === localYmd(),
      isSelected: value === selectedDate,
    };
  });
}

function ScheduleDateSelector({
  selectedDate,
  onSelectedDateChange,
  pickupCount,
  deliveryCount,
}: Pick<
  Props,
  "selectedDate" | "onSelectedDateChange" | "pickupCount" | "deliveryCount"
>) {
  const days = React.useMemo(() => buildDateRail(selectedDate), [selectedDate]);
  const total = pickupCount + deliveryCount;

  const jump = (daysDelta: number) => {
    sounds.press();
    haptics.tap();
    onSelectedDateChange(addDays(selectedDate, daysDelta));
  };

  const choose = (value: string) => {
    sounds.press();
    haptics.tap();
    onSelectedDateChange(value);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18, duration: 0.35 }}
      className="mb-6 border border-border/40 bg-void-light/45 p-3"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <CalendarDays className="w-3.5 h-3.5 text-neon/65 shrink-0" />
            <p className="text-[8px] tracking-[0.24em] text-neon/65 uppercase font-semibold">
              Route Date
            </p>
          </div>
          <p className="font-display text-[18px] font-bold text-foreground uppercase tracking-wide truncate">
            {formatSelectedDate(selectedDate)}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => jump(-1)}
            className="h-9 w-9 border border-border/50 bg-void/60 text-muted-foreground hover:text-neon hover:border-neon/40 transition-colors flex items-center justify-center"
            aria-label="Previous day"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => choose(localYmd())}
            className="h-9 px-3 border border-neon/25 bg-neon/[0.06] text-[8px] tracking-[0.2em] text-neon/75 hover:border-neon/55 hover:text-neon uppercase font-bold transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => jump(1)}
            className="h-9 w-9 border border-border/50 bg-void/60 text-muted-foreground hover:text-neon hover:border-neon/40 transition-colors flex items-center justify-center"
            aria-label="Next day"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 mb-3">
        {days.map((day) => (
          <button
            key={day.value}
            type="button"
            onClick={() => choose(day.value)}
            className={`h-[58px] border transition-colors flex flex-col items-center justify-center ${
              day.isSelected
                ? "border-neon bg-neon/[0.12] text-neon shadow-[0_0_16px_rgba(0,255,136,0.12)]"
                : day.isToday
                  ? "border-amber/45 bg-amber/[0.07] text-amber"
                  : "border-border/35 bg-void/45 text-muted-foreground hover:border-neon/35 hover:text-foreground"
            }`}
            aria-label={`Show route for ${day.value}`}
          >
            <span className="text-[7px] tracking-[0.18em] uppercase font-semibold">
              {day.day}
            </span>
            <span className="font-display text-[18px] font-bold leading-none mt-1">
              {day.date}
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <div className="border border-neon/20 bg-neon/[0.04] px-2 py-2">
          <p className="text-[7px] tracking-[0.18em] text-neon/55 uppercase">
            Pickups
          </p>
          <p className="font-display text-lg font-bold text-neon leading-none">
            {pickupCount}
          </p>
        </div>
        <div className="border border-amber/20 bg-amber/[0.04] px-2 py-2">
          <p className="text-[7px] tracking-[0.18em] text-amber/60 uppercase">
            Dropoffs
          </p>
          <p className="font-display text-lg font-bold text-amber leading-none">
            {deliveryCount}
          </p>
        </div>
        <div className="border border-border/35 bg-void/45 px-2 py-2">
          <p className="text-[7px] tracking-[0.18em] text-muted-foreground uppercase">
            Total
          </p>
          <p className="font-display text-lg font-bold text-foreground leading-none">
            {total}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function dataUrlToReceiptPayload(dataUrl: string): {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
} {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/);
  if (!match) throw new Error("Use a JPEG, PNG, or WebP receipt photo.");
  return {
    mimeType: match[1] as "image/jpeg" | "image/png" | "image/webp",
    base64: match[2],
  };
}

function DriverReceiptUpload() {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [lastResult, setLastResult] = React.useState<string | null>(null);
  const uploadReceipt = trpc.admin.uploadDriverExpenseReceipt.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        const total = `$${(result.parsed.totalCents / 100).toFixed(2)}`;
        const vendor = result.parsed.vendorName ?? "gas receipt";
        setLastResult(`${vendor} ${total}`);
        toast.success(`Gas receipt logged: ${vendor} ${total}`);
        sounds.scanConfirm();
        haptics.impact();
        return;
      }
      setLastResult(null);
      toast.error(result.error || "Receipt was not logged.");
      sounds.overrideFail();
      haptics.error();
    },
    onError: (error) => {
      setLastResult(null);
      toast.error(error.message || "Could not upload receipt.");
      sounds.overrideFail();
      haptics.error();
    },
  });

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Use a JPEG, PNG, or WebP receipt photo.");
      return;
    }
    try {
      sounds.shutter();
      haptics.shutter();
      const compressed = await compressImageForMissionPreview(file);
      uploadReceipt.mutate(dataUrlToReceiptPayload(compressed));
      if (fileRef.current) fileRef.current.value = "";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read receipt photo.");
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-40 flex justify-center px-6 pointer-events-none">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      <motion.button
        type="button"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.28, duration: 0.4 }}
        onClick={() => fileRef.current?.click()}
        disabled={uploadReceipt.isPending}
        className="pointer-events-auto min-h-[70px] w-[min(300px,calc(100vw-64px))] rounded-full border-2 border-amber/75 bg-black/88 px-6 py-3 text-center shadow-[0_0_28px_rgba(255,190,80,0.22)] backdrop-blur transition-colors hover:border-amber hover:bg-black disabled:opacity-70"
      >
        <div className="flex items-center justify-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-amber/55 bg-amber/[0.12] text-amber">
            {uploadReceipt.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          </span>
          <span className="min-w-0">
            <span className="block font-display text-[18px] font-extrabold uppercase tracking-[0.08em] text-white">
              Gas Receipt Upload
            </span>
            <span className="mt-1 flex items-center justify-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-amber/80">
              {lastResult ? <CheckCircle2 className="h-3 w-3" /> : <ReceiptText className="h-3 w-3" />}
              {lastResult ? `Logged ${lastResult}` : "Tap camera · row 16"}
            </span>
          </span>
        </div>
      </motion.button>
    </div>
  );
}

export default function CommandCenter({
  orders,
  state,
  selectedDate,
  onSelectedDateChange,
  pickupCount,
  deliveryCount,
  onSelectOrder,
  onOrderCreated,
  isLoading,
}: Props) {
  const leaderboard = useLeaderboardToggle();
  const [quickOrderOpen, setQuickOrderOpen] = React.useState(false);

  const handleSelect = (order: GameOrder) => {
    sounds.press();
    haptics.tap();
    onSelectOrder(order);
  };

  const rank = getRank(state.missionsCompleted);

  if (leaderboard.open) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          transition={{ duration: 0.25 }}
        >
          <TerritoryLeaderboard onBack={leaderboard.hide} />
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-void relative overflow-hidden"
    >
      <div className="heartbeat-bar w-full" />

      <div
        className="absolute inset-x-0 top-0 h-[340px] pointer-events-none opacity-[0.18]"
        style={{
          backgroundImage: `url(${HERO_CITYSCAPE})`,
          backgroundSize: "cover",
          backgroundPosition: "center top",
          maskImage:
            "linear-gradient(180deg, black 0%, black 45%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(180deg, black 0%, black 45%, transparent 100%)",
        }}
      />
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
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                onClick={() => {
                  sounds.press();
                  haptics.tap();
                  setQuickOrderOpen(true);
                }}
                className="h-9 w-9 border border-neon/35 bg-neon/[0.08] text-neon hover:border-neon/60 hover:bg-neon/[0.14] transition-colors flex items-center justify-center"
                aria-label="Create new order"
              >
                <Plus className="w-4 h-4" />
              </button>
              <Shield className="w-3.5 h-3.5 text-neon/60" />
              <span className="text-[8px] tracking-[0.2em] text-neon/60 uppercase">
                {rank.name}
              </span>
            </div>
          </div>
          <div className="mt-3 h-px bg-gradient-to-r from-neon/50 via-neon/20 to-transparent" />
        </motion.div>

        <ScheduleDateSelector
          selectedDate={selectedDate}
          onSelectedDateChange={onSelectedDateChange}
          pickupCount={pickupCount}
          deliveryCount={deliveryCount}
        />

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

        {/* Operations Board button */}
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          onClick={() => {
            sounds.press();
            haptics.tap();
            leaderboard.show();
          }}
          className="w-full mb-6 border border-neon/20 hover:border-neon/50 bg-neon/[0.03]
                     py-3 flex items-center justify-center gap-2.5
                     transition-all duration-200 active:bg-neon/[0.06] group"
        >
          <Trophy className="w-4 h-4 text-neon/60 group-hover:text-neon transition-colors" />
          <span className="font-display font-bold text-[11px] uppercase tracking-[0.25em] text-neon/70 group-hover:text-neon transition-colors">
            Operations Board
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-neon/30 group-hover:text-neon/60 transition-colors" />
        </motion.button>

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
                className="w-full text-left border-2 border-yellow-200 bg-yellow-300 text-black
                           shadow-[0_0_22px_rgba(250,204,21,0.34)] transition-all duration-200
                           active:scale-[0.99] active:bg-yellow-200 group relative overflow-hidden"
              >
                <div
                  className="absolute inset-y-0 right-0 w-14 bg-black/10 opacity-80
                             group-hover:bg-black/15 transition-colors"
                />

                <div className="p-4 relative">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-black/65" />
                        <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-black/75">
                          {order.timeWindow}
                        </span>
                      </div>
                      <span
                        className={`text-[9px] tracking-[0.15em] uppercase px-2 py-1 font-black border ${
                          order.type === "PICKUP"
                            ? "bg-black text-yellow-300 border-black"
                            : "bg-white text-black border-black/25"
                        }`}
                      >
                        {order.type}
                      </span>
                    </div>
                    <ChevronRight className="w-6 h-6 text-black/75 group-hover:text-black transition-colors" />
                  </div>

                  <p className="font-display text-[24px] font-black leading-none text-black mb-2 uppercase tracking-wide break-words">
                    {order.customerName}
                  </p>
                  {order.buildingName ? (
                    <div className="flex items-center gap-1.5 mb-2">
                      <Building2 className="w-3.5 h-3.5 text-black/70 shrink-0" />
                      <p className="text-[10px] tracking-[0.18em] text-black/75 uppercase font-black truncate">
                        {order.buildingName}
                      </p>
                    </div>
                  ) : null}
                  <div className="flex items-start gap-1.5">
                    <MapPin className="w-4 h-4 text-black/70 mt-0.5 shrink-0" />
                    <p className="text-[13px] font-bold text-black/80 leading-tight">
                      {order.address}
                      {order.unit ? ` · Unit ${order.unit}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-black/20">
                    <div className="flex items-center gap-1.5">
                      <Package className="w-3.5 h-3.5 text-black/65" />
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-black/70">
                        {order.items} {order.items === 1 ? "bag" : "bags"}
                      </span>
                    </div>
                    <span className="font-display text-[13px] font-black text-black tracking-wider uppercase">
                      {order.dateLabel}
                    </span>
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>
      <QuickNewOrderSheet
        open={quickOrderOpen}
        onOpenChange={setQuickOrderOpen}
        onOrderCreated={onOrderCreated}
      />
      <DriverReceiptUpload />
    </motion.div>
  );
}
