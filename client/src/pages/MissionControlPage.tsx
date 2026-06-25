import { useState } from "react";
import {
  Compass, Copy, ExternalLink, Expand, FileText, Loader2, Mail, MapPin, MessageSquare, Phone,
  Reply, Send, ShieldCheck, Sparkles, Star, Wrench,
} from "lucide-react";
import { trpc } from "@/lib/trpc";

const CATEGORY_OPTIONS = [
  "dog_grooming", "laundry", "dry_cleaning", "car_detail",
  "airport_transport", "apartment_cleaning", "guest_readiness", "haircut", "handyman", "other",
] as const;

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

function evidenceField(evidence: unknown, key: string): string | number | null {
  if (typeof evidence !== "object" || evidence === null) return null;
  const value = (evidence as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function planSourceLabel(source: string, fallbackReason: string | null): string {
  if (source === "anthropic_structured") return "AI structured parser";
  if (fallbackReason === "needs_provider_config") return "Provider config needed";
  if (fallbackReason === "invalid_output") return "Invalid parser output fallback";
  return "Deterministic fallback";
}

function serviceModeBadge(evidence: unknown): string {
  const mode = evidenceField(evidence, "serviceMode");
  if (mode === "mobile_required" || mode === "building_service_required") return "Mobile intent";
  if (mode === "storefront_ok") return "Storefront intent";
  return "Needs review";
}

type RankableCandidate = { evidence: unknown };

function rankCandidates<T extends RankableCandidate>(candidates: T[], currentServiceMode: string | null | undefined): T[] {
  return [...candidates].sort((a, b) => {
    const aMatches = currentServiceMode && evidenceField(a.evidence, "serviceMode") === currentServiceMode ? 1 : 0;
    const bMatches = currentServiceMode && evidenceField(b.evidence, "serviceMode") === currentServiceMode ? 1 : 0;
    if (aMatches !== bMatches) return bMatches - aMatches;

    const aRating = Number(evidenceField(a.evidence, "rating") ?? 0);
    const bRating = Number(evidenceField(b.evidence, "rating") ?? 0);
    if (aRating !== bRating) return bRating - aRating;

    const aReviews = Number(evidenceField(a.evidence, "reviewCount") ?? 0);
    const bReviews = Number(evidenceField(b.evidence, "reviewCount") ?? 0);
    if (aReviews !== bReviews) return bReviews - aReviews;

    const aPhone = evidenceField(a.evidence, "phone") ? 1 : 0;
    const bPhone = evidenceField(b.evidence, "phone") ? 1 : 0;
    if (aPhone !== bPhone) return bPhone - aPhone;

    const aWebsite = evidenceField(a.evidence, "website") ? 1 : 0;
    const bWebsite = evidenceField(b.evidence, "website") ? 1 : 0;
    return bWebsite - aWebsite;
  });
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

const CHANNEL_DISPLAY: Record<string, { label: string; icon: typeof Mail }> = {
  email: { label: "Email", icon: Mail },
  sms_if_allowed: { label: "SMS", icon: MessageSquare },
  website_form: { label: "Web Form", icon: FileText },
  call: { label: "Phone / Voice", icon: Phone },
  voicemail: { label: "Phone / Voice", icon: Phone },
  second_call_if_urgent: { label: "Phone / Voice", icon: Phone },
};

const CHANNEL_ICON_LEGEND = [
  { label: "Email", icon: Mail, comingSoon: false },
  { label: "SMS", icon: MessageSquare, comingSoon: false },
  { label: "Yelp", icon: Star, comingSoon: false },
  { label: "Web Form", icon: FileText, comingSoon: false },
  { label: "Phone / Voice", icon: Phone, comingSoon: true },
  { label: "Reply", icon: Reply, comingSoon: false },
] as const;

const TRAINING_CHIPS = ["Tone: Luxury & Warm", "Focus: Availability", "Qualify: Pricing", "Objection: Busy"] as const;

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

  const recentAttempts = trpc.admin.vendorCastingSprint.recentContactAttempts.useQuery({ limit: 10 });
  const discoveredCandidates = trpc.admin.vendorAcquisitionMission.listDiscoveredCandidates.useQuery({ category, limit: 50 });
  const runDiscovery = trpc.admin.vendorAcquisitionMission.runDiscovery.useMutation();

  const ratingThreshold = Number(minRating);
  const queryPlanPreview = trpc.admin.vendorAcquisitionMission.previewQueryPlan.useQuery({
    missionText: composerNote,
    category,
    geographyLabel: `${zipCode} (${radiusMiles} mi radius)`,
    ratingThreshold: Number.isFinite(ratingThreshold) && ratingThreshold > 0 ? ratingThreshold : null,
    targetQuantity: Math.max(1, Math.trunc(Number(targetQuantity) || 1)),
  });

  // Set immediately from the createMission response so Run Discovery
  // enables right away -- it does not wait on the recentMissions refetch
  // round-trip, which is what left the button stuck disabled after
  // Start Mission succeeded.
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const effectiveMissionId = activeMissionId ?? latestMission?.id ?? null;

  const [trainingDraft, setTrainingDraft] = useState("");
  const [savedTrainingRules, setSavedTrainingRules] = useState<string[]>([]);

  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);
  const [draftQueueStatus, setDraftQueueStatus] = useState<Record<string, "queued" | "already_queued">>({});
  const approveDraftOutreach = trpc.admin.vendorAcquisitionMission.approveCandidateForDraftOutreach.useMutation();

  function approveDraft(candidateId: string) {
    approveDraftOutreach.mutate({ candidateId }, {
      onSuccess: result => {
        if (result.status === "ok") {
          setDraftQueueStatus(prev => ({ ...prev, [candidateId]: result.alreadyQueued ? "already_queued" : "queued" }));
        }
      },
    });
  }

  function copyCandidateDetails(candidate: { businessName: string; evidence: unknown }) {
    const rating = evidenceField(candidate.evidence, "rating");
    const reviewCount = evidenceField(candidate.evidence, "reviewCount");
    const address = evidenceField(candidate.evidence, "address");
    const phone = evidenceField(candidate.evidence, "phone");
    const website = evidenceField(candidate.evidence, "website");
    const lines = [
      candidate.businessName,
      rating !== null ? `Rating: ${rating}` : null,
      reviewCount !== null ? `Reviews: ${reviewCount}` : null,
      address !== null ? `Address: ${address}` : null,
      phone !== null ? `Phone: ${phone}` : null,
      website !== null ? `Website: ${website}` : null,
      "Not contacted. No outreach sent.",
    ].filter((line): line is string => line !== null);
    navigator.clipboard?.writeText(lines.join("\n"));
  }

  function startMission() {
    const rating = Number(minRating);
    createMission.mutate({
      category,
      geographyLabel: `${zipCode} (${radiusMiles} mi radius)`,
      targetQuantity: Math.max(1, Math.trunc(Number(targetQuantity) || 1)),
      qualityGates: Number.isFinite(rating) && rating > 0
        ? { minGoogleRating: rating, minYelpRating: rating, missionText: composerNote }
        : { requireVerifiedContact: true, missionText: composerNote },
      outreachMode: "draft_only",
      activateImmediately: true,
    }, {
      onSuccess: data => {
        if (data.allowed && data.missionId) setActiveMissionId(data.missionId);
        recentMissions.refetch();
      },
    });
  }

  function startDiscovery() {
    if (effectiveMissionId) runDiscovery.mutate({ missionId: effectiveMissionId }, { onSuccess: () => discoveredCandidates.refetch() });
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
          HELD turns your mission into a source query plan. Structured chips are safety constraints.
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

        {queryPlanPreview.data ? (
          <details className="mt-3 rounded-lg border border-black/10 bg-black/[0.02] p-2 text-xs">
            <summary className="cursor-pointer font-semibold text-black/55">
              Query Plan &middot; {label(queryPlanPreview.data.serviceMode)}
            </summary>
            <p className="mt-1 text-black/55">Location: {queryPlanPreview.data.locationText}</p>
            <p className="mt-1 text-black/55">
              Generated queries: {queryPlanPreview.data.searchQueries.join(" · ")}
            </p>
            {queryPlanPreview.data.notes.length > 0 ? (
              <p className="mt-1 text-black/40">{queryPlanPreview.data.notes.join(" ")}</p>
            ) : null}
          </details>
        ) : null}

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
                  This is a real, persisted sourcing target. Google Places discovery is available. Run discovery to
                  find real candidates. No outreach will be sent.
                </p>
                <button
                  type="button"
                  className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  disabled={!effectiveMissionId || runDiscovery.isPending}
                  onClick={startDiscovery}
                >
                  {runDiscovery.isPending ? "Running discovery…" : "Run discovery"}
                </button>
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Sub-Agent Orchestra</h2>
          <button
            type="button"
            className={
              effectiveMissionId
                ? "rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-40"
                : "rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-black/35 disabled:opacity-40"
            }
            disabled={!effectiveMissionId || runDiscovery.isPending}
            onClick={startDiscovery}
          >
            {runDiscovery.isPending ? "Running discovery…" : "Run discovery"}
          </button>
        </div>
        {latestMission ? (
          <p className="mt-1 text-xs text-black/55">
            Latest mission &middot; {label(latestMission.category)} &middot; {latestMission.geographyLabel} &middot; target {latestMission.targetQuantity}
          </p>
        ) : activeMissionId ? (
          <p className="mt-1 text-xs text-black/55">
            Mission active &middot; id <span className="font-mono">{activeMissionId}</span> &middot; discovery ready.
          </p>
        ) : (
          <p className="mt-1 text-xs text-black/50">No mission launched yet.</p>
        )}

        {runDiscovery.isError ? (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            Discovery request failed: {runDiscovery.error?.message ?? "Unknown error"}
          </div>
        ) : runDiscovery.data ? (
          <div className="mt-2 rounded-lg border border-black/10 bg-black/[0.02] p-3 text-xs">
            {runDiscovery.data.status === "needs_provider_config" ? (
              <p className="font-semibold text-amber-800">
                Map Scout needs a Google Places API key configured (missing env var: {runDiscovery.data.missingEnvVar}). No candidates were found.
              </p>
            ) : runDiscovery.data.status === "provider_error" ? (
              <p className="font-semibold text-red-700">Discovery failed: {runDiscovery.data.reason}</p>
            ) : runDiscovery.data.status === "mission_not_found" ? (
              <p className="text-black/55">Mission not found.</p>
            ) : runDiscovery.data.foundCount === 0 ? (
              <>
                <p className="text-black/55">No candidates found for this mission.</p>
                <p className="mt-1 text-black/40">
                  Plan source: {planSourceLabel(runDiscovery.data.queryPlannerSource, runDiscovery.data.queryPlannerFallbackReason)}
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold">
                  Found {runDiscovery.data.foundCount} &middot; persisted {runDiscovery.data.persistedCount} &middot; already discovered {runDiscovery.data.alreadyDiscoveredCount}
                  &middot; see Discovered Candidates below for details.
                </p>
                <p className="mt-1 text-black/40">
                  Plan source: {planSourceLabel(runDiscovery.data.queryPlannerSource, runDiscovery.data.queryPlannerFallbackReason)}
                </p>
              </>
            )}
          </div>
        ) : null}

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
                    {effectiveMissionId ? agent.statusWithMission : "Waiting for mission"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold">Discovered Candidates</h2>
        <p className="mt-1 text-xs text-black/55">Review real candidates found by HELD before approving outreach.</p>

        {discoveredCandidates.isLoading ? (
          <p className="mt-3 text-xs text-black/50">Loading candidates&hellip;</p>
        ) : discoveredCandidates.data && discoveredCandidates.data.length > 0 ? (
          <div className="mt-3 space-y-2">
            {rankCandidates(discoveredCandidates.data, queryPlanPreview.data?.serviceMode).map(candidate => {
              const rating = evidenceField(candidate.evidence, "rating");
              const reviewCount = evidenceField(candidate.evidence, "reviewCount");
              const address = evidenceField(candidate.evidence, "address") ?? candidate.publicProfile?.address;
              const phone = evidenceField(candidate.evidence, "phone");
              const website = evidenceField(candidate.evidence, "website");
              const sourceUrl = evidenceField(candidate.evidence, "sourceUrl");
              const matchedQuery = evidenceField(candidate.evidence, "matchedQuery");
              const queryPlannerSource = evidenceField(candidate.evidence, "queryPlannerSource");
              const expanded = expandedCandidateId === candidate.id;
              return (
                <div key={candidate.id} className="rounded-lg border border-black/10 p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{candidate.businessName}</p>
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">Google Places</span>
                    <span className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-semibold text-black/55">{label(candidate.sourcingStatus)}</span>
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{serviceModeBadge(candidate.evidence)}</span>
                    {rating !== null ? <span className="text-black/55">{rating}&#9733;{reviewCount !== null ? ` (${reviewCount} reviews)` : ""}</span> : null}
                  </div>
                  {typeof address === "string" ? <p className="mt-1 text-black/55">{address}</p> : null}
                  {typeof matchedQuery === "string" ? <p className="mt-1 text-black/40">Found via: {matchedQuery}</p> : null}
                  {typeof queryPlannerSource === "string" ? (
                    <p className="mt-1 text-black/40">Plan source: {planSourceLabel(queryPlannerSource, null)}</p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-3 text-black/45">
                    {typeof phone === "string" ? <span>{phone}</span> : null}
                    {typeof website === "string" ? <span>{website}</span> : null}
                  </div>
                  <p className="mt-1 font-semibold text-emerald-700">Not contacted &middot; No outreach sent</p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-black/15 px-2 py-1 text-xs font-semibold"
                      onClick={() => setExpandedCandidateId(expanded ? null : candidate.id)}
                    >
                      {expanded ? "Hide review" : "Review"}
                    </button>
                    {typeof sourceUrl === "string" ? (
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 rounded-lg border border-black/15 px-2 py-1 text-xs font-semibold"
                      >
                        <ExternalLink className="h-3 w-3" /> Open source
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded-lg border border-black/15 px-2 py-1 text-xs font-semibold"
                      onClick={() => copyCandidateDetails(candidate)}
                    >
                      <Copy className="h-3 w-3" /> Copy details
                    </button>
                    {draftQueueStatus[candidate.id] ? (
                      <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
                        {draftQueueStatus[candidate.id] === "already_queued" ? "Draft already queued" : "Draft queued"} &middot; No outreach sent
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={approveDraftOutreach.isPending}
                        title="Creates a draft-only, no-send contact record. Nothing is sent to this vendor."
                        className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 disabled:opacity-40"
                        onClick={() => approveDraft(candidate.id)}
                      >
                        {approveDraftOutreach.isPending ? "Queueing draft…" : "Approve for draft outreach"}
                      </button>
                    )}
                  </div>
                  {serviceModeBadge(candidate.evidence) === "Needs review" ? (
                    <p className="mt-1 text-[11px] text-amber-700">Review mobile fit before outreach.</p>
                  ) : null}

                  {expanded ? (
                    <div className="mt-2 rounded-lg border border-black/10 bg-black/[0.02] p-2 text-[11px] text-black/55">
                      <p>Source type: {candidate.sourceType} &middot; Source reference: {candidate.sourceReference}</p>
                      <p>Created: {new Date(candidate.createdAt).toLocaleString()}</p>
                      <p className="mt-1">Evidence summary: {JSON.stringify(candidate.evidence)}</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-xs text-black/50">No candidates discovered yet. Run discovery to populate this list.</p>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold">Sent Messages</h2>
        <p className="mt-1 text-xs text-black/55">Agent activity feed.</p>

        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-black/45">
          {CHANNEL_ICON_LEGEND.map(channel => {
            const Icon = channel.icon;
            return (
              <span key={channel.label} className="flex items-center gap-1">
                <Icon className="h-3 w-3" /> {channel.label}
                {channel.comingSoon ? <span className="font-semibold text-amber-700">&nbsp;&middot; Coming soon</span> : null}
              </span>
            );
          })}
        </div>

        {recentAttempts.isLoading ? (
          <p className="mt-3 text-xs text-black/50">Loading activity&hellip;</p>
        ) : recentAttempts.data && recentAttempts.data.attempts.length > 0 ? (
          <div className="mt-3 space-y-2">
            {recentAttempts.data.attempts.map(attempt => {
              const channel = CHANNEL_DISPLAY[attempt.channel] ?? { label: label(attempt.channel), icon: Mail };
              const Icon = channel.icon;
              return (
                <div key={attempt.attemptId} className="rounded-lg border border-black/10 p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-black/45" />
                    <span className="font-semibold">{channel.label}</span>
                    <span className="text-black/40">&middot;</span>
                    <span className="text-black/55">{label(attempt.automationMode)}</span>
                    <span className="ml-auto text-black/40">{new Date(attempt.updatedAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-black/60">Status: {label(attempt.status)}</p>
                  <p className="mt-1 text-[11px] text-black/40">
                    provider_responded: {String(attempt.providerResponded)} &middot; provider_accepted: false &middot; booking/payment/dispatch: false
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-xs text-black/50">No outbound attempts yet. Launch a mission and approve outreach to begin.</p>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold">Sub-Agent Training</h2>
        <p className="mt-1 text-xs text-black/55">Teach HELD how to communicate and qualify.</p>
        <p className="mt-1 text-xs font-semibold text-amber-700">
          This is human guidance for message drafting, not model training. Local guidance draft &mdash; persistence comes next.
        </p>

        <textarea
          className="mt-3 w-full resize-none rounded-xl border border-black/10 bg-black/[0.02] p-3 text-sm outline-none"
          rows={2}
          placeholder="Instead of this message, send something like…"
          value={trainingDraft}
          onChange={event => setTrainingDraft(event.target.value)}
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {TRAINING_CHIPS.map(chip => (
            <button
              key={chip}
              type="button"
              className="rounded-full border border-black/15 px-3 py-1 text-xs font-semibold text-black/65"
              onClick={() => setTrainingDraft(value => (value ? `${value} ${chip}` : chip))}
            >
              {chip}
            </button>
          ))}
          <button
            type="button"
            className="rounded-full bg-black px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
            disabled={!trainingDraft.trim()}
            onClick={() => {
              setSavedTrainingRules(rules => [...rules, trainingDraft.trim()]);
              setTrainingDraft("");
            }}
          >
            Add rule
          </button>
        </div>

        {savedTrainingRules.length > 0 ? (
          <div className="mt-3 space-y-1">
            <p className="text-xs font-bold uppercase tracking-wide text-black/45">Unsaved guidance (this session only)</p>
            {savedTrainingRules.map((rule, index) => (
              <p key={index} className="rounded-lg border border-black/10 bg-black/[0.02] p-2 text-xs text-black/65">{rule}</p>
            ))}
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
