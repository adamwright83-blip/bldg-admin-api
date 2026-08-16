import { describe, expect, it } from "vitest";
import {
  CORRIDOR_MIN_PROGRESS,
  clampCorridorProgress,
  forwardProgressLimit,
} from "./movementLimit";
import {
  branchPaceFor,
  stepVelocity,
  targetSpeedForMagnitude,
} from "../runtime/movementFeel";
import {
  CORRIDOR_EXIT_THRESHOLD,
  EXPEDITION_CORRIDOR_END,
  EXPEDITION_START_PROGRESS,
} from "./expeditionPlan";

/**
 * The bug this file exists to prevent, stated plainly:
 *
 *     const ceiling = trigger ? trigger.at : this.forwardCeiling();
 *     this.progress = Math.max(0.035, Math.min(blocked ? ceiling : 0.82, next));
 *
 * `blocked` is false during ordinary unobstructed movement, so the joystick
 * clamped to the raw 0.82 and walked straight through the expedition
 * ceiling — while dodge and the tether impulse correctly respected it. The
 * previous test suite passed because it asserted the ceiling HELPER rather
 * than the movement path that consumes it.
 *
 * So these tests drive the real per-frame locomotion decision using the
 * same production functions the runtime calls — stepVelocity,
 * targetSpeedForMagnitude, branchPaceFor, forwardProgressLimit,
 * clampCorridorProgress — rather than asserting a constant.
 */

const ORDINARY_CEILING = 0.82;
const FRAME = 1 / 60;

/**
 * One frame of ordinary joystick locomotion, mirroring GoldlineGame.update.
 * `input.y = -1` is full forward, exactly as the stick reports it.
 */
function walkFrame(state: {
  progress: number;
  velocity: number;
  modeCeiling: number;
  triggerAt: number | null;
  blocked: boolean;
}) {
  const magnitude = 1;
  const targetSpeed = targetSpeedForMagnitude(magnitude, branchPaceFor("intel"));
  state.velocity = stepVelocity({
    currentVelocity: state.velocity,
    targetSpeed,
    deltaSeconds: FRAME,
    isReversing: false,
  });
  const next = state.progress + state.velocity * 1 * FRAME;
  state.progress = clampCorridorProgress(
    next,
    forwardProgressLimit({
      modeCeiling: state.modeCeiling,
      triggerAt: state.triggerAt,
      blocked: state.blocked,
    })
  );
  return state;
}

/** Holds forward long enough that unrestricted movement would overrun. */
function holdForward(state: Parameters<typeof walkFrame>[0], seconds: number) {
  const frames = Math.round(seconds / FRAME);
  for (let i = 0; i < frames; i += 1) walkFrame(state);
  return state;
}

describe("holding forward inside an expedition", () => {
  it("never crosses the expedition ceiling", () => {
    const state = {
      progress: EXPEDITION_START_PROGRESS,
      velocity: 0,
      modeCeiling: EXPEDITION_CORRIDOR_END,
      triggerAt: null,
      blocked: false,
    };

    // 60 seconds of continuous forward input — far more than enough to
    // cross the whole corridor at any plausible pace.
    holdForward(state, 60);

    expect(state.progress).toBeLessThanOrEqual(EXPEDITION_CORRIDOR_END);
  });

  it("never crosses the ordinary corridor exit threshold", () => {
    const state = {
      progress: EXPEDITION_START_PROGRESS,
      velocity: 0,
      modeCeiling: EXPEDITION_CORRIDOR_END,
      triggerAt: null,
      blocked: false,
    };
    holdForward(state, 60);

    // The claim that was previously false for this exact path.
    expect(state.progress).toBeLessThan(CORRIDOR_EXIT_THRESHOLD);
  });

  it("still actually travels — the clamp is not just freezing the player", () => {
    const state = {
      progress: EXPEDITION_START_PROGRESS,
      velocity: 0,
      modeCeiling: EXPEDITION_CORRIDOR_END,
      triggerAt: null,
      blocked: false,
    };
    holdForward(state, 60);

    // It must reach the end of the expedition, not stall short of it.
    expect(state.progress).toBeCloseTo(EXPEDITION_CORRIDOR_END, 3);
  });

  it("is unblocked throughout — the failing condition of the original bug", () => {
    // The old code only consulted the ceiling when `blocked` was true. This
    // whole scenario runs with blocked === false, which is why it slipped
    // through before.
    const state = {
      progress: EXPEDITION_START_PROGRESS,
      velocity: 0,
      modeCeiling: EXPEDITION_CORRIDOR_END,
      triggerAt: null,
      blocked: false,
    };
    holdForward(state, 60);
    expect(state.blocked).toBe(false);
    expect(state.progress).toBeLessThanOrEqual(EXPEDITION_CORRIDOR_END);
  });
});

describe("ordinary corridor movement is unchanged", () => {
  it("still progresses toward the normal corridor maximum", () => {
    const state = {
      progress: 0.06,
      velocity: 0,
      modeCeiling: ORDINARY_CEILING,
      triggerAt: null,
      blocked: false,
    };
    holdForward(state, 60);

    // Outside an expedition the player must still be able to reach the exit
    // region — the fix must not permanently shorten the corridor.
    expect(state.progress).toBeGreaterThan(CORRIDOR_EXIT_THRESHOLD);
    expect(state.progress).toBeCloseTo(ORDINARY_CEILING, 3);
  });

  it("still stops at an authored traversal trigger", () => {
    const state = {
      progress: 0.2,
      velocity: 0,
      modeCeiling: ORDINARY_CEILING,
      triggerAt: 0.35,
      blocked: true,
    };
    holdForward(state, 30);
    expect(state.progress).toBeCloseTo(0.35, 6);
  });
});

describe("forwardProgressLimit", () => {
  it("applies the mode ceiling even when nothing is blocking", () => {
    expect(
      forwardProgressLimit({
        modeCeiling: EXPEDITION_CORRIDOR_END,
        triggerAt: null,
        blocked: false,
      })
    ).toBe(EXPEDITION_CORRIDOR_END);
  });

  it("lets a trigger tighten the limit but never loosen it", () => {
    // Trigger nearer than the ceiling: the trigger wins.
    expect(
      forwardProgressLimit({
        modeCeiling: 0.74,
        triggerAt: 0.4,
        blocked: true,
      })
    ).toBe(0.4);

    // Trigger BEYOND the ceiling: the ceiling still wins. This is the
    // asymmetry the old `blocked ? ceiling : 0.82` got backwards.
    expect(
      forwardProgressLimit({
        modeCeiling: 0.74,
        triggerAt: 0.9,
        blocked: true,
      })
    ).toBe(0.74);
  });

  it("ignores a trigger the player has not closed on", () => {
    expect(
      forwardProgressLimit({
        modeCeiling: 0.74,
        triggerAt: 0.4,
        blocked: false,
      })
    ).toBe(0.74);
  });
});

describe("clampCorridorProgress", () => {
  it("holds the corridor floor", () => {
    expect(clampCorridorProgress(-5, 0.74)).toBe(CORRIDOR_MIN_PROGRESS);
  });

  it("holds the supplied limit", () => {
    expect(clampCorridorProgress(99, 0.74)).toBe(0.74);
  });
});
