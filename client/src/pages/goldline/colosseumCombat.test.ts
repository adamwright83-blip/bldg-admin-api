import { describe, expect, it } from "vitest";
import {
  CLOCKHEAD_PROJECTILE_ORIGIN,
  movementFacing,
  perspectiveScale,
  spawnClockheadProjectiles,
  stepColosseumProjectiles,
  sweepHitsPlayer,
} from "./colosseumCombat";

describe("Colosseum combat", () => {
  it("fires a committed aimed projectile rather than a homing beam", () => {
    const [shot] = spawnClockheadProjectiles("aimed", { x: 50, y: 80 }, 1);
    expect(shot.x).toBe(CLOCKHEAD_PROJECTILE_ORIGIN.x);
    expect(shot.y).toBe(CLOCKHEAD_PROJECTILE_ORIGIN.y);
    expect(shot.vy).toBeGreaterThan(0);
    expect(Math.abs(shot.vx)).toBeLessThan(0.001);
  });

  it("fires a readable three-shot fan", () => {
    const shots = spawnClockheadProjectiles("fan", { x: 50, y: 80 }, 2);
    expect(shots).toHaveLength(3);
    expect(shots[0].vx).toBeGreaterThan(0);
    expect(Math.abs(shots[1].vx)).toBeLessThan(0.001);
    expect(shots[2].vx).toBeLessThan(0);
  });

  it("lets the carried shield consume a projectile before body collision", () => {
    const result = stepColosseumProjectiles(
      [{ id: "p", x: 50, y: 74, vx: 0, vy: 20 }],
      0.12,
      { x: 50, y: 80 },
      true,
      false
    );
    expect(result.projectiles).toHaveLength(0);
    expect(result.collisions[0]?.kind).toBe("shield");
  });

  it("can damage Trailblazer when a shot gets past the guard", () => {
    const result = stepColosseumProjectiles(
      [{ id: "p", x: 50, y: 76.8, vx: 0, vy: 20 }],
      0.05,
      { x: 50, y: 80 },
      false,
      false
    );
    expect(result.collisions[0]?.kind).toBe("player");
  });

  it("makes the clock-hand sweep a spatial hazard rather than decoration", () => {
    expect(sweepHitsPlayer(0.5, { x: 50, y: 70 })).toBe(true);
    expect(sweepHitsPlayer(0.5, { x: 78, y: 70 })).toBe(false);
  });

  it("projects facing and arena depth deterministically", () => {
    expect(movementFacing({ x: -1, y: 0.2 })).toBe("left");
    expect(movementFacing({ x: 0.2, y: -1 })).toBe("back");
    expect(perspectiveScale(86)).toBeGreaterThan(perspectiveScale(34));
  });
});
