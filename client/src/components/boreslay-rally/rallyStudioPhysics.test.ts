import { describe, expect, it } from "vitest";
import { RallyEngine } from "./rallyEngine";
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
  it("uses the reference landscape proportions, a 60-second match, and no first prompt before 35 seconds", () => {
    expect(RALLY_CONFIG.arena.width / RALLY_CONFIG.arena.height).toBeCloseTo(600 / 269, 5);
    expect(RALLY_CONFIG.scoring.regulationMs).toBe(60_000);
    expect(RALLY_CONFIG.rescue.minimumMatchAgeMs).toBe(35_000);
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

  it("lets Closer hold the inbound scroll without stealing match time, then resumes play after acceptance", () => {
    const engine = new RallyEngine({ controlMode: "duel", scoringMode: "buttHybrid", seed: 77 });
    engine.start();
    engine.state.serveAt = null;
    engine.state.excuse.inPlay = true;
    engine.state.excuse.x = engine.state.spark.x + 150;
    engine.state.excuse.y = engine.state.spark.y - 60;
    engine.state.excuse.vx = -700;
    engine.state.excuse.vy = 90;
    engine.state.excuse.lastTouchedBy = "clockhead";
    engine.state.mission.status = "ready";
    engine.state.mission.readyAt = engine.state.timeMs;
    engine.state.mission.acceptDeadline = engine.state.timeMs + RALLY_CONFIG.rescue.acceptWindowMs;

    const regulationBefore = engine.state.regulationRemainingMs;
    engine.advanceFixedSteps(30);

    expect(engine.state.regulationRemainingMs).toBe(regulationBefore);
    expect(engine.state.excuse.vx).toBe(0);
    expect(engine.state.excuse.vy).toBe(0);
    expect(engine.state.excuse.inPlay).toBe(true);

    expect(engine.acceptRescue()).toBe(true);
    expect(engine.state.mission.status).toBe("accepted");
    expect(engine.state.status).toBe("playing");
    expect(engine.state.spark.frozenUntil).toBe(engine.state.timeMs);
    expect(engine.state.excuse.vx).toBeGreaterThan(0);

    const acceptedAtX = engine.state.excuse.x;
    engine.advanceFixedSteps(10);
    expect(engine.state.excuse.x).toBeGreaterThan(acceptedAtX);
  });
});