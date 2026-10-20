import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lanternSceneFor } from "@/admin/adminPaths";

const read = (relative: string) => readFileSync(join(__dirname, "../../../..", relative), "utf8");

describe("cozy villager call sites", () => {
  it("mounts no 2D encounter anywhere: Silver Lake is the 3D courtyard", () => {
    const scene = read("components/admin/control-room/LanternCitySceneV6/LanternCityScene.tsx");
    const host = read("pages/AdminHostApp.tsx");
    const walkable = read("pages/goldline/silverLake3d/SilverLake3D.tsx");
    expect(scene).not.toContain("<CozyNeighborhoodEncounter");
    expect(host).not.toContain("CozyNeighborhoodEncounter");
    expect(scene).toContain("openSilverLake3D(");
    expect(walkable).toContain("<PlayableLetterDesk");
    const geography = read("components/admin/control-room/WorldGeographySurface.tsx");
    const atlas = read("components/admin/control-room/LanternCityAtlas.tsx");
    const islands = read("components/admin/control-room/LanternCityIslands/LanternCityIslands.tsx");
    expect(geography).not.toContain("CozyNeighborhoodEncounter");
    expect(atlas).not.toContain("CozyNeighborhoodEncounter");
    expect(islands).not.toContain("CozyNeighborhoodEncounter");
  });

  it("opens the 3D Silver Lake for every cozy query, old deep links included", () => {
    expect(lanternSceneFor("/growth/lantern-city", "?cozy=1&territory=silver-lake")).toBe("silverLake3d");
    expect(lanternSceneFor("/growth/lantern-city", "?cozy=1&territory=silver-lake&walk=0")).toBe("silverLake3d");
    expect(lanternSceneFor("/growth/lantern-city", "?scene=v6&cozy=1&territory=silver-lake")).toBe("silverLake3d");
    expect(lanternSceneFor("/growth/lantern-city", "?encounter=1&territory=century-city")).toBe("silverLake3d");
    expect(lanternSceneFor("/growth/lantern-city", "?scene=v6")).toBe("v6");
    expect(lanternSceneFor("/growth/lantern-city", "")).toBe("islands");
    expect(lanternSceneFor("/growth/lantern-city", "?scene=atlas")).toBe("atlas");
  });
});
