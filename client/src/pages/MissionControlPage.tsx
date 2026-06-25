import { useState } from "react";
import { Compass, Expand, Loader2, MapPin, Send, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";

const CATEGORY_OPTIONS = [
  "dog_grooming", "laundry", "dry_cleaning", "car_detail",
  "airport_transport", "apartment_cleaning", "guest_readiness", "haircut", "handyman", "other",
] as const;

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

const GLOBAL_MARKET_PREVIEW_CITIES = ["London", "Dubai", "Singapore", "Paris", "Tokyo"] as const;
const US_MARKETS = [
  { name: "Los Angeles", active: true },
  { name: "NYC", active: false },
  { name: "Atlanta", active: false },
  { name: "Dallas", active: false },
  { name: "Chicago", active: false },
] as const;

const LA_BUILDINGS = [
  { id: "opus-la", name: "OPUS LA", zip: "90027" },
  { id: "century-park-east", name: "Century Park East", zip: "90067" },
] as const;

type SubAgent = { name: string; role: string; icon: typeof Compass; statusWithMission: string };
const SUB_AGENTS: SubAgent[] = [
  { name: "Map Scout", role: "Maps & Places", icon: Compass, statusWithMission: "Ready to inspect places" },
  { name: "Directory Digger", role: "Yelp & Directories", icon: MapPin, statusWithMission: "Waiting for provider keys" },
  { name: "Outreach Ace", role: "Messaging vendors", icon: Send, statusWithMission: "AgentMail ready, canary gated" },
  { name: "Reply Whisperer", role: "Replies & Follow-ups", icon: Sparkles, statusWithMission: "Webhook ready" },
  { name: "Verifier", role: "Quality & Trust", icon: ShieldCheck, statusWithMission: "Waiting for candidates" },
  { name: "Web Seeker", role: "Exploring sites", icon: Wrench, statusWithMission: "Not configured yet" },
];

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
  const [selectedBuildingId, setSelectedBuildingId] = useState<(typeof LA_BUILDINGS)[number]["id"]>("opus-la");
  const selectedBuilding = LA_BUILDINGS.find(building => building.id === selectedBuildingId) ?? LA_BUILDINGS[0];

  const createMission = trpc.admin.vendorAcquisitionMission.createMission.useMutation();
  const recentMissions = trpc.admin.vendorAcquisitionMission.listMissions.useQuery({ limit: 10 });
  const latestMission = recentMissions.data?.[0] ?? null;

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
        <div className="flex flex-wrap items-center gap-2">
          {GLOBAL_MARKET_PREVIEW_CITIES.map(city => (
            <button
              key={city}
              type="button"
              disabled
              title="Market preview — not live yet"
              className="rounded-full border border-black/10 bg-black/[0.03] px-3 py-1 text-xs font-semibold text-black/35 cursor-not-allowed"
            >
              {city}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {US_MARKETS.map(market => (
            <button
              key={market.name}
              type="button"
              disabled={!market.active}
              title={market.active ? undefined : "Preview — not active yet"}
              className={
                market.active
                  ? "rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800"
                  : "rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-black/35 cursor-not-allowed"
              }
            >
              {market.name}{!market.active ? " · Preview" : ""}
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[200px_1fr]">
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-black/45">Los Angeles</p>
            {LA_BUILDINGS.map(building => (
              <button
                key={building.id}
                type="button"
                onClick={() => setSelectedBuildingId(building.id)}
                className={`w-full rounded-lg border p-2 text-left text-xs ${
                  selectedBuildingId === building.id
                    ? "border-amber-300 bg-amber-50 font-semibold text-amber-900"
                    : "border-black/10 text-black/65"
                }`}
              >
                <p className="font-semibold">{building.name}</p>
                <p className="text-black/45">{building.zip}</p>
              </button>
            ))}
            <button type="button" disabled className="w-full rounded-lg border border-dashed border-black/15 p-2 text-left text-xs text-black/35 cursor-not-allowed">
              + Add Building
            </button>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-black/10 bg-gradient-to-br from-amber-50 via-white to-black/[0.03] p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-black/55">
                Map preview &middot; {selectedBuilding.zip}, Los Angeles, CA
              </p>
              <button
                type="button"
                disabled
                title="Expand map (preview — not yet interactive)"
                className="flex items-center gap-1 rounded-lg border border-black/15 px-2 py-1 text-xs font-semibold text-black/45 cursor-not-allowed"
              >
                <Expand className="h-3 w-3" /> Expand map
              </button>
            </div>
            <div className="relative mt-3 flex h-48 items-center justify-center rounded-lg border border-black/10 bg-[radial-gradient(circle_at_center,rgba(217,119,6,0.12),transparent_70%)]">
              <div className="absolute h-32 w-32 rounded-full border-2 border-dashed border-amber-300/70" />
              <div className="flex flex-col items-center gap-1">
                <MapPin className="h-6 w-6 text-amber-600" />
                <p className="text-xs font-semibold text-black/60">{selectedBuilding.name}</p>
              </div>
              <p className="absolute bottom-2 right-2 text-[10px] font-semibold uppercase tracking-wide text-black/30">
                Static map preview &mdash; no live map provider configured
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-black/55">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-600" /> Target Building</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full border border-amber-400" /> Search Radius</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-black/20" /> Discovered Vendors (none yet &mdash; preview)</span>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold">Sub-Agent Orchestra</h2>
        {latestMission ? (
          <p className="mt-1 text-xs text-black/55">
            Latest mission &middot; {label(latestMission.category)} &middot; {latestMission.geographyLabel} &middot; target {latestMission.targetQuantity}
          </p>
        ) : (
          <p className="mt-1 text-xs text-black/50">No mission launched yet.</p>
        )}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SUB_AGENTS.map(agent => {
            const Icon = agent.icon;
            return (
              <div key={agent.name} className="flex items-start gap-2 rounded-lg border border-black/10 p-3">
                <div className="rounded-full bg-amber-50 p-2">
                  <Icon className="h-4 w-4 text-amber-700" />
                </div>
                <div>
                  <p className="text-xs font-bold">{agent.name}</p>
                  <p className="text-xs text-black/45">{agent.role}</p>
                  <p className="mt-1 text-xs font-semibold text-black/60">
                    {latestMission ? agent.statusWithMission : "Waiting for mission"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
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
