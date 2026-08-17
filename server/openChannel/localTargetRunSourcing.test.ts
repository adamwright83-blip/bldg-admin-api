import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceLocalTargetRunTargets } from "./localTargetRunSourcing";

const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
const originalGooglePlacesKey = process.env.GOOGLE_PLACES_API_KEY;

describe("sourceLocalTargetRunTargets", () => {
  beforeEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
  });
  afterEach(() => {
    if (originalGoogleMapsKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
    if (originalGooglePlacesKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = originalGooglePlacesKey;
  });

  describe("labeled-simulation fallback (Adam's road-testing rail)", () => {
    it("falls back to exactly ten simulated targets when no Places key is configured", async () => {
      const result = await sourceLocalTargetRunTargets({
        targetQuery: "dry cleaner",
        requestedCount: 10,
        anchor: { lat: 34, lng: -118, label: "here" },
      });
      expect(result.simulated).toBe(true);
      expect(result.targets).toHaveLength(10);
      expect(result.targets.every(t => t.simulated)).toBe(true);
    });

    it("falls back to simulation when there is no legitimate anchor, even with a key configured", async () => {
      process.env.GOOGLE_MAPS_API_KEY = "test-key";
      const result = await sourceLocalTargetRunTargets({
        targetQuery: "dry cleaner",
        requestedCount: 10,
        anchor: null,
      });
      expect(result.simulated).toBe(true);
      expect(result.targets).toHaveLength(10);
    });

    it("falls back to simulation when the live Places call throws", async () => {
      process.env.GOOGLE_MAPS_API_KEY = "test-key";
      const throwingFetch = vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch;
      const result = await sourceLocalTargetRunTargets({
        targetQuery: "dry cleaner",
        requestedCount: 10,
        anchor: { lat: 34, lng: -118, label: "here" },
        fetcher: throwingFetch,
      });
      expect(result.simulated).toBe(true);
      expect(result.targets).toHaveLength(10);
    });

    it("falls back to simulation when Places responds with a non-OK HTTP status", async () => {
      process.env.GOOGLE_MAPS_API_KEY = "test-key";
      const failingFetch = vi.fn(async () =>
        new Response("", { status: 500 })
      ) as unknown as typeof fetch;
      const result = await sourceLocalTargetRunTargets({
        targetQuery: "dry cleaner",
        requestedCount: 10,
        anchor: { lat: 34, lng: -118, label: "here" },
        fetcher: failingFetch,
      });
      expect(result.simulated).toBe(true);
    });
  });

  describe("real sourcing (never the laundry-demand scorer)", () => {
    function fakePlace(id: string, lat: number, lng: number) {
      return {
        id,
        displayName: { text: `Cleaner ${id}` },
        formattedAddress: `${id} Real Street`,
        location: { latitude: lat, longitude: lng },
        types: ["laundry"],
        websiteUri: null,
        nationalPhoneNumber: null,
        googleMapsUri: `https://maps.google.com/?q=${id}`,
      };
    }

    it("returns real, provider-sourced targets — never simulated — for a successful search", async () => {
      process.env.GOOGLE_MAPS_API_KEY = "test-key";
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("places:searchText")) {
          return new Response(
            JSON.stringify({
              places: [fakePlace("p1", 34.01, -118.01), fakePlace("p2", 34.02, -118.02)],
            }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch;

      const result = await sourceLocalTargetRunTargets({
        targetQuery: "dry cleaner",
        requestedCount: 5,
        anchor: { lat: 34, lng: -118, label: "here" },
        fetcher,
      });

      expect(result.simulated).toBe(false);
      expect(result.targets).toHaveLength(2);
      expect(result.targets.every(t => !t.simulated)).toBe(true);
      expect(result.targets.map(t => t.id)).toEqual(["places:p1", "places:p2"]);
    });

    it("truthfully returns fewer than requested when the real search finds fewer (never padded, never simulated)", async () => {
      process.env.GOOGLE_MAPS_API_KEY = "test-key";
      const fetcher = vi.fn(async () =>
        new Response(JSON.stringify({ places: [fakePlace("only", 34, -118)] }), {
          status: 200,
        })
      ) as unknown as typeof fetch;

      const result = await sourceLocalTargetRunTargets({
        targetQuery: "dry cleaner",
        requestedCount: 10,
        anchor: { lat: 34, lng: -118, label: "here" },
        fetcher,
      });

      expect(result.simulated).toBe(false);
      expect(result.targets).toHaveLength(1);
    });

    it("de-duplicates candidates by provider id", async () => {
      process.env.GOOGLE_MAPS_API_KEY = "test-key";
      const fetcher = vi.fn(async () =>
        new Response(
          JSON.stringify({
            places: [fakePlace("dup", 34, -118), fakePlace("dup", 34, -118)],
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;

      const result = await sourceLocalTargetRunTargets({
        targetQuery: "dry cleaner",
        requestedCount: 10,
        anchor: { lat: 34, lng: -118, label: "here" },
        fetcher,
      });

      expect(result.targets).toHaveLength(1);
    });

    it("truncates to requestedCount", async () => {
      process.env.GOOGLE_MAPS_API_KEY = "test-key";
      const places = Array.from({ length: 8 }, (_, i) =>
        fakePlace(`p${i}`, 34 + i * 0.01, -118 + i * 0.01)
      );
      const fetcher = vi.fn(async () =>
        new Response(JSON.stringify({ places }), { status: 200 })
      ) as unknown as typeof fetch;

      const result = await sourceLocalTargetRunTargets({
        targetQuery: "dry cleaner",
        requestedCount: 3,
        anchor: { lat: 34, lng: -118, label: "here" },
        fetcher,
      });

      expect(result.targets).toHaveLength(3);
    });
  });
});
