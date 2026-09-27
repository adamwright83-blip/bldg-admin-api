import { describe, expect, it, vi } from "vitest";
import { GooglePlacesTerritoryProvider } from "./googlePlacesTerritoryProvider";

describe("GooglePlacesTerritoryProvider", () => {
  it("returns the exact first Google Place for a property/address query", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body).toEqual({
        textQuery: "Los Feliz Towers 4455 Los Feliz Blvd",
        maxResultCount: 1,
      });
      return new Response(
        JSON.stringify({
          places: [
            {
              id: "los-feliz-towers",
              displayName: { text: "Los Feliz Towers" },
              formattedAddress: "4455 Los Feliz Blvd, Los Angeles, CA 90027",
              location: { latitude: 34.112, longitude: -118.287 },
              types: ["apartment_complex"],
              googleMapsUri: "https://maps.example/los-feliz-towers",
            },
          ],
        }),
        { status: 200 }
      );
    });
    const result = await new GooglePlacesTerritoryProvider(
      { placesApiKey: "places-secret", geocodingApiKey: "geo-secret" },
      fetcher as typeof fetch
    ).searchExactBusiness("Los Feliz Towers 4455 Los Feliz Blvd");
    expect(result?.providerId).toBe("los-feliz-towers");
    expect(result?.name).toBe("Los Feliz Towers");
    expect(result?.formattedAddress).toContain("4455 Los Feliz Blvd");
  });

  it("uses the dedicated geocoding key without exposing it in the result", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("key")).toBe("geocoding-secret");
      expect(url.searchParams.get("key")).not.toBe("places-secret");
      return new Response(JSON.stringify({ status: "OK", results: [{ formatted_address: "922 N Alvarado St, Los Angeles, CA", geometry: { location: { lat: 34.07, lng: -118.25 } } }] }), { status: 200 });
    });
    const result = await new GooglePlacesTerritoryProvider(
      { placesApiKey: "places-secret", geocodingApiKey: "geocoding-secret" },
      fetcher as typeof fetch
    ).geocode("Sunset Laundry");
    expect(result.formattedAddress).toContain("Los Angeles");
    expect(JSON.stringify(result)).not.toContain("geocoding-secret");
  });

  it("uses the dedicated Places key and normalizes Places API facts", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("X-Goog-Api-Key")).toBe("places-secret");
      expect(headers.get("X-Goog-Api-Key")).not.toBe("geocoding-secret");
      return new Response(JSON.stringify({ places: [{ id: "place-1", displayName: { text: "Harbor Hotel" }, formattedAddress: "1 Main St", location: { latitude: 34.1, longitude: -118.2 }, types: ["hotel"], websiteUri: "https://hotel.example", googleMapsUri: "https://maps.example/place-1" }] }), { status: 200 });
    });
    const results = await new GooglePlacesTerritoryProvider(
      { placesApiKey: "places-secret", geocodingApiKey: "geocoding-secret" },
      fetcher as typeof fetch
    ).searchBusinesses({ center: { lat: 34, lng: -118, formattedAddress: "LA" }, radiusMiles: 3, categories: ["hotel"], limit: 10 });
    expect(results[0]).toMatchObject({ providerId: "place-1", providerName: "google_places", name: "Harbor Hotel", providerUrl: "https://maps.example/place-1" });
    expect(results[0]?.sourceCapturedAt).toMatch(/^\d{4}-/);
  });
});
