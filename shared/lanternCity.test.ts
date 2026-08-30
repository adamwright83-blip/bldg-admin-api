import { describe, expect, it } from "vitest";
import {
  inferCustomerCadence,
  LANTERN_CITY_CONTROL_POINTS,
  projectLatLngToLanternAtlas,
} from "./lanternCity";

describe("customer cadence", () => {
  it.each([
    [
      ["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23"],
      "2026-08-30",
      "active",
      7,
    ],
    [
      ["2026-07-05", "2026-07-19", "2026-08-02", "2026-08-16"],
      "2026-08-30",
      "active",
      14,
    ],
    [["2026-05-30", "2026-06-29", "2026-07-29"], "2026-08-30", "active", 30],
    [
      ["2026-08-01", "2026-08-01", "2026-08-08", "2026-08-15"],
      "2026-08-30",
      "dimming",
      7,
    ],
    [["2026-05-01", "2026-05-08", "2026-05-15"], "2026-08-30", "dark", 7],
  ])("classifies deterministic cadence", (dates, today, state, cadence) => {
    const result = inferCustomerCadence({
      qualifyingOrderDates: dates,
      today,
      sparseFallback: "active",
    });
    expect(result.state).toBe(state);
    expect(result.expectedCadenceDays).toBe(cadence);
  });

  it("uses the existing recency fallback for sparse history", () => {
    expect(
      inferCustomerCadence({
        qualifyingOrderDates: ["2026-08-20"],
        today: "2026-08-30",
        sparseFallback: "dimming",
      })
    ).toMatchObject({ state: "dimming", confidence: "sparse" });
  });
});

describe("illustrated atlas projection", () => {
  it("calibrates against multiple LA control points", () => {
    for (const point of LANTERN_CITY_CONTROL_POINTS) {
      const projected = projectLatLngToLanternAtlas(point);
      expect(Math.abs(projected.x - point.x)).toBeLessThan(18);
      expect(Math.abs(projected.y - point.y)).toBeLessThan(24);
    }
  });

  it("clamps out-of-bounds geography", () => {
    const point = projectLatLngToLanternAtlas({
      latitude: 40.7128,
      longitude: -74.006,
    });
    expect(point.outOfBounds).toBe(true);
    expect(point.x).toBeGreaterThanOrEqual(2);
    expect(point.y).toBeLessThanOrEqual(95);
  });
});
