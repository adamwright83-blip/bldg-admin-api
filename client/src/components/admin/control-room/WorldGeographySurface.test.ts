import { describe, expect, it } from "vitest";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";

describe("WorldGeographySurface Coordinate Resolution", () => {
  it("projects OPUS LA and Century Park East into safe boundary coordinates", () => {
    const opus = projectLatLngToLanternAtlas({ latitude: 34.0618, longitude: -118.3011 });
    const cpe = projectLatLngToLanternAtlas({ latitude: 34.0591, longitude: -118.4147 });

    expect(opus.outOfBounds).toBe(false);
    expect(opus.x).toBeGreaterThan(0);
    expect(opus.x).toBeLessThan(100);
    expect(opus.y).toBeGreaterThan(0);
    expect(opus.y).toBeLessThan(100);

    expect(cpe.outOfBounds).toBe(false);
    expect(cpe.x).toBeGreaterThan(0);
    expect(cpe.x).toBeLessThan(100);
    expect(cpe.y).toBeGreaterThan(0);
    expect(cpe.y).toBeLessThan(100);
  });
});
