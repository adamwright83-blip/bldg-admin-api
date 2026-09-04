/**
 * Google Distance Matrix adapter for campaign future-window intelligence.
 * Explicit provider state. No retry storm. Disabled in CI/test. Cached.
 */

import { ENV } from "../_core/env";
import type {
  CampaignTravelTruth,
  TravelLegEstimate,
  TravelProviderState,
} from "../../shared/goldlineTravelTruth";
import { emptyTravelTruth, travelFingerprint } from "../../shared/goldlineTravelTruth";

const cache = new Map<string, TravelLegEstimate>();
const MAX_CACHE = 64;
const MAX_LEGS = 6;

type LatLng = { latitude: number; longitude: number };

function routingDisabled(): boolean {
  return (
    Boolean(process.env.VITEST) ||
    process.env.CI === "true" ||
    process.env.GOLDLINE_DISABLE_ROUTING === "1" ||
    process.env.NODE_ENV === "test"
  );
}

function apiKey(): string {
  return (
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    ENV.googleGeocodingApiKey.trim() ||
    ENV.googlePlacesApiKey.trim()
  );
}

function cacheSet(key: string, value: TravelLegEstimate) {
  cache.set(key, value);
  if (cache.size > MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
}

function unavailableLeg(
  fromObjectiveId: string,
  toObjectiveId: string
): TravelLegEstimate {
  return {
    fromObjectiveId,
    toObjectiveId,
    durationSeconds: null,
    distanceMeters: null,
    providerState: "unavailable",
    source: "google_distance_matrix",
  };
}

async function fetchLeg(
  from: LatLng,
  to: LatLng,
  fromObjectiveId: string,
  toObjectiveId: string
): Promise<TravelLegEstimate> {
  const key = `${from.latitude.toFixed(5)},${from.longitude.toFixed(5)}>${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, fromObjectiveId, toObjectiveId };
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", `${from.latitude},${from.longitude}`);
  url.searchParams.set("destinations", `${to.latitude},${to.longitude}`);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("key", apiKey());

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      const miss = unavailableLeg(fromObjectiveId, toObjectiveId);
      cacheSet(key, miss);
      return miss;
    }
    const body = (await response.json()) as {
      status?: string;
      rows?: Array<{
        elements?: Array<{
          status?: string;
          duration?: { value?: number };
          distance?: { value?: number };
        }>;
      }>;
    };
    const element = body.rows?.[0]?.elements?.[0];
    const ok = body.status === "OK" && element?.status === "OK";
    const estimate: TravelLegEstimate = {
      fromObjectiveId,
      toObjectiveId,
      durationSeconds: ok ? element?.duration?.value ?? null : null,
      distanceMeters: ok ? element?.distance?.value ?? null : null,
      providerState: ok ? "configured" : "unavailable",
      source: "google_distance_matrix",
    };
    cacheSet(key, estimate);
    return estimate;
  } catch {
    const miss = unavailableLeg(fromObjectiveId, toObjectiveId);
    cacheSet(key, miss);
    return miss;
  }
}

export async function estimateCampaignTravel(input: {
  points: Array<{ objectiveId: string; latitude: number | null; longitude: number | null }>;
}): Promise<CampaignTravelTruth> {
  if (routingDisabled()) return emptyTravelTruth("unconfigured");
  const key = apiKey();
  if (!key) return emptyTravelTruth("unconfigured");
  const located = input.points.filter(
    point => typeof point.latitude === "number" && typeof point.longitude === "number"
  );
  const legs: TravelLegEstimate[] = [];
  for (let index = 0; index < located.length - 1 && legs.length < MAX_LEGS; index += 1) {
    const from = located[index]!;
    const to = located[index + 1]!;
    legs.push(
      await fetchLeg(
        { latitude: from.latitude!, longitude: from.longitude! },
        { latitude: to.latitude!, longitude: to.longitude! },
        from.objectiveId,
        to.objectiveId
      )
    );
  }
  const state: TravelProviderState = legs.some(leg => leg.providerState === "configured")
    ? "configured"
    : legs.length
      ? "unavailable"
      : "configured";
  const truth: CampaignTravelTruth = {
    providerState: state,
    legs,
    fingerprint: "",
  };
  return { ...truth, fingerprint: travelFingerprint(truth) };
}

export function campaignTravelProviderState(): TravelProviderState {
  if (routingDisabled() || !apiKey()) return "unconfigured";
  return "configured";
}
