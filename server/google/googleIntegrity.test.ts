import { afterEach, describe, expect, it, vi } from "vitest";
import { capabilityStateFrom, CAPABILITY_STALE_AFTER_MS, GoogleWorldService } from "./googleWorldService";
import { classifyGoogleFailure, latestGoogleTelemetry, recordGoogleTelemetry } from "./googleTelemetry";
import { GooglePlacesAggregateService, resetPlacesAggregateCacheForTests, STRATEGIC_DISTRICT_CIRCLES } from "./googlePlacesAggregateService";
import { countPresenceByDistrict } from "./districtPresence";
import { GoogleGeocoder } from "../geography/googleGeocoder";
import { fetchTravelLegForTests } from "../integrations/googleMaps/campaignTravelAdapter";
import type { GoogleTelemetryEvent } from "../../shared/googleCapabilities";

const NOW = new Date("2026-10-31T12:00:00Z");
const event = (status: GoogleTelemetryEvent["status"], at: string, success = status === "available"): GoogleTelemetryEvent => ({
  id: `t-${at}`,
  api: "weather",
  requestType: "x",
  elapsedMs: 10,
  success,
  status,
  timestamp: at,
  ...(success ? {} : { error: `failed ${status}` }),
});

describe("provider status reads the newest evidence (finding 1)", () => {
  it("the latest telemetry is the newest event, not the oldest retained one", () => {
    recordGoogleTelemetry({ api: "air_quality", requestType: "x", elapsedMs: 5, success: false, status: "permission_denied", error: "denied" });
    recordGoogleTelemetry({ api: "air_quality", requestType: "x", elapsedMs: 5, success: true, status: "available" });
    // before: .at(-1) on a newest-first log returned the old permission_denied
    expect(latestGoogleTelemetry("air_quality")?.status).toBe("available");
  });

  it("a cache hit is not evidence of a live call", () => {
    recordGoogleTelemetry({ api: "aerial_view", requestType: "x", elapsedMs: 5, success: false, status: "quota_limited", error: "429" });
    recordGoogleTelemetry({ api: "aerial_view", requestType: "x", elapsedMs: 0, success: true, status: "available", cacheHit: true });
    expect(latestGoogleTelemetry("aerial_view")?.status).toBe("quota_limited");
  });
});

describe("capability state from timestamped evidence (findings 1, 2; diagnostics)", () => {
  const base = { name: "weather" as const, hasCredential: true, persisted: null, now: NOW };

  it("a key alone is configured, never verified", () => {
    expect(capabilityStateFrom({ ...base, memory: null }).status).toBe("configured_not_yet_exercised");
    expect(capabilityStateFrom({ ...base, hasCredential: false, memory: null }).status).toBe("unconfigured");
  });

  it("live and verified carries the time Google answered, not the time of the request for status", () => {
    const state = capabilityStateFrom({ ...base, memory: event("available", "2026-10-31T11:00:00.000Z") });
    expect(state.status).toBe("available");
    expect(state.lastCheckedAt).toBe("2026-10-31T11:00:00.000Z");
    expect(state.lastSuccessAt).toBe("2026-10-31T11:00:00.000Z");
    expect(state.fallbackActive).toBe(false);
  });

  it("permission denied, quota and provider errors are told apart, with the error kept", () => {
    for (const status of ["permission_denied", "quota_limited", "provider_error", "degraded"] as const) {
      const state = capabilityStateFrom({ ...base, memory: event(status, "2026-10-31T11:00:00.000Z") });
      expect(state.status).toBe(status);
      expect(state.lastError).toBe(`failed ${status}`);
      expect(state.lastFailureAt).toBe("2026-10-31T11:00:00.000Z");
    }
    // older telemetry's "unavailable" reads as a provider error
    expect(capabilityStateFrom({ ...base, memory: event("unavailable", "2026-10-31T11:00:00.000Z", false) }).status).toBe("provider_error");
  });

  it("evidence older than a day is stale, keeping when it last worked", () => {
    const old = new Date(NOW.getTime() - CAPABILITY_STALE_AFTER_MS - 60_000).toISOString();
    const state = capabilityStateFrom({ ...base, memory: event("available", old) });
    expect(state.status).toBe("stale");
    expect(state.lastSuccessAt).toBe(old);
  });

  it("evidence kept across a restart counts, and the newer of memory and the store wins", () => {
    const persisted = {
      capability: "weather" as const,
      lastStatus: "permission_denied" as const,
      lastCheckedAt: new Date("2026-10-31T10:00:00Z"),
      lastSuccessAt: new Date("2026-10-29T10:00:00Z"),
      lastFailureAt: new Date("2026-10-31T10:00:00Z"),
      lastError: "API not enabled",
      lastLatencyMs: 30,
    };
    const afterRestart = capabilityStateFrom({ ...base, memory: null, persisted });
    expect(afterRestart.status).toBe("permission_denied");
    expect(afterRestart.lastError).toBe("API not enabled");
    expect(afterRestart.lastSuccessAt).toBe("2026-10-29T10:00:00.000Z");
    const fixed = capabilityStateFrom({ ...base, memory: event("available", "2026-10-31T11:30:00.000Z"), persisted });
    expect(fixed.status).toBe("available");
    expect(fixed.lastFailureAt).toBe("2026-10-31T10:00:00.000Z");
  });

  it("geocoding is no longer hard-coded permission_denied", async () => {
    const result = await new GoogleWorldService().getCapabilities(NOW);
    const geocoding = result.capabilities.geocoding;
    // no key in tests: unconfigured, from the same rule as every other capability
    expect(geocoding.status).toBe(geocoding.hasCredential ? expect.any(String) : "unconfigured");
    expect(geocoding.lastError ?? "").not.toContain("returns invalid key error");
    expect(result.capabilities.distance_matrix).toBeDefined();
  });
});

describe("failures are classified the same way everywhere", () => {
  it("reads HTTP and provider statuses", () => {
    expect(classifyGoogleFailure({ httpStatus: 200, providerStatus: "REQUEST_DENIED" })).toBe("permission_denied");
    expect(classifyGoogleFailure({ httpStatus: 403 })).toBe("permission_denied");
    expect(classifyGoogleFailure({ httpStatus: 200, providerStatus: "OVER_QUERY_LIMIT" })).toBe("quota_limited");
    expect(classifyGoogleFailure({ httpStatus: 429 })).toBe("quota_limited");
    expect(classifyGoogleFailure({ httpStatus: 503 })).toBe("provider_error");
    expect(classifyGoogleFailure({ httpStatus: null })).toBe("provider_error");
  });

  it("the geocoder records what the Geocoding API answered", async () => {
    const denied = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "REQUEST_DENIED", error_message: "This API project is not authorized to use this API." }) });
    await new GoogleGeocoder("geo-key", denied as any, "").geocode("1 Main St, Los Angeles");
    expect(latestGoogleTelemetry("geocoding")).toMatchObject({ status: "permission_denied", success: false });
    const ok = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "OK", results: [{ formatted_address: "1 Main St, Los Angeles, CA", place_id: "p", geometry: { location: { lat: 34, lng: -118 } } }] }),
    });
    await new GoogleGeocoder("geo-key", ok as any, "").geocode("1 Main St, Los Angeles");
    expect(latestGoogleTelemetry("geocoding")).toMatchObject({ status: "available", success: true });
  });
});

describe("Places Aggregate keeps failures visible (finding 3)", () => {
  afterEach(() => resetPlacesAggregateCacheForTests());
  const answers = (failing: string[], status = 503) =>
    vi.fn(async (_url: string, init: RequestInit) => {
      const lat = JSON.parse(String(init.body)).filter.locationFilter.circle.latLng.latitude;
      const district = STRATEGIC_DISTRICT_CIRCLES.find(d => d.lat === lat)!;
      return failing.includes(district.districtId)
        ? new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status })
        : Response.json({ count: "40" });
    });

  it("a cached answer keeps its failed districts and its status", async () => {
    let now = Date.parse("2026-10-31T12:00:00Z");
    const fetcher = answers(["koreatown", "hollywood"]);
    const service = new GooglePlacesAggregateService("agg-key", fetcher as any, () => now);
    const first = await service.getLosAngelesOpportunityDensity({ goldlinePresence: {} });
    expect(first.status).toBe("partial");
    now += 60_000;
    const cached = await service.getLosAngelesOpportunityDensity({ goldlinePresence: {} });
    // before: a cache hit was always "available" with no error districts
    expect(cached.cacheHit).toBe(true);
    expect(cached.status).toBe("partial");
    expect(cached.errorDistricts).toEqual(["koreatown", "hollywood"]);
    expect(cached.projection.districts.find(d => d.districtId === "koreatown")!.multiFamilyDensityCount).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(STRATEGIC_DISTRICT_CIRCLES.length);
  });

  it("a failed answer is asked again after the hold, not served for six hours", async () => {
    let now = Date.parse("2026-10-31T12:00:00Z");
    const fetcher = answers(STRATEGIC_DISTRICT_CIRCLES.map(d => d.districtId), 403);
    const service = new GooglePlacesAggregateService("agg-key", fetcher as any, () => now);
    const first = await service.getLosAngelesOpportunityDensity({ goldlinePresence: {} });
    expect(first.status).toBe("unavailable");
    expect(latestGoogleTelemetry("places_aggregate")).toMatchObject({ status: "permission_denied", success: false });
    expect(first.projection.districts.every(d => d.opportunityPressure === "unknown")).toBe(true);
    now += 11 * 60_000;
    await service.getLosAngelesOpportunityDensity({ goldlinePresence: {} });
    expect(fetcher).toHaveBeenCalledTimes(2 * STRATEGIC_DISTRICT_CIRCLES.length);
  });
});

describe("real customer presence reaches the territory (finding 4)", () => {
  const recent = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const long = new Date(Date.now() - 200 * 86_400_000).toISOString();
  const silverLake = { latitude: 34.0839, longitude: -118.2703 };

  it("counts active located customers inside each district's circle, and nobody else", () => {
    const counts = countPresenceByDistrict([
      { totalOrders: 4, firstOrderAt: long, lastOrderAt: recent, location: silverLake },
      { totalOrders: 4, firstOrderAt: long, lastOrderAt: long, location: silverLake }, // lapsed
      { totalOrders: 4, firstOrderAt: long, lastOrderAt: recent, location: null }, // not geocoded
    ]);
    expect(counts.silver_lake).toBe(1);
    expect(counts.koreatown).toBe(0);
  });

  it("the opportunity view passes presence through; unreadable presence is unknown, not empty", async () => {
    resetPlacesAggregateCacheForTests();
    const service = new GoogleWorldService();
    const withPresence = await service.getOpportunityPressure("tenant-a", true, async tenant => {
      expect(tenant).toBe("tenant-a");
      return { silver_lake: 3 };
    });
    const silver = withPresence.projection.districts.find(d => d.districtId === "silver_lake")!;
    // no Places Aggregate key in tests: housing is unknown, so the district is unknown, but presence arrived
    expect(silver.goldlineCustomerCount).toBe(3);
    const unknown = await service.getOpportunityPressure("tenant-a", true, async () => null);
    expect(unknown.projection.districts.every(d => d.goldlineCustomerCount === null)).toBe(true);
  });
});

describe("Distance Matrix failures are visible and not cached forever (finding 6)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("REQUEST_DENIED is recorded as permission denied, and a later success shows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "REQUEST_DENIED", error_message: "This API is not activated on your API project." })));
    const leg = await fetchTravelLegForTests({ latitude: 34.1, longitude: -118.3 }, { latitude: 34.2, longitude: -118.4 }, "a", "b");
    expect(leg.providerState).toBe("unavailable");
    expect(latestGoogleTelemetry("distance_matrix")).toMatchObject({ status: "permission_denied", success: false });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ status: "OK", rows: [{ elements: [{ status: "OK", duration: { value: 600 }, distance: { value: 5000 } }] }] }))
    );
    const other = await fetchTravelLegForTests({ latitude: 34.3, longitude: -118.3 }, { latitude: 34.4, longitude: -118.4 }, "c", "d");
    expect(other.durationSeconds).toBe(600);
    expect(latestGoogleTelemetry("distance_matrix")).toMatchObject({ status: "available", success: true });
  });
});
