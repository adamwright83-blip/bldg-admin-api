import { describe, expect, it } from "vitest";
import {
  describeFrameworkQuality,
  sourceCompletenessTier,
} from "./salesIntelQuality";

describe("sourceCompletenessTier", () => {
  it("ranks a supplied transcript as full", () => {
    expect(sourceCompletenessTier("supplied_transcript", true)).toBe("full_transcript");
  });

  it("ranks model video understanding as full", () => {
    expect(sourceCompletenessTier("video_understanding", true)).toBe("full_transcript");
  });

  it("ranks audio transcription as partial", () => {
    expect(sourceCompletenessTier("audio_transcription", true)).toBe("partial_transcript");
  });

  it("ranks caption-only distinctly and lower than a transcript", () => {
    expect(sourceCompletenessTier("caption_only", true)).toBe("caption_only");
  });

  it("falls back to url_reference_only when there is no transcript at all", () => {
    expect(sourceCompletenessTier(null, false)).toBe("url_reference_only");
  });
});

describe("describeFrameworkQuality", () => {
  it("never produces a percentage-effectiveness claim", () => {
    const summary = describeFrameworkQuality({
      sourceCompleteness: "full_transcript",
      independentSourceSupportCount: 3,
      modelConfidence: 0.87,
    });
    expect(summary).not.toMatch(/effective/i);
    expect(summary).not.toMatch(/win rate/i);
    expect(summary).not.toMatch(/success rate/i);
  });

  it("includes independent source support only when it is real (> 0)", () => {
    const withSupport = describeFrameworkQuality({
      sourceCompleteness: "full_transcript",
      independentSourceSupportCount: 2,
      modelConfidence: null,
    });
    expect(withSupport).toContain("2 other sources");

    const withoutSupport = describeFrameworkQuality({
      sourceCompleteness: "full_transcript",
      independentSourceSupportCount: 0,
      modelConfidence: null,
    });
    expect(withoutSupport).not.toContain("other source");
  });

  it("reports extraction confidence as a labeled percentage, not a bare number", () => {
    const summary = describeFrameworkQuality({
      sourceCompleteness: "partial_transcript",
      independentSourceSupportCount: 0,
      modelConfidence: 0.5,
    });
    expect(summary).toContain("extraction confidence 50%");
  });
});
