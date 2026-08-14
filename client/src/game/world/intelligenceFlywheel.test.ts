import { describe, expect, it } from "vitest";
import { briefingIntelNote, toStrongholdIntel } from "./intelligenceFlywheel";
import type { DriverSafeSalesIntel } from "../../../../shared/driverSafeSalesIntel";

function report(
  overrides: Partial<DriverSafeSalesIntel> = {}
): DriverSafeSalesIntel {
  return {
    acceptedTeachingCount: 3,
    byCategory: [
      { category: "discovery", count: 2 },
      { category: "closing", count: 1 },
    ],
    ...overrides,
  };
}

describe("toStrongholdIntel", () => {
  it("maps the real accepted-teaching count through unchanged", () => {
    expect(toStrongholdIntel(report()).acceptedTeachingCount).toBe(3);
  });

  it("preserves only the positive categories allowed by the server contract", () => {
    const intel = toStrongholdIntel(report());
    expect(intel.byCategory.map(c => c.category)).toEqual([
      "discovery",
      "closing",
    ]);
  });

  it("performs no acceptance/filtering of its own — it is a pure reshape", () => {
    const source = report();
    const intel = toStrongholdIntel(source);
    expect(intel.acceptedTeachingCount).toBe(source.acceptedTeachingCount);
  });
});

describe("briefingIntelNote", () => {
  it("returns a note when real accepted teaching exists for the category", () => {
    const intel = toStrongholdIntel(report());
    expect(briefingIntelNote(intel, "discovery")).toContain(
      "2 accepted teachings"
    );
  });

  it("returns null for a category with no real accepted teaching — never a generic CRM tip", () => {
    const intel = toStrongholdIntel(report());
    expect(briefingIntelNote(intel, "negotiation")).toBeNull();
  });

  it("returns null when intel itself is null", () => {
    expect(briefingIntelNote(null, "discovery")).toBeNull();
  });
});
