import { describe, expect, it } from "vitest";
import { architecturalDepth, worldDayPhase } from "./worldDepth";

describe("siege depth changes architecture", () => {
  it.each([
    ["reachable", "callbox"],
    ["at_the_door", "street_doors"],
    ["inside", "elevator"],
    ["held", "tower_lights"],
  ] as const)("maps %s to %s", (depth, feature) => {
    expect(architecturalDepth(depth).feature).toBe(feature);
  });
});

describe("the shared world clock", () => {
  it("has an explicit settlement interval and a distinct morning", () => {
    expect(worldDayPhase(7)).toBe("morning");
    expect(worldDayPhase(14)).toBe("day");
    expect(worldDayPhase(21)).toBe("settling");
    expect(worldDayPhase(2)).toBe("night");
  });
});

