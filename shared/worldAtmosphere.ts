/**
 * Living Los Angeles World Atmosphere.
 * Translates real weather and air quality conditions into bounded CSS variables.
 *
 * ABSOLUTE EXPERIENCE LAWS:
 * 1. Missing AQ means NO AQ MODULATION (unknown AQ), NOT clean air.
 * 2. Missing Weather means authored time-of-day baseline without invented weather.
 * 3. Rain requires actual current precipitation, not probability.
 * 4. Atmosphere modulates the ground and sky, NEVER business state signals.
 */

export type WeatherConditionCategory =
  | "clear"
  | "partly_cloudy"
  | "cloudy"
  | "overcast"
  | "fog"
  | "drizzle"
  | "rain"
  | "heavy_rain"
  | "thunderstorm"
  | "windy";

export type AirQualityCategory =
  | "good"
  | "moderate"
  | "unhealthy_sensitive"
  | "unhealthy"
  | "very_unhealthy"
  | "hazardous"
  | "unknown";

export type LiveWeatherInput = {
  condition: WeatherConditionCategory;
  description: string;
  cloudCoverPercent: number; // 0 to 100
  temperatureFahrenheit: number;
  humidityPercent: number;
  windSpeedMph: number;
  windDirectionDegrees?: number;
  isRaining: boolean;
  rainIntensityPercent?: number; // 0 to 100
  visibilityMiles?: number;
  isDaytime: boolean;
  sunriseIso?: string;
  sunsetIso?: string;
  source: "google_weather" | "authored_fallback";
  observedAt: string;
};

export type LiveAirQualityInput = {
  aqi: number | null; // Universal AQI or US AQI
  category: AirQualityCategory;
  dominantPollutant?: string | null;
  source: "google_air_quality" | "unknown";
  observedAt: string;
};

export type WorldAtmosphereProjection = {
  generatedAt: string;
  dayPhase: "dawn" | "day" | "dusk" | "night";
  statusBadge: string; // e.g. "LA WORLD · NIGHT · HAZY" or "LA WORLD · CLEAR · 72°F"
  weather: LiveWeatherInput | null;
  airQuality: LiveAirQualityInput | null;
  /** Bounded CSS variables to apply to the world root */
  cssVariables: {
    "--world-cloud": string; // 0.00 to 1.00
    "--world-haze": string; // 0.00 to 0.65 (clamped to prevent washing out business signals)
    "--world-visibility": string; // 0.35 to 1.00 (clamped so world never blanks)
    "--world-wetness": string; // 0.00 to 1.00
    "--world-wind": string; // 0.00 to 1.00
    "--world-light-temperature": string; // 0.0 (warm/golden) to 1.0 (cool/overcast)
    "--world-sky-luminance": string; // 0.05 to 1.00
    "--world-atmosphere-contrast": string; // 0.70 to 1.00 (preserves readable contrast)
    "--world-rain-density": string; // 0.00 to 1.00
    "--world-ground-saturation": string; // 0.60 to 1.10
  };
  hasWeatherModulation: boolean;
  hasAirQualityModulation: boolean;
};

/** Derives Los Angeles local time-of-day phase */
export function deriveLosAngelesDayPhase(now = new Date()): "dawn" | "day" | "dusk" | "night" {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find(p => p.type === "hour")?.value ?? 12);
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 18) return "day";
  if (hour >= 18 && hour < 21) return "dusk";
  return "night";
}

/**
 * Computes the authoritative Living Los Angeles atmosphere projection.
 */
export function projectWorldAtmosphere(input: {
  now?: Date;
  weather?: LiveWeatherInput | null;
  airQuality?: LiveAirQualityInput | null;
}): WorldAtmosphereProjection {
  const now = input.now ?? new Date();
  const dayPhase = deriveLosAngelesDayPhase(now);
  const weather = input.weather ?? null;
  const airQuality = input.airQuality ?? null;

  // Baseline time-of-day values
  let baseSkyLuminance = 1.0;
  let baseLightTemp = 0.5; // neutral

  switch (dayPhase) {
    case "dawn":
      baseSkyLuminance = 0.55;
      baseLightTemp = 0.25; // golden/warm
      break;
    case "day":
      baseSkyLuminance = 0.95;
      baseLightTemp = 0.45; // crisp daylight
      break;
    case "dusk":
      baseSkyLuminance = 0.45;
      baseLightTemp = 0.15; // deep amber/dusk
      break;
    case "night":
      baseSkyLuminance = 0.15;
      baseLightTemp = 0.85; // midnight cool
      break;
  }

  // Weather modulation (only if authentic weather data exists)
  let cloudValue = 0.0;
  let wetnessValue = 0.0;
  let windValue = 0.0;
  let rainDensity = 0.0;
  let skyLuminance = baseSkyLuminance;
  let lightTemp = baseLightTemp;
  const hasWeatherModulation = weather !== null && weather.source === "google_weather";

  if (hasWeatherModulation && weather) {
    cloudValue = Math.max(0, Math.min(1, weather.cloudCoverPercent / 100));
    windValue = Math.max(0, Math.min(1, weather.windSpeedMph / 35));

    // Wetness and rain density strictly require actual rain
    if (weather.isRaining) {
      rainDensity = Math.max(0.2, Math.min(1.0, (weather.rainIntensityPercent ?? 50) / 100));
      wetnessValue = Math.max(0.4, rainDensity);
      // Overcast / rain cools the light and reduces sky luminance
      skyLuminance = Math.max(0.1, baseSkyLuminance * (1 - cloudValue * 0.4));
      lightTemp = Math.min(1.0, baseLightTemp + 0.25);
    } else if (weather.condition === "fog") {
      skyLuminance = Math.max(0.2, baseSkyLuminance * 0.7);
      cloudValue = Math.max(0.8, cloudValue);
    } else if (cloudValue > 0.5) {
      skyLuminance = Math.max(0.12, baseSkyLuminance * (1 - (cloudValue - 0.5) * 0.3));
    }
  }

  // Air Quality modulation (only if authentic AQ data exists)
  // RULE: Missing AQ means 0 haze modulation, not assumed "good".
  let hazeValue = 0.0;
  let visibilityValue = 1.0;
  let atmosphereContrast = 1.0;
  let groundSaturation = 1.0;
  const hasAirQualityModulation = airQuality !== null && airQuality.source === "google_air_quality" && airQuality.aqi !== null;

  if (hasAirQualityModulation && airQuality && airQuality.aqi !== null) {
    const aqi = airQuality.aqi;
    if (aqi <= 50) {
      // Clean air: zero haze, maximum crispness
      hazeValue = 0.02;
      visibilityValue = 1.0;
      atmosphereContrast = 1.0;
      groundSaturation = 1.02;
    } else if (aqi <= 100) {
      // Moderate: slight realistic distance haze
      hazeValue = 0.12;
      visibilityValue = 0.90;
      atmosphereContrast = 0.96;
      groundSaturation = 0.98;
    } else if (aqi <= 150) {
      // Unhealthy for sensitive groups: noticeable haze
      hazeValue = 0.28;
      visibilityValue = 0.78;
      atmosphereContrast = 0.90;
      groundSaturation = 0.92;
    } else if (aqi <= 200) {
      // Unhealthy: thick haze layer
      hazeValue = 0.45;
      visibilityValue = 0.65;
      atmosphereContrast = 0.82;
      groundSaturation = 0.85;
    } else {
      // Very unhealthy / hazardous: clamped so business signals remain legible
      hazeValue = 0.60;
      visibilityValue = 0.50;
      atmosphereContrast = 0.75;
      groundSaturation = 0.78;
    }
  } else if (weather?.condition === "fog") {
    // Natural weather fog creates haze even without AQ pollution
    hazeValue = 0.40;
    visibilityValue = 0.60;
  }

  // Generate short badge
  const weatherLabel = weather?.condition ? weather.condition.replace(/_/g, " ").toUpperCase() : "";
  const tempLabel = weather?.temperatureFahrenheit ? `${Math.round(weather.temperatureFahrenheit)}°F` : "";
  const aqLabel = hasAirQualityModulation && airQuality?.category && airQuality.category !== "good"
    ? airQuality.category.replace(/_/g, " ").toUpperCase()
    : "";

  const badgeTokens = ["LA WORLD", dayPhase.toUpperCase()];
  if (tempLabel) badgeTokens.push(tempLabel);
  if (weatherLabel && weatherLabel !== "CLEAR") badgeTokens.push(weatherLabel);
  if (aqLabel) badgeTokens.push(`AQ: ${aqLabel}`);
  const statusBadge = badgeTokens.join(" · ");

  return {
    generatedAt: now.toISOString(),
    dayPhase,
    statusBadge,
    weather,
    airQuality,
    cssVariables: {
      "--world-cloud": cloudValue.toFixed(2),
      "--world-haze": hazeValue.toFixed(2),
      "--world-visibility": visibilityValue.toFixed(2),
      "--world-wetness": wetnessValue.toFixed(2),
      "--world-wind": windValue.toFixed(2),
      "--world-light-temperature": lightTemp.toFixed(2),
      "--world-sky-luminance": skyLuminance.toFixed(2),
      "--world-atmosphere-contrast": atmosphereContrast.toFixed(2),
      "--world-rain-density": rainDensity.toFixed(2),
      "--world-ground-saturation": groundSaturation.toFixed(2),
    },
    hasWeatherModulation,
    hasAirQualityModulation,
  };
}
