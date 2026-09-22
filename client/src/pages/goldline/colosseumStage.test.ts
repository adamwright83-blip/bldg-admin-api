import { describe, expect, it } from "vitest";
import { DAY1_TARGETS } from "../../../../shared/day1TenDoors";
import {
  ARENA_ANCHOR,
  ARENA_FLOOR,
  CLOCKHEAD_CENTER,
  CLOCKHEAD_WINDING_CENTER,
  COLOSSEUM_DOORS,
  SHIELD_REST,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  artPoint,
  cameraFrame,
  pointInPolygon,
  projectColosseumArena,
  slideWithinFloor,
  stageDepthScale,
  stageScaleFor,
} from "./colosseumStage";

/**
 * Door extents measured from arena-background-hd.webp (percent of the
 * painting's width). The first playable pass placed six hit zones at
 * 8/24/40/60/76/92% of the VIEWPORT, which matched none of these on a phone.
 */
const PAINTED_DOOR_SPANS: Record<string, [number, number]> = {
  I: [9.9, 16.9],
  II: [28, 35],
  III: [46, 54],
  IV: [64, 71.3],
  V: [82.5, 89.8],
};

describe("stage geometry follows the approved painting", () => {
  it("uses isotropic units with the painting's own aspect ratio", () => {
    expect(STAGE_WIDTH).toBe(100);
    expect(STAGE_HEIGHT).toBeCloseTo((100 * 1672) / 941, 6);
    expect(artPoint(50, 50)).toEqual({ x: 50, y: STAGE_HEIGHT / 2 });
  });

  it("puts each painted door's trigger in front of the door that is actually painted", () => {
    for (const door of COLOSSEUM_DOORS.filter(d => d.painted)) {
      const [left, right] = PAINTED_DOOR_SPANS[door.id]!;
      expect(door.threshold.x, `door ${door.id}`).toBeGreaterThanOrEqual(left);
      expect(door.threshold.x, `door ${door.id}`).toBeLessThanOrEqual(right);
      const yPercent = (door.threshold.y / STAGE_HEIGHT) * 100;
      expect(yPercent).toBeGreaterThan(45);
      expect(yPercent).toBeLessThan(49);
    }
  });

  it("presents six fictional doors: five painted and Door VI, which is only debated", () => {
    expect(COLOSSEUM_DOORS.map(door => door.id)).toEqual(["I", "II", "III", "IV", "V", "VI"]);
    expect(COLOSSEUM_DOORS.filter(door => door.painted)).toHaveLength(5);
    const six = COLOSSEUM_DOORS.find(door => door.id === "VI")!;
    expect(six.painted).toBe(false);
  });

  it("lets every door, the shield and the anchor be reached on foot", () => {
    for (const door of COLOSSEUM_DOORS) {
      const justInside = {
        x: door.threshold.x + (50 - door.threshold.x) * 0.02,
        y: door.threshold.y + 1.2,
      };
      expect(pointInPolygon(justInside, ARENA_FLOOR), `door ${door.id}`).toBe(true);
    }
    expect(pointInPolygon(SHIELD_REST, ARENA_FLOOR)).toBe(true);
    expect(pointInPolygon(ARENA_ANCHOR, ARENA_FLOOR)).toBe(true);
  });

  it("keeps Trailblazer on the floor however she is steered", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let feet = { ...ARENA_ANCHOR };
    for (let i = 0; i < 4000; i += 1) {
      const next = {
        x: feet.x + (random() - 0.5) * 9,
        y: feet.y + (random() - 0.5) * 9,
      };
      feet = slideWithinFloor(feet, next);
      expect(pointInPolygon(feet, ARENA_FLOOR)).toBe(true);
    }
  });

  it("scales figures by depth: small at the doors, large at the front", () => {
    const back = stageDepthScale(COLOSSEUM_DOORS[0]!.threshold.y);
    const front = stageDepthScale(ARENA_ANCHOR.y);
    expect(front).toBeGreaterThan(back * 1.5);
  });

  it("hangs Clockhead over the pediment and lowers him within reach to wind", () => {
    expect(CLOCKHEAD_WINDING_CENTER.y).toBeGreaterThan(CLOCKHEAD_CENTER.y);
    expect(CLOCKHEAD_WINDING_CENTER.x).toBe(CLOCKHEAD_CENTER.x);
  });
});

describe("camera", () => {
  it("covers a phone screen without letterboxing", () => {
    const scale = stageScaleFor(412, 915);
    expect(STAGE_WIDTH * scale).toBeGreaterThanOrEqual(412 - 0.001);
    expect(STAGE_HEIGHT * scale).toBeGreaterThanOrEqual(915 - 0.001);
  });

  it("never zooms a wide screen in so far that most of the arena is lost", () => {
    const scale = stageScaleFor(1440, 900);
    expect(900 / (STAGE_HEIGHT * scale)).toBeGreaterThanOrEqual(0.72 - 1e-9);
  });

  it("follows the focus but never shows past the painting's edge", () => {
    const left = cameraFrame({ viewportWidth: 412, viewportHeight: 915, focus: { x: 0, y: 90 } });
    const right = cameraFrame({ viewportWidth: 412, viewportHeight: 915, focus: { x: 100, y: 90 } });
    expect(left.x).toBe(0);
    expect(right.x).toBeCloseTo(412 - STAGE_WIDTH * right.scale, 6);
    expect(right.x).toBeLessThan(left.x);
  });
});

describe("the real campaign projected onto the arena (read-only)", () => {
  it("breaks exactly one seal per real recorded outcome", () => {
    for (let visited = 0; visited <= 5; visited += 1) {
      const view = projectColosseumArena({ visitedCount: visited, totalCount: 5, isComplete: visited === 5 });
      expect(view.seals).toHaveLength(5);
      expect(view.seals.filter(seal => seal.broken)).toHaveLength(visited);
      expect(view.tracedCount).toBe(visited);
    }
  });

  it("reveals Clockhead only when the authoritative campaign says it is complete", () => {
    const allSealsButIncomplete = projectColosseumArena({ visitedCount: 5, totalCount: 5, isComplete: false });
    expect(allSealsButIncomplete.located).toBe(false);
    expect(allSealsButIncomplete.mood).not.toBe("located");
    expect(projectColosseumArena({ visitedCount: 5, totalCount: 5, isComplete: true }).located).toBe(true);
  });

  it("cannot be talked into more progress than the real count", () => {
    const over = projectColosseumArena({ visitedCount: 99, totalCount: 5, isComplete: false });
    expect(over.tracedCount).toBe(5);
    const under = projectColosseumArena({ visitedCount: -3, totalCount: 5, isComplete: false });
    expect(under.tracedCount).toBe(0);
    expect(under.seals.every(seal => !seal.broken)).toBe(true);
  });

  it("grows steadily more solid and more rattled as the real hunt advances", () => {
    const signals = [0, 1, 2, 3, 4].map(
      visited => projectColosseumArena({ visitedCount: visited, totalCount: 5, isComplete: false }).signal
    );
    for (let i = 1; i < signals.length; i += 1) expect(signals[i]).toBeGreaterThan(signals[i - 1]!);
    expect(projectColosseumArena({ visitedCount: 4, totalCount: 5, isComplete: false }).mood).toBe("cornered");
  });

  it("keeps the fantasy a fantasy: no real property ever appears in Clockhead's mouth", () => {
    const names = DAY1_TARGETS.flatMap(target => [target.name, target.address, target.neighborhood])
      .filter(Boolean)
      .map(text => text.toLowerCase());
    for (let visited = 0; visited <= 5; visited += 1) {
      const view = projectColosseumArena({ visitedCount: visited, totalCount: 5, isComplete: visited === 5 });
      const spoken = [view.taunt, ...view.seals.map(seal => seal.legend)].join(" ").toLowerCase();
      for (const name of names) expect(spoken.includes(name), name).toBe(false);
    }
  });
});
