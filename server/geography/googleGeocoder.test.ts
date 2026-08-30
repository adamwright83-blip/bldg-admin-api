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
