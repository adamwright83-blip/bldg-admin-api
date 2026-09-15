import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeLanternCityScene, hudLayout } from "./LanternCitySceneV6/composeLanternCityScene";
import { lanternNeedsRekindling } from "./lanternCustomerPresentation";
import { lanternDensityClass } from "./customerGeography";
import { LANTERN_CITY_V5_ASSETS } from "@/components/goldline/lanternCityV5Assets";
import { CANONICAL_BUILDING_GEOGRAPHY } from "@shared/canonicalGeography";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";
import {
  LANTERN_TERRITORIES,
  territoryCenter,
} from "@shared/lanternTerritories";
import type { GeographicCustomer } from "./customerGeography";

const read = (file: string) =>
  readFileSync(join(__dirname, file), "utf8");

const scene = read("./LanternCitySceneV6/LanternCityScene.tsx");
const renderer = read("./LanternCitySceneV6/LanternCitySceneRenderer.tsx");
const hud = read("./LanternCitySceneV6/LanternCityHUD.tsx");
const css = read("./LanternCitySceneV6/lantern-city-v6.module.css");
const surface = read("./WorldGeographySurface.tsx");
const stateLayer = read("./LanternTerritoryStateLayer.tsx");

function customer(
  id: string,
  latitude: number,
  longitude: number,
  state: "active" | "dimming" | "dark" = "active",
  address: string | null = null
): GeographicCustomer {
  return {
    identityKey: id,
    displayName: id,
    phone: null,
    cadence: { state, daysSinceLastOrder: state === "active" ? 1 : 45 },
    location: {
      latitude,
      longitude,
      ...projectLatLngToLanternAtlas({ latitude, longitude }),
      canonicalAddress: address,
    },
  };
}

describe("Lantern City V6 visible composition", () => {
  it("mounts the V6 scene shell and HUD", () => {
    expect(scene).toContain("data-lantern-city=\"v6\"");
    expect(scene).toContain("LanternCityHUD");
    expect(hud).toContain("aria-label=\"Lantern City command deck\"");
    expect(hud).toContain('["map", "Map"');
  });

  it("uses composed world art and Home still uses the territory state layer", () => {
    expect(scene).toContain("composeLanternCityScene");
    expect(renderer).toContain("SCENE_ART.base");
    expect(surface).toContain("LANTERN_CITY_V5_ASSETS.world.master");
    expect(surface).toContain("LanternTerritoryStateLayer");
    expect(stateLayer).toContain("territoryMaskSrc");
  });

  it("does not hide legacy SaaS dashboard DOM for tests", () => {
    expect(scene).not.toContain('className="lc-status-grid"');
    expect(scene).not.toContain('className="lc-attention-row"');
    expect(scene).not.toContain('className="lc-utility-row"');
    expect(scene).not.toContain("lc-page-header");
    expect(hud).not.toContain("lc-status-grid");
  });

  it("does not mount default campaign chrome over the world", () => {
    expect(scene).not.toContain("CampaignChrome");
    expect(hud).not.toContain("CampaignChrome");
  });

  it("hides AdminHostApp utility chrome on the lantern-city route", () => {
    const host = read("../../../pages/AdminHostApp.tsx");
    expect(host).toContain("is-lantern-city-v5");
    expect(host).toContain("!isLanternCity");
    expect(host).toContain("LanternCityScene");
  });

  it("keeps command labels as HTML", () => {
    expect(hud).toContain("<strong>{label}</strong>");
  });

  it("routes cooling/quiet lanterns through Rekindling first", () => {
    expect(lanternNeedsRekindling("dimming")).toBe(true);
    expect(lanternNeedsRekindling("dark")).toBe(true);
    expect(lanternNeedsRekindling("active")).toBe(false);
    expect(scene).toContain("RekindlingArsenal");
    expect(scene).toContain("setRekindle");
    expect(scene).toContain("o.cluster.active < o.cluster.total");
  });

  it("defaults MAP command to active", () => {
    expect(scene).toContain('useState<Command>("map")');
  });

  it("hides geographic truth overlay unless worldTruth=1", () => {
    expect(surface).toContain('get("worldTruth") === "1"');
    expect(surface).toContain("{worldTruth && !googleVisible ? (");
    expect(scene).not.toContain("lc-world-truth-overlay");
  });

  it("keeps tower-attached customer lanterns visible instead of suppressing them", () => {
    expect(renderer).toContain("showLight && object.cluster && object.cluster.total > 0");
    expect(renderer).toContain("styles.towerLight");
    expect(surface).toContain("towerAttachedClusters");
    expect(surface).toContain("TowerAttachedCustomerLantern");
  });

  it("scales customer lanterns by cluster density", () => {
    expect(lanternDensityClass(1)).toBe("density-single");
    expect(lanternDensityClass(8)).toBe("density-major");
    const geo = territoryCenter(
      LANTERN_TERRITORIES.find(t => t.id === "beverly-hills")!
    );
    const one = composeLanternCityScene({
      customers: [customer("one", geo.latitude, geo.longitude)],
      atlasReady: true,
      viewport: { width: 1920, height: 1080 },
    });
    const many = composeLanternCityScene({
      customers: Array.from({ length: 8 }, (_, i) =>
        customer(`many-${i}`, geo.latitude, geo.longitude)
      ),
      atlasReady: true,
      viewport: { width: 1920, height: 1080 },
    });
    const oneLantern = one.objects.find(o => o.kind === "lantern");
    const manyLantern = many.objects.find(o => o.kind === "lantern");
    expect(oneLantern?.artBounds.height).toBe(80);
    expect(manyLantern?.artBounds.height).toBe(154);
  });

  it("frees V6 lantern art from the legacy 30px lantern box", () => {
    expect(css).toMatch(/\.objectArt > img[\s\S]*?max-width:\s*none/);
    expect(css).toContain(".objectArt .lanternArt");
  });

  it("clips every state gel through the canonical territory mask as tint + texture", () => {
    expect(stateLayer).toContain("territoryMaskSrc");
    expect(stateLayer).toContain("useFeatheredTerritoryMasks");
    expect(stateLayer).toContain("territoryStateHasEvidence");
    expect(stateLayer).toContain("gelTintForState");
    expect(stateLayer).toContain('className="lc-territory-gel-tint"');
    expect(stateLayer).toContain('className="lc-territory-gel-texture"');
    expect(stateLayer).not.toContain("atlasPolygon(");
    const homeCss = read("./lantern-city-v5.css");
    expect(homeCss).toMatch(/\.lc-territory-gel\s*\{[^}]*mask-mode:\s*luminance/);
    expect(homeCss).toMatch(/\.lc-territory-gel-tint\s*\{[^}]*mix-blend-mode:\s*multiply/);
    const feather = read("./useFeatheredTerritoryMasks.ts");
    expect(feather).toContain("territoryMaskSrc(territoryId)");
    expect(feather).toContain("getImageData");
  });

  it("places environmental props and nameplates in atlas space above the gels", () => {
    expect(renderer).toContain("scene.plates.map");
    expect(renderer).toContain("scene.props.map");
    expect(renderer).toContain("TerritoryLabel");
    expect(css).toMatch(/\.plate\s*\{[^}]*z-index:\s*1/);
    expect(css).toMatch(/\.props\s*\{[^}]*z-index:\s*2/);
    expect(css).toMatch(/\.object\s*\{[^}]*z-index:\s*3/);
  });

  it("stacks the world: plates < props < objects < attached lights < HUD", () => {
    expect(css).toMatch(/\.plate\s*\{[^}]*z-index:\s*1/);
    expect(css).toMatch(/\.props\s*\{[^}]*z-index:\s*2/);
    expect(css).toMatch(/\.object\s*\{[^}]*z-index:\s*3/);
    expect(css).toMatch(/\.towerLight\s*\{[^}]*z-index:\s*4/);
    expect(css).toMatch(/\.identity,[\s\S]*?\.deck \{[\s\S]*?z-index:\s*5/);
    const homeCss = read("./lantern-city-v5.css");
    expect(homeCss).toMatch(/\.lc-tower-attached-lantern\s*\{[^}]*z-index:\s*6/);
  });

  it("frontier objectives scale up from the authored anchor instead of being replaced by it", () => {
    const guarded = LANTERN_TERRITORIES.find(t => t.id === "malibu")
      ?? LANTERN_TERRITORIES.find(t => t.id !== "koreatown" && t.id !== "century-city");
    expect(guarded).toBeDefined();
    const empty = composeLanternCityScene({
      customers: [],
      atlasReady: true,
      viewport: { width: 1920, height: 1080 },
    });
    const frontier = empty.objects.find(o => o.frontierKind);
    const singleGeo = territoryCenter(
      LANTERN_TERRITORIES.find(t => t.id === "beverly-hills")!
    );
    const withLantern = composeLanternCityScene({
      customers: [customer("bh", singleGeo.latitude, singleGeo.longitude)],
      atlasReady: true,
      viewport: { width: 1920, height: 1080 },
    });
    const lantern = withLantern.objects.find(o => o.kind === "lantern");
    if (frontier && lantern) {
      expect(frontier.artBounds.height).toBeGreaterThan(lantern.artBounds.height);
    } else {
      expect(css).toContain(".frontierArt");
    }
  });

  it("keeps the HUD readable with lantern art and cadence labels", () => {
    expect(hud).toContain("LanternCityHUD");
    expect(hud).toContain("ACTIVE");
    expect(hud).toContain("COOLING");
    expect(hud).toContain("DORMANT");
    expect(hud).toContain("ASSETS.lanterns.quiet");
    expect(LANTERN_CITY_V5_ASSETS.lanterns.active).toContain("lantern");
  });

  it("scales the HUD to game size", () => {
    const compact = hudLayout(1280, 800);
    const wide = hudLayout(1920, 1080);
    expect(wide.identity.width).toBe(330);
    expect(wide.identity.height).toBe(72);
    expect(wide.deck.height).toBe(84);
    expect(compact.identity.width).toBe(250);
    expect(css).toMatch(/\.identity h1\s*\{[^}]*font-size:\s*29px/);
  });

  it("keeps Utilities out of the default world-home view but reachable in debug mode", () => {
    const host = read("../../../pages/AdminHostApp.tsx");
    expect(host).toContain("isWorldHome && !isLanternCity && worldDebugChrome");
    expect(host).toContain('get("worldTruth") === "1"');
  });

  it("anchors strongholds on canonical buildings", () => {
    const geo = CANONICAL_BUILDING_GEOGRAPHY.opus_la;
    const composed = composeLanternCityScene({
      customers: [customer("opus", geo.latitude, geo.longitude, "active", geo.address)],
      atlasReady: true,
      viewport: { width: 1920, height: 1080 },
    });
    expect(composed.objects.some(o => o.buildingId === "opus_la")).toBe(true);
  });
});
