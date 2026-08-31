import { ENV } from "../_core/env";
import type { AirQualityCategory, LiveAirQualityInput } from "../../shared/worldAtmosphere";
import { recordGoogleTelemetry } from "./googleTelemetry";

// Cache for 30 minutes
const CACHE_TTL_MS = 30 * 60 * 1000;
let cachedAirQuality: { data: LiveAirQualityInput; timestamp: number } | null = null;

function mapAqiCategory(categoryStr: string, aqi: number): AirQualityCategory {
  const normalized = categoryStr.toLowerCase();
  if (normalized.includes("hazardous")) return "hazardous";
  if (normalized.includes("very unhealthy")) return "very_unhealthy";
  if (normalized.includes("unhealthy for sensitive")) return "unhealthy_sensitive";
  if (normalized.includes("unhealthy")) return "unhealthy";
  if (normalized.includes("moderate")) return "moderate";
  if (normalized.includes("good")) return "good";

  // Fallback to numeric thresholds
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "unhealthy_sensitive";
  if (aqi <= 200) return "unhealthy";
  if (aqi <= 300) return "very_unhealthy";
  return "hazardous";
}

export class GoogleAirQualityService {
  constructor(
    private readonly apiKey = ENV.googleAirQualityApiKey,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async getCurrentLosAngelesAirQuality(forceFresh = false): Promise<{
    airQuality: LiveAirQualityInput;
    cacheHit: boolean;
    status: "available" | "unavailable" | "unconfigured" | "error";
  }> {
    const now = Date.now();
    if (!forceFresh && cachedAirQuality && now - cachedAirQuality.timestamp < CACHE_TTL_MS) {
      return { airQuality: cachedAirQuality.data, cacheHit: true, status: "available" };
    }

    if (!this.apiKey.trim()) {
      // RULE: Missing AQ is NOT clean air. It is unknown/unmodulated.
      const unconfigured: LiveAirQualityInput = {
        aqi: null,
        category: "unknown",
        dominantPollutant: null,
        source: "unknown",
        observedAt: new Date().toISOString(),
      };
      return { airQuality: unconfigured, cacheHit: false, status: "unconfigured" };
    }

    const start = performance.now();
    try {
      const url = new URL("https://airquality.googleapis.com/v1/currentConditions:lookup");
      url.searchParams.set("key", this.apiKey);

      const res = await this.fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location: { latitude: 34.0522, longitude: -118.2437 },
          extraComputations: ["LOCAL_AQI", "DOMINANT_POLLUTANT_CONCENTRATION"],
        }),
        signal: AbortSignal.timeout(8000),
      });

      const elapsedMs = performance.now() - start;

      if (res.ok) {
        const json = await res.json() as any;
        const indexes = json.indexes ?? [];
        const universalAqiIndex = indexes.find((item: any) => item.code === "usa_epa" || item.code === "uaqi") ?? indexes[0];
        const aqiValue = universalAqiIndex?.aqi != null ? Number(universalAqiIndex.aqi) : null;
        const categoryStr = universalAqiIndex?.category ?? "moderate";
        const dominantPollutant = universalAqiIndex?.dominantPollutant ?? json.dominantPollutant ?? null;

        const category = aqiValue != null ? mapAqiCategory(categoryStr, aqiValue) : "unknown";

        const data: LiveAirQualityInput = {
          aqi: aqiValue,
          category,
          dominantPollutant,
          source: "google_air_quality",
          observedAt: new Date().toISOString(),
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

        return { airQuality: data, cacheHit: false, status: "available" };
      } else {
        recordGoogleTelemetry({
          api: "air_quality",
          requestType: "currentConditions:lookup",
          elapsedMs,
          success: false,
          status: res.status === 403 || res.status === 401 ? "permission_denied" : "unavailable",
          error: `Google Air Quality HTTP ${res.status}`,
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

    // On failure: return unknown AQ without inventing clean air
    const unknownData: LiveAirQualityInput = {
      aqi: null,
      category: "unknown",
      dominantPollutant: null,
      source: "unknown",
      observedAt: new Date().toISOString(),
    };

    return { airQuality: unknownData, cacheHit: false, status: "error" };
  }
}
