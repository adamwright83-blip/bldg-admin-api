import { describe, expect, it } from "vitest";
import { DAY1_TARGETS, type Day1TargetOutcome } from "../../../../shared/day1TenDoors";
import type { Day1TenDoorsMissionView } from "./Day1FieldMission";
import {
  COLOSSEUM_TARGET_IDS,
  COLOSSEUM_VILLAIN_TARGET_ID,
  projectColosseumMission,
} from "./colosseumCampaign";

function missionWith(outcomes: Record<string, Day1TargetOutcome>): Day1TenDoorsMissionView {
  return {
    missionId: "day1",
    targets: [...DAY1_TARGETS],
    outcomes,
    currentTarget: DAY1_TARGETS[0],
    progressLabel: "TARGET 1 OF 10",
    visitedCount: Object.keys(outcomes).length,
    totalCount: DAY1_TARGETS.length,
    isComplete: false,
    outcomeCounts: { pitched: 0, couldntReach: 0 },
  };
}

describe("Colosseum six-site campaign", () => {
  it("projects exactly six real Day 1 targets in authored order", () => {
    const projected = projectColosseumMission(missionWith({}));
    expect(projected.targets.map(target => target.id)).toEqual(COLOSSEUM_TARGET_IDS);
    expect(projected.totalCount).toBe(6);
    expect(projected.progressLabel).toBe("TARGET 1 OF 6");
    expect(projected.targets.some(target => target.id === COLOSSEUM_VILLAIN_TARGET_ID)).toBe(true);
  });

  it("ignores outcomes outside the six-site boss campaign", () => {
    const projected = projectColosseumMission(
      missionWith({ onsunset: "pitched", "the-alfred": "couldnt_reach" })
    );
    expect(projected.visitedCount).toBe(0);
    expect(projected.isComplete).toBe(false);
  });

  it("unlocks the finale only when all six real campaign outcomes exist", () => {
    const five = Object.fromEntries(
      COLOSSEUM_TARGET_IDS.slice(0, 5).map(id => [id, "pitched" as const])
    );
    expect(projectColosseumMission(missionWith(five)).isComplete).toBe(false);

    const six = {
      ...five,
      [COLOSSEUM_TARGET_IDS[5]]: "couldnt_reach" as const,
    };
    const projected = projectColosseumMission(missionWith(six));
    expect(projected.isComplete).toBe(true);
    expect(projected.visitedCount).toBe(6);
    expect(projected.outcomeCounts).toEqual({ pitched: 5, couldntReach: 1 });
  });
});
