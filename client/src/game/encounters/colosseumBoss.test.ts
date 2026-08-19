import { describe, expect, it } from "vitest";
import { DAY1_TARGETS, type Day1TargetOutcome } from "../../../../shared/day1TenDoors";
import type { Day1TenDoorsMissionView } from "../../pages/goldline/Day1FieldMission";
import {
  CLOCKHEAD_PROJECTILE_ORIGIN,
  movementFacing,
  perspectiveScale,
  spawnClockheadProjectiles,
  stepColosseumProjectiles,
  sweepHitsPlayer,
} from "../../pages/goldline/colosseumCombat";
import {
  COLOSSEUM_TARGET_IDS,
  projectColosseumMission,
} from "../../pages/goldline/colosseumCampaign";

function missionWith(
  outcomes: Record<string, Day1TargetOutcome>
): Day1TenDoorsMissionView {
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

describe("Colosseum boss production contract", () => {
  it("projects exactly five real Koreatown Greystar targets", () => {
    const projected = projectColosseumMission(missionWith({}));
    expect(projected.targets.map(target => target.id)).toEqual(COLOSSEUM_TARGET_IDS);
    expect(projected.targets).toHaveLength(5);
    expect(projected.targets.every(target => target.isGreystar)).toBe(true);
    expect(projected.targets.every(target => target.neighborhood === "Koreatown")).toBe(true);
  });

  it("ignores non-boss-route outcomes when computing Colosseum progress", () => {
    const projected = projectColosseumMission(
      missionWith({ onsunset: "pitched", "the-alfred": "couldnt_reach" })
    );
    expect(projected.visitedCount).toBe(0);
    expect(projected.isComplete).toBe(false);
  });

  it("fires a committed aimed projectile instead of a homing beam", () => {
    const [shot] = spawnClockheadProjectiles("aimed", { x: 50, y: 80 }, 1);
    expect(shot.x).toBe(CLOCKHEAD_PROJECTILE_ORIGIN.x);
    expect(shot.y).toBe(CLOCKHEAD_PROJECTILE_ORIGIN.y);
    expect(shot.vy).toBeGreaterThan(0);
    expect(Math.abs(shot.vx)).toBeLessThan(0.001);
  });

  it("fires a readable three-shot fan", () => {
    const shots = spawnClockheadProjectiles("fan", { x: 50, y: 80 }, 2);
    expect(shots).toHaveLength(3);
    expect(shots[0].vx).toBeGreaterThan(0);
    expect(Math.abs(shots[1].vx)).toBeLessThan(0.001);
    expect(shots[2].vx).toBeLessThan(0);
  });

  it("resolves carried-shield collision before Trailblazer body collision", () => {
    const result = stepColosseumProjectiles(
      [{ id: "p", x: 50, y: 74, vx: 0, vy: 20 }],
      0.12,
      { x: 50, y: 80 },
      true,
      false
    );
    expect(result.projectiles).toHaveLength(0);
    expect(result.collisions[0]?.kind).toBe("shield");
  });

  it("lets a shot that gets past the guard damage Trailblazer", () => {
    const result = stepColosseumProjectiles(
      [{ id: "p", x: 50, y: 76.8, vx: 0, vy: 20 }],
      0.05,
      { x: 50, y: 80 },
      false,
      false
    );
    expect(result.collisions[0]?.kind).toBe("player");
  });

  it("makes the sweeping clock hand a spatial hazard", () => {
    expect(sweepHitsPlayer(0.5, { x: 50, y: 70 })).toBe(true);
    expect(sweepHitsPlayer(0.5, { x: 78, y: 70 })).toBe(false);
  });

  it("keeps directional facing and depth deterministic", () => {
    expect(movementFacing({ x: -1, y: 0.2 })).toBe("left");
    expect(movementFacing({ x: 0.2, y: -1 })).toBe("back");
    expect(perspectiveScale(86)).toBeGreaterThan(perspectiveScale(34));
  });
});
