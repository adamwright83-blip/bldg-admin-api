import { describe, expect, it } from "vitest";
import { BUILDINGS } from "./buildings";
import { TOWER_DEFINITIONS } from "./propertyTowers";
import {
  COORDINATE_SOURCES,
  SIEGE_DEPTHS,
  composeCanonicalBuilding,
  deriveBuildingPhase,
  derivePenetrationAccess,
  firstBrokenLink,
  hasUnbrokenContinuity,
  readPenetration,
  resolveCanonicalBuilding,
  siegeDepthForStatus,
  siegeDepthRank,
  traceBuildingContinuity,
  type CanonicalBuildingInput,
} from "./canonicalBuilding";
import { COMMERCIAL_MISSION_STATUSES } from "./commercialMission";

const opus = BUILDINGS.find(b => b.id === "opus_la")!;
const cpe = BUILDINGS.find(b => b.id === "century_park_east")!;

function input(overrides: CanonicalBuildingInput = {}): CanonicalBuildingInput {
  return {
    config: opus,
    residents: { signups: 40, paidResidents: 25 },
    ...overrides,
  };
}

describe("siege depth", () => {
  it("maps every real mission status to a depth", () => {
    for (const status of COMMERCIAL_MISSION_STATUSES) {
      expect(SIEGE_DEPTHS).toContain(siegeDepthForStatus(status));
    }
  });

  it("recovers the five statuses the world projection collapses into 'active'", () => {
    const collapsed = [
      "game_active",
      "phone_ready",
      "preparing",
      "en_route",
      "arrived",
    ] as const;
    const depths = collapsed.map(siegeDepthForStatus);
    // The whole point: these must NOT all be the same value any more.
    expect(new Set(depths).size).toBe(5);
    expect(depths).toEqual([
      "briefed",
      "reachable",
      "committed",
      "inbound",
      "at_the_door",
    ]);
  });

  it("orders the ladder so deeper statuses rank higher", () => {
    expect(siegeDepthRank(siegeDepthForStatus("arrived"))).toBeGreaterThan(
      siegeDepthRank(siegeDepthForStatus("phone_ready"))
    );
    expect(siegeDepthRank(siegeDepthForStatus("won"))).toBeGreaterThan(
      siegeDepthRank(siegeDepthForStatus("visit_completed"))
    );
  });

  it("refuses to rank a lost account as progress", () => {
    expect(siegeDepthRank("closed")).toBe(-1);
    expect(siegeDepthRank("closed")).toBeLessThan(siegeDepthRank("unsighted"));
  });
});

describe("penetration denominator honesty", () => {
  it("uses the real unit counts as the denominator", () => {
    const reading = readPenetration({
      totalUnits: opus.total_units,
      signups: 107,
      paidResidents: 0,
      access: "preexisting_residents",
    })!;
    expect(reading.totalUnits).toBe(428);
    expect(reading.signupShare).toBeCloseTo(107 / 428);
  });

  it("marks a placeholder denominator unverified rather than hiding it", () => {
    const verified = readPenetration({
      totalUnits: 576,
      needsVerification: false,
      signups: 10,
      paidResidents: 5,
      access: "preexisting_residents",
    })!;
    const provisional = readPenetration({
      totalUnits: 576,
      needsVerification: true,
      signups: 10,
      paidResidents: 5,
      access: "preexisting_residents",
    })!;
    expect(verified.denominatorVerified).toBe(true);
    expect(provisional.denominatorVerified).toBe(false);
    // Same share, different confidence — the flag is the only difference, and
    // it always travels with the number.
    expect(provisional.paidShare).toBe(verified.paidShare);
  });

  it("returns null rather than dividing by an unusable denominator", () => {
    expect(
      readPenetration({
        totalUnits: 0,
        signups: 5,
        paidResidents: 1,
        access: "none",
      })
    ).toBeNull();
  });

  it("clamps shares so bad data cannot render past full", () => {
    const reading = readPenetration({
      totalUnits: 10,
      signups: 999,
      paidResidents: -4,
      access: "preexisting_residents",
    })!;
    expect(reading.signupShare).toBe(1);
    expect(reading.paidShare).toBe(0);
  });
});

describe("penetration access — no invented causal links", () => {
  it("claims a commercial win only when a mission was actually won", () => {
    expect(
      derivePenetrationAccess({ siegeDepth: "held", hasResidentData: false })
    ).toBe("commercial_win");
  });

  it("reports preexisting residents when no win caused them", () => {
    expect(
      derivePenetrationAccess({ siegeDepth: null, hasResidentData: true })
    ).toBe("preexisting_residents");
  });

  it("does not upgrade an in-progress siege into access", () => {
    expect(
      derivePenetrationAccess({ siegeDepth: "at_the_door", hasResidentData: false })
    ).toBe("none");
  });

  it("describes both configured buildings as preexisting, not won", () => {
    for (const config of [opus, cpe]) {
      const building = composeCanonicalBuilding({
        config,
        residents: { signups: 12, paidResidents: 6 },
      })!;
      expect(building.penetration?.access).toBe("preexisting_residents");
      expect(building.penetrationUnlocked).toBe(true);
    }
  });
});

describe("phase — winning the account is not winning the residents", () => {
  it("separates held-unpenetrated from held-penetrating", () => {
    const wonNoResidents = deriveBuildingPhase({
      siegeDepth: "held",
      penetration: readPenetration({
        totalUnits: 428,
        signups: 0,
        paidResidents: 0,
        access: "commercial_win",
      }),
    });
    const wonWithResidents = deriveBuildingPhase({
      siegeDepth: "held",
      penetration: readPenetration({
        totalUnits: 428,
        signups: 30,
        paidResidents: 12,
        access: "commercial_win",
      }),
    });
    expect(wonNoResidents).toBe("held_unpenetrated");
    expect(wonWithResidents).toBe("held_penetrating");
  });

  it("treats a lost mission as closed regardless of anything else", () => {
    expect(
      deriveBuildingPhase({
        siegeDepth: "closed",
        penetration: readPenetration({
          totalUnits: 428,
          signups: 30,
          paidResidents: 12,
          access: "preexisting_residents",
        }),
      })
    ).toBe("closed");
  });

  it("is unknown when nothing is known", () => {
    expect(deriveBuildingPhase({ siegeDepth: null, penetration: null })).toBe(
      "unknown"
    );
  });
});

describe("identity resolution", () => {
  it("resolves a real Opus address across both matchers", () => {
    const resolved = resolveCanonicalBuilding("3545 Wilshire Blvd, Los Angeles, CA 90010");
    expect(resolved.agreement).toBe("both");
    expect(resolved.config?.id).toBe("opus_la");
    expect(resolved.tower?.towerKey).toBe("opus_south_3545");
  });

  it("resolves a real Century Park East address across both matchers", () => {
    const resolved = resolveCanonicalBuilding("2170 Century Pk E");
    expect(resolved.agreement).toBe("both");
    expect(resolved.config?.id).toBe("century_park_east");
    expect(resolved.tower?.propertyGroup).toBe("century_park_east");
  });

  /**
   * Regression guard. Every canonical address the tower registry declares must
   * also be recognised by the building registry, or an order stored in that
   * exact canonical form silently drops out of buildingSlug derivation
   * (server/db.ts) and therefore out of penetration counts. This previously
   * failed for "2170 Century Pk E" and "2160 Century Pk E".
   */
  it("resolves every tower's own canonical address across both registries", () => {
    const canonicalAddresses = Object.values(TOWER_DEFINITIONS)
      .map(t => t.buildingAddressCanonical)
      .filter((a): a is string => Boolean(a));
    expect(canonicalAddresses.length).toBeGreaterThan(0);
    for (const address of canonicalAddresses) {
      expect(
        resolveCanonicalBuilding(address).agreement,
        `${address} must resolve in both registries`
      ).toBe("both");
    }
  });

  it("agrees on both spellings of Century Park East", () => {
    for (const form of ["2170 Century Pk E", "2170 Century Park E"]) {
      expect(resolveCanonicalBuilding(form).agreement, form).toBe("both");
    }
  });

  it("reports none for an address no view recognises", () => {
    const resolved = resolveCanonicalBuilding("1 Infinite Loop, Cupertino");
    expect(resolved.agreement).toBe("none");
    expect(resolved.config).toBeNull();
    expect(resolved.tower).toBeNull();
  });

  it("never invents a coordinate", () => {
    const building = composeCanonicalBuilding(input())!;
    expect(building.identity.coordinate).toBeNull();
  });

  it("carries a coordinate only with a real source", () => {
    const building = composeCanonicalBuilding(
      input({
        coordinate: {
          latitude: 34.0616,
          longitude: -118.3089,
          source: "geocoded_address",
        },
      })
    )!;
    expect(COORDINATE_SOURCES).toContain(building.identity.coordinate!.source);
  });

  it("returns null when nothing identifies a building", () => {
    expect(composeCanonicalBuilding({})).toBeNull();
  });
});

describe("the continuity chain", () => {
  const fullChain = composeCanonicalBuilding({
    config: opus,
    tower: TOWER_DEFINITIONS.opus_south_3545,
    siege: {
      missionId: 91,
      missionStatus: "won",
      worldState: "captured",
      lossReason: null,
      verifiedAnnualValueCents: 4_200_000,
      realizedRevenueCents: 380_000,
    },
    residents: { signups: 61, paidResidents: 34 },
    war: {
      towerWarsBuildingId: "opus_la",
      revenueCents: 380_000,
      orderCount: 52,
      todayDamage: "chipped",
      settledScars: 7,
    },
  })!;

  it("traces one building through every stage", () => {
    expect(hasUnbrokenContinuity(fullChain)).toBe(true);
    expect(firstBrokenLink(fullChain)).toBeNull();
  });

  it("resolves the canonical object across more than one view", () => {
    expect(fullChain.identity.identitySources).toEqual([
      "building_config",
      "property_tower",
      "commercial_mission",
    ]);
    expect(fullChain.phase).toBe("held_penetrating");
  });

  it("names the first missing link instead of inferring it", () => {
    const notWon = composeCanonicalBuilding({
      config: opus,
      tower: TOWER_DEFINITIONS.opus_south_3545,
      siege: {
        missionId: 91,
        missionStatus: "arrived",
        worldState: "active",
        lossReason: null,
        verifiedAnnualValueCents: null,
        realizedRevenueCents: 0,
      },
      residents: { signups: 61, paidResidents: 34 },
    })!;
    const broken = firstBrokenLink(notWon)!;
    expect(broken.stage).toBe("account_won");
    expect(broken.evidence).toBe("not won");
    expect(hasUnbrokenContinuity(notWon)).toBe(false);
  });

  it("surfaces a loss reason rather than a generic failure", () => {
    const lost = composeCanonicalBuilding({
      config: cpe,
      siege: {
        missionId: 12,
        missionStatus: "lost",
        worldState: "closed",
        lossReason: "management renewed with incumbent",
        verifiedAnnualValueCents: null,
        realizedRevenueCents: 0,
      },
      residents: { signups: 3, paidResidents: 0 },
    })!;
    const wonLink = traceBuildingContinuity(lost).find(
      l => l.stage === "account_won"
    )!;
    expect(wonLink.present).toBe(false);
    expect(wonLink.evidence).toContain("management renewed with incumbent");
  });

  it("reports permanent history as absent before anything settles", () => {
    const nothingSettled = composeCanonicalBuilding({
      config: opus,
      war: {
        towerWarsBuildingId: "opus_la",
        revenueCents: 1_000,
        orderCount: 1,
        todayDamage: "pristine",
        settledScars: 0,
      },
      residents: { signups: 1, paidResidents: 1 },
    })!;
    const history = traceBuildingContinuity(nothingSettled).find(
      l => l.stage === "permanent_history"
    )!;
    expect(history.present).toBe(false);
    expect(history.evidence).toBe("nothing settled into permanent history yet");
  });

  it("flags an unverified denominator inside the trace evidence", () => {
    const provisional = composeCanonicalBuilding({
      config: { ...opus, needsVerification: true },
      residents: { signups: 10, paidResidents: 4 },
    })!;
    const link = traceBuildingContinuity(provisional).find(
      l => l.stage === "resident_penetration"
    )!;
    expect(link.evidence).toContain("denominator unverified");
  });
});
