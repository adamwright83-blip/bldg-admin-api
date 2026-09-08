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

  it("hides geographic truth drawer unless worldTruth=1", () => {
    expect(atlas).toContain('get("worldTruth") === "1"');
    expect(atlas).toContain("{worldTruthMode ? (");
  });

  it("keeps tower-attached customer lanterns visible instead of suppressing them", () => {
    expect(atlas).toContain("primaryObjectCoversCluster");
    expect(atlas).toContain("TowerAttachedCustomerLantern");
    expect(surface).toContain("towerAttachedClusters");
  });

  it("scales customer lanterns by cluster density", () => {
    expect(atlas).toContain("lanternDensityClass");
    expect(css).toContain(".lc-v5-lantern.density-major");
  });

  it("frees v5 lantern art from the legacy 30px lantern box", () => {
    // Root cause of tiny production lanterns: `.lc-lantern{width:30px}` plus
    // the global `img{max-width:100%}` reset clamped the art to 30px.
    expect(css).toMatch(/\.lc-v5-lantern\.lc-lantern[\s\S]*?width:\s*auto/);
    expect(css).toMatch(/\.lc-v5-lantern-art\s*\{[^}]*max-width:\s*none/);
  });

  it("clips every state gel through the canonical territory mask as tint + texture", () => {
    expect(stateLayer).toContain("territoryMaskSrc");
    expect(stateLayer).toContain("useFeatheredTerritoryMasks");
    expect(stateLayer).toContain("territoryStateHasEvidence");
    expect(stateLayer).toContain("gelTintForState");
    expect(stateLayer).toContain('className="lc-territory-gel-tint"');
    expect(stateLayer).toContain('className="lc-territory-gel-texture"');
    expect(stateLayer).not.toContain("atlasPolygon(");
    expect(css).toMatch(/\.lc-territory-gel\s*\{[^}]*mask-mode:\s*luminance/);
    expect(css).toMatch(/\.lc-territory-gel-tint\s*\{[^}]*mix-blend-mode:\s*multiply/);
    const feather = read("./useFeatheredTerritoryMasks.ts");
    expect(feather).toContain("territoryMaskSrc(territoryId)");
    expect(feather).toContain("getImageData");
  });

  it("places environmental props and nameplates in atlas space above the gels", () => {
    expect(stateLayer).toContain('className="lc-environmental-props-layer"');
    expect(stateLayer).toContain('className="lc-territory-nameplates"');
    expect(stateLayer).toContain("territoryCenter(territory)");
    expect(stateLayer).toContain("projectLatLngToLanternAtlas");
    // Gels, props and nameplates are siblings so each takes its own z-index
    // instead of being trapped in the gel stacking context.
    expect(stateLayer).toMatch(/return \(\s*<>\s*<div\s+className="lc-territory-state-layer"/);
    expect(css).toMatch(/\.lc-territory-state-layer\s*\{\s*z-index:\s*1/);
    expect(css).toMatch(/\.lc-environmental-props-layer\s*\{\s*z-index:\s*2/);
    expect(css).toMatch(/\.lc-territory-nameplates\s*\{[^}]*z-index:\s*10/);
    // Nameplates replace the landmark captions; no double labels.
    expect(atlas).toContain("showNeighborhoods={false}");
  });

  it("stacks the world: gels < props < foliage < frontier < lanterns < strongholds < nameplates", () => {
    // Root cause of hidden tower labels / customer lights: decorative foreground
    // foliage sat at z 12 above every game object, and the tower art button
    // (z 5) painted over its own attached customer lantern (z 3).
    expect(css).toMatch(/\.lc-v5-foreground-depth\s*\{[^}]*z-index:\s*3/);
    expect(css).toMatch(/\.lc-page\.lc-v5-game \.cr-world-towers-layer\s*\{\s*z-index:\s*9/);
    expect(css).toMatch(/\.lc-tower-attached-lantern\s*\{[^}]*z-index:\s*6/);
    // Prospect blocks reset the legacy building-glyph span styling for the lantern.
    expect(css).toMatch(/\.lc-pursued-building > span\.lc-tower-attached-lantern\s*\{[^}]*clip-path:\s*none/);
    // Several pipelines on one address fan out instead of stacking (presentation only).
    expect(atlas).toContain("pursuitFanOffset");
    // Camera controls no longer sit on top of the Downtown / Arts District plates.
    expect(css).toMatch(/\.lc-page\.lc-v5-game \.cr-world-camera-controls\s*\{[^}]*position:\s*fixed/);
  });

  it("frontier objectives scale up from the authored anchor instead of being replaced by it", () => {
    expect(css).toMatch(/\.lc-frontier-object\s*\{[^}]*scale\(calc\(var\(--lc-frontier-scale, 1\) \* 1\.15\)\)/);
    expect(css).toMatch(/\.lc-frontier-freedom-art\s*\{[^}]*width:\s*clamp\(170px/);
  });

  it("keeps the legend open by default and readable with lantern art + neighborhood swatches", () => {
    const deck = read("./LanternCommandDeck.tsx");
    expect(atlas).toContain("<LanternMapLegend />");
    for (const label of ["Active customer", "Cooling / Fading", "Quiet / Dormant", "Hearth", "Opportunity"]) {
      expect(deck).toContain(label);
    }
    for (const label of ["Healthy", "At Risk", "Cooling", "Overgrown / Decay", "Locked opportunity", "Lost · Re-earn"]) {
      expect(deck).toContain(label);
    }
    expect(deck).toContain("LANTERN_CITY_V5_ASSETS.lanterns.active");
    expect(css).toMatch(/\.lc-v5-legend\s*\{[^}]*width:\s*clamp\(250px/);
  });

  it("scales the HUD to game size", () => {
    expect(css).toMatch(/\.lc-v5-command-deck\s*\{[^}]*width:\s*min\(1380px/);
    expect(css).toMatch(/\.lc-v5-command-deck\s*\{[^}]*height:\s*clamp\(170px/);
    expect(css).toMatch(/\.lc-v5-today-quest\s*\{[^}]*min-height:\s*190px/);
    expect(css).toMatch(/\.lc-v5-identity strong\s*\{[^}]*font-size:\s*32px/);
  });

  it("keeps Utilities out of the default world-home view but reachable in debug mode", () => {
    const host = read("../../../pages/AdminHostApp.tsx");
    expect(host).toContain("isWorldHome && !isLanternCity && worldDebugChrome");
    expect(host).toContain('get("worldTruth") === "1"');
  });
});
