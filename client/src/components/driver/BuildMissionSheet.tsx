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
            className="w-full max-w-[860px] max-h-[calc(100svh-24px)] overflow-y-auto rounded-[26px] border border-violet-200/40 bg-[#111827] text-white shadow-[0_28px_80px_rgba(15,23,42,.58)]"
            initial={{ y: 36, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 36, opacity: 0 }}
          >
            <div className="flex items-start justify-between border-b border-white/10 px-[clamp(22px,4vw,42px)] py-[clamp(22px,3.5vw,36px)]">
              <div>
                <p className="text-[clamp(13px,1.8vw,18px)] font-black uppercase tracking-[.2em] text-violet-300">
                  Sales mode
                </p>
                <h2 id="build-mission-title" className="mt-1 text-[clamp(32px,4.6vw,46px)] font-black leading-none tracking-[-.02em]">
                  {missionType ? "Pick a venue" : "Build a mission"}
                </h2>
                <p className="mt-3 text-[clamp(15px,2.1vw,21px)] font-medium text-white/60">
                  Searching near {searchNear}
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={build.isPending}
                className="flex h-[clamp(48px,6.5vw,66px)] w-[clamp(48px,6.5vw,66px)] shrink-0 items-center justify-center rounded-full bg-white/10 text-white active:bg-white/20 disabled:opacity-50"
                aria-label="Close mission builder"
              >
                <X className="h-[clamp(22px,3vw,30px)] w-[clamp(22px,3vw,30px)]" />
              </button>
            </div>

            <div className="p-[clamp(16px,3vw,30px)] pb-[calc(env(safe-area-inset-bottom)+clamp(20px,3vw,30px))]">
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
                    className="flex min-h-[clamp(112px,15vw,148px)] items-center gap-[clamp(16px,2.5vw,26px)] rounded-[20px] border border-fuchsia-300/35 bg-fuchsia-400/10 p-[clamp(18px,3vw,30px)] text-left active:bg-fuchsia-400/20"
                  >
                    <span className="flex h-[clamp(60px,8vw,80px)] w-[clamp(60px,8vw,80px)] shrink-0 items-center justify-center rounded-[18px] bg-fuchsia-300 text-[#30103d]">
                      <PhoneCall className="h-[clamp(30px,4vw,40px)] w-[clamp(30px,4vw,40px)]" />
                    </span>
                    <span>
                      <strong className="block text-[clamp(22px,3vw,31px)] font-black">Cold-call mission</strong>
                      <span className="mt-1 block text-[clamp(15px,2.1vw,21px)] leading-snug text-white/65">Only venues with a public phone number</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMissionType("in_person")}
                    className="flex min-h-[clamp(112px,15vw,148px)] items-center gap-[clamp(16px,2.5vw,26px)] rounded-[20px] border border-violet-300/35 bg-violet-400/10 p-[clamp(18px,3vw,30px)] text-left active:bg-violet-400/20"
                  >
                    <span className="flex h-[clamp(60px,8vw,80px)] w-[clamp(60px,8vw,80px)] shrink-0 items-center justify-center rounded-[18px] bg-violet-300 text-[#21133d]">
                      <Store className="h-[clamp(30px,4vw,40px)] w-[clamp(30px,4vw,40px)]" />
                    </span>
                    <span>
                      <strong className="block text-[clamp(22px,3vw,31px)] font-black">In-person mission</strong>
                      <span className="mt-1 block text-[clamp(15px,2.1vw,21px)] leading-snug text-white/65">Sales stops placed alongside today’s route</span>
                    </span>
                  </button>
                  <p className="px-2 pt-2 text-center text-[clamp(14px,1.9vw,19px)] font-semibold text-white/50">
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
                        className="flex min-h-[clamp(96px,12vw,120px)] items-center gap-[clamp(16px,2.5vw,26px)] rounded-[18px] border border-white/10 bg-white/[.065] p-[clamp(16px,2.5vw,24px)] text-left active:border-violet-300/50 active:bg-violet-400/15"
                      >
                        <span className="flex h-[clamp(54px,7vw,70px)] w-[clamp(54px,7vw,70px)] shrink-0 items-center justify-center rounded-[16px] bg-violet-300/15 text-violet-200">
                          <Icon className="h-[clamp(27px,3.5vw,35px)] w-[clamp(27px,3.5vw,35px)]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <strong className="block text-[clamp(20px,2.8vw,28px)] font-black">{venue.title}</strong>
                          <span className="mt-1 block text-[clamp(14px,2vw,20px)] leading-snug text-white/60">{venue.detail}</span>
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setMissionType(null)}
                    className="mt-1 min-h-[clamp(56px,7vw,70px)] rounded-[14px] border border-white/15 text-[clamp(16px,2.2vw,22px)] font-black text-white/75"
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
