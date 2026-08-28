import { describe, expect, it } from "vitest";
import { proportionalTowerHeight, towerComparisonState } from "./towerWarsGeometry";

describe("Tower Wars proportional revenue geometry", () => {
  it("gives zero revenue a true zero-height tower", () => {
    expect(proportionalTowerHeight(0, 8_400)).toBe(0);
    expect(proportionalTowerHeight(8_400, 8_400)).toBe(240);
  });

  it("keeps close revenue values visually close", () => {
    expect(proportionalTowerHeight(8_400, 8_400)).toBe(240);
    expect(proportionalTowerHeight(8_000, 8_400)).toBe(229);
  });

  it("keeps a dramatic revenue gap dramatic without a fake minimum", () => {
    expect(proportionalTowerHeight(8_400, 8_400)).toBe(240);
    expect(proportionalTowerHeight(84, 8_400)).toBe(2);
  });

  it("keeps both all-zero values at zero", () => {
    expect(proportionalTowerHeight(0, 0)).toBe(0);
    expect(towerComparisonState(0, 0)).toEqual({ kind: "no-revenue", leaderIndex: 0, delta: 0 });
  });

  it("reports a near tie without inventing a lead", () => {
    expect(towerComparisonState(8_400, 8_400.004)).toEqual({ kind: "even", leaderIndex: 0, delta: 0 });
  });

  it("keeps an extreme lead numerically explicit", () => {
    expect(towerComparisonState(8_400, 84)).toEqual({ kind: "lead", leaderIndex: 0, delta: 8_316 });
  });
});
