import { describe, expect, it } from "vitest";
import {
  AFTERMATH_TIMING,
  ROOK_ON_THE_LINE,
  SPEAKER_LABELS,
  lineDurationMs,
  readMs,
  speakerPoint,
  typeMs,
} from "./aftermathScript";
import { CLOCKHEAD_CENTER, stageDistance } from "./colosseumStage";
import { CLOCKHEAD_DIAL_RADIUS } from "./clockheadHitReaction";

describe("Rook is discovered, not rescued", () => {
  it("opens on an unnamed voice, and Trailblazer names him in the very next line", () => {
    expect(ROOK_ON_THE_LINE[0]!.speaker).toBe("unknown");
    expect(SPEAKER_LABELS.unknown).not.toMatch(/rook/i);
    expect(ROOK_ON_THE_LINE[1]).toEqual({ speaker: "trailblazer", text: "…Rook?" });
    expect(ROOK_ON_THE_LINE.slice(2).some(line => line.speaker === "unknown")).toBe(false);
  });

  it("reveals the network he has been running, never a rescue (WORLD_BIBLE §12)", () => {
    const script = ROOK_ON_THE_LINE.map(line => `${line.text} ${line.lieFails ?? ""}`).join(" ");
    expect(script).toMatch(/every clock in the republic has a speaker/i);
    expect(script).not.toMatch(/rescu|prison|cell|free me|save me|let me out|thank you/i);
  });

  it("shows the Sunder exactly once: a direct lie dies in static and the truth follows", () => {
    const lies = ROOK_ON_THE_LINE.filter(line => line.lieFails);
    expect(lies).toHaveLength(1);
    expect(lies[0]!.speaker).toBe("rook");
    expect(lies[0]!.text.endsWith("—")).toBe(true);
  });

  it("ends on something he will not say, rather than a welcome", () => {
    const last = ROOK_ON_THE_LINE[ROOK_ON_THE_LINE.length - 1]!;
    expect(last).toEqual({ speaker: "rook", text: "Yes." });
  });

  it("keeps every line to a phone subtitle", () => {
    for (const line of ROOK_ON_THE_LINE) {
      expect(line.text.length, line.text).toBeLessThanOrEqual(90);
      if (line.lieFails) expect(line.lieFails.length).toBeLessThanOrEqual(90);
    }
  });
});

describe("the aftermath's pacing", () => {
  it("lands LEVEL COMPLETE first, then quiet, then the crackle, then the first line", () => {
    const t = AFTERMATH_TIMING;
    expect(t.stampAtMs).toBeLessThan(t.statsAtMs);
    expect(t.statsAtMs).toBeLessThan(t.stampOutMs);
    expect(t.crackleAtMs - t.stampOutMs).toBeGreaterThanOrEqual(1000);
    expect(t.firstLineAtMs).toBeGreaterThan(t.crackleAtMs);
  });

  it("gives every line time to be typed and read, longer lines longer", () => {
    for (const line of ROOK_ON_THE_LINE) {
      expect(lineDurationMs(line)).toBeGreaterThanOrEqual(typeMs(line.text) + AFTERMATH_TIMING.minReadMs);
    }
    expect(readMs("Yes.")).toBe(AFTERMATH_TIMING.minReadMs);
    const lie = ROOK_ON_THE_LINE.find(line => line.lieFails)!;
    expect(lineDurationMs(lie)).toBeGreaterThan(typeMs(lie.text) + typeMs(lie.lieFails!) + AFTERMATH_TIMING.lieStaticMs);
  });

  it("puts the speaking dial on his face", () => {
    const dial = speakerPoint();
    expect(stageDistance(dial, CLOCKHEAD_CENTER)).toBeLessThan(CLOCKHEAD_DIAL_RADIUS);
    expect(dial.x).toBeLessThan(CLOCKHEAD_CENTER.x);
  });
});
