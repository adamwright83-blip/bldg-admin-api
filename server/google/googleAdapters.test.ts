import { describe, expect, it, vi } from "vitest";
import { GoogleWeatherService } from "./googleWeatherService";
import { GoogleAirQualityService } from "./googleAirQualityService";
import { GoogleAddressValidationService } from "./googleAddressValidationService";
import { GooglePlacesService } from "./googlePlacesService";
import { GooglePlacesAggregateService } from "./googlePlacesAggregateService";
import { GoogleAerialViewService } from "./googleAerialViewService";
import { GoogleStreetViewService } from "./googleStreetViewService";

describe("Google Service Adapters Suite", () => {
  describe("GoogleWeatherService", () => {
    it("parses Google Weather API payload correctly", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          weatherCondition: { condition: "partly_cloudy", description: "Partly Cloudy" },
          temperature: { degreesFahrenheit: 74 },
          cloudCover: { percent: 40 },
          relativeHumidity: { percent: 55 },
          wind: { speedMph: 8 },
        }),
      });

      const service = new GoogleWeatherService("mock-key", mockFetch as any);
      const result = await service.getCurrentLosAngelesWeather(true);

      expect(result.status).toBe("available");
      expect(result.weather.condition).toBe("partly_cloudy");
      expect(result.weather.temperatureFahrenheit).toBe(74);
      expect(result.weather.cloudCoverPercent).toBe(40);
      expect(result.weather.isRaining).toBe(false);
      expect(result.weather.source).toBe("google_weather");
    });

    it("falls back gracefully when unconfigured", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          current: {
            weather_code: 0,
            temperature_2m: 72,
            relative_humidity_2m: 50,
            wind_speed_10m: 5,
            cloud_cover: 10,
            is_day: 1,
          },
        }),
      });

      const service = new GoogleWeatherService("", mockFetch as any);
      const result = await service.getCurrentLosAngelesWeather(true);

      expect(result.weather.temperatureFahrenheit).toBe(72);
      expect(result.weather.isRaining).toBe(false);
    });
  });

  describe("GoogleAirQualityService", () => {
    it("returns unknown AQ without clean air assumption when unconfigured", async () => {
      const service = new GoogleAirQualityService("");
      const result = await service.getCurrentLosAngelesAirQuality(true);

      expect(result.status).toBe("unconfigured");
      expect(result.airQuality.aqi).toBe(null);
      expect(result.airQuality.category).toBe("unknown");
      expect(result.airQuality.source).toBe("unknown");
    });

    it("parses Google Air Quality payload correctly", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          indexes: [
            { code: "usa_epa", aqi: 125, category: "Unhealthy for Sensitive Groups", dominantPollutant: "pm25" },
          ],
        }),
      });

      const service = new GoogleAirQualityService("mock-key", mockFetch as any);
      const result = await service.getCurrentLosAngelesAirQuality(true);

      expect(result.status).toBe("available");
      expect(result.airQuality.aqi).toBe(125);
      expect(result.airQuality.category).toBe("unhealthy_sensitive");
      expect(result.airQuality.dominantPollutant).toBe("pm25");
      expect(result.airQuality.source).toBe("google_air_quality");
    });
  });

  describe("GoogleAddressValidationService", () => {
    it("parses address validation response into normalized postal components", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            verdict: { addressComplete: true, validationGranularity: "PREMISE" },
            address: {
              formattedAddress: "3545 Wilshire Blvd, Los Angeles, CA 90010-2305, USA",
              postalAddress: {
                addressLines: ["3545 Wilshire Blvd"],
                locality: "Los Angeles",
                administrativeArea: "CA",
                postalCode: "90010-2305",
              },
            },
            geocode: {
              location: { latitude: 34.0618, longitude: -118.3011 },
              plusCode: { globalCode: "85633P6X+PH" },
            },
          },
        }),
      });

      const service = new GoogleAddressValidationService("mock-key", mockFetch as any);
      const result = await service.validateAddress("3545 Wilshire Blvd, Los Angeles");

      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.formattedAddress).toContain("3545 Wilshire Blvd");
        expect(result.latitude).toBeCloseTo(34.0618, 3);
        expect(result.longitude).toBeCloseTo(-118.3011, 3);
        expect(result.isComplete).toBe(true);
      }
    });
  });

  describe("GooglePlacesService", () => {
    it("extracts place details with proper photo attribution", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "ChIJMockPlaceId",
          displayName: { text: "OPUS LA" },
          formattedAddress: "3545 Wilshire Blvd, Los Angeles, CA 90010",
          location: { latitude: 34.0618, longitude: -118.3011 },
          primaryType: "apartment_building",
          photos: [
            {
              name: "places/ChIJMockPlaceId/photos/photo123",
              widthPx: 1920,
              heightPx: 1080,
              authorAttributions: [
                { displayName: "John Contributor", uri: "https://maps.google.com/contrib/123" },
              ],
            },
          ],
        }),
      });

      const service = new GooglePlacesService("mock-key", mockFetch as any);
      const result = await service.getPlaceDetails("ChIJMockPlaceId");

      expect(result.status).toBe("available");
      expect(result.place?.displayName).toBe("OPUS LA");
      expect(result.place?.primaryPhotoAttribution?.displayName).toBe("John Contributor");
      expect(result.place?.primaryPhotoUri).toContain("places/ChIJMockPlaceId/photos/photo123/media");
    });
  });

  describe("GoogleAerialViewService", () => {
    it("handles active aerial video metadata lookup", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "aerial-video-1",
          state: "ACTIVE",
          uris: {
            MP4_HIGH: { landscapeUri: "https://aerialview.googleapis.com/video1_hd.mp4" },
          },
        }),
      });

      const service = new GoogleAerialViewService("mock-key", mockFetch as any);
      const result = await service.lookupAerialVideo({
        buildingId: "opus_la",
        address: "3545 Wilshire Blvd, Los Angeles, CA",
      });

      expect(result.status).toBe("active");
      expect(result.videoUri).toBe("https://aerialview.googleapis.com/video1_hd.mp4");
    });
  });

  describe("GoogleStreetViewService", () => {
    it("checks metadata before building image URL with strict attribution", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "OK",
          pano_id: "pano_mock_456",
          location: { lat: 34.0618, lng: -118.3011 },
          copyright: "© 2026 Google",
        }),
      });

      const service = new GoogleStreetViewService("mock-key", mockFetch as any);
      const result = await service.getBuildingFacade({
        buildingId: "opus_la",
        latitude: 34.0618,
        longitude: -118.3011,
        hasGpsProof: false,
      });

      expect(result.status).toBe("available");
      expect(result.hasCoverage).toBe(true);
      expect(result.contextLabel).toBe("Verified facade");
      expect(result.attributionText).toBe("© 2026 Google");
      expect(result.imageUrl).toContain("maps.googleapis.com/maps/api/streetview");
    });

    it("labels GPS-proven arrival accurately", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "OK",
          pano_id: "pano_mock_456",
          copyright: "© 2026 Google",
        }),
      });

      const service = new GoogleStreetViewService("mock-key", mockFetch as any);
      const result = await service.getBuildingFacade({
        buildingId: "opus_la",
        latitude: 34.0618,
        longitude: -118.3011,
        hasGpsProof: true,
      });

      expect(result.contextLabel).toBe("Physical arrival proof");
    });
  });
});
