import { describe, expect, it } from "vitest";
import { briefingIntelNote, toStrongholdIntel } from "./intelligenceFlywheel";
import type { SalesIntelTeachingCoverageReport } from "../../../../shared/salesIntelTeachingCoverage";

function report(overrides: Partial<SalesIntelTeachingCoverageReport> = {}): SalesIntelTeachingCoverageReport {
  return {
    totalAcceptedTeachings: 3,
    byCategory: [
      { category: "discovery", count: 2 },
      { category: "closing", count: 1 },
      { category: "pricing", count: 0 },
    ],
    byCreator: [],
    bySource: [],
    newestAcceptedAt: null,
    oldestAcceptedAt: null,
    ...overrides,
  };
}

describe("toStrongholdIntel", () => {
  it("maps the real accepted-teaching count through unchanged", () => {
    expect(toStrongholdIntel(report()).acceptedTeachingCount).toBe(3);
  });

  it("drops zero-count categories rather than presenting a padded full list", () => {
    const intel = toStrongholdIntel(report());
    expect(intel.byCategory.map(c => c.category)).toEqual(["discovery", "closing"]);
  });

  it("performs no acceptance/filtering of its own — it is a pure reshape", () => {
    const source = report();
    const intel = toStrongholdIntel(source);
    expect(intel.acceptedTeachingCount).toBe(source.totalAcceptedTeachings);
  });
});

describe("briefingIntelNote", () => {
  it("returns a note when real accepted teaching exists for the category", () => {
    const intel = toStrongholdIntel(report());
    expect(briefingIntelNote(intel, "discovery")).toContain("2 accepted teachings");
  });

  it("returns null for a category with no real accepted teaching — never a generic CRM tip", () => {
    const intel = toStrongholdIntel(report());
    expect(briefingIntelNote(intel, "negotiation")).toBeNull();
  });

  it("returns null when intel itself is null", () => {
    expect(briefingIntelNote(null, "discovery")).toBeNull();
  });
});
