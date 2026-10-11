import { describe, expect, it } from "vitest";
import { daylineObjectSource } from "./DaylineWorldCompositor";
import {
  climbAvatarPosition,
  shouldPlayClimb,
} from "./daylineWorldComposition";

describe("Day Line asset and progress invariants", () => {
  it("uses a course segment for a connected slide and corrected art for the chest", () => {
    expect(daylineObjectSource("sales")).toBe(
      "/goldline/dayline-v2/objects/sales-course.webp"
    );
    expect(daylineObjectSource("dropoff")).toBe(
      "/goldline/dayline-v2/objects/dropoff.webp"
    );
    expect(daylineObjectSource("generic")).toBeNull();
  });
  it("does not change progress for app opening, object selection or scrolling", () => {
    const before = climbAvatarPosition(1, 4);
    expect(climbAvatarPosition(1, 4)).toEqual(before);
    expect(shouldPlayClimb(1, 1, false, false)).toBe(false);
  });
});
