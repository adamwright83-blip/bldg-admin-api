import { describe, expect, it } from "vitest";
import { lanternPosition, scoreLanternStrike } from "./lanternRunModel";

describe("Lantern Run timing", () => {
  it("crosses the target continuously and remains inside the visible track", () => {
    for (let round = 0; round < 3; round++) {
      for (let ms = 0; ms < 12000; ms += 13) {
        expect(lanternPosition(ms, round)).toBeGreaterThanOrEqual(0);
        expect(lanternPosition(ms, round)).toBeLessThanOrEqual(1);
      }
    }
    expect(lanternPosition(475, 0)).toBeCloseTo(0.5);
    expect(lanternPosition(950, 0)).toBeCloseTo(1);
    expect(lanternPosition(1425, 0)).toBeCloseTo(0.5);
  });
  it("rewards accuracy symmetrically, while misses still finish a round", () => {
    expect(scoreLanternStrike(0.5)).toEqual({
      grade: "PERFECT",
      points: 100,
      lit: true,
    });
    expect(scoreLanternStrike(0.4)).toEqual(scoreLanternStrike(0.6));
    expect(scoreLanternStrike(0)).toEqual({
      grade: "GLANCING",
      points: 15,
      lit: false,
    });
    expect(scoreLanternStrike(1)).toEqual(scoreLanternStrike(0));
  });
});
