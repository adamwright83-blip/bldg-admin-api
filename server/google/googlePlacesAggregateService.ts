import { ENV } from "../_core/env";
import {
  computeOpportunityPressure,
  STRATEGIC_LA_DISTRICTS,
  type TerritoryOpportunityProjection,
} from "../../shared/opportunityPressure";
import { recordGoogleTelemetry } from "./googleTelemetry";

// Cache for 6 hours
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cachedAggregate: { data: TerritoryOpportunityProjection; timestamp: number } | null = null;

// Baseline multi-family housing density estimates for LA neighborhoods (derived from census & zoning)
const DISTRICT_BASELINES: Record<string, number> = {
  koreatown: 320,
  century_city: 140,
  west_hollywood: 280,
  beverly_hills: 110,
  hollywood: 290,
  silver_lake: 160,
  echo_park: 175,
  los_feliz: 150,
  downtown_la: 420,
};

export class GooglePlacesAggregateService {
  constructor(
    private readonly apiKey = ENV.googlePlacesAggregateApiKey || ENV.googlePlacesApiKey,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async getLosAngelesOpportunityDensity(input: {
    activeCustomersByDistrict?: Record<string, number>;
    forceFresh?: boolean;
  } = {}): Promise<{
    projection: TerritoryOpportunityProjection;
    cacheHit: boolean;
    status: "available" | "baseline" | "unconfigured" | "error";
  }> {
    const now = Date.now();
    const customerCounts = input.activeCustomersByDistrict ?? {
      koreatown: 25,
      century_city: 18,
    };

    if (!input.forceFresh && cachedAggregate && now - cachedAggregate.timestamp < CACHE_TTL_MS) {
      return { projection: cachedAggregate.data, cacheHit: true, status: "available" };
    }

    const start = performance.now();

    // If aggregate key is configured, query Places API for nearby multi-family housing count in district centers
    if (this.apiKey.trim()) {
      try {
        const districtResults: Array<{ districtId: string; housingCount: number; activeCustomerCount: number }> = [];

        for (const district of STRATEGIC_LA_DISTRICTS) {
          const url = new URL("https://places.googleapis.com/v1/places:searchNearby");
          const res = await this.fetcher(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": this.apiKey,
              "X-Goog-FieldMask": "places.id",
            },
            body: JSON.stringify({
              includedTypes: [
                "apartment_building",
                "apartment_complex",
                "condominium_complex",
                "housing_complex",
              ],
              maxResultCount: 20,
              locationRestriction: {
                circle: {
                  center: district.center,
                  radius: 1500.0,
                },
              },
            }),
            signal: AbortSignal.timeout(5000),
          });

          if (res.ok) {
            const json = await res.json() as any;
            const placesCount = Array.isArray(json.places) ? json.places.length : 0;
            // Scale up sample count to territory estimate
            const estimatedTotal = Math.max(DISTRICT_BASELINES[district.id] ?? 100, placesCount * 14);
            districtResults.push({
              districtId: district.id,
              housingCount: estimatedTotal,
              activeCustomerCount: customerCounts[district.id] ?? 0,
            });
          } else {
            districtResults.push({
              districtId: district.id,
              housingCount: DISTRICT_BASELINES[district.id] ?? 100,
              activeCustomerCount: customerCounts[district.id] ?? 0,
            });
          }
        }

        const elapsedMs = performance.now() - start;
        const projection = computeOpportunityPressure({
          districts: districtResults,
          source: "places_aggregate",
        });

        cachedAggregate = { data: projection, timestamp: now };
        recordGoogleTelemetry({
          api: "places_aggregate",
          requestType: "places:searchNearby:aggregate",
          elapsedMs,
          success: true,
          status: "available",
          cacheHit: false,
        });

        return { projection, cacheHit: false, status: "available" };
      } catch (err) {
        const elapsedMs = performance.now() - start;
        recordGoogleTelemetry({
          api: "places_aggregate",
          requestType: "places:searchNearby:aggregate",
          elapsedMs,
          success: false,
          status: "degraded",
          fallbackSelected: "baseline_density",
          error: String(err),
        });
      }
    }

    // Fallback baseline density calculation
    const fallbackDistricts = STRATEGIC_LA_DISTRICTS.map(d => ({
      districtId: d.id,
      housingCount: DISTRICT_BASELINES[d.id] ?? 150,
      activeCustomerCount: customerCounts[d.id] ?? 0,
    }));

    const projection = computeOpportunityPressure({
      districts: fallbackDistricts,
      source: "baseline_density",
    });

    return {
      projection,
      cacheHit: false,
      status: this.apiKey.trim() ? "baseline" : "unconfigured",
    };
  }
}
