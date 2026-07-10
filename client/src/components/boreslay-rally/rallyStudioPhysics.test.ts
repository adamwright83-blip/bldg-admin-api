import { describe, expect, it } from "vitest";
import { RALLY_CONFIG } from "./rallyConfig";
import {
  getRallyStudioBumpers,
  resolveRallyStudioBumper,
} from "./rallyStudioPhysics";

const target = (x: number, y: number) => ({
  x,
  y,
  prevX: x,
  prevY: y,
  radius: RALLY_CONFIG.buttTarget.radius,
  wobble: { x: 0, y: 0, vx: 0, vy: 0 },
});

describe("Boreslay studio contract", () => {
  it("uses the reference landscape proportions and a 60-second match", () => {
    expect(RALLY_CONFIG.arena.width / RALLY_CONFIG.arena.height).toBeCloseTo(600 / 269, 5);
    expect(RALLY_CONFIG.scoring.regulationMs).toBe(60_000);
  });

  it.each([
    ["spark", -600, 255],
    ["clockhead", 600, 945],
  ] as const)("turns the %s back bumper into a bank toward its themed target", (side, vx, targetX) => {
    const bumper = getRallyStudioBumpers().find(candidate => candidate.side === side)!;
    const middleX = (bumper.ax + bumper.bx) / 2;
    const middleY = (bumper.ay + bumper.by) / 2;
    const collisionRadius = RALLY_CONFIG.duel.excuseRadius + RALLY_CONFIG.duel.bumperThickness;
    const excuse = {
      x: middleX + bumper.nx * (collisionRadius - 1),
      y: middleY + bumper.ny * (collisionRadius - 1),
      vx,
      vy: 0,
      bankState: false,
    };

    expect(
      resolveRallyStudioBumper(
        excuse,
        target(targetX, RALLY_CONFIG.duel.groundY),
        bumper
      )
    ).toBe(true);
    expect(excuse.bankState).toBe(true);
    expect(Math.sign(excuse.vx)).toBe(side === "spark" ? 1 : -1);
    expect(excuse.vy).toBeGreaterThan(0);
    expect(Math.hypot(excuse.vx, excuse.vy)).toBeGreaterThan(Math.abs(vx));
  });
});
