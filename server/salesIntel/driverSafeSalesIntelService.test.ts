import { describe, expect, it } from "vitest";
import { driverSafeSalesIntelSchema } from "../../shared/driverSafeSalesIntel";
import { projectDriverSafeSalesIntel } from "./driverSafeSalesIntelService";

describe("driver-safe Sales Intel projection", () => {
  it("returns null when no qualifying persisted intelligence exists", () => {
    expect(projectDriverSafeSalesIntel([])).toBeNull();
  });

  it("returns the exact allowlisted Stronghold shape in stable category order", () => {
    expect(
      projectDriverSafeSalesIntel([
        { category: "closing", count: 1 },
        { category: "discovery", count: 2 },
      ])
    ).toEqual({
      acceptedTeachingCount: 3,
      byCategory: [
        { category: "discovery", count: 2 },
        { category: "closing", count: 1 },
      ],
    });
  });

  it("cannot leak unrelated canonical fields through object spreading", () => {
    const canonicalShapedRow = {
      category: "pricing" as const,
      count: 4,
      rawTranscript: "private transcript",
      extractionProvider: "internal-provider",
      promptVersion: "private-prompt",
      reviewedBy: "admin-only",
    };
    const result = projectDriverSafeSalesIntel([canonicalShapedRow]);
    expect(Object.keys(result ?? {})).toEqual([
      "acceptedTeachingCount",
      "byCategory",
    ]);
    expect(Object.keys(result?.byCategory[0] ?? {})).toEqual([
      "category",
      "count",
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /private transcript|internal-provider|private-prompt|admin-only/
    );
  });

  it("keeps the runtime serializer strict when the canonical model grows", () => {
    expect(() =>
      driverSafeSalesIntelSchema.parse({
        acceptedTeachingCount: 1,
        byCategory: [{ category: "opening", count: 1 }],
        internalJobId: "must-not-cross-boundary",
      })
    ).toThrow();
  });
});
