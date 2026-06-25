import { useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";

const CATEGORY_OPTIONS = [
  "dog_grooming", "laundry", "dry_cleaning", "car_detail",
  "airport_transport", "apartment_cleaning", "guest_readiness", "haircut", "handyman", "other",
] as const;

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

export default function MissionControlPage() {
  const [category, setCategory] = useState<(typeof CATEGORY_OPTIONS)[number]>("dog_grooming");
  const [zipCode, setZipCode] = useState("90027");
  const [radiusMiles, setRadiusMiles] = useState("5");
  const [minRating, setMinRating] = useState("4.7");
  const [targetQuantity, setTargetQuantity] = useState("10");
  const [mobilePreferred, setMobilePreferred] = useState(true);
  const [composerNote, setComposerNote] = useState(
    "Find me 10 dog groomers near 90027 with 4.7 or higher ratings on Yelp and/or Google Maps.",
  );

  const createMission = trpc.admin.vendorAcquisitionMission.createMission.useMutation();
  const recentMissions = trpc.admin.vendorAcquisitionMission.listMissions.useQuery({ limit: 10 });

  function startMission() {
    const rating = Number(minRating);
    createMission.mutate({
      category,
      geographyLabel: `${zipCode} (${radiusMiles} mi radius)`,
      targetQuantity: Math.max(1, Math.trunc(Number(targetQuantity) || 1)),
      qualityGates: Number.isFinite(rating) && rating > 0
        ? { minGoogleRating: rating, minYelpRating: rating }
        : { requireVerifiedContact: true },
      outreachMode: "draft_only",
      activateImmediately: true,
    }, { onSuccess: () => recentMissions.refetch() });
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Mission Control</h1>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Live</span>
          </div>
          <p className="mt-1 text-sm text-black/55">Autonomous vendor casting. Human-aligned outcomes.</p>
        </div>
      </div>

      <section className="mt-6 rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-600" />
          <h2 className="text-sm font-bold">Mission Composer</h2>
          <span className="ml-auto text-xs text-black/45">Describe what you&rsquo;re looking for. HELD does the rest.</span>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-xl border border-black/10 bg-black/[0.02] p-3">
          <textarea
            className="flex-1 resize-none border-none bg-transparent text-sm outline-none"
            rows={2}
            value={composerNote}
            onChange={event => setComposerNote(event.target.value)}
          />
          <button
            className="rounded-full bg-amber-600 p-2 text-white disabled:opacity-40"
            disabled={createMission.isPending}
            onClick={startMission}
            type="button"
            aria-label="Start mission"
          >
            {createMission.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-1 text-xs text-black/40">
          HELD uses the structured filters below to create this mission in this version &mdash; the note above is for your reference only.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className="rounded-full border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold" value={category} onChange={event => setCategory(event.target.value as typeof category)}>
            {CATEGORY_OPTIONS.map(option => <option key={option} value={option}>{label(option)}</option>)}
          </select>
          <input className="w-28 rounded-full border border-black/15 px-3 py-1.5 text-xs font-semibold" placeholder="ZIP code" value={zipCode} onChange={event => setZipCode(event.target.value)} />
          <input className="w-24 rounded-full border border-black/15 px-3 py-1.5 text-xs font-semibold" placeholder="Rating 4.7+" value={minRating} onChange={event => setMinRating(event.target.value)} />
          <input className="w-28 rounded-full border border-black/15 px-3 py-1.5 text-xs font-semibold" placeholder="Radius (mi)" value={radiusMiles} onChange={event => setRadiusMiles(event.target.value)} />
          <input className="w-24 rounded-full border border-black/15 px-3 py-1.5 text-xs font-semibold" placeholder="Quantity" value={targetQuantity} onChange={event => setTargetQuantity(event.target.value)} />
          <button
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${mobilePreferred ? "border-amber-300 bg-amber-50 text-amber-800" : "border-black/15 text-black/55"}`}
            onClick={() => setMobilePreferred(value => !value)}
            type="button"
          >
            {mobilePreferred ? "✓ " : ""}Mobile preferred
          </button>
        </div>
        <p className="mt-1 text-xs text-black/35">
          &ldquo;Mobile preferred&rdquo; is not yet wired to mission criteria &mdash; reserved for a future slice.
        </p>

        <button
          className="mt-4 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          disabled={createMission.isPending}
          onClick={startMission}
          type="button"
        >
          {createMission.isPending ? "Starting mission…" : "Start Mission"}
        </button>

        {createMission.data ? (
          <div className={`mt-3 rounded-lg border p-3 text-xs ${createMission.data.allowed ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            {createMission.data.allowed ? (
              <>
                <p className="font-semibold">
                  Mission {createMission.data.status === "active" ? "active" : "draft ready"} &middot; id <span className="font-mono">{createMission.data.missionId}</span>
                </p>
                <p className="mt-1">
                  This is a real, persisted sourcing target. No discovery agent has run yet &mdash; Google/Yelp source
                  connectors are not implemented in this slice, so no candidates have been found and no outreach has
                  been drafted or sent.
                </p>
              </>
            ) : (
              <p>Mission blocked: {createMission.data.reasons.map(label).join(" · ")}</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="mt-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold">Recent missions</h2>
        {recentMissions.isLoading ? (
          <p className="mt-2 text-xs text-black/50">Loading missions&hellip;</p>
        ) : recentMissions.data && recentMissions.data.length > 0 ? (
          <div className="mt-2 space-y-2">
            {recentMissions.data.map(mission => (
              <div key={mission.id} className="rounded-lg border border-black/10 p-2 text-xs">
                <p className="font-mono text-black/45">{mission.id}</p>
                <p>
                  <span className="font-semibold">{label(mission.status)}</span> &middot; {label(mission.category)} &middot; {mission.geographyLabel} &middot; target {mission.targetQuantity}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-black/50">No missions yet. Launch one above to begin.</p>
        )}
      </section>
    </div>
  );
}
