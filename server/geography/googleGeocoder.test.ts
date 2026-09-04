import { describe, expect, it, vi } from "vitest";
import { GoogleGeocoder } from "./googleGeocoder";

describe("GoogleGeocoder", () => {
  it("reports unconfigured without making a request", async () => {
    const fetcher = vi.fn();
    expect(await new GoogleGeocoder("", fetcher).geocode("1 Main St")).toEqual({
      status: "unconfigured",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns canonical address, coordinates, and place identity", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                formatted_address: "1 Main St, Los Angeles, CA",
                place_id: "place-1",
                geometry: { location: { lat: 34.1, lng: -118.3 } },
              },
            ],
          }),
          { status: 200 }
        )
    );
    await expect(
      new GoogleGeocoder("secret", fetcher as typeof fetch).geocode("1 main")
    ).resolves.toEqual({
      status: "success",
      canonicalAddress: "1 Main St, Los Angeles, CA",
      googlePlaceId: "place-1",
      latitude: 34.1,
      longitude: -118.3,
      provider: "google_geocoding",
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("geocode/json");
  });

  it("does not retry a permanent provider failure", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 403 }));
    expect(
      (
        await new GoogleGeocoder("secret", fetcher as typeof fetch).geocode(
          "1 main"
        )
      ).status
    ).toBe("provider_failure");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("Places text search fallback", () => {
  const placesBody = {
    places: [{
      id: "place-1",
      formattedAddress: "Santa Monica, CA, USA",
      location: { latitude: 34.0118, longitude: -118.4915 },
      viewport: {
        low: { latitude: 33.9668, longitude: -118.5631 },
        high: { latitude: 34.0505, longitude: -118.4435 },
      },
    }],
  };
  const placesFetcher = (seen: { url: string; init?: RequestInit }[]) =>
    (async (url: any, init?: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response(JSON.stringify(placesBody), { status: 200 });
    }) as unknown as typeof fetch;

  it("uses Places when no Geocoding key is configured", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const result = await new GoogleGeocoder("", placesFetcher(seen), "places-key").geocode("Santa Monica, CA");
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain("places.googleapis.com");
    expect(result).toMatchObject({
      status: "success",
      canonicalAddress: "Santa Monica, CA, USA",
      provider: "google_places_text_search",
      googlePlaceId: "place-1",
    });
    // The viewport still yields a service-area extent for topology sizing.
    if (result.status === "success") expect(result.extentKm).toBeGreaterThan(5);
  });

  it("falls back when a Geocoding key exists but is restricted to other APIs", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetcher = (async (url: any, init?: RequestInit) => {
      if (String(url).includes("maps.googleapis.com"))
        return new Response(JSON.stringify({ status: "REQUEST_DENIED", error_message: "not authorized" }), { status: 200 });
      return placesFetcher(seen)(url, init);
    }) as unknown as typeof fetch;
    const result = await new GoogleGeocoder("restricted-key", fetcher, "places-key").geocode("Santa Monica, CA");
    expect(result).toMatchObject({ status: "success", provider: "google_places_text_search" });
  });

  it("reports unconfigured only when neither key exists", async () => {
    const never = (async () => { throw new Error("must not call"); }) as unknown as typeof fetch;
    expect(await new GoogleGeocoder("", never, "").geocode("anywhere")).toEqual({ status: "unconfigured" });
  });

  it("never overstates provenance as the Geocoding API", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const result = await new GoogleGeocoder("", placesFetcher(seen), "places-key").geocode("Santa Monica, CA");
    if (result.status === "success") expect(result.provider).not.toBe("google_geocoding");
  });
});
