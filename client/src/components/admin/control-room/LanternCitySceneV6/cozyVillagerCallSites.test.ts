import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lanternSceneFor } from "@/admin/adminPaths";

const read = (relative: string) => readFileSync(join(__dirname, "../../../..", relative), "utf8");

describe("cozy villager call sites", () => {
  it("mounts the encounter on the v6 scene only", () => {
    const scene = read("components/admin/control-room/LanternCitySceneV6/LanternCityScene.tsx");
    const geography = read("components/admin/control-room/WorldGeographySurface.tsx");
    const atlas = read("components/admin/control-room/LanternCityAtlas.tsx");
    const islands = read("components/admin/control-room/LanternCityIslands/LanternCityIslands.tsx");
    expect(scene).toContain("CozyNeighborhoodEncounter");
    expect(geography).not.toContain("CozyNeighborhoodEncounter");
    expect(atlas).not.toContain("CozyNeighborhoodEncounter");
    expect(islands).not.toContain("CozyNeighborhoodEncounter");
  });

  it("opens the v6 scene for the existing cozy query instead of the island board", () => {
    expect(lanternSceneFor("/growth/lantern-city", "?cozy=1&territory=silver-lake")).toBe("v6");
    expect(lanternSceneFor("/growth/lantern-city", "")).toBe("islands");
    expect(lanternSceneFor("/growth/lantern-city", "?scene=atlas")).toBe("atlas");
  });
});
