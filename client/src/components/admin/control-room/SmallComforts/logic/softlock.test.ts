import { describe, expect, it } from "vitest";
import { ASSIST_SECONDS, freshSoftLock, stepSoftLock, type SoftLockConfig } from "./softlock";

/** run `seconds` of idle placement (nobody touching the button) at 12 fps, counting what fired */
function idle(cfg: SoftLockConfig, seconds: number, input = { dragging: false, everPressed: false }) {
  let s = freshSoftLock();
  let cues = 0, assistSteps = 0, assistFired = 0, firstCueAt = -1, firstAssistAt = -1;
  const dt = 1 / 12;
  for (let i = 0; i < seconds * 12; i++) {
    const r = stepSoftLock(s, dt, cfg, input);
    s = r.state;
    if (r.cue) { cues++; if (firstCueAt < 0) firstCueAt = s.stuckFor; }
    if (r.assistActive) { assistSteps++; if (firstAssistAt < 0) firstAssistAt = s.stuckFor; }
    if (r.assistFiredNow) assistFired++;
  }
  return { cues, assistSteps, assistFired, firstCueAt, firstAssistAt };
}

describe("mirror soft-lock rules", () => {
  it("normal game keeps its 40 s assist and has no cue", () => {
    const r = idle({ assistEnabled: true, hintAfter: null }, 120);
    expect(ASSIST_SECONDS).toBe(40);
    expect(r.firstAssistAt).toBeGreaterThan(40);
    expect(r.firstAssistAt).toBeLessThan(40.2);
    expect(r.assistFired).toBe(1);
    expect(r.assistSteps).toBeGreaterThan(0);
    expect(r.cues).toBe(0);
  });

  it("normal game does not assist while the player is dragging", () => {
    const r = idle({ assistEnabled: true, hintAfter: null }, 120, { dragging: true, everPressed: true });
    expect(r.assistSteps).toBe(0);
  });

  it("mirror-cold stays unassisted and uncued indefinitely (30 minutes idle)", () => {
    const r = idle({ assistEnabled: false, hintAfter: null }, 30 * 60);
    expect(r.assistSteps).toBe(0);
    expect(r.assistFired).toBe(0);
    expect(r.cues).toBe(0);
  });

  it("mirror-hinted gives exactly one cue at 20 s and never the 40 s assist", () => {
    const r = idle({ assistEnabled: false, hintAfter: 20 }, 30 * 60);
    expect(r.cues).toBe(1);
    expect(r.firstCueAt).toBeGreaterThan(20);
    expect(r.firstCueAt).toBeLessThan(20.2);
    expect(r.assistSteps).toBe(0);
    expect(r.assistFired).toBe(0);
  });

  it("mirror-hinted gives no cue once the tester has pressed the button", () => {
    const r = idle({ assistEnabled: false, hintAfter: 20 }, 120, { dragging: false, everPressed: true });
    expect(r.cues).toBe(0);
  });
});
