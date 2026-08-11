import { describe, expect, it } from "vitest";
import { lateralForProgress, parseGoldRoute } from "./goldRoute";

const SAMPLE = [
  { progress: 0, lateral: 0.5 },
  { progress: 0.5, lateral: 0.7 },
  { progress: 1, lateral: 0.4 },
];

describe("parseGoldRoute", () => {
  it("parses well-formed points and sorts by progress", () => {
    const parsed = parseGoldRoute({
      points: [
        { progress: 0.5, lateral: 0.6 },
        { progress: 0.1, lateral: 0.5 },
      ],
    });
    expect(parsed.map(p => p.progress)).toEqual([0.1, 0.5]);
  });

  it("drops malformed entries instead of throwing", () => {
    expect(parseGoldRoute({ points: [{ progress: "x" }, null] })).toEqual([]);
  });

  it("degrades to empty for missing/corrupt payloads", () => {
    expect(parseGoldRoute(null)).toEqual([]);
    expect(parseGoldRoute({})).toEqual([]);
  });
});

describe("lateralForProgress", () => {
  it("interpolates between authored points", () => {
    expect(lateralForProgress(SAMPLE, 0.25)).toBeCloseTo(0.6, 5);
  });

  it("clamps before the first and after the last point", () => {
    expect(lateralForProgress(SAMPLE, -1)).toBe(0.5);
    expect(lateralForProgress(SAMPLE, 2)).toBe(0.4);
  });

  it("returns a sane default when no points are loaded", () => {
    expect(lateralForProgress([], 0.5)).toBe(0.5);
  });

  it("matches an authored point exactly at its own progress", () => {
    expect(lateralForProgress(SAMPLE, 0.5)).toBe(0.7);
  });
});
