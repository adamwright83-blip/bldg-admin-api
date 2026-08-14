import { describe, expect, it } from "vitest";
import { facingForInput } from "./facing";

describe("facingForInput", () => {
  it("derives back from forward joystick push (negative y)", () => {
    expect(facingForInput(0, -0.8, "front")).toBe("back");
  });

  it("derives front from backward joystick push (positive y)", () => {
    expect(facingForInput(0, 0.8, "back")).toBe("front");
  });

  it("derives left from negative x when x dominates y", () => {
    expect(facingForInput(-0.6, 0.1, "front")).toBe("left");
  });

  it("derives right from positive x when x dominates y", () => {
    expect(facingForInput(0.6, -0.1, "front")).toBe("right");
  });

  it("keeps the current facing inside the dead zone (near-zero input)", () => {
    expect(facingForInput(0.02, -0.03, "left")).toBe("left");
    expect(facingForInput(0, 0, "back")).toBe("back");
  });

  it("resolves an exact axis tie by favoring forward/back — the corridor's primary motion axis", () => {
    expect(facingForInput(0.5, 0.5, "left")).toBe("front");
    expect(facingForInput(0.5, -0.5, "left")).toBe("back");
  });

  it("never changes facing based on anything but the two input numbers (deterministic, no randomness)", () => {
    const a = facingForInput(-0.9, 0.1, "front");
    const b = facingForInput(-0.9, 0.1, "front");
    expect(a).toBe(b);
    expect(a).toBe("left");
  });

  it("is a pure function of its arguments — repeated identical calls never diverge", () => {
    const results = new Set(
      Array.from({ length: 20 }, () => facingForInput(0.3, -0.7, "left"))
    );
    expect(results.size).toBe(1);
  });
});
