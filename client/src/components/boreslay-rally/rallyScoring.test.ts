import { describe, expect, it } from "vitest";
import { RallyEngine } from "./rallyEngine";
import { RALLY_CONFIG } from "./rallyConfig";

function crossing(side: "spark" | "clockhead", lives = 3) {
  const engine = new RallyEngine();
  engine.start();
  engine.state.serveAt = null;
  engine.state.sparkLives = side === "spark" ? lives : 3;
  engine.state.clockheadLives = side === "clockhead" ? lives : 3;
  engine.state.excuse.inPlay = true;
  engine.state.excuse.y = 330;
  engine.state.excuse.prevY = 330;
  if (side === "spark") {
    engine.state.excuse.x = 5;
    engine.state.excuse.prevX = 5;
    engine.state.excuse.vx = -RALLY_CONFIG.excuse.maxSpeed;
  } else {
    engine.state.excuse.x = RALLY_CONFIG.arena.width - 5;
    engine.state.excuse.prevX = RALLY_CONFIG.arena.width - 5;
    engine.state.excuse.vx = RALLY_CONFIG.excuse.maxSpeed;
  }
  engine.state.excuse.vy = 0;
  return engine;
}

describe("RallyEngine scoring", () => {
  it("lets a first-timer score by tracking the scroll and holding Fire Breath", () => {
    const engine = new RallyEngine({ seed: 23 });
    engine.start();
    engine.setAim(RALLY_CONFIG.arena.width, 340);
    engine.setBreath(true);
    const thirtySeconds = RALLY_CONFIG.simulation.fixedHz * 30;
    for (let step = 0; step < thirtySeconds && engine.state.clockheadLives === 3; step += 1) {
      engine.setMovement(0, Math.sign(engine.state.excuse.y - engine.state.spark.y));
      engine.setAim(RALLY_CONFIG.arena.width, 340);
      engine.advanceFixedSteps(1);
    }
    expect(engine.state.clockheadLives).toBeLessThan(3);
  });

  it("scores a swept gate-plane crossing at the 980 px/s cap", () => {
    const engine = crossing("clockhead");
    engine.advanceFixedSteps(1);
    expect(engine.state.clockheadLives).toBe(2);
    expect(engine.state.excuse.inPlay).toBe(false);
    expect(engine.consumeEvents().some(event => event.type === "gate_score_for")).toBe(true);
  });

  it("does not score when the center crosses outside the gate opening", () => {
    const engine = crossing("spark");
    engine.state.excuse.y = 150;
    engine.state.excuse.prevY = 150;
    engine.advanceFixedSteps(1);
    expect(engine.state.sparkLives).toBe(3);
    expect(engine.state.excuse.vx).toBeGreaterThan(0);
  });

  it("makes an ignited gate score count double", () => {
    const engine = crossing("clockhead");
    engine.state.excuse.ignitedUntil = 9999;
    engine.advanceFixedSteps(1);
    expect(engine.state.clockheadLives).toBe(1);
  });

  it("reaches victory and defeat through gate lives, not hit points", () => {
    const victory = crossing("clockhead", 1);
    victory.advanceFixedSteps(1);
    expect(victory.state.status).toBe("victory");

    const defeat = crossing("spark", 1);
    defeat.advanceFixedSteps(1);
    expect(defeat.state.status).toBe("defeat");
  });
});
