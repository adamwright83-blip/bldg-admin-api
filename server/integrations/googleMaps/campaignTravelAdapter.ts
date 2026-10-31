/**
 * Google Distance Matrix adapter for campaign future-window intelligence.
 * Explicit provider state. No retry storm. Disabled in CI/test. Cached.
 *
 * Every real answer is recorded as `distance_matrix` evidence (googleTelemetry.ts), so a rejected key shows on the
 * admin capabilities view. This is Google's legacy API; it can only be called by projects that already had it
 * enabled. Its supported replacement is the Routes API's computeRouteMatrix, which needs enabling (and is billed)
 * in Google Cloud before an adapter for it can be used.
 */

import { ENV } from "../../_core/env";
import type {
  CampaignTravelTruth,
  TravelLegEstimate,
  TravelProviderState,
} from "../../../shared/goldlineTravelTruth";
import { emptyTravelTruth, travelFingerprint } from "../../../shared/goldlineTravelTruth";
import { classifyGoogleFailure, recordGoogleTelemetry } from "../../google/googleTelemetry";

const cache = new Map<string, TravelLegEstimate>();
/** a failed leg is not asked again for this long (no retry storm), but not forever: a fixed key shows */
const FAILURE_HOLD_MS = 10 * 60 * 1000;
const failedUntil = new Map<string, number>();
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

/** Whether a key is present for travel legs (not whether Google accepts it: that is the telemetry's job). */
export function campaignTravelKeyConfigured(): boolean {
  return Boolean(apiKey());
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
  if ((failedUntil.get(key) ?? 0) > Date.now()) return unavailableLeg(fromObjectiveId, toObjectiveId);
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", `${from.latitude},${from.longitude}`);
  url.searchParams.set("destinations", `${to.latitude},${to.longitude}`);
  url.searchParams.set("mode", "driving");
  url.searchParams.set("key", apiKey());

  const started = performance.now();
  // a failure is recorded as evidence and not cached, so a fixed key or a re-enabled API shows on the next call
  const failed = (httpStatus: number | null, providerStatus: string | null, error: string) => {
    recordGoogleTelemetry({
      api: "distance_matrix",
      requestType: "distancematrix:json",
      elapsedMs: performance.now() - started,
      success: false,
      status: classifyGoogleFailure({ httpStatus, providerStatus }),
      error,
    });
    failedUntil.set(key, Date.now() + FAILURE_HOLD_MS);
    if (failedUntil.size > MAX_CACHE) failedUntil.delete(failedUntil.keys().next().value!);
    return unavailableLeg(fromObjectiveId, toObjectiveId);
  };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return failed(response.status, null, `Distance Matrix HTTP ${response.status}`);
    const body = (await response.json()) as {
      status?: string;
      error_message?: string;
      rows?: Array<{
        elements?: Array<{
          status?: string;
          duration?: { value?: number };
          distance?: { value?: number };
        }>;
      }>;
    };
    // REQUEST_DENIED is how the legacy API says the key may not call it (not enabled, or restricted)
    if (body.status !== "OK") return failed(response.status, body.status ?? null, body.error_message ?? `Distance Matrix returned ${body.status ?? "no status"}`);
    const element = body.rows?.[0]?.elements?.[0];
    const ok = element?.status === "OK";
    recordGoogleTelemetry({
      api: "distance_matrix",
      requestType: "distancematrix:json",
      elapsedMs: performance.now() - started,
      success: true,
      // the API answered; a leg it can't route (ZERO_RESULTS) is still a working API
      status: "available",
    });
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
  } catch (error) {
    return failed(null, null, error instanceof Error ? error.message : "no answer");
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

/** Tests only: one leg, past the CI/test switch that keeps routing off. */
export const fetchTravelLegForTests = fetchLeg;
