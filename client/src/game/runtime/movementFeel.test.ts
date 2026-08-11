import { describe, expect, it } from "vitest";
import {
  ACCEL_UNITS_PER_SECOND,
  DECEL_UNITS_PER_SECOND,
  INPUT_DEADZONE,
  REVERSAL_UNITS_PER_SECOND,
  branchPaceFor,
  stepVelocity,
  targetSpeedForMagnitude,
} from "./movementFeel";
import { CAMERA_LAG_EASE_PER_SECOND } from "./CameraController";

// These assert behavior CLASS (monotonic, continuous, in-range), not one
// magic number, so a future retune of the constants doesn't require
// rewriting the tests — only a genuine behavioral regression should fail them.

describe("targetSpeedForMagnitude", () => {
  it("is zero inside the deadzone", () => {
    expect(targetSpeedForMagnitude(0, 1)).toBe(0);
    expect(targetSpeedForMagnitude(INPUT_DEADZONE - 0.01, 1)).toBe(0);
  });

  it("scales continuously with magnitude — not a 2-tier step function", () => {
    const small = targetSpeedForMagnitude(0.2, 1);
    const medium = targetSpeedForMagnitude(0.5, 1);
    const full = targetSpeedForMagnitude(1, 1);
    expect(small).toBeGreaterThan(0);
    expect(medium).toBeGreaterThan(small);
    expect(full).toBeGreaterThan(medium);
  });

  it("scales with branch pace", () => {
    const safe = targetSpeedForMagnitude(1, 0.82);
    const normal = targetSpeedForMagnitude(1, 1);
    const upper = targetSpeedForMagnitude(1, 1.08);
    expect(safe).toBeLessThan(normal);
    expect(normal).toBeLessThan(upper);
  });
});

describe("stepVelocity", () => {
  it("ramps toward the target rather than snapping to it", () => {
    const next = stepVelocity({
      currentVelocity: 0,
      targetSpeed: 0.13,
      deltaSeconds: 1 / 60,
      isReversing: false,
    });
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(0.13);
  });

  it("never overshoots the target in a single step", () => {
    const next = stepVelocity({
      currentVelocity: 0.1,
      targetSpeed: 0.13,
      deltaSeconds: 1,
      isReversing: false,
    });
    expect(next).toBeLessThanOrEqual(0.13);
  });

  it("decelerates faster than it accelerates by default (weightier stop)", () => {
    expect(DECEL_UNITS_PER_SECOND).toBeGreaterThan(ACCEL_UNITS_PER_SECOND);
  });

  it("ramps a direction reversal faster than either accel or decel alone", () => {
    expect(REVERSAL_UNITS_PER_SECOND).toBeGreaterThan(ACCEL_UNITS_PER_SECOND);
    expect(REVERSAL_UNITS_PER_SECOND).toBeGreaterThan(DECEL_UNITS_PER_SECOND);
  });

  it("reaches the target asymptotically over many small steps, never oscillating", () => {
    let velocity = 0;
    const target = 0.13;
    for (let i = 0; i < 300; i += 1) {
      velocity = stepVelocity({
        currentVelocity: velocity,
        targetSpeed: target,
        deltaSeconds: 1 / 60,
        isReversing: false,
      });
      expect(velocity).toBeLessThanOrEqual(target + 1e-9);
      expect(velocity).toBeGreaterThanOrEqual(0);
    }
    expect(velocity).toBeCloseTo(target, 3);
  });
});

describe("branchPaceFor", () => {
  it("orders safe < intel < upper", () => {
    expect(branchPaceFor("safe")).toBeLessThan(branchPaceFor("intel"));
    expect(branchPaceFor("intel")).toBeLessThan(branchPaceFor("upper"));
  });
});

describe("camera lag settle time", () => {
  it("falls within the requested 120-220ms range", () => {
    const settleMs = 1000 / CAMERA_LAG_EASE_PER_SECOND;
    expect(settleMs).toBeGreaterThanOrEqual(120);
    expect(settleMs).toBeLessThanOrEqual(220);
  });
});
