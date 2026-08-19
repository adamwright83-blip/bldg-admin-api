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

describe("Colosseum five-site campaign", () => {
  it("projects exactly five real Koreatown Greystar targets in authored order", () => {
    const projected = projectColosseumMission(missionWith({}));
    expect(projected.targets.map(target => target.id)).toEqual(COLOSSEUM_TARGET_IDS);
    expect(projected.targets.every(target => target.isGreystar)).toBe(true);
    expect(projected.targets.every(target => target.neighborhood === "Koreatown")).toBe(true);
    expect(projected.totalCount).toBe(5);
    expect(projected.progressLabel).toBe("TARGET 1 OF 5");
    expect(projected.targets.some(target => target.id === COLOSSEUM_VILLAIN_TARGET_ID)).toBe(true);
  });

  it("ignores outcomes outside the five-site boss campaign", () => {
    const projected = projectColosseumMission(
      missionWith({ onsunset: "pitched", "the-alfred": "couldnt_reach" })
    );
    expect(projected.visitedCount).toBe(0);
    expect(projected.isComplete).toBe(false);
  });

  it("unlocks the finale only when all five real campaign outcomes exist", () => {
    const four = Object.fromEntries(
      COLOSSEUM_TARGET_IDS.slice(0, 4).map(id => [id, "pitched" as const])
    );
    expect(projectColosseumMission(missionWith(four)).isComplete).toBe(false);

    const five = {
      ...four,
      [COLOSSEUM_TARGET_IDS[4]]: "pitched" as const,
    };
    const projected = projectColosseumMission(missionWith(five));
    expect(projected.isComplete).toBe(true);
    expect(projected.visitedCount).toBe(5);
    expect(projected.outcomeCounts).toEqual({ pitched: 5, couldntReach: 0 });
  });
});
