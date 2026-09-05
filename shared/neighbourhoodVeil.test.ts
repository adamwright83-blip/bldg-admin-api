import { describe, expect, it } from "vitest";
import {
  deriveNeighbourhoodVeil,
  MAX_ACTIVE_CLOUD_GUARDIANS,
  selectActiveCloudGuardians,
} from "./neighbourhoodVeil";

describe("neighbourhood veil", () => {
  it("suppresses conquest weather when customers exist but geocoding has not run", () => {
    const result = deriveNeighbourhoodVeil({
      mappedCustomers: [],
      totalCustomers: 12,
      atlasReady: true,
    });
    expect(result.suppressed).toBe(true);
  });

  it("clears a whole neighbourhood when one mapped customer claims it", () => {
    const baseline = deriveNeighbourhoodVeil({
      mappedCustomers: [],
      totalCustomers: 0,
      atlasReady: true,
    });
    const westHollywood = baseline.neighbourhoods.find(n => n.name === "West Hollywood")!;
    const result = deriveNeighbourhoodVeil({
      mappedCustomers: [{ x: westHollywood.x, y: westHollywood.y }],
      totalCustomers: 1,
      atlasReady: true,
    });
    expect(result.neighbourhoods.find(n => n.name === "West Hollywood")?.state).toBe("clear");
  });

  it("renders at most five distinct active bosses", () => {
    const result = deriveNeighbourhoodVeil({
      mappedCustomers: [],
      totalCustomers: 0,
      atlasReady: true,
    });
    const active = selectActiveCloudGuardians(result.neighbourhoods, []);
    expect(active).toHaveLength(MAX_ACTIVE_CLOUD_GUARDIANS);
    expect(new Set(active.map(n => n.guardianId)).size).toBe(active.length);
  });
});
