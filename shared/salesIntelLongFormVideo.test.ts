import { describe, expect, it } from "vitest";
import { computeVideoSegments, toGeminiOffset } from "./salesIntelLongFormVideo";

describe("computeVideoSegments", () => {
  it("splits a 118-minute video into 15-minute chunks with a correct final partial chunk", () => {
    const durationSeconds = 118 * 60; // 7080s — the actual Shelby video length, used only as a realistic test input
    const segments = computeVideoSegments(durationSeconds, 15 * 60);

    expect(segments).toHaveLength(8);
    expect(segments[0]).toEqual({ index: 0, startSeconds: 0, endSeconds: 900 });
    expect(segments[1]).toEqual({ index: 1, startSeconds: 900, endSeconds: 1800 });
    expect(segments[6]).toEqual({ index: 6, startSeconds: 5400, endSeconds: 6300 });
    // Final chunk is whatever remains — 7080 - 7*900 = 780s, not a full 900s.
    const last = segments.at(-1)!;
    expect(last.index).toBe(7);
    expect(last.startSeconds).toBe(7 * 900);
    expect(last.endSeconds).toBe(durationSeconds);
    expect(last.endSeconds - last.startSeconds).toBe(780);
    expect(last.endSeconds - last.startSeconds).toBeGreaterThan(0);
    expect(last.endSeconds - last.startSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it("never produces a zero-length segment", () => {
    for (const duration of [1, 59, 60, 61, 900, 901, 7080, 7200]) {
      const segments = computeVideoSegments(duration, 900);
      for (const segment of segments) {
        expect(segment.endSeconds).toBeGreaterThan(segment.startSeconds);
      }
    }
  });

  it("produces exactly one segment when duration is shorter than the chunk size", () => {
    const segments = computeVideoSegments(300, 900);
    expect(segments).toEqual([{ index: 0, startSeconds: 0, endSeconds: 300 }]);
  });

  it("produces exactly one full segment when duration equals the chunk size exactly", () => {
    const segments = computeVideoSegments(900, 900);
    expect(segments).toEqual([{ index: 0, startSeconds: 0, endSeconds: 900 }]);
  });

  it("segments are contiguous with no gaps and no overlap", () => {
    const segments = computeVideoSegments(7080, 900);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].startSeconds).toBe(segments[i - 1].endSeconds);
    }
  });

  it("indices are stable and sequential starting at 0", () => {
    const segments = computeVideoSegments(7080, 900);
    segments.forEach((segment, i) => expect(segment.index).toBe(i));
  });

  it("rejects a non-positive duration or chunk size", () => {
    expect(() => computeVideoSegments(0, 900)).toThrow();
    expect(() => computeVideoSegments(-5, 900)).toThrow();
    expect(() => computeVideoSegments(7080, 0)).toThrow();
    expect(() => computeVideoSegments(7080, -900)).toThrow();
  });
});

describe("toGeminiOffset", () => {
  it("formats whole seconds with a trailing s, matching Gemini's documented offset format", () => {
    expect(toGeminiOffset(0)).toBe("0s");
    expect(toGeminiOffset(900)).toBe("900s");
    expect(toGeminiOffset(7080)).toBe("7080s");
  });

  it("rounds fractional seconds rather than truncating unpredictably", () => {
    expect(toGeminiOffset(899.6)).toBe("900s");
  });
});
