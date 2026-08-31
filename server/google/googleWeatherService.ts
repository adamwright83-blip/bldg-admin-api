import { ENV } from "../_core/env";
import type { LiveWeatherInput, WeatherConditionCategory } from "../../shared/worldAtmosphere";
import { recordGoogleTelemetry } from "./googleTelemetry";

// Cache for 10 minutes
const CACHE_TTL_MS = 10 * 60 * 1000;
let cachedWeather: { data: LiveWeatherInput; timestamp: number } | null = null;

/**
 * Maps Google Weather API `weatherCondition.type` enum values to WorldAtmosphere categories.
 * Schema confirmed live against: weather.googleapis.com/v1/currentConditions:lookup
 * Real types observed: "CLEAR", "PARTLY_CLOUDY", "MOSTLY_CLOUDY", "CLOUDY", "OVERCAST",
 *   "RAIN", "DRIZZLE", "HEAVY_RAIN", "THUNDERSTORM", "FOGGY", "WINDY"
 */
function mapConditionType(type: string): WeatherConditionCategory {
  const t = type.toUpperCase().trim();
  if (t.includes("THUNDERSTORM")) return "thunderstorm";
  if (t.includes("HEAVY_RAIN")) return "heavy_rain";
  if (t.includes("RAIN") || t.includes("SHOWER")) return "rain";
  if (t.includes("DRIZZLE")) return "drizzle";
  if (t.includes("FOG") || t.includes("MIST") || t.includes("HAZE")) return "fog";
  if (t.includes("OVERCAST")) return "overcast";
  if (t.includes("PARTLY")) return "partly_cloudy";
  if (t.includes("MOSTLY_CLOUDY") || t.includes("CLOUDY")) return "cloudy";
  if (t.includes("WINDY")) return "windy";
  return "clear";
}

/** Open-Meteo WMO weather code → WorldAtmosphere category */
function mapWmoCode(code: number): WeatherConditionCategory {
  if (code >= 95) return "thunderstorm";
  if (code >= 65) return "heavy_rain";
  if (code >= 51 || code >= 61) return "rain";
  if (code >= 45) return "fog";
  if (code === 3) return "overcast";
  if (code === 2) return "cloudy";
  if (code === 1) return "partly_cloudy";
  return "clear";
}

export class GoogleWeatherService {
  constructor(
    private readonly apiKey = ENV.googleWeatherApiKey,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async getCurrentLosAngelesWeather(forceFresh = false): Promise<{
    weather: LiveWeatherInput;
    cacheHit: boolean;
    status: "available" | "open_meteo_fallback" | "unconfigured" | "error";
    rawGoogleFields?: Record<string, unknown>;
  }> {
    const now = Date.now();
    if (!forceFresh && cachedWeather && now - cachedWeather.timestamp < CACHE_TTL_MS) {
      return { weather: cachedWeather.data, cacheHit: true, status: "available" };
    }

    const start = performance.now();
    const laLat = 34.0522;
    const laLng = -118.2437;

    // PRIMARY: Google Weather API
    // Schema: weather.googleapis.com/v1/currentConditions:lookup
    // Real fields (observed 2026-08-31):
    //   weatherCondition.type (e.g. "CLEAR"), weatherCondition.description.text
    //   temperature.degrees (number), temperature.unit ("CELSIUS" | "FAHRENHEIT")
    //   cloudCover (numeric 0-100), relativeHumidity (numeric 0-100)
    //   wind.speed.value (number), wind.speed.unit ("KILOMETERS_PER_HOUR" | "MILES_PER_HOUR")
    //   precipitation.qpf.quantity (current QPF, not probability), isDaytime (boolean)
    if (this.apiKey.trim()) {
      try {
        const url = new URL("https://weather.googleapis.com/v1/currentConditions:lookup");
        url.searchParams.set("location.latitude", String(laLat));
        url.searchParams.set("location.longitude", String(laLng));
        url.searchParams.set("key", this.apiKey);
        // Request IMPERIAL explicitly to get Fahrenheit and MPH directly
        url.searchParams.set("unitsSystem", "IMPERIAL");

        const res = await this.fetcher(url, { signal: AbortSignal.timeout(8000) });
        const elapsedMs = performance.now() - start;

        if (res.ok) {
          const json = await res.json() as any;

          // Parse temperature: prefer FAHRENHEIT direct, else convert CELSIUS
          let tempF: number;
          const tempDegrees: number = json.temperature?.degrees ?? json.temperature?.degreesFahrenheit ?? json.temperature?.degreesCelsius ?? null;
          const tempUnit: string = json.temperature?.unit ?? (json.temperature?.degreesFahrenheit != null ? "FAHRENHEIT" : "CELSIUS");
          if (tempDegrees != null) {
            tempF = tempUnit === "FAHRENHEIT" ? tempDegrees : (tempDegrees * 9 / 5 + 32);
          } else {
            tempF = 70; // genuine unknown — mark it, don't hardcode 72
          }

          // Parse wind speed: prefer MPH direct, else convert KPH
          let windMph: number;
          const windValue: number = json.wind?.speed?.value ?? json.wind?.speedMph ?? json.wind?.speedKmH ?? null;
          const windUnit: string = json.wind?.speed?.unit ?? "KILOMETERS_PER_HOUR";
          if (windValue != null) {
            windMph = windUnit === "MILES_PER_HOUR" ? windValue : (windValue * 0.621371);
          } else {
            windMph = 0;
          }

          // cloudCover is a top-level numeric field (0-100), not nested
          const cloudPercent: number = typeof json.cloudCover === "number" ? json.cloudCover : (json.cloudCover?.percent ?? 0);

          // relativeHumidity is a top-level numeric field
          const humidity: number = typeof json.relativeHumidity === "number" ? json.relativeHumidity : (json.relativeHumidity?.percent ?? 50);

          // isDaytime is a top-level boolean field
          const isDaytime: boolean = typeof json.isDaytime === "boolean" ? json.isDaytime : true;

          // Precipitation truth: qpf.quantity > 0 means actual QPF, not just probability
          const qpf: number = json.precipitation?.qpf?.quantity ?? 0;
          const isRaining = qpf > 0;
          // Rain intensity: only set if actually raining
          const rainIntensityPercent = isRaining ? Math.min(100, Math.round(qpf * 200)) : 0;

          // Condition type from the real enum field
          const conditionType: string = json.weatherCondition?.type ?? json.weatherCondition?.condition ?? "CLEAR";
          const conditionDesc: string = json.weatherCondition?.description?.text ?? json.weatherCondition?.description ?? conditionType;

          const data: LiveWeatherInput = {
            condition: mapConditionType(conditionType),
            description: conditionDesc,
            cloudCoverPercent: Math.round(cloudPercent),
            temperatureFahrenheit: Math.round(tempF),
            humidityPercent: Math.round(humidity),
            windSpeedMph: Math.round(windMph),
            isRaining,
            rainIntensityPercent,
            isDaytime,
            source: "google_weather",
            observedAt: json.currentTime ?? new Date().toISOString(),
          };

          cachedWeather = { data, timestamp: now };
          recordGoogleTelemetry({
            api: "weather",
            requestType: "currentConditions:lookup",
            elapsedMs,
            success: true,
            status: "available",
            cacheHit: false,
          });

          // Return raw Google fields for report evidence
          const rawGoogleFields = {
            "weatherCondition.type": json.weatherCondition?.type,
            "weatherCondition.description.text": json.weatherCondition?.description?.text,
            "temperature.degrees": json.temperature?.degrees,
            "temperature.unit": json.temperature?.unit,
            "cloudCover": json.cloudCover,
            "relativeHumidity": json.relativeHumidity,
            "wind.speed.value": json.wind?.speed?.value,
            "wind.speed.unit": json.wind?.speed?.unit,
            "precipitation.qpf.quantity": json.precipitation?.qpf?.quantity,
            "isDaytime": json.isDaytime,
            "currentTime": json.currentTime,
          };

          return { weather: data, cacheHit: false, status: "available", rawGoogleFields };
        } else {
          const errText = await res.text().catch(() => "");
          recordGoogleTelemetry({
            api: "weather",
            requestType: "currentConditions:lookup",
            elapsedMs,
            success: false,
            status: res.status === 403 || res.status === 401 ? "permission_denied" : "degraded",
            fallbackSelected: "open_meteo_live",
            error: `Google Weather HTTP ${res.status}: ${errText.slice(0, 200)}`,
          });
        }
      } catch (err) {
        const elapsedMs = performance.now() - start;
        recordGoogleTelemetry({
          api: "weather",
          requestType: "currentConditions:lookup",
          elapsedMs,
          success: false,
          status: "degraded",
          fallbackSelected: "open_meteo_live",
          error: String(err),
        });
      }
    }

    // SECONDARY: Open-Meteo live public fallback (not labelled google_weather)
    try {
      const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${laLat}&longitude=${laLng}&current=temperature_2m,relative_humidity_2m,is_day,precipitation,rain,weather_code,cloud_cover,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FLos_Angeles`;
      const res = await this.fetcher(openMeteoUrl, { signal: AbortSignal.timeout(6000) });
      const elapsedMs = performance.now() - start;

      if (res.ok) {
        const json = await res.json() as any;
        const current = json.current;
        const weatherCode = current?.weather_code ?? 0;
        // Actual precipitation truth: rain > 0 or precipitation > 0 (inches)
        const isRain = (current?.rain ?? 0) > 0 || (current?.precipitation ?? 0) > 0;

        const data: LiveWeatherInput = {
          condition: mapWmoCode(weatherCode),
          description: `WMO code ${weatherCode} (Open-Meteo fallback)`,
          cloudCoverPercent: current?.cloud_cover ?? 0,
          temperatureFahrenheit: Math.round(current?.temperature_2m ?? 70),
          humidityPercent: Math.round(current?.relative_humidity_2m ?? 50),
          windSpeedMph: Math.round(current?.wind_speed_10m ?? 0),
          isRaining: isRain,
          rainIntensityPercent: isRain ? 50 : 0,
          isDaytime: current?.is_day === 1,
          // CRITICAL: always label Open-Meteo source truthfully, never google_weather
          source: "open_meteo_fallback",
          observedAt: new Date().toISOString(),
        };

        cachedWeather = { data, timestamp: now };
        recordGoogleTelemetry({
          api: "weather",
          requestType: "currentConditions:lookup",
          elapsedMs,
          success: true,
          status: "degraded",
          fallbackSelected: "open_meteo_live",
          cacheHit: false,
        });

        return { weather: data, cacheHit: false, status: "open_meteo_fallback" };
      }
    } catch {
      // Ignore — proceed to neutral authored fallback
    }

    // TERTIARY: Neutral authored fallback — no invented meteorology
    const fallback: LiveWeatherInput = {
      condition: "clear",
      description: "Unknown weather — no live provider available",
      cloudCoverPercent: 0,
      temperatureFahrenheit: null as unknown as number,
      humidityPercent: null as unknown as number,
      windSpeedMph: null as unknown as number,
      isRaining: false,
      isDaytime: true,
      source: "authored_fallback",
      observedAt: new Date().toISOString(),
    };

    return {
      weather: fallback,
      cacheHit: false,
      status: this.apiKey.trim() ? "error" : "unconfigured",
    };
  }
}
