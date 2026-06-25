import { describe, expect, it, vi } from "vitest";
import { runGooglePlacesDiscovery } from "./googlePlacesDiscoveryConnector";

function fakeFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body });
}

describe("runGooglePlacesDiscovery -- missing provider key", () => {
  it("returns needs_provider_config when GOOGLE_PLACES_API_KEY is missing, without calling fetch", async () => {
    const fetchImpl = fakeFetch({ places: [] });
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer near 90027", maxResults: 10 },
      { env: {}, fetchImpl },
    );
    expect(result).toEqual({ status: "needs_provider_config", missingEnvVar: "GOOGLE_PLACES_API_KEY" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns needs_provider_config for a blank/whitespace-only key", async () => {
    const fetchImpl = fakeFetch({ places: [] });
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

describe("runGooglePlacesDiscovery -- Places API (New) request shape", () => {
  it("POSTs to the Places API (New) searchText endpoint, not the legacy endpoint", async () => {
    const fetchImpl = fakeFetch({ places: [] });
    await runGooglePlacesDiscovery(
      { searchText: "dog groomer near 90027", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://places.googleapis.com/v1/places:searchText",
      expect.objectContaining({ method: "POST" }),
    );
    const [url] = fetchImpl.mock.calls[0];
    expect(url).not.toContain("maps.googleapis.com/maps/api/place");
  });

  it("sends X-Goog-Api-Key with the real key, never embedding it in the URL", async () => {
    const fetchImpl = fakeFetch({ places: [] });
    await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(url).not.toContain("test-key");
  });

  it("sends X-Goog-FieldMask listing the fields this connector actually normalizes", async () => {
    const fetchImpl = fakeFetch({ places: [] });
    await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers["X-Goog-FieldMask"]).toBe(
      "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.location,places.nationalPhoneNumber,places.websiteUri,places.googleMapsUri",
    );
  });

  it("sends a JSON body containing textQuery", async () => {
    const fetchImpl = fakeFetch({ places: [] });
    await runGooglePlacesDiscovery(
      { searchText: "dog groomer near 90027", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ textQuery: "dog groomer near 90027" });
  });
});

describe("runGooglePlacesDiscovery -- normalization", () => {
  const mockResponse = {
    places: [
      {
        id: "place_1", displayName: { text: "Paw Spa LA" }, rating: 4.9, userRatingCount: 220,
        formattedAddress: "123 Main St, Los Angeles, CA", location: { latitude: 34.1, longitude: -118.3 },
        nationalPhoneNumber: "(323) 555-0100", websiteUri: "https://pawspala.example", googleMapsUri: "https://maps.google.com/?cid=1",
      },
      { id: "place_2", displayName: { text: "Bark Avenue Grooming" }, rating: 4.5, userRatingCount: 80, formattedAddress: "456 Oak Ave, Los Angeles, CA" },
      { id: "place_3", displayName: { text: "No Rating Groomer" } },
    ],
  };

  it("normalizes mocked Places API (New) results into candidate evidence", async () => {
    const fetchImpl = fakeFetch(mockResponse);
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
    expect(first.website).toBe("https://pawspala.example");
    expect(first.phone).toBe("(323) 555-0100");
    expect(first.sourceUrl).toBe("https://maps.google.com/?cid=1");
  });

  it("never fabricates a rating, review count, phone, or website for a result missing them", async () => {
    const fetchImpl = fakeFetch(mockResponse);
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    if (result.status !== "ok") throw new Error("expected ok");
    const noRating = result.candidates.find(candidate => candidate.placeId === "place_3");
    expect(noRating?.rating).toBeNull();
    expect(noRating?.reviewCount).toBeNull();
    expect(noRating?.website).toBeNull();
    expect(noRating?.phone).toBeNull();
  });

  it("drops results missing an id or displayName rather than inventing one", async () => {
    const fetchImpl = fakeFetch({ places: [{ displayName: { text: "No place id" } }, { id: "p4" }] });
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.candidates).toHaveLength(0);
  });

  it("applies the rating threshold filter", async () => {
    const fetchImpl = fakeFetch(mockResponse);
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", minRating: 4.7, maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].businessName).toBe("Paw Spa LA");
  });

  it("applies the target-count limit", async () => {
    const fetchImpl = fakeFetch(mockResponse);
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 1 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.candidates).toHaveLength(1);
  });

  it("returns an empty, honest result set when no places are returned, rather than an error or fake data", async () => {
    const fetchImpl = fakeFetch({ places: [] });
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    expect(result).toEqual({ status: "ok", candidates: [] });
  });

  it("returns an empty result set when the places field is entirely absent from the response", async () => {
    const fetchImpl = fakeFetch({});
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    expect(result).toEqual({ status: "ok", candidates: [] });
  });
});

describe("runGooglePlacesDiscovery -- provider error diagnostics", () => {
  it("surfaces Google's status/message on a denied request, without leaking the API key", async () => {
    const fetchImpl = fakeFetch(
      { error: { code: 403, message: "API key not authorized to use this API.", status: "PERMISSION_DENIED" } },
      false, 403,
    );
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "super-secret-key" }, fetchImpl },
    );
    expect(result).toEqual({
      status: "provider_error",
      reason: "PERMISSION_DENIED",
      providerStatus: "PERMISSION_DENIED",
      providerMessage: "API key not authorized to use this API.",
      endpointFamily: "places_api_new",
    });
    expect(JSON.stringify(result)).not.toContain("super-secret-key");
  });

  it("falls back to an http_<status> reason when Google's error body has no status field", async () => {
    const fetchImpl = fakeFetch({}, false, 500);
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    expect(result).toEqual({ status: "provider_error", reason: "http_500", endpointFamily: "places_api_new" });
  });

  it("surfaces a provider_error on a network failure rather than throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    expect(result).toEqual({ status: "provider_error", reason: "request_failed", endpointFamily: "places_api_new" });
  });

  it("surfaces a provider_error on an invalid JSON response rather than throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } });
    const result = await runGooglePlacesDiscovery(
      { searchText: "dog groomer", maxResults: 10 },
      { env: { GOOGLE_PLACES_API_KEY: "test-key" }, fetchImpl },
    );
    expect(result).toEqual({ status: "provider_error", reason: "invalid_response", endpointFamily: "places_api_new" });
  });
});

describe("runGooglePlacesDiscovery -- isolation", () => {
  it("never imports or calls an outreach/send adapter, and never logs the API key", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "googlePlacesDiscoveryConnector.ts"), "utf8");
    expect(source).not.toMatch(/agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid/i);
    expect(source).not.toMatch(/provider_accepted|booking_confirmed|payment_authorized|\bdispatched\b/);
    expect(source).not.toMatch(/console\.(log|error|warn|info)\(/);
  });
});
