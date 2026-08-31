import { describe, expect, it } from "vitest";
import { GoogleWorldService, CANONICAL_BUILDING_GEO } from "./googleWorldService";
import { recordGoogleTelemetry, getGoogleTelemetryLogs } from "./googleTelemetry";

describe("GoogleWorldService Suite", () => {
  it("projects all 10 Google capabilities without leaking secrets", async () => {
    const service = new GoogleWorldService();
    const result = await service.getCapabilities();

    expect(result.capabilities.geocoding).toBeDefined();
    expect(result.capabilities.address_validation).toBeDefined();
    expect(result.capabilities.places).toBeDefined();
    expect(result.capabilities.places_aggregate).toBeDefined();
    expect(result.capabilities.maps_javascript).toBeDefined();
    expect(result.capabilities.map_tiles).toBeDefined();
    expect(result.capabilities.aerial_view).toBeDefined();
    expect(result.capabilities.street_view_static).toBeDefined();
    expect(result.capabilities.weather).toBeDefined();
    expect(result.capabilities.air_quality).toBeDefined();

    // Verify no secret keys exist in the returned capability object
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("AIza");
    expect(serialized).not.toContain("sk_");
  });

  it("exposes canonical coordinates for OPUS LA and Century Park East", () => {
    expect(CANONICAL_BUILDING_GEO.opus_la.latitude).toBeCloseTo(34.0618, 3);
    expect(CANONICAL_BUILDING_GEO.opus_la.longitude).toBeCloseTo(-118.3011, 3);

    expect(CANONICAL_BUILDING_GEO.century_park_east.latitude).toBeCloseTo(34.0591, 3);
    expect(CANONICAL_BUILDING_GEO.century_park_east.longitude).toBeCloseTo(-118.4147, 3);
  });

  it("records telemetry safely without logging credentials", () => {
    const logged = recordGoogleTelemetry({
      api: "places",
      requestType: "places:get",
      elapsedMs: 42,
      success: true,
      status: "available",
      error: "Failed with key=AIzaSySecretKey12345 in url",
    });

    expect(logged.api).toBe("places");
    expect(logged.elapsedMs).toBe(42);
    expect(logged.error).not.toContain("AIzaSySecretKey12345");
    expect(logged.error).toContain("key=[redacted]");

    const all = getGoogleTelemetryLogs();
    expect(all.length).toBeGreaterThan(0);
  });
});
