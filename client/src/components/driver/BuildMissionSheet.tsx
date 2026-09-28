import { useDeferredValue, useEffect, useRef, useState } from "react";
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

// Mission builder production deploy marker: venue validation is live.
type MissionType = "cold_call" | "in_person";
type VenueType = "luxury_living" | "hotels" | "fitness_wellness" | "salons_spas";
type TargetMode = "exact_property" | "nearby_discovery";
type PlaceSuggestion = {
  placeId: string;
  name: string;
  address: string;
  text: string;
  types: string[];
};

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
  searchNear = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchNear?: string;
}) {
  const utils = trpc.useUtils();
  const [missionType, setMissionType] = useState<MissionType | null>(null);
  const [targetMode, setTargetMode] = useState<TargetMode>("exact_property");
  const [searchNearValue, setSearchNearValue] = useState(searchNear);
  const [selectedPlace, setSelectedPlace] = useState<PlaceSuggestion | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const build = trpc.system.commercialMission.buildForDriver.useMutation();
  const deferredSearch = useDeferredValue(searchNearValue.trim());
  const placeSuggestions = trpc.system.commercialMission.placeSuggestions.useQuery(
    { query: deferredSearch },
    {
      enabled:
        open &&
        !selectedPlace &&
        deferredSearch.length >= 2,
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    }
  );

  useEffect(() => {
    if (open) {
      setSearchNearValue(searchNear);
      setSelectedPlace(null);
    }
  }, [open, searchNear]);

  function close() {
    if (build.isPending) return;
    setMissionType(null);
    onOpenChange(false);
  }

  async function chooseVenue(venueType: VenueType) {
    if (!missionType) return;
    if (searchNearValue.trim().length < 5) {
      sounds.overrideFail();
      haptics.error();
      toast.error("Enter the property name or street address first.");
      searchInputRef.current?.focus();
      return;
    }
    sounds.press();
    haptics.impact();
    try {
      const missions = await build.mutateAsync({
        missionType,
        venueType,
        targetMode,
        searchNear: searchNearValue.trim(),
        ...(targetMode === "exact_property" && selectedPlace
          ? { placeId: selectedPlace.placeId }
          : {}),
        requestId: crypto.randomUUID(),
        count: targetMode === "exact_property" ? 1 : 3,
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
                  {targetMode === "exact_property"
                    ? "Create one mission for a specific property"
                    : "Discover prospects around a location"}
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
              <div
                className="mb-4 grid grid-cols-2 gap-2"
                role="group"
                aria-label="Mission target mode"
              >
                <button
                  type="button"
                  onClick={() => {
                    setTargetMode("exact_property");
                    setSelectedPlace(null);
                  }}
                  aria-pressed={targetMode === "exact_property"}
                  className={`min-h-[72px] rounded-[14px] border px-3 py-3 text-left text-[14px] font-black leading-tight ${
                    targetMode === "exact_property"
                      ? "border-violet-300 bg-violet-300/20 text-white"
                      : "border-white/15 bg-white/[.05] text-white/65"
                  }`}
                >
                  Create mission for this property
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTargetMode("nearby_discovery");
                    setSelectedPlace(null);
                  }}
                  aria-pressed={targetMode === "nearby_discovery"}
                  className={`min-h-[72px] rounded-[14px] border px-3 py-3 text-left text-[14px] font-black leading-tight ${
                    targetMode === "nearby_discovery"
                      ? "border-violet-300 bg-violet-300/20 text-white"
                      : "border-white/15 bg-white/[.05] text-white/65"
                  }`}
                >
                  Find prospects near this location
                </button>
              </div>
              <div className="mb-4">
                <label className="block">
                  <span className="mb-2 block text-[13px] font-black uppercase tracking-[.16em] text-white/55">
                    {targetMode === "exact_property" ? "Property" : "Search center"}
                  </span>
                  <input
                    ref={searchInputRef}
                    value={searchNearValue}
                    onChange={event => {
                      setSearchNearValue(event.target.value);
                      setSelectedPlace(null);
                    }}
                    placeholder={
                      targetMode === "exact_property"
                        ? "Start typing a property name or street address"
                        : "Address or neighborhood to search around"
                    }
                    disabled={build.isPending}
                    autoComplete="off"
                    className="w-full rounded-[14px] border border-white/15 bg-white/10 px-4 py-4 text-[17px] font-semibold text-white outline-none placeholder:text-white/35 focus:border-violet-300/60"
                    aria-label="Mission search location"
                    aria-autocomplete="list"
                    aria-expanded={
                      !selectedPlace && Boolean(placeSuggestions.data?.length)
                    }
                  />
                </label>

                {selectedPlace ? (
                  <div className="mt-2 rounded-[12px] border border-violet-300/35 bg-violet-300/10 px-4 py-3">
                    <div className="text-[15px] font-black text-white">
                      {selectedPlace.name}
                    </div>
                    {selectedPlace.address ? (
                      <div className="mt-1 text-[13px] font-semibold leading-snug text-white/60">
                        {selectedPlace.address}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {!selectedPlace && searchNearValue.trim().length >= 2 ? (
                  <div
                    className="mt-2 overflow-hidden rounded-[14px] border border-white/15 bg-[#182235] shadow-[0_18px_38px_rgba(0,0,0,.35)]"
                    role="listbox"
                    aria-label="Google Places property suggestions"
                  >
                    {placeSuggestions.isFetching ? (
                      <div className="flex items-center gap-2 px-4 py-3 text-[14px] font-semibold text-white/60">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Finding the property…
                      </div>
                    ) : placeSuggestions.isError ? (
                      <div className="px-4 py-3 text-[13px] font-semibold text-rose-200">
                        Google Places could not load suggestions. Keep typing or try again.
                      </div>
                    ) : placeSuggestions.data?.length ? (
                      <>
                        {(placeSuggestions.data as PlaceSuggestion[]).map(suggestion => (
                          <button
                            key={suggestion.placeId}
                            type="button"
                            role="option"
                            aria-selected="false"
                            onClick={() => {
                              setSelectedPlace(suggestion);
                              setSearchNearValue(
                                targetMode === "nearby_discovery"
                                  ? suggestion.address || suggestion.text
                                  : suggestion.text
                              );
                              sounds.press();
                              haptics.impact();
                            }}
                            className="block w-full border-b border-white/10 px-4 py-3 text-left last:border-b-0 active:bg-violet-300/15"
                          >
                            <span className="block text-[15px] font-black text-white">
                              {suggestion.name}
                            </span>
                            {suggestion.address ? (
                              <span className="mt-1 block text-[13px] font-semibold leading-snug text-white/55">
                                {suggestion.address}
                              </span>
                            ) : null}
                          </button>
                        ))}
                        <div className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-[.08em] text-white/35">
                          Powered by Google
                        </div>
                      </>
                    ) : deferredSearch.length >= 2 ? (
                      <div className="px-4 py-3 text-[13px] font-semibold text-white/45">
                        No Google Places matches yet. Keep typing.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {build.isPending ? (
                <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
                  <Loader2 className="h-10 w-10 animate-spin text-violet-300" />
                  <p className="mt-5 text-[22px] font-black">Building your route…</p>
                  <p className="mt-2 max-w-[300px] text-[15px] leading-relaxed text-white/55">
                    {targetMode === "exact_property"
                      ? "Resolving one exact property. If it cannot be identified, nothing nearby will be substituted."
                      : "Finding nearby prospects around the location you chose."}
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
