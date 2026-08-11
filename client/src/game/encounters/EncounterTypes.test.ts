import { describe, expect, it } from "vitest";
import { archetypeForMission, channelForMission } from "./EncounterTypes";
import type { PlayableMission } from "../state/GameState";

function mission(overrides: Partial<PlayableMission> = {}): PlayableMission {
  return {
    key: "mission:1",
    missionId: 1,
    moveId: null,
    name: "Test Account",
    address: null,
    navigationUrl: null,
    phoneUrl: null,
    destinationPath: "/driver/sales-mission/1",
    state: "available",
    timeBurdenMinutes: null,
    travelBurdenMinutes: null,
    estimatedValueLowCents: null,
    estimatedValueHighCents: null,
    confidence: "unknown",
    expiresAt: null,
    contestedUntil: null,
    verifiedAnnualValueCents: null,
    realizedRevenueCents: 0,
    unlockedPath: null,
    lossReason: null,
    ...overrides,
  };
}

const now = new Date("2026-08-10T12:00:00.000Z");

describe("archetype selection", () => {
  it("defaults to the Anchor, preserving Run-1 behaviour", () => {
    expect(
      archetypeForMission({
        mission: mission(),
        hasDecisionMakerContact: false,
        now,
      })
    ).toBe("ANCHOR");
  });

  it("does not infer a gatekeeper merely from a missing phone number", () => {
    // Missing data is not evidence of being blocked.
    expect(
      archetypeForMission({
        mission: mission({ state: "available", phoneUrl: null }),
        hasDecisionMakerContact: false,
        now,
      })
    ).toBe("ANCHOR");
  });

  it("infers a gatekeeper only once the account is actively worked and still blocked", () => {
    expect(
      archetypeForMission({
        mission: mission({ state: "active" }),
        hasDecisionMakerContact: false,
        now,
      })
    ).toBe("GATEKEEPER");
    expect(
      archetypeForMission({
        mission: mission({ state: "active" }),
        hasDecisionMakerContact: true,
        now,
      })
    ).toBe("ANCHOR");
  });

  it("treats a real future commitment as a staller", () => {
    expect(
      archetypeForMission({
        mission: mission({
          state: "contested",
          contestedUntil: "2026-08-12T09:00:00.000Z",
        }),
        hasDecisionMakerContact: true,
        now,
      })
    ).toBe("STALLER");
  });

  it("treats a missed commitment as a ghost", () => {
    expect(
      archetypeForMission({
        mission: mission({
          state: "contested",
          contestedUntil: "2026-08-08T09:00:00.000Z",
        }),
        hasDecisionMakerContact: true,
        now,
      })
    ).toBe("GHOST");
  });

  it("treats contested state without any date as a ghost", () => {
    expect(
      archetypeForMission({
        mission: mission({ state: "contested" }),
        hasDecisionMakerContact: true,
        now,
      })
    ).toBe("GHOST");
  });

  it("ignores an unparseable date rather than inventing a timeline", () => {
    expect(
      archetypeForMission({
        mission: mission({ state: "available", contestedUntil: "not-a-date" }),
        hasDecisionMakerContact: true,
        now,
      })
    ).toBe("ANCHOR");
  });
});

describe("channel selection", () => {
  it("uses follow-up for missions carrying a live commitment", () => {
    expect(channelForMission(mission({ state: "contested" }))).toBe("follow_up");
    expect(channelForMission(mission({ state: "recovery_active" }))).toBe(
      "follow_up"
    );
    expect(channelForMission(mission({ state: "watching" }))).toBe("follow_up");
  });

  it("uses in-person when there is a real address to visit", () => {
    expect(channelForMission(mission({ address: "1 Test St" }))).toBe(
      "in_person"
    );
  });

  it("uses phone when only a number is sourced", () => {
    expect(channelForMission(mission({ phoneUrl: "tel:+15550000" }))).toBe(
      "phone"
    );
  });
});
