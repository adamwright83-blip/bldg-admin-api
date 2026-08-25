import { describe, expect, it } from "vitest";
import { depthScaleAtY, depthSpeedFactorAtY } from "./perspective";

describe("authored overworld perspective", () => {
  const depth = {
    nearY: 600,
    farY: 250,
    nearScale: 1.08,
    farScale: 0.62,
    farSpeedFactor: 0.84,
  };

  it("drives both presentation scale and the production movement factor", () => {
    expect(depthScaleAtY(depth, 600)).toBeCloseTo(1.08);
    expect(depthScaleAtY(depth, 250)).toBeCloseTo(0.62);
    expect(depthSpeedFactorAtY(depth, 600)).toBe(1);
    expect(depthSpeedFactorAtY(depth, 250)).toBeCloseTo(0.84);
  });
});
