import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Building2,
  Dumbbell,
  Hotel,
  Loader2,
  PhoneCall,
  Scissors,
  Store,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { haptics } from "./driverHaptics";
import { sounds } from "./driverSounds";

type MissionType = "cold_call" | "in_person";
type VenueType = "luxury_living" | "hotels" | "fitness_wellness" | "salons_spas";

const VENUES = [
  {
    value: "luxury_living" as const,
    title: "Luxury living",
    detail: "High-rises, apartment communities, property managers",
    icon: Building2,
  },
  { value: "hotels" as const, title: "Hotels", detail: "Luxury and boutique hotels", icon: Hotel },
  { value: "fitness_wellness" as const, title: "Fitness + wellness", detail: "Gyms, clubs, wellness centers", icon: Dumbbell },
  { value: "salons_spas" as const, title: "Salons + spas", detail: "Salons, day spas, med spas", icon: Scissors },
];

export function BuildMissionSheet({
  open,
  onOpenChange,
  searchNear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchNear: string;
}) {
  const utils = trpc.useUtils();
  const [missionType, setMissionType] = useState<MissionType | null>(null);
  const build = trpc.system.commercialMission.buildForDriver.useMutation();

  function close() {
    if (build.isPending) return;
    setMissionType(null);
    onOpenChange(false);
  }

  async function chooseVenue(venueType: VenueType) {
    if (!missionType) return;
    sounds.press();
    haptics.impact();
    try {
      const missions = await build.mutateAsync({
        missionType,
        venueType,
        searchNear,
        requestId: crypto.randomUUID(),
        count: 3,
      });
      await utils.system.commercialMission.myBuiltMissions.invalidate();
      sounds.missionAssign();
      haptics.slam();
      toast.success(
        `${missions.length} ${missionType === "cold_call" ? "cold-call" : "in-person"} ${missions.length === 1 ? "mission" : "missions"} added to your route.`
      );
      setMissionType(null);
      onOpenChange(false);
    } catch (error) {
      sounds.overrideFail();
      haptics.error();
      toast.error(error instanceof Error ? error.message : "Could not build missions.");
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[140] flex items-end bg-[#07101f]/70 p-3 backdrop-blur-sm sm:items-center sm:justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="build-mission-title"
            className="w-full overflow-hidden rounded-[24px] border border-violet-200/40 bg-[#111827] text-white shadow-[0_28px_80px_rgba(15,23,42,.48)] sm:max-w-lg"
            initial={{ y: 36, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 36, opacity: 0 }}
          >
            <div className="flex items-start justify-between border-b border-white/10 px-5 py-5">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[.2em] text-violet-300">
                  Sales mode
                </p>
                <h2 id="build-mission-title" className="mt-1 text-[28px] font-black leading-none">
                  {missionType ? "Pick a venue" : "Build a mission"}
                </h2>
                <p className="mt-2 text-[14px] text-white/55">
                  Searching near {searchNear}
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={build.isPending}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white active:bg-white/20 disabled:opacity-50"
                aria-label="Close mission builder"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+18px)]">
              {build.isPending ? (
                <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
                  <Loader2 className="h-10 w-10 animate-spin text-violet-300" />
                  <p className="mt-5 text-[22px] font-black">Building your route…</p>
                  <p className="mt-2 max-w-[300px] text-[15px] leading-relaxed text-white/55">
                    Finding new venues, removing duplicates, and assigning the best three to you.
                  </p>
                </div>
              ) : !missionType ? (
                <div className="grid gap-3">
                  <button
                    type="button"
                    onClick={() => setMissionType("cold_call")}
                    className="flex min-h-[104px] items-center gap-4 rounded-[18px] border border-fuchsia-300/35 bg-fuchsia-400/10 p-4 text-left active:bg-fuchsia-400/20"
                  >
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[16px] bg-fuchsia-300 text-[#30103d]">
                      <PhoneCall className="h-7 w-7" />
                    </span>
                    <span>
                      <strong className="block text-[20px] font-black">Cold-call mission</strong>
                      <span className="mt-1 block text-[14px] leading-snug text-white/60">Only venues with a public phone number</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMissionType("in_person")}
                    className="flex min-h-[104px] items-center gap-4 rounded-[18px] border border-violet-300/35 bg-violet-400/10 p-4 text-left active:bg-violet-400/20"
                  >
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[16px] bg-violet-300 text-[#21133d]">
                      <Store className="h-7 w-7" />
                    </span>
                    <span>
                      <strong className="block text-[20px] font-black">In-person mission</strong>
                      <span className="mt-1 block text-[14px] leading-snug text-white/60">Sales stops placed alongside today’s route</span>
                    </span>
                  </button>
                  <p className="px-2 pt-1 text-center text-[13px] font-semibold text-white/45">
                    Nothing is called or messaged automatically.
                  </p>
                </div>
              ) : (
                <div className="grid gap-2.5">
                  {VENUES.map(venue => {
                    const Icon = venue.icon;
                    return (
                      <button
                        key={venue.value}
                        type="button"
                        onClick={() => void chooseVenue(venue.value)}
                        className="flex min-h-[82px] items-center gap-4 rounded-[16px] border border-white/10 bg-white/[.055] p-3.5 text-left active:border-violet-300/50 active:bg-violet-400/15"
                      >
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-violet-300/15 text-violet-200">
                          <Icon className="h-6 w-6" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <strong className="block text-[17px] font-black">{venue.title}</strong>
                          <span className="mt-0.5 block text-[13px] leading-snug text-white/50">{venue.detail}</span>
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setMissionType(null)}
                    className="mt-1 min-h-12 rounded-[14px] border border-white/10 text-[14px] font-black text-white/65"
                  >
                    Back
                  </button>
                </div>
              )}
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
