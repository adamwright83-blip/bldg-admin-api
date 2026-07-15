import { describe, expect, it, vi } from "vitest";
import { GooglePlacesTerritoryProvider } from "./googlePlacesTerritoryProvider";

describe("GooglePlacesTerritoryProvider", () => {
  it("resolves an address through Places without requiring the Geocoding API", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            places: [
              {
                id: "address-1",
                displayName: { text: "Sunset Laundry" },
                formattedAddress: "922 N Alvarado St, Los Angeles, CA",
                location: { latitude: 34.07, longitude: -118.25 },
              },
            ],
          }),
          { status: 200 }
        )
    );
    const result = await new GooglePlacesTerritoryProvider(
      "server-secret",
      fetcher as typeof fetch
    ).geocode("Sunset Laundry");
    expect(result.formattedAddress).toContain("Los Angeles");
    expect(JSON.stringify(result)).not.toContain("server-secret");
    expect(fetcher).toHaveBeenCalledWith(
      "https://places.googleapis.com/v1/places:searchText",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("classifies an empty Places address lookup as an address miss", async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({}), { status: 200 })
    );
    await expect(
      new GooglePlacesTerritoryProvider(
        "server-secret",
        fetcher as typeof fetch
      ).geocode("Unknown place")
    ).rejects.toThrow("ZERO_RESULTS");
  });

  it("normalizes Places API facts with capture time and source URL", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            places: [
              {
                id: "place-1",
                displayName: { text: "Harbor Hotel" },
                formattedAddress: "1 Main St",
                location: { latitude: 34.1, longitude: -118.2 },
                types: ["hotel"],
                websiteUri: "https://hotel.example",
                googleMapsUri: "https://maps.example/place-1",
              },
            ],
          }),
          { status: 200 }
        )
    );
    const results = await new GooglePlacesTerritoryProvider(
      "server-secret",
      fetcher as typeof fetch
    ).searchBusinesses({
      center: { lat: 34, lng: -118, formattedAddress: "LA" },
      radiusMiles: 3,
      categories: ["hotel"],
      limit: 10,
    });
    expect(results[0]).toMatchObject({
      providerId: "place-1",
      providerName: "google_places",
      name: "Harbor Hotel",
      providerUrl: "https://maps.example/place-1",
    });
    expect(results[0]?.sourceCapturedAt).toMatch(/^\d{4}-/);
  });
});
