import { ENV } from "../_core/env";
import { recordGoogleTelemetry } from "./googleTelemetry";
import { computeOpportunityPressure } from "../../shared/opportunityPressure";
import type { OpportunityPressureProjection } from "../../shared/opportunityPressure";

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

const STRATEGIC_DISTRICT_CIRCLES = [
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

// Cache 6 hours — housing density doesn't change rapidly
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cachedResult: {
  projection: OpportunityPressureProjection;
  rawCounts: Record<string, number | null>;
  timestamp: number;
} | null = null;

export type PlacesAggregateResult = {
  status: "available" | "partial" | "unavailable" | "unconfigured";
  projection: OpportunityPressureProjection;
  rawCounts: Record<string, number | null>;
  errorDistricts: string[];
};

export class GooglePlacesAggregateService {
  constructor(
    private readonly apiKey = ENV.googlePlacesAggregateApiKey,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async getLosAngelesOpportunityDensity(opts?: {
    forceFresh?: boolean;
    /** Goldline customer presence per district from authoritative business records */
    goldlinePresence?: Record<string, number>;
  }): Promise<PlacesAggregateResult> {
    const now = Date.now();
    if (!opts?.forceFresh && cachedResult && now - cachedResult.timestamp < CACHE_TTL_MS) {
      const proj = computeOpportunityPressure({
        districts: STRATEGIC_DISTRICT_CIRCLES.map(d => ({
          districtId: d.districtId,
          housingCount: cachedResult!.rawCounts[d.districtId] ?? 0,
          activeCustomerCount: opts?.goldlinePresence?.[d.districtId] ?? 0,
        })),
        source: "places_aggregate",
      });
      return { status: "available", projection: proj, rawCounts: cachedResult.rawCounts, errorDistricts: [] };
    }

    if (!this.apiKey.trim()) {
      const proj = computeOpportunityPressure({ districts: [], source: "baseline_density" });
      return {
        status: "unconfigured",
        projection: proj,
        rawCounts: Object.fromEntries(STRATEGIC_DISTRICT_CIRCLES.map(d => [d.districtId, null])),
        errorDistricts: STRATEGIC_DISTRICT_CIRCLES.map(d => d.districtId),
      };
    }

    const rawCounts: Record<string, number | null> = {};
    const errorDistricts: string[] = [];
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
          const json = await res.json() as any;
          // API returns count as a string: { "count": "133" }
          const count = json.count != null ? Number(json.count) : null;
          rawCounts[district.districtId] = count;
        } else {
          rawCounts[district.districtId] = null;
          errorDistricts.push(district.districtId);
        }
      } catch {
        rawCounts[district.districtId] = null;
        errorDistricts.push(district.districtId);
      }
    }

    const elapsedMs = performance.now() - start;
    const successCount = Object.values(rawCounts).filter(v => v != null).length;
    const status: PlacesAggregateResult["status"] =
      successCount === 0 ? "unavailable" :
      successCount < STRATEGIC_DISTRICT_CIRCLES.length ? "partial" : "available";

    recordGoogleTelemetry({
      api: "places_aggregate",
      requestType: "areainsights:computeInsights",
      elapsedMs,
      success: status !== "unavailable",
      status: status === "available" ? "available" : status === "partial" ? "degraded" : "unavailable",
      cacheHit: false,
    });

    // Build projection with real Area Insights counts + real Goldline presence
    const projection = computeOpportunityPressure({
      districts: STRATEGIC_DISTRICT_CIRCLES.map(d => ({
        districtId: d.districtId,
        // RULE: If district query failed, use 0 but flag in errorDistricts — never invent a count
        housingCount: rawCounts[d.districtId] ?? 0,
        activeCustomerCount: opts?.goldlinePresence?.[d.districtId] ?? 0,
      })),
      source: "places_aggregate",
    });

    cachedResult = { projection, rawCounts, timestamp: now };
    return { status, projection, rawCounts, errorDistricts };
  }
}
