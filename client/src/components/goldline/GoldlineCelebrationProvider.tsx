import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Link } from "wouter";
import { celebrationForEvent, type CelebrationDescriptor, type GoldlineWorldEvent } from "@shared/goldlineWorld";
import { useAuth } from "@/_core/hooks/useAuth";
import { getAudioManager, type AudioCueId } from "@/game/audio/AudioManager";
import { authoritativeMutationFeedback, businessVictoryFeedback } from "@/game/audio/haptics";
import { trpc } from "@/lib/trpc";

type CelebrationContextValue = {
  celebrate: (event: GoldlineWorldEvent) => void;
};

const CelebrationContext = React.createContext<CelebrationContextValue | null>(null);
const cueMap: Record<CelebrationDescriptor["cue"], AudioCueId> = {
  field_intel: "captured_truth",
  call: "action_ready",
  follow_up: "signal_lock",
  visit: "mutation_path_open",
  proposal: "gate_unlock",
  recovery: "signal_lock",
  tower: "scout_discovery",
  outcome: "victory_flag",
  territory: "victory_flag",
};

const colors = ["#fde047", "#f0abfc", "#67e8f9", "#ffffff", "#fb7185"];

function CelebrationStage({ descriptor }: { descriptor: CelebrationDescriptor }) {
  const reducedMotion = useReducedMotion();
  const count = descriptor.magnitude === "detonation" ? 42 : descriptor.magnitude === "surge" ? 28 : 18;
  return (
    <motion.div
      data-testid="goldline-celebration"
      className="pointer-events-none fixed inset-0 z-[250] grid place-items-center overflow-hidden"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      aria-live="assertive" aria-atomic="true"
    >
      <motion.div
        className="absolute inset-0 bg-[radial-gradient(circle,rgba(250,204,21,.26),rgba(15,23,42,.16)_38%,transparent_68%)]"
        initial={{ opacity: 0 }} animate={{ opacity: [0, 1, .35] }} transition={{ duration: reducedMotion ? .15 : 1.1 }}
      />
      {!reducedMotion ? Array.from({ length: count }, (_, index) => {
        const angle = (index / count) * Math.PI * 2;
        const distance = 110 + (index % 7) * 34;
        return <motion.i key={index} aria-hidden="true" className="absolute left-1/2 top-1/2 h-2.5 w-2.5 rounded-full shadow-[0_0_14px_currentColor]"
          style={{ color: colors[index % colors.length], backgroundColor: "currentColor" }}
          initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
          animate={{ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, scale: [0, 1.4, 0], opacity: [0, 1, 0] }}
          transition={{ duration: 1.45, delay: (index % 5) * .035, ease: "easeOut" }} />;
      }) : null}
      <motion.div
        className="relative mx-5 rounded-[26px] border border-amber-300/70 bg-[#fff8dc]/96 px-7 py-6 text-center text-[#17385e] shadow-[0_0_90px_rgba(250,204,21,.55)]"
        initial={{ scale: reducedMotion ? 1 : .72, y: reducedMotion ? 0 : 22 }} animate={{ scale: 1, y: 0 }}
        transition={{ type: reducedMotion ? "tween" : "spring", stiffness: 280, damping: 17 }}
      >
        <p className="text-[11px] font-black uppercase tracking-[.32em] text-[#9b6410]">Goldline Chronicle</p>
        <p className="mt-2 text-[clamp(25px,7vw,54px)] font-black tracking-[-.025em]">{descriptor.label}</p>
        {descriptor.cue === "tower" && descriptor.physicalEntityId ? <Link className="pointer-events-auto mt-4 inline-flex min-h-11 items-center rounded-full bg-amber-400 px-5 text-sm font-black text-[#17385e]" href={`/growth/lantern-city?entity=${descriptor.physicalEntityId}`}>Reveal it in Lantern City</Link> : null}
      </motion.div>
    </motion.div>
  );
}

export function GoldlineCelebrationProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [queue, setQueue] = React.useState<CelebrationDescriptor[]>([]);
  const seenRef = React.useRef(new Set<string>());
  const mark = trpc.system.goldlineWorld.markEvent.useMutation();
  const unread = trpc.system.goldlineWorld.unpresentedCelebrations.useQuery({ limit: 20 }, {
    enabled: isAuthenticated,
    retry: false,
    refetchInterval: 12_000,
    refetchOnWindowFocus: true,
  });

  const enqueue = React.useCallback((event: GoldlineWorldEvent) => {
    const descriptor = celebrationForEvent(event);
    if (!descriptor || seenRef.current.has(descriptor.eventId)) return;
    seenRef.current.add(descriptor.eventId);
    setQueue(current => [...current, descriptor]);
  }, []);

  React.useEffect(() => {
    for (const event of unread.data ?? []) enqueue(event as GoldlineWorldEvent);
  }, [enqueue, unread.data]);

  const current = queue[0] ?? null;
  React.useEffect(() => {
    if (!current) return;
    getAudioManager().playOnce(cueMap[current.cue], `world-event:${current.eventId}`);
    if (current.magnitude === "detonation") businessVictoryFeedback();
    else authoritativeMutationFeedback(current.eventId);
    mark.mutate({ worldEventId: current.eventId, receiptType: "presented" });
    const timer = window.setTimeout(() => setQueue(items => items.slice(1)), current.magnitude === "detonation" ? 2800 : 2200);
    return () => window.clearTimeout(timer);
  // The mutation object's identity is not part of the semantic event lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.eventId]);

  const value = React.useMemo(() => ({ celebrate: enqueue }), [enqueue]);
  return <CelebrationContext.Provider value={value}>
    {children}
    <AnimatePresence>{current ? <CelebrationStage key={current.eventId} descriptor={current} /> : null}</AnimatePresence>
  </CelebrationContext.Provider>;
}

export function useGoldlineCelebration() {
  const context = React.useContext(CelebrationContext);
  if (!context) throw new Error("useGoldlineCelebration must be used inside GoldlineCelebrationProvider");
  return context;
}
