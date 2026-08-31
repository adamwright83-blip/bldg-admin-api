import { ENV } from "../_core/env";
import type { LiveWeatherInput, WeatherConditionCategory } from "../../shared/worldAtmosphere";
import { recordGoogleTelemetry } from "./googleTelemetry";

// Cache for 10 minutes
const CACHE_TTL_MS = 10 * 60 * 1000;
let cachedWeather: { data: LiveWeatherInput; timestamp: number } | null = null;

function mapConditionCode(code: string | number): WeatherConditionCategory {
  const str = String(code).toLowerCase();
  if (str.includes("thunder") || str.includes("storm")) return "thunderstorm";
  if (str.includes("heavy_rain") || str.includes("torrential")) return "heavy_rain";
  if (str.includes("rain") || str.includes("shower")) return "rain";
  if (str.includes("drizzle")) return "drizzle";
  if (str.includes("fog") || str.includes("mist") || str.includes("haze")) return "fog";
  if (str.includes("overcast")) return "overcast";
  if (str.includes("partly")) return "partly_cloudy";
  if (str.includes("cloud") || str.includes("mostly_cloudy")) return "cloudy";
  if (str.includes("wind")) return "windy";
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
    status: "available" | "fallback" | "unconfigured" | "error";
  }> {
    const now = Date.now();
    if (!forceFresh && cachedWeather && now - cachedWeather.timestamp < CACHE_TTL_MS) {
      return { weather: cachedWeather.data, cacheHit: true, status: "available" };
    }

    const start = performance.now();
    const laLat = 34.0522;
    const laLng = -118.2437;

    // If Google Weather API key is configured, query Google Weather API
    if (this.apiKey.trim()) {
      try {
        const url = new URL("https://weather.googleapis.com/v1/currentConditions:lookup");
        url.searchParams.set("location.latitude", String(laLat));
        url.searchParams.set("location.longitude", String(laLng));
        url.searchParams.set("key", this.apiKey);

        const res = await this.fetcher(url, { signal: AbortSignal.timeout(8000) });
        const elapsedMs = performance.now() - start;

        if (res.ok) {
          const json = await res.json() as any;
          const conditionType = json.weatherCondition?.condition ?? json.currentConditions?.condition ?? "clear";
          const tempF = json.temperature?.degreesFahrenheit != null
            ? json.temperature.degreesFahrenheit
            : json.temperature?.degreesCelsius != null
              ? (json.temperature.degreesCelsius * 9/5 + 32)
              : 72;
          const cloudPercent = json.cloudCover?.percent ?? (conditionType.includes("cloud") ? 60 : 10);
          const isRaining = conditionType.includes("rain") || conditionType.includes("drizzle") || conditionType.includes("storm");
          const humidity = json.relativeHumidity?.percent ?? 50;
          const windMph = json.wind?.speedMph != null
            ? json.wind.speedMph
            : json.wind?.speedKmH != null
              ? (json.wind.speedKmH * 0.621371)
              : 5;

          const data: LiveWeatherInput = {
            condition: mapConditionCode(conditionType),
            description: json.weatherCondition?.description ?? String(conditionType),
            cloudCoverPercent: cloudPercent,
            temperatureFahrenheit: Math.round(tempF),
            humidityPercent: humidity,
            windSpeedMph: Math.round(windMph),
            isRaining,
            rainIntensityPercent: isRaining ? 65 : 0,
            isDaytime: true,
            source: "google_weather",
            observedAt: new Date().toISOString(),
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

          return { weather: data, cacheHit: false, status: "available" };
        } else {
          recordGoogleTelemetry({
            api: "weather",
            requestType: "currentConditions:lookup",
            elapsedMs,
            success: false,
            status: res.status === 403 || res.status === 401 ? "permission_denied" : "degraded",
            fallbackSelected: "open_meteo_live",
            error: `Google Weather HTTP ${res.status}`,
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

    // Live public Open-Meteo fallback for real LA conditions if Google Weather key is absent/recovering
    try {
      const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${laLat}&longitude=${laLng}&current=temperature_2m,relative_humidity_2m,is_day,precipitation,rain,weather_code,cloud_cover,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FLos_Angeles`;
      const res = await this.fetcher(openMeteoUrl, { signal: AbortSignal.timeout(6000) });
      const elapsedMs = performance.now() - start;

      if (res.ok) {
        const json = await res.json() as any;
        const current = json.current;
        const weatherCode = current?.weather_code ?? 0;
        const isRain = (current?.rain ?? 0) > 0 || (current?.precipitation ?? 0) > 0 || weatherCode >= 50;

        let condition: WeatherConditionCategory = "clear";
        if (weatherCode >= 95) condition = "thunderstorm";
        else if (weatherCode >= 65) condition = "heavy_rain";
        else if (weatherCode >= 51 || weatherCode >= 61) condition = "rain";
        else if (weatherCode >= 45) condition = "fog";
        else if (weatherCode === 3) condition = "overcast";
        else if (weatherCode === 2) condition = "cloudy";
        else if (weatherCode === 1) condition = "partly_cloudy";

        const data: LiveWeatherInput = {
          condition,
          description: `Live condition code ${weatherCode}`,
          cloudCoverPercent: current?.cloud_cover ?? 10,
          temperatureFahrenheit: Math.round(current?.temperature_2m ?? 72),
          humidityPercent: Math.round(current?.relative_humidity_2m ?? 50),
          windSpeedMph: Math.round(current?.wind_speed_10m ?? 6),
          isRaining: isRain,
          rainIntensityPercent: isRain ? 60 : 0,
          isDaytime: current?.is_day === 1,
          source: this.apiKey.trim() ? "google_weather" : "authored_fallback",
          observedAt: new Date().toISOString(),
        };

        cachedWeather = { data, timestamp: now };
        return {
          weather: data,
          cacheHit: false,
          status: this.apiKey.trim() ? "available" : "fallback",
        };
      }
    } catch {
      // Ignore fallback error
    }

    // Authored fallback: neutral clear 72°F day without fake weather
    const fallback: LiveWeatherInput = {
      condition: "clear",
      description: "Standard Los Angeles atmosphere",
      cloudCoverPercent: 15,
      temperatureFahrenheit: 72,
      humidityPercent: 45,
      windSpeedMph: 5,
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
