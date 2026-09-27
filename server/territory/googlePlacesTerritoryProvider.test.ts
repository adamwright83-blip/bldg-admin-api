import { describe, expect, it, vi } from "vitest";
import { GooglePlacesTerritoryProvider } from "./googlePlacesTerritoryProvider";

describe("GooglePlacesTerritoryProvider", () => {
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

  it("selects the exact street-address property instead of a nearby result", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/geocode/json")) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                formatted_address:
                  "4455 Los Feliz Blvd, Los Angeles, CA 90027, USA",
                geometry: { location: { lat: 34.1126, lng: -118.287 } },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          places: [
            {
              id: "places/grand-residences",
              displayName: { text: "The Grand Residences" },
              formattedAddress:
                "4450 Los Feliz Blvd, Los Angeles, CA 90027, USA",
              location: { latitude: 34.1129, longitude: -118.2865 },
              types: ["apartment_complex", "establishment"],
            },
            {
              id: "places/los-feliz-towers",
              displayName: { text: "Los Feliz Towers" },
              formattedAddress:
                "4455 Los Feliz Blvd, Los Angeles, CA 90027, USA",
              location: { latitude: 34.1126, longitude: -118.287 },
              types: ["apartment_complex", "establishment"],
            },
          ],
        }),
        { status: 200 }
      );
    });

    const target = await new GooglePlacesTerritoryProvider(
      { placesApiKey: "places-secret", geocodingApiKey: "geocoding-secret" },
      fetcher as typeof fetch
    ).resolveBusiness("4455 Los Feliz Blvd, Los Angeles, CA 90027");

    expect(target?.providerId).toBe("places/los-feliz-towers");
    expect(target?.name).toBe("Los Feliz Towers");
  });

  it("resolves an exact place name plus city by matching the place name", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          places: [
            {
              id: "places/jardine",
              displayName: { text: "Jardine Hollywood" },
              formattedAddress:
                "6390 De Longpre Ave, Los Angeles, CA 90028, USA",
              location: { latitude: 34.096, longitude: -118.329 },
              types: ["apartment_complex", "establishment"],
            },
            {
              id: "places/los-feliz-towers",
              displayName: { text: "Los Feliz Towers" },
              formattedAddress:
                "4455 Los Feliz Blvd, Los Angeles, CA 90027, USA",
              location: { latitude: 34.1126, longitude: -118.287 },
              types: ["apartment_complex", "establishment"],
            },
          ],
        }),
        { status: 200 }
      )
    );

    const target = await new GooglePlacesTerritoryProvider(
      { placesApiKey: "places-secret", geocodingApiKey: "geocoding-secret" },
      fetcher as typeof fetch
    ).resolveBusiness("Los Feliz Towers, Los Angeles");

    expect(target?.providerId).toBe("places/los-feliz-towers");
  });

  it("returns null instead of substituting a nearby venue when the exact address has no property", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/geocode/json")) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                formatted_address:
                  "4455 Imaginary Blvd, Los Angeles, CA 90027, USA",
                geometry: { location: { lat: 34.11, lng: -118.28 } },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          places: [
            {
              id: "places/bare-address",
              displayName: { text: "4455 Imaginary Blvd" },
              formattedAddress:
                "4455 Imaginary Blvd, Los Angeles, CA 90027, USA",
              location: { latitude: 34.11, longitude: -118.28 },
              types: ["street_address"],
            },
            {
              id: "places/nearby-property",
              displayName: { text: "Nearby Property" },
              formattedAddress:
                "4459 Imaginary Blvd, Los Angeles, CA 90027, USA",
              location: { latitude: 34.1103, longitude: -118.2802 },
              types: ["apartment_complex", "establishment"],
            },
          ],
        }),
        { status: 200 }
      );
    });

    const target = await new GooglePlacesTerritoryProvider(
      { placesApiKey: "places-secret", geocodingApiKey: "geocoding-secret" },
      fetcher as typeof fetch
    ).resolveBusiness("4455 Imaginary Blvd, Los Angeles, CA 90027");

    expect(target).toBeNull();
  });

});
