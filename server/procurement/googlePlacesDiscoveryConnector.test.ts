import { describe, expect, it, vi } from "vitest";
import { runGooglePlacesDiscovery } from "./googlePlacesDiscoveryConnector";

function fakeFetch(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({ ok, json: async () => body });
}

describe("runGooglePlacesDiscovery -- missing provider key", () => {
  it("returns needs_provider_config when GOOGLE_PLACES_API_KEY is missing, without calling fetch", async () => {
    const fetchImpl = fakeFetch({ status: "OK", results: [] });
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer near 90027", maxResults: 10 },
      { env: {}, fetchImpl },
    );
    expect(result).toEqual({ status: "needs_provider_config", missingEnvVar: "GOOGLE_PLACES_API_KEY" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns needs_provider_config for a blank/whitespace-only key", async () => {
    const fetchImpl = fakeFetch({ status: "OK", results: [] });
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "   " }, fetchImpl },
    );
    expect(result.status).toBe("needs_provider_config");
  });

  it("never fabricates a candidate when the key is missing", async () => {
    const result = await runGooglePlacesDiscovery({ searchText: "dog groomer", maxResults: 10 }, { env: {} });
    expect(result).toEqual({ status: "needs_provider_config", missingEnvVar: "GOOGLE_PLACES_API_KEY" });
  });
});

describe("runGooglePlacesDiscovery -- normalization", () => {
  const mockResults = {
    status: "OK",
    results: [
      { place_id: "place_1", name: "Paw Spa LA", rating: 4.9, user_ratings_total: 220, formatted_address: "123 Main St, Los Angeles, CA", geometry: { location: { lat: 34.1, lng: -118.3 } } },
      { place_id: "place_2", name: "Bark Avenue Grooming", rating: 4.5, user_ratings_total: 80, formatted_address: "456 Oak Ave, Los Angeles, CA" },
      { place_id: "place_3", name: "No Rating Groomer" },
    ],
  };

  it("normalizes mocked Google Places results into candidate evidence, never inventing phone/website", async () => {
    const fetchImpl = fakeFetch(mockResults);
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer near 90027", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.candidates).toHaveLength(3);
    const first = result.candidates[0];
    expect(first.provider).toBe("google_places");
    expect(first.placeId).toBe("place_1");
    expect(first.businessName).toBe("Paw Spa LA");
    expect(first.rating).toBe(4.9);
    expect(first.reviewCount).toBe(220);
    expect(first.website).toBeNull();
    expect(first.phone).toBeNull();
    expect(first.sourceUrl).toBe("https://www.google.com/maps/place/?q=place_id:place_1");
  });

  it("never fabricates a rating or review count for a result missing them", async () => {
    const fetchImpl = fakeFetch(mockResults);
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    if (result.status !== "ok") throw new Error("expected ok");
    const noRating = result.candidates.find(candidate => candidate.placeId === "place_3");
    expect(noRating?.rating).toBeNull();
    expect(noRating?.reviewCount).toBeNull();
  });

  it("drops results missing a place_id or name rather than inventing one", async () => {
    const fetchImpl = fakeFetch({ status: "OK", results: [{ name: "No place id" }, { place_id: "p4" }] });
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.candidates).toHaveLength(0);
  });

  it("applies the rating threshold filter", async () => {
    const fetchImpl = fakeFetch(mockResults);
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", minRating: 4.7, maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].businessName).toBe("Paw Spa LA");
  });

  it("applies the target-count limit", async () => {
    const fetchImpl = fakeFetch(mockResults);
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 1 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.candidates).toHaveLength(1);
  });

  it("returns an empty, honest result set on ZERO_RESULTS rather than an error or fake data", async () => {
    const fetchImpl = fakeFetch({ status: "ZERO_RESULTS", results: [] });
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    expect(result).toEqual({ status: "ok", candidates: [] });
  });

  it("surfaces a provider_error on a non-OK Google status rather than throwing", async () => {
    const fetchImpl = fakeFetch({ status: "REQUEST_DENIED", error_message: "bad key" });
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    expect(result).toEqual({ status: "provider_error", reason: "REQUEST_DENIED" });
  });

  it("surfaces a provider_error on a non-ok HTTP response rather than throwing", async () => {
    const fetchImpl = fakeFetch({}, false);
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    expect(result).toEqual({ status: "provider_error", reason: "request_failed" });
  });
});

describe("runGooglePlacesDiscovery -- isolation", () => {
  it("never imports or calls an outreach/send adapter", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "googlePlacesDiscoveryConnector.ts"), "utf8");
    expect(source).not.toMatch(/agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid/i);
    expect(source).not.toMatch(/provider_accepted|booking_confirmed|payment_authorized|\bdispatched\b/);
  });
});
