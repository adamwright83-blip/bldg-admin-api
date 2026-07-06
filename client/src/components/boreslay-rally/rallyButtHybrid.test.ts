import { describe, expect, it } from "vitest";
import { FIXED_STEP_MS, RALLY_CONFIG } from "./rallyConfig";
import { RallyEngine } from "./rallyEngine";

const playing = () => {
  const engine = new RallyEngine({ scoringMode: "buttHybrid", seed: 91 });
  engine.start();
  engine.state.serveAt = null;
  return engine;
};

const placeAtClockTarget = (engine: RallyEngine, banked = false) => {
  engine.state.clockhead.exposedUntil = engine.state.timeMs + 1000;
  engine.state.clockhead.facing = { x: 1, y: 0 };
  engine.advanceFixedSteps(1);
  const target = engine.state.buttTargets.clockhead;
  Object.assign(engine.state.excuse, {
    inPlay: true,
    x: target.x - target.radius - RALLY_CONFIG.excuse.radius - 2,
    y: target.y,
    prevX: target.x - target.radius - RALLY_CONFIG.excuse.radius - 2,
    prevY: target.y,
    vx: RALLY_CONFIG.excuse.maxSpeed,
    vy: 0,
    lastTouchAt: -Infinity,
    bankState: banked,
  });
};

const reachImpact = (engine: RallyEngine) => {
  engine.advanceFrame(RALLY_CONFIG.ceremony.ingestionMs + RALLY_CONFIG.ceremony.hitStopMs);
};

describe("butt-hybrid scoring", () => {
  it("sweeps a moving target at the 980 px/s cap", () => {
    const engine = playing();
    placeAtClockTarget(engine);
    engine.advanceFixedSteps(1);
    expect(engine.state.ceremony?.snapshot).toMatchObject({
      victim: "clockhead",
      mode: "buttHybrid",
      points: 1,
      banked: false,
    });
  });

  it("keeps the entire target inside every arena edge", () => {
    const engine = playing();
    engine.state.spark.x = -500;
    engine.state.spark.y = -500;
    engine.state.spark.facing = { x: 1, y: 1 };
    engine.state.clockhead.x = 1700;
    engine.state.clockhead.y = 1200;
    engine.state.clockhead.exposedUntil = engine.state.timeMs + 1000;
    engine.state.clockhead.facing = { x: -1, y: -1 };
    engine.advanceFixedSteps(1);
    for (const target of Object.values(engine.state.buttTargets)) {
      expect(target.x - target.radius).toBeGreaterThanOrEqual(0);
      expect(target.y - target.radius).toBeGreaterThanOrEqual(0);
      expect(target.x + target.radius).toBeLessThanOrEqual(RALLY_CONFIG.arena.width);
      expect(target.y + target.radius).toBeLessThanOrEqual(RALLY_CONFIG.arena.height);
    }
  });

  it("awards one direct point and two after a wall or bumper bank", () => {
    const direct = playing();
    placeAtClockTarget(direct, false);
    direct.advanceFixedSteps(1);
    reachImpact(direct);
    expect(direct.state.sparkScore).toBe(1);

    const bank = playing();
    placeAtClockTarget(bank, true);
    bank.advanceFixedSteps(1);
    reachImpact(bank);
    expect(bank.state.sparkScore).toBe(2);
  });

  it("seals both legacy gate openings in butt-hybrid mode", () => {
    const engine = playing();
    Object.assign(engine.state.excuse, {
      inPlay: true,
      x: 5,
      y: 330,
      prevX: 5,
      prevY: 330,
      vx: -RALLY_CONFIG.excuse.maxSpeed,
      vy: 0,
      lastTouchAt: -Infinity,
    });
    engine.advanceFixedSteps(1);
    expect(engine.state.ceremony).toBeNull();
    expect(engine.state.excuse.vx).toBeGreaterThan(0);
    expect(engine.state.excuse.bankState).toBe(true);
  });

  it("turns Clockhead's target toward play for 350ms after a swat", () => {
    const engine = playing();
    Object.assign(engine.state.excuse, {
      inPlay: true,
      x: 800,
      y: engine.state.clockhead.y,
      prevX: 800,
      prevY: engine.state.clockhead.y,
      vx: 500,
      vy: 0,
      rallyCount: 0,
    });
    engine.state.clockhead.telegraph = "swat";
    engine.state.clockhead.telegraphUntil = 0;
    engine.advanceFixedSteps(1);
    expect(engine.state.clockhead.exposedUntil - engine.state.timeMs).toBeCloseTo(
      RALLY_CONFIG.buttTarget.clockheadExposureMs,
      5
    );
    expect(engine.state.clockhead.facing.x).toBe(1);
    expect(engine.state.buttTargets.clockhead.x).toBeLessThan(engine.state.clockhead.x);
  });

  it("ends regulation on a leader and enters sudden death on a tie", () => {
    const leader = playing();
    leader.state.sparkScore = 2;
    leader.state.clockheadScore = 1;
    leader.state.regulationRemainingMs = FIXED_STEP_MS;
    leader.advanceFixedSteps(1);
    expect(leader.state.status).toBe("victory");

    const tie = playing();
    tie.state.regulationRemainingMs = FIXED_STEP_MS;
    tie.advanceFixedSteps(1);
    expect(tie.state.status).toBe("playing");
    expect(tie.state.suddenDeath).toBe(true);
    expect(tie.consumeEvents().some(event => event.type === "sudden_death")).toBe(true);
  });
});
