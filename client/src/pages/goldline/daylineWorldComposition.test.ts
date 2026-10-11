import { describe, expect, it } from "vitest";
import {
  actionSlotArtScale,
  actionSlotAnchors,
  artForDayPlanKind,
  climbAvatarPosition,
  completedFromProjection,
  goldenTrailGeometry,
  groupConsecutiveActionSlots,
  presentationLabelForUpcoming,
  shouldPlayClimb,
  visualStateForStop,
} from "./daylineWorldComposition";

describe("GOLDLINE dynamic Action Slot composition", () => {
  it.each([1, 2, 3, 5, 8, 10])("fits %i slots without adding, removing, or reordering them", count => {
    const scales = Array.from({ length: count }, (_, index) => actionSlotArtScale(index, count));
    expect(scales[scales.length - 1]).toBe(1);
    expect(scales[0]).toBeCloseTo(count <= 3 && count > 1 ? 0.9 : count > 3 ? 0.8 : 1);
    expect(scales.every((size, index) => index === 0 || size >= scales[index - 1])).toBe(true);
    expect(actionSlotAnchors(count)).toHaveLength(count);
    const trail = goldenTrailGeometry(count);
    expect(trail.height).toBeGreaterThanOrEqual(count * 176);
    expect(trail.anchors).toHaveLength(count);
    expect(trail.path).toMatch(/^M /);
    expect(trail.anchors.every((anchor, index) =>
      index === 0 || anchor.y > trail.anchors[index - 1].y,
    )).toBe(true);
  });

  it("does not turn unidentified prep or processing into a marketing challenge", () => {
    expect(artForDayPlanKind("pickup")).toBe("pickup");
    expect(artForDayPlanKind("dropoff")).toBe("dropoff");
    expect(artForDayPlanKind("sales")).toBe("sales");
    expect(artForDayPlanKind("growth")).toBe("growth");
    expect(artForDayPlanKind("prep")).toBe("generic");
    expect(artForDayPlanKind("processing")).toBe("generic");
  });

  it("reports a separate upward climb while day order stays top-to-bottom", () => {
    expect(climbAvatarPosition(0, 5).bottomPercent).toBe(7);
    expect(climbAvatarPosition(5, 5).bottomPercent).toBe(90);
    expect(climbAvatarPosition(5, 5).scale).toBeCloseTo(0.52);
    expect(climbAvatarPosition(3, 5).scale).toBeLessThan(climbAvatarPosition(2, 5).scale);
    expect(climbAvatarPosition(12, 5)).toEqual(climbAvatarPosition(5, 5));
  });

  it("treats verified completion as a prerequisite for revealing an opened object", () => {
    const upcoming = { id: "A", status: "ready" as const };
    const completed = { id: "A", status: "completed" as const };
    expect(visualStateForStop(upcoming, "A", true)).toBe("up_next");
    expect(visualStateForStop(completed, null, false)).toBe("ready_to_open");
    expect(visualStateForStop(completed, null, true)).toBe("opened");
    expect(visualStateForStop({ id: "B", status: "blocked" }, null, true)).toBe("blocked");
  });

  it("never plays a walking animation while driving or with reduced motion", () => {
    expect(shouldPlayClimb(0, 1, false, false)).toBe(true);
    expect(shouldPlayClimb(0, 1, true, false)).toBe(false);
    expect(shouldPlayClimb(0, 1, false, true)).toBe(false);
    expect(shouldPlayClimb(1, 1, false, false)).toBe(false);
    expect(completedFromProjection([
      { status: "completed" },
      { status: "ready" },
      { status: "completed" },
    ])).toBe(2);
  });

  it("reuses one landmark for adjacent same-kind work but preserves separate IDs", () => {
    const stops = [
      { id: "sale:1", kind: "sales" as const },
      { id: "sale:2", kind: "sales" as const },
      { id: "sale:3", kind: "sales" as const },
      { id: "growth:1", kind: "growth" as const },
      { id: "growth:2", kind: "growth" as const },
      { id: "sale:4", kind: "sales" as const },
    ];
    const groups = groupConsecutiveActionSlots(stops);
    expect(groups.map(group => group.kind)).toEqual(["sales", "growth", "sales"]);
    expect(groups.map(group => group.items.length)).toEqual([3, 2, 1]);
    expect(groups.flatMap(group => group.items.map(({stop}) => stop.id)))
      .toEqual(stops.map(stop => stop.id));
    expect(groups.flatMap(group => group.items.map(({index}) => index)))
      .toEqual([0, 1, 2, 3, 4, 5]);
    expect(presentationLabelForUpcoming(true)).toBe("NEXT");
    expect(presentationLabelForUpcoming(false)).toBe("PLANNED");
  });

  it("retains duplicate address slots because each business ID is distinct", () => {
    const ids = ["order:1", "order:2"];
    expect(new Set(ids).size).toBe(2);
    expect(actionSlotAnchors(ids.length)).toHaveLength(2);
  });
});
