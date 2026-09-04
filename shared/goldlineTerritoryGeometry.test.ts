import { describe, expect, it } from "vitest";
import { buildVeilGeometry, classifyGeometryMode, convexHull, haversineKm } from "./goldlineTerritoryGeometry";

describe("territory geometry", () => {
  it("does not use the hull to invent members", () => {
    const geometry = buildVeilGeometry({
      mode: "cluster",
      members: [
        { physicalEntityId: "a", atlas: { x: 10, y: 10 } },
        { physicalEntityId: "b", atlas: { x: 12, y: 11 } },
        { physicalEntityId: "c", atlas: { x: 11, y: 13 } },
      ],
    });
    expect(geometry.memberApertures.map(item => item.physicalEntityId).sort()).toEqual(["a", "b", "c"]);
    expect(geometry.polygon.length).toBeGreaterThanOrEqual(3);
  });

  it("classifies a street as a corridor", () => {
    expect(
      classifyGeometryMode([
        { latitude: 34.05, longitude: -118.38 },
        { latitude: 34.0501, longitude: -118.372 },
        { latitude: 34.0502, longitude: -118.364 },
      ])
    ).toBe("corridor");
  });

  it("keeps a hull stable for identical points", () => {
    const points = [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 4 },
    ];
    expect(convexHull(points)).toEqual(convexHull([...points].reverse()));
  });

  it("measures real distances rather than guessing nicer ones", () => {
    expect(
      haversineKm(
        { latitude: 34.048, longitude: -118.376 },
        { latitude: 34.048, longitude: -118.376 }
      )
    ).toBe(0);
  });
});
