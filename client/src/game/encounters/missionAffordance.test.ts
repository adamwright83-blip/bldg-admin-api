import { describe, expect, it } from "vitest";
import type { PlayableMission } from "../state/GameState";
import { projectAuthoritativeOutcome } from "./authoritativeOutcome";
import { projectMissionAffordance } from "./missionAffordance";

const base: PlayableMission = {
  key: "mission:1",
  missionId: 1,
  moveId: null,
  name: "Fixture",
  address: null,
  navigationUrl: null,
  phoneUrl: null,
  destinationPath: "/driver/sales-mission/1",
  state: "active",
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
};

describe("mission affordances", () => {
  const now = new Date("2026-08-12T12:00:00Z");
  it("never offers CALL without callable data", () => {
    expect(projectMissionAffordance(base, now).available).not.toContain("CALL");
  });
  it("presents a future sourced follow-up as WAIT without urgency", () => {
    expect(
      projectMissionAffordance(
        { ...base, contestedUntil: "2026-08-13T12:00:00Z" },
        now
      )
    ).toEqual({
      primary: "WAIT",
      available: ["WAIT", "REVIEW"],
      worldSignal: "dormant",
    });
  });
  it("offers no active affordance for closed missions", () => {
    expect(
      projectMissionAffordance({ ...base, state: "closed" }, now).available
    ).toEqual([]);
  });
  it("is deterministic for the same truth and time", () => {
    expect(
      projectMissionAffordance({ ...base, phoneUrl: "tel:555" }, now)
    ).toEqual(projectMissionAffordance({ ...base, phoneUrl: "tel:555" }, now));
  });
});

describe("authoritative outcome projection", () => {
  it("preserves authoritative wins regardless of game performance", () => {
    expect(projectAuthoritativeOutcome({ ...base, state: "captured" })).toEqual(
      {
        kind: "captured",
        mutationType: "CAPTURED_PATH",
      }
    );
  });
  it("does not capture unresolved/no-answer state", () => {
    expect(projectAuthoritativeOutcome(base)).toEqual({
      kind: "unresolved",
      mutationType: null,
    });
  });
});
