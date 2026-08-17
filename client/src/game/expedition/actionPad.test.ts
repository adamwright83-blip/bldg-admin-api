import { describe, expect, it, vi } from "vitest";
import {
  ActionPad,
  DODGE,
  FLICK_DISTANCE_PX,
  FLICK_VELOCITY_PX_MS,
  HOLD_THRESHOLD_MS,
  MOVEMENT_DEADZONE_PX,
  beginDodge,
  createDodgeState,
  dodgeIsInvulnerable,
  stepDodge,
} from "./actionPad";

describe("tap/flick/hold grammar", () => {
  it("resolves a short press with no meaningful movement to a strike", () => {
    const pad = new ActionPad();
    pad.pointerDown(1000, 0);
    pad.pointerUpdate(1000 + HOLD_THRESHOLD_MS - 40, 0, 0);
    expect(pad.getPhase()).toBe("pending");
    expect(pad.pointerUp(1000 + HOLD_THRESHOLD_MS - 40)).toEqual({ kind: "strike" });
  });

  it("resolves a short press with only jitter (below the movement deadzone) to a strike", () => {
    const pad = new ActionPad();
    pad.pointerDown(0, 0);
    pad.pointerUpdate(50, 0, MOVEMENT_DEADZONE_PX - 1);
    expect(pad.pointerUp(50)).toEqual({ kind: "strike" });
  });

  it("resolves a fast, far release within the hold threshold to a dodge (flick-evade)", () => {
    const pad = new ActionPad();
    pad.pointerDown(0, 0);
    // Covers FLICK_DISTANCE_PX well within HOLD_THRESHOLD_MS, comfortably
    // above FLICK_VELOCITY_PX_MS.
    const atMs = 60;
    pad.pointerUpdate(atMs, 0, FLICK_DISTANCE_PX + 5);
    expect(pad.pointerUp(atMs)).toEqual({ kind: "dodge" });
  });

  it("does not classify a release just below the flick distance as a dodge", () => {
    const pad = new ActionPad();
    pad.pointerDown(0, 0);
    const atMs = 60;
    pad.pointerUpdate(atMs, 0, FLICK_DISTANCE_PX - 1);
    expect(pad.pointerUp(atMs)).toEqual({ kind: "strike" });
  });

  it("does not classify a release just above the flick distance as a dodge if it arrived too slowly", () => {
    const pad = new ActionPad();
    pad.pointerDown(0, 0);
    // Distance clears FLICK_DISTANCE_PX, but the elapsed time keeps
    // velocity just under FLICK_VELOCITY_PX_MS.
    const distance = FLICK_DISTANCE_PX + 5;
    const atMs = Math.ceil(distance / FLICK_VELOCITY_PX_MS) + 5;
    expect(atMs).toBeLessThan(HOLD_THRESHOLD_MS);
    pad.pointerUpdate(atMs, 0, distance);
    expect(pad.pointerUp(atMs)).toEqual({ kind: "strike" });
  });

  it("classifies a release right at both flick thresholds as a dodge", () => {
    const pad = new ActionPad();
    pad.pointerDown(0, 0);
    const atMs = Math.floor(FLICK_DISTANCE_PX / FLICK_VELOCITY_PX_MS);
    expect(atMs).toBeLessThan(HOLD_THRESHOLD_MS);
    pad.pointerUpdate(atMs, 0, FLICK_DISTANCE_PX);
    expect(pad.pointerUp(atMs)).toEqual({ kind: "dodge" });
  });

  it("a flick cannot accidentally become Line aim under slow CDP/device timing", () => {
    // Even a large, fast excursion resolves as soon as it releases before
    // the hold threshold — promotion to aiming is driven only by elapsed
    // time via pointerUpdate, never by distance.
    const pad = new ActionPad();
    pad.pointerDown(0, 0);
    pad.pointerUpdate(HOLD_THRESHOLD_MS - 1, 0, FLICK_DISTANCE_PX * 3);
    expect(pad.isAiming()).toBe(false);
    expect(pad.pointerUp(HOLD_THRESHOLD_MS - 1)).toEqual({ kind: "dodge" });
  });

  it("a hold cannot accidentally become a flick even with large drag distance", () => {
    const pad = new ActionPad();
    pad.pointerDown(0, 0);
    pad.pointerUpdate(HOLD_THRESHOLD_MS, 0, FLICK_DISTANCE_PX * 3);
    expect(pad.isAiming()).toBe(true);
    pad.setLockedTargetId(null);
    expect(pad.pointerUp(HOLD_THRESHOLD_MS)).toEqual({ kind: "cancel" });
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
