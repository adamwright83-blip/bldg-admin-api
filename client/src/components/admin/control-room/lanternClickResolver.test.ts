import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CanonicalBuildingId } from "./buildingArt";
import { resolveLanternCityClick } from "./lanternClickResolver";

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

const BUILDINGS = ["opus_la", "century_park_east"] as const;

const EXPECTED: Record<CanonicalBuildingId, string> = {
  opus_la: "/growth/opus-la-inspection",
  century_park_east: "/growth/tower-wars?building=century_park_east",
};

describe("resolveLanternCityClick", () => {
  it("sends the same building to the same destination from either surface", () => {
    for (const buildingId of BUILDINGS) {
      const liveCity = resolveLanternCityClick({
        buildingId,
        target: "tower",
      });
      const homeMiniMap = resolveLanternCityClick({
        buildingId,
        target: "tower",
      });
      expect(liveCity).toEqual(homeMiniMap);
      expect(liveCity).toEqual({
        action: "navigate",
        entityId: buildingId,
        path: EXPECTED[buildingId],
      });
    }
  });

  it("treats a default building click the same as the tower body", () => {
    expect(
      resolveLanternCityClick({
        buildingId: "century_park_east",
        target: "default",
      })
    ).toEqual(
      resolveLanternCityClick({
        buildingId: "century_park_east",
        target: "tower",
      })
    );
  });

  it("opens the inspector for the attached light and does not navigate", () => {
    for (const buildingId of BUILDINGS) {
      expect(
        resolveLanternCityClick({
          buildingId,
          target: "light",
          opensInspector: true,
        })
      ).toEqual({ action: "inspect" });
    }
  });

  it("does not invent a route when the light has no customers to inspect", () => {
    expect(
      resolveLanternCityClick({
        buildingId: "opus_la",
        target: "light",
        opensInspector: false,
      })
    ).toEqual({ action: "none" });
  });

  it("inspects a customer cluster or prospect that is not a stronghold", () => {
    expect(
      resolveLanternCityClick({
        target: "default",
        opensInspector: true,
      })
    ).toEqual({ action: "inspect" });
  });

  it("fails closed for an unknown building instead of guessing a route", () => {
    expect(
      resolveLanternCityClick({
        buildingId: "not_a_stronghold",
        target: "tower",
      })
    ).toEqual({ action: "none" });
  });
});

describe("both Lantern surfaces call the resolver", () => {
  const scene = read("LanternCitySceneV6/LanternCityScene.tsx");
  const surface = read("WorldGeographySurface.tsx");
  const button = read("CityTowerButton.tsx");

  it("does not let either surface choose a building path", () => {
    for (const source of [scene, surface, button]) {
      expect(source).toContain("resolveLanternCityClick");
      expect(source).not.toContain("/growth/opus-la-inspection");
      expect(source).not.toContain("/growth/tower-wars");
      expect(source).not.toContain("/growth/siege");
    }
  });

  it("asks for the tower body on the mini-map and for the clicked target in the live city", () => {
    expect(surface).toContain('target: "tower"');
    expect(scene).toContain("target,");
    expect(scene).toContain('target: "tower"');
  });
});
