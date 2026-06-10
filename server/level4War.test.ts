import { describe, expect, it } from "vitest";
import {
  MERCY_FLOOR_TILE,
  WAR_NEUTRAL_TILE,
  WAR_TILE_COUNT,
  WAR_VICTORY_TILE,
  isMissingWarTableError,
} from "./level4War";

describe("Level 4 War — geometry & safety contracts", () => {
  it("keeps the mercy floor strictly between the family edge and neutral", () => {
    // The villain must never reach the family (tile 0 side is the hero's
    // start; the family sits past the victory edge) — and a bad day can
    // never start tomorrow underwater past the floor.
    expect(MERCY_FLOOR_TILE).toBeGreaterThan(0);
    expect(MERCY_FLOOR_TILE).toBeLessThan(WAR_NEUTRAL_TILE);
  });

  it("victory edge is the final tile of the existing 14-tile bridge", () => {
    expect(WAR_TILE_COUNT).toBe(14);
    expect(WAR_VICTORY_TILE).toBe(13);
  });

  it("recognizes the missing-table error shapes used by mysql drivers", () => {
    expect(
      isMissingWarTableError(new Error("Table 'db.level4_war_events' doesn't exist"))
    ).toBe(true);
    expect(isMissingWarTableError(new Error("ER_NO_SUCH_TABLE: nope"))).toBe(true);
    expect(isMissingWarTableError(new Error("connection refused"))).toBe(false);
  });
});
