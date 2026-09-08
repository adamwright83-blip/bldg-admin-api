import { describe, expect, it } from "vitest";
import { CANONICAL_BUILDING_GEOGRAPHY } from "./canonicalGeography";
import { projectLatLngToLanternAtlas } from "./lanternCity";
import {
  deriveTerritoryVisualState,
  gelOpacityForState,
  gelTintForState,
  stableHash,
  territoryStateHasEvidence,
  TERRITORY_VISUAL_THRESHOLDS,
  type TerritoryVisualState,
} from "./lanternTerritoryVisualState";
import {
  classifyTerritory,
  deriveTerritoryOccupancy,
} from "./lanternTerritories";
import { frontierKindForTerritory } from "./lanternFrontierPresentation";

describe("lanternTerritoryVisualState", () => {
  it("does not change customer coordinates when visual state changes", () => {
    const customer = { latitude: 34.0618, longitude: -118.3011 };
    const before = projectLatLngToLanternAtlas(customer);
    deriveTerritoryVisualState({
      territoryId: "koreatown",
      active: 0,
      dimming: 0,
      dark: 5,
      guarded: false,
      conquered: true,
      pressureReturned: false,
    });
    const after = projectLatLngToLanternAtlas(customer);
    expect(after).toEqual(before);
  });

  it("keeps territory classification independent of v5 presentation", () => {
    expect(
      classifyTerritory(
        CANONICAL_BUILDING_GEOGRAPHY.opus_la.latitude,
        CANONICAL_BUILDING_GEOGRAPHY.opus_la.longitude
      )?.id
    ).toBe("koreatown");
  });

  it("never promotes cooling/quiet to active from outreach alone", () => {
    expect(
      deriveTerritoryVisualState({
        territoryId: "silver-lake",
        active: 0,
        dimming: 0,
        dark: 1,
        guarded: false,
        conquered: true,
        pressureReturned: false,
      })
    ).toBe("at_risk");
  });

  it("requires verified hearth cadence separately from dimming", () => {
    expect(
      deriveTerritoryVisualState({
        territoryId: "los-feliz",
        active: 1,
        dimming: 0,
        dark: 0,
        guarded: false,
        conquered: true,
        pressureReturned: false,
      })
    ).toBe("healthy");
  });

  it("does not collapse a neighborhood from one dormant customer", () => {
    const state = deriveTerritoryVisualState({
      territoryId: "echo-park",
      active: 4,
      dimming: 0,
      dark: 1,
      guarded: false,
      conquered: true,
      pressureReturned: false,
    });
    expect(["healthy", "at_risk", "cooling"]).toContain(state);
    expect(state).not.toBe("infested");
    expect(state).not.toBe("closed_construction");
  });

  it("separates never-conquered locked opportunity from lost ground", () => {
    expect(
      deriveTerritoryVisualState({
        territoryId: "west-hollywood",
        active: 0,
        dimming: 0,
        dark: 0,
        guarded: true,
        conquered: false,
        pressureReturned: false,
      })
    ).toBe("locked_opportunity");
    expect(
      deriveTerritoryVisualState({
        territoryId: "silver-lake",
        active: 0,
        dimming: 0,
        dark: 0,
        guarded: false,
        conquered: false,
        pressureReturned: true,
      })
    ).toBe("lost_ground");
    expect(
      deriveTerritoryVisualState({
        territoryId: "silver-lake",
        active: 0,
        dimming: 0,
        dark: 0,
        guarded: false,
        conquered: true,
        pressureReturned: false,
      })
    ).toBe("healthy");
  });

  it("reads an empty, never-conquered territory as locked opportunity, not healthy", () => {
    // ~50 of the 61 real territories have no located customers. They are
    // prospective ground ("what could be"), and must never paint as thriving.
    expect(
      deriveTerritoryVisualState({
        territoryId: "atwater-village",
        active: 0,
        dimming: 0,
        dark: 0,
        guarded: false,
        conquered: false,
        pressureReturned: false,
      })
    ).toBe("locked_opportunity");
  });

  it("paints no gel for a conquered territory with no located customers", () => {
    expect(
      territoryStateHasEvidence({
        territoryId: "hollywood",
        active: 0,
        dimming: 0,
        dark: 0,
        guarded: false,
        conquered: true,
        pressureReturned: false,
      })
    ).toBe(false);
    expect(
      territoryStateHasEvidence({
        territoryId: "hollywood",
        active: 0,
        dimming: 0,
        dark: 1,
        guarded: false,
        conquered: true,
        pressureReturned: false,
      })
    ).toBe(true);
    expect(
      territoryStateHasEvidence({
        territoryId: "atwater-village",
        active: 0,
        dimming: 0,
        dark: 0,
        guarded: false,
        conquered: false,
        pressureReturned: false,
      })
    ).toBe(true);
  });

  it("gives every visual state a visible gel treatment, with locked as the quiet background", () => {
    const states: TerritoryVisualState[] = [
      "healthy",
      "at_risk",
      "cooling",
      "overgrown",
      "infested",
      "closed_construction",
      "lost_ground",
      "locked_opportunity",
    ];
    for (const state of states) {
      const tint = gelTintForState(state);
      expect(tint.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(tint.opacity).toBeGreaterThan(0.15);
      expect(tint.opacity).toBeLessThan(0.6);
      expect(gelOpacityForState(state)).toBeGreaterThanOrEqual(0.3);
    }
    // Locked covers most of the city; it must stay lighter than any lit state
    // so healthy / at-risk / cooling neighbourhoods pop out of it.
    const locked = gelTintForState("locked_opportunity").opacity;
    for (const state of states.filter(s => s !== "locked_opportunity")) {
      expect(gelTintForState(state).opacity).toBeGreaterThan(locked);
    }
    // Distinct hues for the three lit business states.
    expect(new Set([gelTintForState("healthy").color, gelTintForState("at_risk").color, gelTintForState("cooling").color]).size).toBe(3);
  });

  it("never locks a territory that has real customer presence", () => {
    const occupancy = deriveTerritoryOccupancy({
      customers: [{ latitude: 34.0618, longitude: -118.3011 }],
      totalCustomers: 1,
      atlasReady: true,
    });
    const koreatown = occupancy.territories.find(
      row => row.territory.id === "koreatown"
    );
    expect(koreatown?.customerCount).toBeGreaterThan(0);
    expect(koreatown?.guarded).toBe(false);
    expect(
      deriveTerritoryVisualState({
        territoryId: "koreatown",
        active: 1,
        dimming: 0,
        dark: 0,
        guarded: false,
        conquered: true,
        pressureReturned: false,
      })
    ).not.toBe("locked_opportunity");
  });

  it("keeps canonical tower coordinates fixed", () => {
    const cpeGeo = CANONICAL_BUILDING_GEOGRAPHY.century_park_east;
    const opusGeo = CANONICAL_BUILDING_GEOGRAPHY.opus_la;
    const cpe = projectLatLngToLanternAtlas(cpeGeo);
    const opus = projectLatLngToLanternAtlas(opusGeo);
    expect(cpe.outOfBounds).toBe(false);
    expect(opus.outOfBounds).toBe(false);
    expect(classifyTerritory(opusGeo.latitude, opusGeo.longitude)?.id).toBe(
      "koreatown"
    );
  });

  it("keeps seeded frontier placement stable", () => {
    expect(frontierKindForTerritory("west-hollywood")).toBe("balloon");
    expect(frontierKindForTerritory("west-hollywood")).toBe("balloon");
    expect(stableHash("silver-lake")).toBe(stableHash("silver-lake"));
  });

  it("caps frontier visibility through occupancy derivation", () => {
    const occupancy = deriveTerritoryOccupancy({
      customers: [],
      totalCustomers: 0,
      atlasReady: true,
    });
    const guarded = occupancy.territories.filter(row => row.guarded);
    expect(guarded.length).toBeGreaterThan(0);
    expect(guarded.slice(0, 5).length).toBeLessThanOrEqual(5);
  });

  it("uses self-relative decline shares rather than universal day timers", () => {
    expect(TERRITORY_VISUAL_THRESHOLDS.atRiskDimmingShare).toBeLessThan(1);
    expect(TERRITORY_VISUAL_THRESHOLDS.overgrownMinCustomers).toBeGreaterThan(1);
  });
});
