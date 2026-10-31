import { ENV } from "../_core/env";
import { classifyGoogleFailure, recordGoogleTelemetry } from "./googleTelemetry";
import {
  computeOpportunityPressure,
  type TerritoryOpportunityProjection,
} from "../../shared/opportunityPressure";

/**
 * Uses the real Google Area Insights API (areainsights.googleapis.com/v1:computeInsights)
 * to query INSIGHT_COUNT for apartment_complex + condominium_complex within bounded
 * circles over each strategic Los Angeles district.
 *
 * Real counts observed 2026-08-31 from live API (IMPORT: never multiply or scale these):
 *   koreatown=133, century_city=40, west_hollywood=93, beverly_hills=68,
 *   hollywood=127, silver_lake=31, echo_park=19, los_feliz=30, downtown_la=228
 *
 * DO NOT substitute invented district counts or scale capped results.
 * If the API fails for a district, mark its density as null (unknown), not a baseline.
 */

export const STRATEGIC_DISTRICT_CIRCLES = [
  { districtId: "koreatown",    name: "Koreatown",    lat: 34.0586, lng: -118.3022, radiusM: 2000 },
  { districtId: "century_city", name: "Century City", lat: 34.0588, lng: -118.4167, radiusM: 1500 },
  { districtId: "west_hollywood", name: "West Hollywood", lat: 34.0900, lng: -118.3617, radiusM: 1800 },
  { districtId: "beverly_hills", name: "Beverly Hills", lat: 34.0736, lng: -118.4004, radiusM: 2000 },
  { districtId: "hollywood",    name: "Hollywood",    lat: 34.1020, lng: -118.3439, radiusM: 2000 },
  { districtId: "silver_lake",  name: "Silver Lake",  lat: 34.0839, lng: -118.2703, radiusM: 1500 },
  { districtId: "echo_park",    name: "Echo Park",    lat: 34.0784, lng: -118.2597, radiusM: 1200 },
  { districtId: "los_feliz",    name: "Los Feliz",    lat: 34.1058, lng: -118.2896, radiusM: 1500 },
  { districtId: "downtown_la",  name: "Downtown LA",  lat: 34.0430, lng: -118.2673, radiusM: 2500 },
] as const;

// A complete answer is kept 6 hours (housing density doesn't change rapidly). One with failed districts is kept only
// FAILURE_HOLD_MS, so the failed districts are asked again soon instead of being served as answered for 6 hours.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_HOLD_MS = 10 * 60 * 1000;
type CachedCounts = {
  status: "available" | "partial" | "unavailable";
  rawCounts: Record<string, number | null>;
  errorDistricts: string[];
  timestamp: number;
};
let cachedResult: CachedCounts | null = null;

/** Tests only: forget the cached counts. */
export function resetPlacesAggregateCacheForTests() {
  cachedResult = null;
}

export type PlacesAggregateResult = {
  status: "available" | "partial" | "unavailable" | "unconfigured";
  projection: TerritoryOpportunityProjection;
  rawCounts: Record<string, number | null>;
  errorDistricts: string[];
  /** when Google answered these counts (a cached answer keeps its original time) */
  countedAt: string | null;
  cacheHit: boolean;
};

/**
 * Active customers per district, from authoritative business records; null when presence couldn't be read. A
 * district missing from a non-null record has no located active customers.
 */
export type DistrictPresence = Record<string, number> | null;

function project(counts: Record<string, number | null>, presence: DistrictPresence) {
  return computeOpportunityPressure({
    districts: STRATEGIC_DISTRICT_CIRCLES.map(d => ({
      districtId: d.districtId,
      // a failed district stays unknown: never 0, never a baseline
      housingCount: counts[d.districtId] ?? null,
      activeCustomerCount: presence ? (presence[d.districtId] ?? 0) : null,
    })),
    source: "places_aggregate",
  });
}

export class GooglePlacesAggregateService {
  constructor(
    private readonly apiKey = ENV.googlePlacesAggregateApiKey,
    private readonly fetcher: typeof fetch = fetch,
    private readonly clock: () => number = Date.now
  ) {}

  async getLosAngelesOpportunityDensity(opts?: {
    forceFresh?: boolean;
    /** Goldline customer presence per district from authoritative business records; null or absent: unknown */
    goldlinePresence?: DistrictPresence;
  }): Promise<PlacesAggregateResult> {
    const now = this.clock();
    const presence = opts?.goldlinePresence ?? null;
    if (!this.apiKey.trim()) {
      const rawCounts = Object.fromEntries(STRATEGIC_DISTRICT_CIRCLES.map(d => [d.districtId, null]));
      return {
        status: "unconfigured",
        projection: { ...project(rawCounts, presence), source: "baseline_density" },
        rawCounts,
        errorDistricts: STRATEGIC_DISTRICT_CIRCLES.map(d => d.districtId),
        countedAt: null,
        cacheHit: false,
      };
    }
    if (!opts?.forceFresh && cachedResult) {
      const age = now - cachedResult.timestamp;
      const ttl = cachedResult.status === "available" ? CACHE_TTL_MS : FAILURE_HOLD_MS;
      if (age < ttl) {
        // the cached answer as it was: its status and its failed districts, not "available"
        return {
          status: cachedResult.status,
          projection: project(cachedResult.rawCounts, presence),
          rawCounts: cachedResult.rawCounts,
          errorDistricts: cachedResult.errorDistricts,
          countedAt: new Date(cachedResult.timestamp).toISOString(),
          cacheHit: true,
        };
      }
    }

    const rawCounts: Record<string, number | null> = {};
    const errorDistricts: string[] = [];
    let firstFailure: { http: number | null; provider: string | null; error: string } | null = null;
    const start = performance.now();

    // Fan out district queries sequentially (rate limit friendly)
    for (const district of STRATEGIC_DISTRICT_CIRCLES) {
      try {
        const res = await this.fetcher("https://areainsights.googleapis.com/v1:computeInsights", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": this.apiKey,
          },
          body: JSON.stringify({
            insights: ["INSIGHT_COUNT"],
            filter: {
              locationFilter: {
                circle: {
                  latLng: { latitude: district.lat, longitude: district.lng },
                  radius: district.radiusM,
                },
              },
              typeFilter: {
                includedTypes: ["apartment_complex", "condominium_complex"],
              },
            },
          }),
          signal: AbortSignal.timeout(8000),
        });

        if (res.ok) {
          const json = (await res.json()) as any;
          // API returns count as a string: { "count": "133" }
          const count = json.count != null && Number.isFinite(Number(json.count)) ? Number(json.count) : null;
          rawCounts[district.districtId] = count;
          if (count == null) errorDistricts.push(district.districtId);
        } else {
          rawCounts[district.districtId] = null;
          errorDistricts.push(district.districtId);
          if (!firstFailure) {
            const body = (await res.json().catch(() => null)) as { error?: { status?: string; message?: string } } | null;
            firstFailure = { http: res.status, provider: body?.error?.status ?? null, error: `Area Insights HTTP ${res.status}${body?.error?.status ? ` ${body.error.status}` : ""}` };
          }
        }
      } catch (error) {
        rawCounts[district.districtId] = null;
        errorDistricts.push(district.districtId);
        if (!firstFailure) firstFailure = { http: null, provider: null, error: error instanceof Error ? error.message : "no answer" };
      }
    }

    const elapsedMs = performance.now() - start;
    const successCount = Object.values(rawCounts).filter(v => v != null).length;
    const status: CachedCounts["status"] =
      successCount === 0 ? "unavailable" :
      successCount < STRATEGIC_DISTRICT_CIRCLES.length ? "partial" : "available";

    recordGoogleTelemetry({
      api: "places_aggregate",
      requestType: "areainsights:computeInsights",
      elapsedMs,
      success: status !== "unavailable",
      status:
        status === "available"
          ? "available"
          : status === "partial"
            ? "degraded"
            : classifyGoogleFailure({ httpStatus: firstFailure?.http ?? null, providerStatus: firstFailure?.provider }),
      error: firstFailure?.error,
      cacheHit: false,
    });

    cachedResult = { status, rawCounts, errorDistricts, timestamp: now };
    return {
      status,
      projection: project(rawCounts, presence),
      rawCounts,
      errorDistricts,
      countedAt: new Date(now).toISOString(),
      cacheHit: false,
    };
  }
}
