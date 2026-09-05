/**
 * THE HIERARCHY, ENFORCED.
 *
 * Lantern City -> a real tower -> TOWER WARS (automatic, real-sales-driven)
 * -> optional PLAY SIEGE -> GOLDLINE: SIEGE -> back to the same Tower Wars
 * -> back to the city.
 *
 * Tower Wars and Siege are not interchangeable modes, and the code must not be
 * able to drift back into presenting them as tabs. These are source assertions
 * in the style of worldTransition.test.ts: this suite runs in the repository's
 * node environment, which has no DOM renderer.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { entityFromSearch } from "./worldTransition";
import {
  SIEGE_LEVELS,
  playableSiegeLevel,
  siegeLevelFor,
} from "./siegeStageGeometry";

const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const towerWars = read("./TowerWars.tsx");
const siege = read("./TowerSiege.tsx");
const cityButton = read("./CityTowerButton.tsx");

describe("clicking a tower in Lantern City enters Tower Wars", () => {
  it("carries the selected canonical building to Tower Wars", () => {
    expect(cityButton).toContain(
      "onNavigate(`/growth/tower-wars?building=${buildingId}`)"
    );
    expect(entityFromSearch("?building=century_park_east")).toBe(
      "century_park_east"
    );
    expect(entityFromSearch("?building=opus_la")).toBe("opus_la");
  });

  it("arrives in Tower Wars for either building, never straight into Siege", () => {
    // Siege is reachable only through explicit player state, never from the URL.
    expect(towerWars).toContain(
      "const [siegeBuilding, setSiegeBuilding] = useState<CanonicalBuildingId | null>(null)"
    );
    expect(towerWars).not.toMatch(/=== "opus_la".*\? "rivalry" : "siege"/);
    expect(towerWars).not.toMatch(/entityFromSearch\([^)]*\)[^;]*siege/i);
  });

  it("has no Siege/Rivalry segmented mode selector", () => {
    expect(towerWars).not.toContain("Rivalry · Sales");
    expect(towerWars).not.toContain("Siege · Century Park East");
    expect(towerWars).not.toContain('aria-label="Tower Wars mode"');
    expect(towerWars).not.toMatch(/"siege" \| "rivalry"/);
  });

  it("never conflates the two systems in Siege's own chrome", () => {
    expect(siege).not.toContain("TOWER WARS / SIEGE");
    expect(siege).toContain('<span className="sg-eyebrow">GOLDLINE: SIEGE</span>');
  });
});

describe("a quiet Tower Wars offers PLAY SIEGE", () => {
  it("exposes the CTA only once the sales spectacle has settled", () => {
    expect(towerWars).toContain(
      "{siegeLevel && !activeSpectacle && unseenEvents.length === 0 && replay.mode === \"live\" && !businessDate ?"
    );
    expect(towerWars).toContain('className="tw-play-siege"');
    expect(towerWars).toContain("<strong>Play Siege</strong>");
  });

  it("enters Siege directly, with no second mode picker and no trip via the city", () => {
    const ctaAt = towerWars.indexOf('className="tw-play-siege"');
    const enterAt = towerWars.indexOf("onPlaySiege(siegeLevel.buildingId)");
    expect(ctaAt).toBeGreaterThan(-1);
    expect(enterAt).toBeGreaterThan(ctaAt);
    // The CTA's own handler must not navigate anywhere.
    expect(
      towerWars.slice(ctaAt, enterAt)
    ).not.toContain("onNavigate(");
  });

  it("moves the camera from the tower down to the battlefield", () => {
    expect(towerWars).toContain('from: "building",');
    expect(towerWars).toContain('to: "interior",');
    expect(towerWars).toContain("sourceEl: pieceRefs.current[siegeLevel.buildingId]");
    // The city return anchor is passed through untouched, not overwritten.
    expect(towerWars).toContain("returnPath,");
    expect(siege).toContain("arrive(level.buildingId, tower.current)");
  });
});

describe("leaving Siege returns to the same building's Tower Wars", () => {
  it("exits by clearing Siege state rather than navigating to the city", () => {
    expect(towerWars).toContain(
      "<TowerSiege buildingId={siegeBuilding} onExit={() => setSiegeBuilding(null)} />"
    );
    expect(siege).toContain("onBack={onExit}");
    expect(siege).not.toContain('onNavigate(returnPath ?? "/growth/lantern-city")');
    expect(siege).toContain('aria-label="Return to Tower Wars"');
  });

  it("keeps Tower Wars' own outward journey to the city intact", () => {
    expect(towerWars).toContain('kind: "reverse"');
    expect(towerWars).toContain('onNavigate(returnPath ?? "/growth/lantern-city")');
    expect(towerWars).toContain("Return to the city");
  });
});

describe("Siege is building-aware and never fakes a battlefield", () => {
  it("resolves the Stronghold from the tower the player entered from", () => {
    expect(siegeLevelFor("century_park_east")?.courtyard).toBe(
      "/assets/goldline/siege/courtyard.png"
    );
    // Only CPE artwork exists, so OPUS has no authored level of its own.
    expect(siegeLevelFor("opus_la")).toBeNull();
    expect(Object.keys(SIEGE_LEVELS)).toEqual(["century_park_east"]);
  });

  it("opens the truthfully-named available Stronghold rather than relabelling art", () => {
    const fromOpus = playableSiegeLevel("opus_la")!;
    expect(fromOpus.buildingId).toBe("century_park_east");
    expect(fromOpus.displayName).toBe("Century Park East");
    // The header, aria label and save key all follow the level, not the caller.
    expect(siege).toContain("aria-label={`${level.displayName} Siege`}");
    expect(siege).toContain("buildingId: level.buildingId,");
    expect(siege).toContain("href={level.courtyard}");
    expect(towerWars).toContain("Stronghold · the battlefield built so far");
  });

  it("reads the business feed for difficulty and never marks an event seen", () => {
    expect(siege).toContain("e.buildingId === level.buildingId");
    expect(siege).not.toContain("markSeen");
    expect(siege).not.toContain("writeSeenCursor");
    expect(siege).not.toMatch(/useMutation/);
  });
});
