import { describe, expect, it } from "vitest";
import {
  deriveLosAngelesDayPhase,
  projectWorldAtmosphere,
  type LiveAirQualityInput,
  type LiveWeatherInput,
} from "./worldAtmosphere";

describe("Living Los Angeles Atmosphere Calculator", () => {
  it("derives correct local day phase for Los Angeles", () => {
    // 2026-08-31 12:00 PM LA time (2026-08-31T19:00:00Z)
    const midday = new Date("2026-08-31T19:00:00Z");
    expect(deriveLosAngelesDayPhase(midday)).toBe("day");

    // 2026-08-31 11:00 PM LA time (2026-09-01T06:00:00Z)
    const night = new Date("2026-09-01T06:00:00Z");
    expect(deriveLosAngelesDayPhase(night)).toBe("night");
  });

  it("RULE 1: Missing Air Quality produces NO AQ modulation, NOT clean air", () => {
    const atmo = projectWorldAtmosphere({
      now: new Date("2026-08-31T19:00:00Z"),
      airQuality: null,
    });

    expect(atmo.hasAirQualityModulation).toBe(false);
    expect(atmo.airQuality).toBe(null);
    expect(atmo.cssVariables["--world-haze"]).toBe("0.00");
    expect(atmo.statusBadge).not.toContain("GOOD");
  });

  it("RULE 2: Missing Weather uses authored day phase without invented rain or fog", () => {
    const atmo = projectWorldAtmosphere({
      now: new Date("2026-08-31T19:00:00Z"),
      weather: null,
    });

    expect(atmo.hasWeatherModulation).toBe(false);
    expect(atmo.cssVariables["--world-rain-density"]).toBe("0.00");
    expect(atmo.cssVariables["--world-wetness"]).toBe("0.00");
    expect(atmo.cssVariables["--world-cloud"]).toBe("0.00");
  });

  it("RULE 3: Rain requires actual current precipitation truth", () => {
    const dryWeather: LiveWeatherInput = {
      condition: "cloudy",
      description: "Cloudy with 60% chance of rain",
      cloudCoverPercent: 80,
      temperatureFahrenheit: 68,
      humidityPercent: 75,
      windSpeedMph: 10,
      isRaining: false,
      isDaytime: true,
      source: "google_weather",
      observedAt: new Date().toISOString(),
    };

    const dryAtmo = projectWorldAtmosphere({ weather: dryWeather });
    expect(dryAtmo.cssVariables["--world-rain-density"]).toBe("0.00");
    expect(dryAtmo.cssVariables["--world-wetness"]).toBe("0.00");

    const rainWeather: LiveWeatherInput = {
      condition: "rain",
      description: "Steady rainfall",
      cloudCoverPercent: 95,
      temperatureFahrenheit: 62,
      humidityPercent: 90,
      windSpeedMph: 14,
      isRaining: true,
      rainIntensityPercent: 70,
      isDaytime: true,
      source: "google_weather",
      observedAt: new Date().toISOString(),
    };

    const rainAtmo = projectWorldAtmosphere({ weather: rainWeather });
    expect(Number(rainAtmo.cssVariables["--world-rain-density"])).toBeGreaterThan(0.5);
    expect(Number(rainAtmo.cssVariables["--world-wetness"])).toBeGreaterThan(0.5);
  });

  it("RULE 4: Atmosphere modulates background while preserving business signal contrast", () => {
    const hazardousAq: LiveAirQualityInput = {
      aqi: 350,
      category: "hazardous",
      source: "google_air_quality",
      observedAt: new Date().toISOString(),
    };

    const atmo = projectWorldAtmosphere({ airQuality: hazardousAq });
    // Contrast is clamped to never fall below 0.70 so TODAY red / revenue gold remain sharp
    expect(Number(atmo.cssVariables["--world-atmosphere-contrast"])).toBeGreaterThanOrEqual(0.70);
    // Haze is bounded to never exceed 0.60
    expect(Number(atmo.cssVariables["--world-haze"])).toBeLessThanOrEqual(0.65);
    expect(atmo.statusBadge).toContain("HAZARDOUS");
  });
});
