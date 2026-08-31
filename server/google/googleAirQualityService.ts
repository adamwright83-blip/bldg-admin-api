import { ENV } from "../_core/env";
import type { AirQualityCategory, LiveAirQualityInput } from "../../shared/worldAtmosphere";
import { recordGoogleTelemetry } from "./googleTelemetry";

// Cache for 30 minutes
const CACHE_TTL_MS = 30 * 60 * 1000;
let cachedAirQuality: { data: LiveAirQualityInput; timestamp: number } | null = null;

/**
 * Maps Google AQ category string to WorldAtmosphere AirQualityCategory.
 * Google AQ API real category values observed 2026-08-31:
 *   "Good air quality", "Moderate air quality", "Unhealthy for sensitive groups",
 *   "Unhealthy", "Very Unhealthy", "Hazardous"
 * Falls back to numeric AQI thresholds.
 */
function mapAqiCategory(categoryStr: string, aqi: number): AirQualityCategory {
  const normalized = categoryStr.toLowerCase();
  if (normalized.includes("hazardous")) return "hazardous";
  if (normalized.includes("very unhealthy")) return "very_unhealthy";
  if (normalized.includes("unhealthy for sensitive")) return "unhealthy_sensitive";
  if (normalized.includes("unhealthy")) return "unhealthy";
  if (normalized.includes("moderate")) return "moderate";
  if (normalized.includes("good")) return "good";
  // Numeric fallback (US EPA scale)
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "unhealthy_sensitive";
  if (aqi <= 200) return "unhealthy";
  if (aqi <= 300) return "very_unhealthy";
  return "hazardous";
}

const UNKNOWN_AQ: LiveAirQualityInput = {
  aqi: null,
  category: "unknown",
  dominantPollutant: null,
  source: "unknown",
  observedAt: new Date().toISOString(),
};

export class GoogleAirQualityService {
  constructor(
    private readonly apiKey = ENV.googleAirQualityApiKey,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async getCurrentLosAngelesAirQuality(forceFresh = false): Promise<{
    airQuality: LiveAirQualityInput;
    cacheHit: boolean;
    status: "available" | "unavailable" | "unconfigured" | "error";
    rawGoogleFields?: Record<string, unknown>;
  }> {
    const now = Date.now();
    if (!forceFresh && cachedAirQuality && now - cachedAirQuality.timestamp < CACHE_TTL_MS) {
      return { airQuality: cachedAirQuality.data, cacheHit: true, status: "available" };
    }

    // RULE: Missing AQ key is NOT clean air. Unknown AQ, no modulation.
    if (!this.apiKey.trim()) {
      return { airQuality: { ...UNKNOWN_AQ, observedAt: new Date().toISOString() }, cacheHit: false, status: "unconfigured" };
    }

    const start = performance.now();
    try {
      // POST to airquality.googleapis.com with X-Goog-Api-Key header
      // Schema confirmed live 2026-08-31:
      //   indexes[].code ("uaqi" | "usa_epa"), indexes[].aqi (number), indexes[].category (string)
      //   indexes[].dominantPollutant (string like "pm10")
      //   dateTime (ISO string), regionCode (string)
      const res = await this.fetcher("https://airquality.googleapis.com/v1/currentConditions:lookup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
        },
        body: JSON.stringify({
          location: { latitude: 34.0522, longitude: -118.2437 },
          universalAqi: true,
          extraComputations: ["DOMINANT_POLLUTANT_CONCENTRATION", "POLLUTANT_CONCENTRATION"],
        }),
        signal: AbortSignal.timeout(8000),
      });

      const elapsedMs = performance.now() - start;

      if (res.ok) {
        const json = await res.json() as any;
        const indexes: any[] = json.indexes ?? [];

        // Prefer uaqi (Universal AQI), then usa_epa, then first available index
        const selectedIndex =
          indexes.find((i: any) => i.code === "uaqi") ??
          indexes.find((i: any) => i.code === "usa_epa") ??
          indexes[0];

        const aqiValue = selectedIndex?.aqi != null ? Number(selectedIndex.aqi) : null;
        const categoryStr: string = selectedIndex?.category ?? "";
        const dominantPollutant: string | null = selectedIndex?.dominantPollutant ?? null;
        const category = aqiValue != null && categoryStr ? mapAqiCategory(categoryStr, aqiValue) : "unknown";

        const data: LiveAirQualityInput = {
          aqi: aqiValue,
          category,
          dominantPollutant,
          source: "google_air_quality",
          observedAt: json.dateTime ?? new Date().toISOString(),
        };

        cachedAirQuality = { data, timestamp: now };
        recordGoogleTelemetry({
          api: "air_quality",
          requestType: "currentConditions:lookup",
          elapsedMs,
          success: true,
          status: "available",
          cacheHit: false,
        });

        const rawGoogleFields = {
          "indexes[0].code": selectedIndex?.code,
          "indexes[0].aqi": selectedIndex?.aqi,
          "indexes[0].aqiDisplay": selectedIndex?.aqiDisplay,
          "indexes[0].category": selectedIndex?.category,
          "indexes[0].dominantPollutant": selectedIndex?.dominantPollutant,
          "dateTime": json.dateTime,
          "regionCode": json.regionCode,
        };

        return { airQuality: data, cacheHit: false, status: "available", rawGoogleFields };
      } else {
        const errText = await res.text().catch(() => "");
        recordGoogleTelemetry({
          api: "air_quality",
          requestType: "currentConditions:lookup",
          elapsedMs,
          success: false,
          status: res.status === 403 || res.status === 401 ? "permission_denied" : "unavailable",
          error: `Google Air Quality HTTP ${res.status}: ${errText.slice(0, 200)}`,
        });
      }
    } catch (err) {
      const elapsedMs = performance.now() - start;
      recordGoogleTelemetry({
        api: "air_quality",
        requestType: "currentConditions:lookup",
        elapsedMs,
        success: false,
        status: "unavailable",
        error: String(err),
      });
    }

    // On failure: return UNKNOWN AQ — never invent clean air
    return { airQuality: { ...UNKNOWN_AQ, observedAt: new Date().toISOString() }, cacheHit: false, status: "error" };
  }
}
