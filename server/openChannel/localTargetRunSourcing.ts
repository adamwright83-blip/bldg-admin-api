/**
 * LOCAL_TARGET_RUN sourcing (§PR77 Part 9-11, 16).
 *
 * Resolves an operator's real intent ("visit 10 dry cleaners") into real,
 * provider-sourced businesses. Reuses GooglePlacesTerritoryProvider's
 * generic geocode/searchBusinesses primitives directly — deliberately NOT
 * `discoverLaundryTerritory`/`scoreLaundryOpportunity`, which are
 * laundry-demand-specific (weekly pounds, likely orders, estimated annual
 * value) and have no meaning for a referral/exchange-partner objective like
 * this one. No second Google Places client either.
 *
 * GRACEFUL DEGRADATION (Adam's explicit rail): if the Places API key is
 * missing, the anchor is unavailable, or the live call fails for any
 * reason, this falls back to exactly ten hardcoded, clearly-labeled
 * synthetic targets (`shared/localTargetRun.ts`) rather than throwing or
 * stalling the mission. That fallback is a deliberate ROAD-TESTING signal:
 * NAVIGATE opens Google Maps but cannot route, which is what tells Adam
 * Places specifically is the broken component. It must never be confused
 * with a real result — every consumer keys off `simulated: true`.
 *
 * Zero or partial REAL results are a different, legitimate state (Part 16)
 * and do NOT trigger the simulation fallback: "7 of 10 found" is the
 * truthful outcome of a real search, not a failure to paper over.
 */
import { GooglePlacesTerritoryProvider } from "../territory/googlePlacesTerritoryProvider";
import type { GeoPoint, TerritoryBusinessCandidate } from "../territory/territoryDiscovery";
import {
  simulatedLocalTargetRunTargets,
  type SourcedTarget,
} from "../../shared/localTargetRun";

export type LocalTargetRunSourcingResult = {
  targets: SourcedTarget[];
  simulated: boolean;
};

function placesApiKey(): string {
  return process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY ?? "";
}

function navigationUrlFor(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

function toSourcedTarget(candidate: TerritoryBusinessCandidate): SourcedTarget {
  return {
    id: `places:${candidate.providerId}`,
    name: candidate.name,
    address: candidate.formattedAddress,
    lat: candidate.lat,
    lng: candidate.lng,
    website: candidate.website ?? null,
    phone: candidate.phone ?? null,
    navigationUrl: candidate.providerUrl ?? navigationUrlFor(candidate.formattedAddress),
    simulated: false,
  };
}

function haversineMiles(a: GeoPoint, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * De-duplicates by provider id, then sequences for low field friction by
 * greedy nearest-neighbour from the anchor (Part 11 — route order, not
 * target selection, and never "busiest" without sourced evidence to back
 * it). This is intentionally simple: a full authoritative visit-route
 * projection (server/field/authoritativeVisitRouteService.ts) is built for
 * a different execution model — closed 2-3-stop commercial missions with
 * server-tracked visit-outcome events — and forcing a 10-stop real-business
 * run through it would either fight its stop-count guard or require
 * fabricating commercial-mission rows this objective doesn't have.
 */
function dedupeAndSequence(
  candidates: TerritoryBusinessCandidate[],
  anchor: GeoPoint,
  limit: number
): TerritoryBusinessCandidate[] {
  const seen = new Set<string>();
  const deduped = candidates.filter(candidate => {
    if (seen.has(candidate.providerId)) return false;
    seen.add(candidate.providerId);
    return true;
  });

  const remaining = [...deduped];
  const ordered: TerritoryBusinessCandidate[] = [];
  let from: GeoPoint | { lat: number; lng: number } = anchor;
  while (remaining.length && ordered.length < limit) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const distance = haversineMiles(from as GeoPoint, remaining[index]!);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    const [next] = remaining.splice(nearestIndex, 1);
    if (!next) break;
    ordered.push(next);
    from = { lat: next.lat, lng: next.lng };
  }
  return ordered;
}

export async function sourceLocalTargetRunTargets(input: {
  targetQuery: string;
  requestedCount: number;
  anchor: { lat: number; lng: number; label: string } | null;
  fetcher?: typeof fetch;
}): Promise<LocalTargetRunSourcingResult> {
  const apiKey = placesApiKey();
  // No key, or no legitimate anchor to search around — Part 15 says never
  // invent a position, and a search with no real center is not a real
  // search. Either way this is exactly the "Places unavailable" case.
  if (!apiKey || !input.anchor) {
    return { targets: simulatedLocalTargetRunTargets(), simulated: true };
  }
  try {
    const provider = new GooglePlacesTerritoryProvider(apiKey, input.fetcher);
    const anchorPoint: GeoPoint = {
      lat: input.anchor.lat,
      lng: input.anchor.lng,
      formattedAddress: input.anchor.label,
    };
    const candidates = await provider.searchBusinesses({
      center: anchorPoint,
      radiusMiles: 10,
      categories: [input.targetQuery],
      limit: Math.max(20, input.requestedCount * 2),
    });
    const sequenced = dedupeAndSequence(candidates, anchorPoint, input.requestedCount);
    // A real search that legitimately finds zero or fewer than requested is
    // a truthful partial result (Part 16), never the simulation fallback.
    return { targets: sequenced.map(toSourcedTarget), simulated: false };
  } catch (error) {
    console.warn(
      "[LocalTargetRun] Google Places sourcing failed — using the labeled simulation fallback",
      error
    );
    return { targets: simulatedLocalTargetRunTargets(), simulated: true };
  }
}
