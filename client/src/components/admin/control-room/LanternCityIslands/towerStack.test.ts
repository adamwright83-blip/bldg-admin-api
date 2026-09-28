import { describe, expect, it } from "vitest";
import { buildTowerModel, darkFloors, parseUnit, TOWER_BUILDINGS } from "./towerStack";

const south = { floors: 22, unitsPerFloor: 18 };

describe("tower stack", () => {
  it("reads unit numbers into floor and door, and refuses to guess", () => {
    expect(parseUnit("1507", south)).toEqual({ floor: 15, slot: 7 });
    expect(parseUnit("Apt 904", south)).toEqual({ floor: 9, slot: 4 });
    expect(parseUnit("#2218", south)).toEqual({ floor: 22, slot: 18 });
    expect(parseUnit("12A", south)).toEqual({ floor: 12, slot: 1 });
    expect(parseUnit("PH3", south)).toEqual({ floor: 22, slot: 3 });
    // floor known, door not
    expect(parseUnit("1500", south)).toEqual({ floor: 15, slot: null });
    expect(parseUnit("1531", south)).toEqual({ floor: 15, slot: null });
    // not in this tower, or not a unit
    expect(parseUnit("2501", south)).toBeNull();
    expect(parseUnit("B2", south)).toBeNull();
    expect(parseUnit("", south)).toBeNull();
    expect(parseUnit(null, south)).toBeNull();
  });

  it("puts each resident in the right tower by street address", () => {
    const opus = TOWER_BUILDINGS.find(b => b.id === "opus_la")!;
    const m = buildTowerModel(opus, [
      { key: "a", name: "A", address: "3545 Wilshire Blvd, Los Angeles, CA 90010", unit: "1507" },
      { key: "b", name: "B", address: "3650 W 6th Street", unit: "902" },
      { key: "c", name: "C", address: "3545 wilshire blvd", unit: "1507" },
      { key: "d", name: "D", address: "3545 Wilshire Blvd", unit: "lobby" },
      { key: "e", name: "E", address: "100 Main St", unit: "101" },
    ]);
    const [s, n] = m.towers;
    expect(s.floors[14][6].map(r => r.key)).toEqual(["a", "c"]);
    expect(n.floors[8][1].map(r => r.key)).toEqual(["b"]);
    expect(s.unplaced.map(r => r.key)).toEqual(["d"]);
    expect(m.unmatched.map(r => r.key)).toEqual(["e"]);
    expect(s.lit).toBe(1);
    expect(darkFloors(s)).toHaveLength(21);
    expect(darkFloors(s)).not.toContain(15);
  });

  it("knows both Century Park East towers", () => {
    const cpe = TOWER_BUILDINGS.find(b => b.id === "century_park_east")!;
    const m = buildTowerModel(cpe, [
      { key: "x", name: "X", address: "2160 Century Pk E", unit: "2112" },
      { key: "y", name: "Y", address: "2170 Century Park East, Los Angeles, CA 90067", unit: "301" },
    ]);
    expect(m.towers[0].floors[20][11][0].key).toBe("x");
    expect(m.towers[1].floors[2][0][0].key).toBe("y");
  });
});
