import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(join(__dirname, file), "utf8");

const atlas = read("./LanternCityAtlas.tsx");
const css = read("./lantern-city-v5.css");
const surface = read("./WorldGeographySurface.tsx");
const stateLayer = read("./LanternTerritoryStateLayer.tsx");

describe("Lantern City v5 visible composition", () => {
  it("mounts the v5 game shell and HUD", () => {
    expect(atlas).toContain('className="lc-page lc-v5-game"');
    expect(atlas).toContain("LanternCityHud");
    expect(atlas).toContain("LanternCommandDeck");
    expect(atlas).toContain("LanternMapLegend");
  });

  it("uses the v5 world master and territory state layer", () => {
    expect(surface).toContain("LANTERN_CITY_V5_ASSETS.world.master");
    expect(surface).toContain("LanternTerritoryStateLayer");
    expect(stateLayer).toContain("territoryMaskSrc");
  });

  it("does not hide legacy SaaS dashboard DOM for tests", () => {
    expect(atlas).not.toContain('className="lc-status-grid"');
    expect(atlas).not.toContain('className="lc-attention-row"');
    expect(atlas).not.toContain('className="lc-utility-row"');
    expect(atlas).not.toContain("lc-page-header");
  });

  it("does not hide obsolete dashboard surfaces in v5 css", () => {
    expect(css).toContain(".lc-page.lc-v5-game .lc-status-grid");
    expect(css).toMatch(/display:\s*none/);
  });

  it("does not mount default campaign chrome over the world", () => {
    expect(atlas).not.toContain("CampaignChrome");
  });

  it("hides AdminHostApp utility chrome on the v5 route", () => {
    const host = read("../../../pages/AdminHostApp.tsx");
    expect(host).toContain("is-lantern-city-v5");
    expect(host).toContain("!isLanternCity");
  });

  it("keeps command labels as HTML", () => {
    expect(read("./LanternCommandDeck.tsx")).toContain("<span>{entry.label}</span>");
  });

  it("routes cooling/quiet lanterns through Rekindling first", () => {
    expect(atlas).toContain("lanternNeedsRekindling");
    expect(atlas).toContain("RekindlingArsenal");
    expect(atlas).toContain("setRekindlingCluster");
  });

  it("defaults MAP command to active", () => {
    expect(atlas).toContain('useState<LanternCommandId>("map")');
  });

  it("uses real frontier objectives for conquest room", () => {
    expect(atlas).toContain("LanternConquestRoom");
    expect(atlas).toContain("frontierObjectives");
    expect(read("./LanternCommandRooms.tsx")).toContain("frontierObjectives");
  });
});
