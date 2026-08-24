import { describe, expect, it } from "vitest";
import {
  MAX_SPEED,
  OVERWORLD_DEADZONE,
  remapAnalogInput,
  stepVelocity,
} from "./movement";

describe("overworld analog movement", () => {
  it("remaps the deadzone and normalizes diagonals", () => {
    expect(remapAnalogInput(OVERWORLD_DEADZONE, 0).magnitude).toBe(0);
    const diagonal = remapAnalogInput(1, 1);
    expect(diagonal.magnitude).toBe(1);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 6);
  });

  it("accelerates, decelerates, and reverses without exceeding max speed", () => {
    const input = remapAnalogInput(1, 0);
    const first = stepVelocity({ x: 0, y: 0 }, input, 1 / 60);
    const forward = stepVelocity(first, input, 1 / 60);
    const reverse = stepVelocity(forward, remapAnalogInput(-1, 0), 1 / 60);
    expect(forward.x).toBeGreaterThan(first.x);
    expect(reverse.x).toBeLessThan(forward.x);
    expect(Math.hypot(forward.x, forward.y)).toBeLessThanOrEqual(MAX_SPEED);
  });

  it("is stable across common frame rates", () => {
    function simulate(fps: number) {
      let velocity = { x: 0, y: 0 };
      let x = 0;
      for (let frame = 0; frame < fps; frame += 1) {
        velocity = stepVelocity(velocity, remapAnalogInput(0.8, 0), 1 / fps);
        x += velocity.x / fps;
      }
      return x;
    }
    const sixtyFps = simulate(60);
    const oneTwentyFps = simulate(120);
    expect(Math.abs(sixtyFps - oneTwentyFps) / oneTwentyFps).toBeLessThan(0.01);
  });
});
