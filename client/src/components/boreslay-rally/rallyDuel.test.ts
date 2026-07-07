import { describe, expect, it } from "vitest";
import { FIXED_STEP_MS, RALLY_CONFIG } from "./rallyConfig";
import { RallyEngine } from "./rallyEngine";

const duelEngine = () => {
  const engine = new RallyEngine({ controlMode: "duel", seed: 20260707 });
  engine.start();
  engine.state.serveAt = null;
  engine.state.spark.x = 300;
  engine.state.spark.y = RALLY_CONFIG.duel.groundY;
  engine.state.spark.facing = { x: 1, y: 0 };
  engine.state.clockhead.x = 900;
  engine.state.clockhead.y = RALLY_CONFIG.duel.groundY;
  engine.state.clockhead.facing = { x: -1, y: 0 };
  engine.state.duel.spark.grounded = true;
  engine.state.duel.clockhead.grounded = true;
  Object.assign(engine.state.excuse, {
    inPlay: true,
    x: engine.state.spark.x + RALLY_CONFIG.spark.radius + RALLY_CONFIG.duel.excuseRadius - 3,
    y: engine.state.spark.y - RALLY_CONFIG.spark.radius * 0.2,
    prevX: engine.state.spark.x + RALLY_CONFIG.spark.radius + RALLY_CONFIG.duel.excuseRadius - 3,
    prevY: engine.state.spark.y - RALLY_CONFIG.spark.radius * 0.2,
    vx: -110,
    vy: 0,
    lastTouchAt: -Infinity,
    bankState: true,
  });
  return engine;
};

const speed = (engine: RallyEngine) =>
  Math.hypot(engine.state.excuse.vx, engine.state.excuse.vy);

describe("duel physics", () => {
  it("keeps a standing body touch in the dink speed class and clears bank state", () => {
    const engine = duelEngine();
    engine.advanceFixedSteps(1);
    expect(speed(engine)).toBeLessThanOrEqual(RALLY_CONFIG.duel.maxDinkSpeed);
    expect(engine.state.excuse.bankState).toBe(false);
    expect(engine.consumeEvents().some(event => event.type === "contact_dink")).toBe(true);
  });

  it.each([
    ["flat", true, "strike"],
    ["spike", false, "strike"],
  ] as const)("makes a %s strike at least 2.2x faster than the standing dink ceiling", (_cell, grounded, button) => {
    const engine = duelEngine();
    engine.state.duel.spark.grounded = grounded;
    engine.state.spark.y = grounded ? RALLY_CONFIG.duel.groundY : RALLY_CONFIG.duel.groundY - 120;
    engine.state.excuse.x = engine.state.spark.x + 90;
    engine.state.excuse.y = engine.state.spark.y - 10;
    expect(engine.duelStrike(button)).toBe(true);
    expect(speed(engine)).toBeGreaterThanOrEqual(RALLY_CONFIG.duel.maxDinkSpeed * 2.2);
    expect(engine.consumeEvents().some(event => event.type === "strike_crack")).toBe(true);
  });

  it("keeps the airborne loft slow and floaty long enough to force a timed jump", () => {
    const engine = duelEngine();
    engine.state.duel.spark.grounded = false;
    engine.state.spark.y = 330;
    engine.state.excuse.x = engine.state.spark.x + 86;
    engine.state.excuse.y = 250;
    expect(engine.duelStrike("loft")).toBe(true);
    expect(engine.state.duel.spark.swingKind).toBe("lob");
    let airtimeMs = 0;
    while (airtimeMs < 2400 && engine.state.excuse.y < RALLY_CONFIG.duel.groundY + RALLY_CONFIG.duel.groundPad - RALLY_CONFIG.duel.excuseRadius) {
      engine.advanceFixedSteps(1);
      airtimeMs += FIXED_STEP_MS;
    }
    expect(airtimeMs / 1000).toBeGreaterThanOrEqual(RALLY_CONFIG.duel.minLobHangS);
  });
});
