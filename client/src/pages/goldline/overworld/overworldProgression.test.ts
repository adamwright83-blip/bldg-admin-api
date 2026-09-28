import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GOLDLINE_OVERWORLD_MAP } from "./mapDefinition";
import {
  COLOSSEUM_DESTINATION_ID,
  COLOSSEUM_PATH_DESTINATION_IDS,
  COASTAL_MARKET_DESTINATION_ID,
  POST_ROOK_DESTINATION_ID,
  activeDestinationIds,
  coastalMarketHuntOpen,
  destinationPresented,
  overworldDestinationStates,
  postRookContentOpen,
  progressionForSignedInOperator,
  serverProgressionFlagTrue,
  type OverworldProgressionReading,
} from "./overworldProgression";

const destinationIds = GOLDLINE_OVERWORLD_MAP.destinations.map(destination => destination.id);

const unrecorded = {
  status: "unrecorded" as const,
  value: false as const,
  reason: "schema_blocked" as const,
  migrationLabel: "CREATE TABLE goldline_domain_progression",
};

function read(overrides: OverworldProgressionReading = {}): OverworldProgressionReading {
  return {
    levelColosseumResolved: unrecorded,
    companionRookOwned: unrecorded,
    kingdomBrassRepublicCompleted: unrecorded,
    overworldUnlocks: { status: "unrecorded", flags: {} },
    capabilityRookContact: { granted: false },
    localStorage: "cache_and_present_only",
    ...overrides,
  };
}

const earnedTrue = { status: "earned", value: true };
const earnedFalse = { status: "earned", value: false };
const operator = { id: 7, openId: "open-7", tenantId: "tenant-a" };

function scoped(overrides: OverworldProgressionReading = {}) {
  return read({ tenantId: "tenant-a", operatorId: "open-7", ...overrides });
}

describe("overworld progression gate", () => {
  it("treats unrecorded flags as not owned", () => {
    expect(serverProgressionFlagTrue(unrecorded)).toBe(false);
    expect(serverProgressionFlagTrue({ status: "unrecorded", value: true })).toBe(false);
    expect(serverProgressionFlagTrue({ status: "uncertain", value: true })).toBe(false);
    expect(serverProgressionFlagTrue({ status: "unearned", value: true })).toBe(false);
    expect(serverProgressionFlagTrue({ status: "earned", value: false })).toBe(false);
    expect(serverProgressionFlagTrue({ value: true })).toBe(false);
    expect(serverProgressionFlagTrue(undefined)).toBe(false);
    expect(serverProgressionFlagTrue(null)).toBe(false);
    expect(serverProgressionFlagTrue({ value: false })).toBe(false);
    expect(serverProgressionFlagTrue({ status: "earned", value: "true" })).toBe(false);
    expect(serverProgressionFlagTrue(earnedTrue)).toBe(true);
  });

  it("opens post-Rook content only when both server fields have value true", () => {
    expect(postRookContentOpen(undefined)).toBe(false);
    expect(postRookContentOpen(null)).toBe(false);
    expect(postRookContentOpen(read())).toBe(false);
    expect(
      postRookContentOpen(
        read({
          levelColosseumResolved: earnedTrue,
          companionRookOwned: earnedFalse,
        })
      )
    ).toBe(false);
    expect(
      postRookContentOpen(
        read({
          levelColosseumResolved: earnedFalse,
          companionRookOwned: earnedTrue,
        })
      )
    ).toBe(false);
    expect(
      postRookContentOpen(
        read({
          levelColosseumResolved: earnedTrue,
          companionRookOwned: { status: "uncertain", value: true },
        })
      )
    ).toBe(false);
    expect(
      postRookContentOpen(
        read({
          levelColosseumResolved: earnedTrue,
          companionRookOwned: earnedTrue,
          capabilityRookContact: { granted: false },
          kingdomBrassRepublicCompleted: { status: "unearned", value: false },
          localStorage: "goldline:fantasy:party",
        })
      )
    ).toBe(true);
  });

  it("keeps Brass Republic → Colosseum as the only meaningful destination before Rook", () => {
    const states = overworldDestinationStates(read(), destinationIds);
    expect(states[COLOSSEUM_DESTINATION_ID]).toBe("active");
    for (const id of COLOSSEUM_PATH_DESTINATION_IDS) expect(states[id]).toBe("active");
    expect(states[COASTAL_MARKET_DESTINATION_ID]).toBe("dormant");
    expect(states[POST_ROOK_DESTINATION_ID]).toBe("dormant");
    const enterable = GOLDLINE_OVERWORLD_MAP.destinations.filter(
      destination => destination.action === "enter" && states[destination.id] === "active"
    );
    expect(enterable.map(destination => destination.id)).toEqual([COLOSSEUM_DESTINATION_ID]);
    for (const destination of GOLDLINE_OVERWORLD_MAP.destinations) {
      if (
        destination.id === COLOSSEUM_DESTINATION_ID ||
        (COLOSSEUM_PATH_DESTINATION_IDS as readonly string[]).includes(destination.id)
      ) {
        continue;
      }
      expect(states[destination.id], destination.id).toBe("dormant");
      expect(destinationPresented(states[destination.id])).toBe(false);
    }
  });

  it("does not let a satisfied binding, a capability grant, kingdom completion, or unlock flags look live", () => {
    const states = overworldDestinationStates(
      read({
        kingdomBrassRepublicCompleted: earnedTrue,
        capabilityRookContact: { granted: true },
        overworldUnlocks: {
          status: "recorded",
          flags: {
            "kingdom.boreslay": true,
            "wayward-approach": true,
            "training-grounds": true,
          },
        },
        localStorage: { rook: true, waywardUnlocked: true },
      }),
      destinationIds
    );
    expect(postRookContentOpen(read({
      kingdomBrassRepublicCompleted: earnedTrue,
      capabilityRookContact: { granted: true },
      overworldUnlocks: { status: "earned", flags: { postRook: true } },
    }))).toBe(false);
    expect(states[POST_ROOK_DESTINATION_ID]).toBe("dormant");
    expect(states["training-grounds"]).toBe("dormant");
    expect(states["relic-vault"]).toBe("dormant");
    expect(states[COASTAL_MARKET_DESTINATION_ID]).toBe("dormant");
    expect(states["dry-cleaner-hunt"]).toBe("dormant");
    expect(states["heavenstalk"]).toBe("dormant");
    expect(states["treehollow"]).toBe("dormant");
    expect(states["treehollow-linehook"]).toBe("dormant");
  });

  it("opens Coastal Market after Colosseum and closes it once Rook is owned", () => {
    const hunt = read({
      levelColosseumResolved: earnedTrue,
      companionRookOwned: { status: "unearned", value: false },
    });
    expect(coastalMarketHuntOpen(hunt)).toBe(true);
    const huntStates = overworldDestinationStates(hunt, destinationIds);
    expect(huntStates[COASTAL_MARKET_DESTINATION_ID]).toBe("active");
    expect(huntStates[POST_ROOK_DESTINATION_ID]).toBe("dormant");

    const owned = read({
      levelColosseumResolved: earnedTrue,
      companionRookOwned: earnedTrue,
    });
    expect(coastalMarketHuntOpen(owned)).toBe(false);
    const ownedStates = overworldDestinationStates(owned, destinationIds);
    expect(ownedStates[COASTAL_MARKET_DESTINATION_ID]).toBe("dormant");
    expect(ownedStates[POST_ROOK_DESTINATION_ID]).toBe("active");
  });

  it("opens exactly one new possibility after both server flags are true", () => {
    const before = overworldDestinationStates(read(), destinationIds);
    const after = overworldDestinationStates(
      read({
        levelColosseumResolved: earnedTrue,
        companionRookOwned: earnedTrue,
      }),
      [...destinationIds, "kingdom-2-the-last-valet", "kingdom.boreslay", "minigame.boreslay_duel"]
    );
    const opened = activeDestinationIds(after).filter(id => before[id] !== "active");
    expect(opened).toEqual([POST_ROOK_DESTINATION_ID]);
    expect(after["kingdom-2-the-last-valet"]).toBe("dormant");
    expect(after["kingdom.boreslay"]).toBe("dormant");
    expect(after["minigame.boreslay_duel"]).toBe("dormant");
    expect(after["training-grounds"]).toBe("dormant");
    expect(after[COLOSSEUM_DESTINATION_ID]).toBe("active");
  });

  it("does not apply another operator's cached read", () => {
    const theirs = scoped({
      levelColosseumResolved: earnedTrue,
      companionRookOwned: earnedTrue,
    });
    expect(progressionForSignedInOperator(theirs, operator)).toBe(theirs);
    expect(postRookContentOpen(progressionForSignedInOperator(theirs, operator))).toBe(true);
    expect(progressionForSignedInOperator(theirs, { id: 8, openId: "open-8", tenantId: "tenant-a" })).toBeNull();
    expect(progressionForSignedInOperator(theirs, { id: 7, openId: "open-7", tenantId: "tenant-b" })).toBeNull();
    expect(progressionForSignedInOperator(theirs, { id: 7, openId: "open-8", tenantId: "tenant-a" })).toBeNull();
    expect(progressionForSignedInOperator(theirs, null)).toBeNull();
    expect(progressionForSignedInOperator(theirs, { id: 7, openId: "open-7" })).toBe(theirs);
    expect(progressionForSignedInOperator(theirs, { id: 7, tenantId: "tenant-a" })).toBeNull();
    expect(
      progressionForSignedInOperator(
        read({
          tenantId: "tenant-a",
          operatorId: "7",
          levelColosseumResolved: earnedTrue,
          companionRookOwned: earnedTrue,
        }),
        operator
      )
    ).toBeNull();
    expect(
      progressionForSignedInOperator(
        read({ levelColosseumResolved: earnedTrue, companionRookOwned: earnedTrue }),
        operator
      )
    ).toBeNull();
    expect(
      progressionForSignedInOperator(theirs, { id: 7, openId: "open-7", tenantId: " tenant-a " })
    ).toBe(theirs);
  });

  it("wires the overworld to the server read", () => {
    const overworld = readFileSync(new URL("../GoldlineOverworld.tsx", import.meta.url), "utf8");
    const controller = readFileSync(
      new URL("../../driver/GoldlineDriverController.tsx", import.meta.url),
      "utf8"
    );
    expect(overworld).toContain("overworldDestinationStates(");
    expect(overworld).toContain('aria-label={`${PRODUCT_NAME} overworld`}');
    expect(overworld).toContain("data-overworld-progression=");
    expect(overworld).not.toContain("waywardUnlocked");
    expect(overworld).not.toContain("greystarCompleted");
    expect(overworld).not.toContain("loadWaywardProgress");
    expect(controller).toContain("trpc.system.goldlineProgression.get.useQuery");
    expect(controller).toContain("progressionForSignedInOperator");
    expect(controller).toContain("progression={progressionForOverworld}");
    expect(controller).toContain("goldlineProgression.isSuccess");
    expect(controller).not.toContain("waywardUnlocked");
    expect(controller).not.toContain("greystarActive");
  });

  it("does not advertise XP on the overworld", () => {
    for (const destination of GOLDLINE_OVERWORLD_MAP.destinations) {
      expect(destination.subtitle).not.toMatch(/\bXP\b/i);
      expect(destination.name).not.toMatch(/\bXP\b/i);
    }
  });
});
