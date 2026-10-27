import { describe, expect, it } from "vitest";
import { applyDeskConfig, TOWER_BUILDINGS } from "./towerStack";

const opus = TOWER_BUILDINGS.find(b => b.id === "opus_la")!;

describe("applyDeskConfig", () => {
  it("keeps the drawing's guesses when nothing is saved", () => {
    expect(applyDeskConfig(opus, null)).toBe(opus);
    const north = applyDeskConfig(opus, { towers: {}, numberingConfirmed: false }).towers.find(t => t.id === "north")!;
    expect(north).toMatchObject({ floors: 14, unitsPerFloor: 18, unitsAssumed: true });
  });

  it("lays the operator's floors and doors over a tower, and stops calling it assumed", () => {
    const out = applyDeskConfig(opus, { towers: { north: { floors: 15, unitsPerFloor: 14 } }, numberingConfirmed: true });
    const north = out.towers.find(t => t.id === "north")!, south = out.towers.find(t => t.id === "south")!;
    expect(north).toMatchObject({ floors: 15, unitsPerFloor: 14, unitsAssumed: false });
    expect(south).toMatchObject({ floors: 22, unitsPerFloor: 18 });
    expect(out.numberingConfirmed).toBe(true);
  });
});
