import { describe, expect, it, vi } from "vitest";
import {
  ActionPad,
  DODGE,
  HOLD_THRESHOLD_MS,
  beginDodge,
  createDodgeState,
  dodgeIsInvulnerable,
  stepDodge,
} from "./actionPad";

describe("tap/hold grammar", () => {
  it("resolves a short press to a dodge", () => {
    const pad = new ActionPad();
    pad.pointerDown(1000, 0);
    pad.pointerUpdate(1000 + HOLD_THRESHOLD_MS - 40, 0);
    expect(pad.getPhase()).toBe("pending");
    expect(pad.pointerUp(1000 + HOLD_THRESHOLD_MS - 40)).toEqual({ kind: "dodge" });
  });

  it("enters aim once the hold threshold is crossed", () => {
    const onEnterAim = vi.fn();
    const pad = new ActionPad({ onEnterAim });

    pad.pointerDown(0, 0);
    pad.pointerUpdate(HOLD_THRESHOLD_MS - 1, 0);
    expect(pad.isAiming()).toBe(false);
    expect(onEnterAim).not.toHaveBeenCalled();

    pad.pointerUpdate(HOLD_THRESHOLD_MS, 0);
    expect(pad.isAiming()).toBe(true);
    expect(onEnterAim).toHaveBeenCalledTimes(1);
  });

  it("uses REAL time for the threshold so dilation cannot change the feel", () => {
    // The pad is fed wall-clock ms by the caller. Even with the simulation
    // at 0.2x, 200 real ms is 200 real ms.
    const pad = new ActionPad();
    pad.pointerDown(5_000, 0);
    pad.pointerUpdate(5_000 + HOLD_THRESHOLD_MS, 0);
    expect(pad.isAiming()).toBe(true);
  });

  it("fires at the locked target on release", () => {
    const onExitAim = vi.fn();
    const pad = new ActionPad({ onExitAim });

    pad.pointerDown(0, 0);
    pad.pointerUpdate(HOLD_THRESHOLD_MS, 0);
    pad.setLockedTargetId("ruin_hunter_1");

    expect(pad.pointerUp(600)).toEqual({ kind: "fire", targetId: "ruin_hunter_1" });
    expect(onExitAim).toHaveBeenCalledTimes(1);
  });

  it("cancels cleanly rather than substituting a dodge (§16)", () => {
    const pad = new ActionPad();
    pad.pointerDown(0, 0);
    pad.pointerUpdate(HOLD_THRESHOLD_MS + 300, 0);
    pad.setLockedTargetId(null);

    const resolution = pad.pointerUp(HOLD_THRESHOLD_MS + 300);
    expect(resolution).toEqual({ kind: "cancel" });
    expect(resolution.kind).not.toBe("dodge");
  });

  it("tracks aim heading as the thumb moves", () => {
    const pad = new ActionPad();
    pad.pointerDown(0, 0);
    pad.pointerUpdate(HOLD_THRESHOLD_MS, Math.PI / 3);
    expect(pad.getAimRadians()).toBeCloseTo(Math.PI / 3, 6);
  });

  it("ignores a lock set while not aiming", () => {
    const pad = new ActionPad();
    pad.pointerDown(0, 0);
    pad.setLockedTargetId("x");
    expect(pad.getLockedTargetId()).toBeNull();
  });

  it("resolves nothing on cancel", () => {
    const onExitAim = vi.fn();
    const pad = new ActionPad({ onExitAim });
    pad.pointerDown(0, 0);
    pad.pointerUpdate(HOLD_THRESHOLD_MS, 0);
    pad.cancel();

    expect(pad.getPhase()).toBe("idle");
    expect(onExitAim).toHaveBeenCalledTimes(1);
    expect(pad.pointerUp(999)).toEqual({ kind: "none" });
  });
});

describe("dodge", () => {
  it("bursts along the movement direction when the stick is deflected", () => {
    const state = createDodgeState();
    expect(beginDodge(state, { x: 0, y: -1 }, 1, 0)).toBe(true);
    expect(state.dirY).toBeCloseTo(-1, 6);
    expect(state.active).toBe(true);
  });

  it("falls back to facing when the stick is neutral", () => {
    const state = createDodgeState();
    beginDodge(state, { x: 0, y: 0 }, -1, 0);
    expect(state.dirX).toBeCloseTo(-1, 6);
  });

  it("grants i-frames at the start of the roll", () => {
    const state = createDodgeState();
    beginDodge(state, { x: 1, y: 0 }, 1, 0);
    expect(dodgeIsInvulnerable(state)).toBe(true);

    stepDodge(state, DODGE.iFrameSeconds + 0.01);
    expect(dodgeIsInvulnerable(state)).toBe(false);
  });

  it("ends and then cools down before it can be reused", () => {
    const state = createDodgeState();
    beginDodge(state, { x: 1, y: 0 }, 1, 0);
    stepDodge(state, DODGE.durationSeconds + 0.01);
    expect(state.active).toBe(false);

    expect(beginDodge(state, { x: 1, y: 0 }, 1, 0)).toBe(false);
    stepDodge(state, DODGE.cooldownSeconds + 0.01);
    expect(beginDodge(state, { x: 1, y: 0 }, 1, 0)).toBe(true);
  });

  it("cannot be retriggered mid-roll", () => {
    const state = createDodgeState();
    beginDodge(state, { x: 1, y: 0 }, 1, 0);
    expect(beginDodge(state, { x: -1, y: 0 }, 1, 0)).toBe(false);
    expect(state.dirX).toBeCloseTo(1, 6);
  });
});
