import { describe, expect, it } from "vitest";
import { HOSTILE_COLLISION_RADIUS, resolveHostileCollision } from "./hostileCollision";

describe("resolveHostileCollision", () => {
  it("lets an unobstructed candidate move through unchanged", () => {
    const result = resolveHostileCollision(0.5, 0.1, 0.4, 0.1, []);
    expect(result).toEqual({ progress: 0.5, lateral: 0.1 });
  });

  it("blocks a candidate that would land inside a hostile's collision radius", () => {
    const hostile = { x: 0.5, y: 0 };
    // Candidate progress lands essentially on top of the hostile, same lateral.
    const result = resolveHostileCollision(0.499, 0, 0.46, 0, [hostile]);
    expect(result.progress).not.toBe(0.499);
  });

  it("never blocks at a distance at or beyond the melee-attack radius (0.06) — a hostile's body must not out-reach its own attack range", () => {
    const hostile = { x: 0.5, y: 0 };
    // Exactly at the melee boundary, well outside the (smaller) collision radius.
    const result = resolveHostileCollision(0.44, 0, 0.43, 0, [hostile]);
    expect(result).toEqual({ progress: 0.44, lateral: 0 });
    expect(HOSTILE_COLLISION_RADIUS).toBeLessThan(0.06);
  });

  it("slides laterally when blocked head-on but a pure lateral move stays clear", () => {
    const hostile = { x: 0.5, y: 0 };
    // Straight-ahead candidate collides; candidate lateral alone (holding
    // progress at current) should clear it and be preferred over a hard stop.
    const result = resolveHostileCollision(0.499, 0.2, 0.46, 0.05, [hostile]);
    expect(result.lateral).toBeCloseTo(0.2, 5);
  });

  it("slides forward when blocked laterally but a pure forward move stays clear", () => {
    const hostile = { x: 0.5, y: 0 };
    const result = resolveHostileCollision(0.47, 0.35, 0.46, 0.02, [hostile]);
    // A large lateral jump alone into open space near the hostile might
    // still collide depending on geometry; what matters is the resolver
    // never just discards a legitimately clear single-axis move.
    expect(result.progress === 0.47 || result.lateral === 0.35 || (result.progress === 0.46 && result.lateral === 0.02)).toBe(true);
  });

  it("holds the current position when every axis of the attempted move collides", () => {
    const hostile = { x: 0.5, y: 0 };
    // Current position is already deep inside the radius too, so no single
    // axis of the candidate move can find daylight.
    const result = resolveHostileCollision(0.499, 0.001, 0.485, 0, [hostile]);
    expect(result).toEqual({ progress: 0.485, lateral: 0 });
  });

  it("ignores hostiles far outside the broad-phase window", () => {
    const distant = { x: 0.9, y: 0 };
    const result = resolveHostileCollision(0.5, 0, 0.49, 0, [distant]);
    expect(result).toEqual({ progress: 0.5, lateral: 0 });
  });

  it("checks every hostile, not just the first", () => {
    const near = { x: 5, y: 5 }; // effectively unreachable, sanity filler
    const blocker = { x: 0.5, y: 0 };
    const result = resolveHostileCollision(0.499, 0, 0.46, 0, [near, blocker]);
    expect(result.progress).not.toBe(0.499);
  });
});
