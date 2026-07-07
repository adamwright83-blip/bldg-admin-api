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

const prepareSlotEngine = () => {
  const engine = duelEngine();
  engine.state.excuse.inPlay = false;
  engine.advanceFixedSteps(1);
  for (const target of Object.values(engine.state.buttTargets)) {
    target.prevX = target.x;
    target.prevY = target.y;
  }
  engine.state.duel.clockhead.strikeCooldownUntil = Number.MAX_SAFE_INTEGER;
  engine.state.duel.aiThinkAt = Number.MAX_SAFE_INTEGER;
  engine.state.duel.aiIntentUntil = Number.MAX_SAFE_INTEGER;
  return engine;
};

const slotCenter = (engine: RallyEngine, side: "spark" | "clockhead") => {
  const target = engine.state.buttTargets[side];
  return { x: target.x, y: target.y };
};

const placeExcuseAtSlot = (
  engine: RallyEngine,
  side: "spark" | "clockhead",
  vx: number,
  vy: number,
  bankState: boolean,
  lastTouchedBy: "spark" | "clockhead"
) => {
  const point = slotCenter(engine, side);
  Object.assign(engine.state.excuse, {
    inPlay: true,
    x: point.x,
    y: point.y,
    prevX: point.x,
    prevY: point.y,
    vx,
    vy,
    lastTouchedBy,
    lastTouchAt: -Infinity,
    bankState,
  });
};

const reachDuelImpact = (engine: RallyEngine) => {
  engine.advanceFrame(RALLY_CONFIG.ceremony.ingestionMs + RALLY_CONFIG.ceremony.hitStopMs);
};

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

describe("duel coin-slot scoring", () => {
  it.each([
    ["Spark bank", "spark", 360, 0, true, true],
    ["Spark front", "spark", -360, 0, true, false],
    ["Clockhead bank", "clockhead", -360, 0, true, true],
    ["Clockhead front", "clockhead", 360, 0, true, false],
    ["Drop-in", "clockhead", 0, 120, false, true],
  ] as const)("applies the fixed inward slot test for %s", (_label, side, vx, vy, bank, shouldScore) => {
    const engine = prepareSlotEngine();
    placeExcuseAtSlot(engine, side, vx, vy, bank, side === "spark" ? "clockhead" : "spark");
    engine.advanceFixedSteps(1);
    expect(engine.state.ceremony !== null).toBe(shouldScore);
  });

  it("attributes own goals to the slot owner's opponent and prefixes the snapshot", () => {
    const engine = prepareSlotEngine();
    placeExcuseAtSlot(engine, "clockhead", -360, 0, false, "clockhead");
    engine.advanceFixedSteps(1);
    expect(engine.state.ceremony?.snapshot).toMatchObject({
      victim: "clockhead",
      scorer: "spark",
      ownGoal: true,
      points: 1,
    });
    reachDuelImpact(engine);
    expect(engine.state.sparkScore).toBe(1);
  });

  it("keeps banked slot inserts worth two points", () => {
    const engine = prepareSlotEngine();
    placeExcuseAtSlot(engine, "clockhead", -360, 0, true, "spark");
    engine.advanceFixedSteps(1);
    expect(engine.state.ceremony?.snapshot).toMatchObject({
      victim: "clockhead",
      scorer: "spark",
      banked: true,
      points: 2,
    });
    reachDuelImpact(engine);
    expect(engine.state.sparkScore).toBe(2);
  });

  it("keeps duel targets clamped inside every arena edge without shrinking fighter bounds", () => {
    const engine = prepareSlotEngine();
    const poses = [
      { side: "spark" as const, x: -500, y: -500, facing: { x: 1, y: 0 } },
      { side: "spark" as const, x: 1700, y: 1200, facing: { x: -1, y: 0 } },
      { side: "clockhead" as const, x: -400, y: 1000, facing: { x: 1, y: 0 } },
      { side: "clockhead" as const, x: 1600, y: -300, facing: { x: -1, y: 0 } },
    ];
    for (const pose of poses) {
      const fighter = engine.state[pose.side];
      Object.assign(fighter, { x: pose.x, y: pose.y, facing: pose.facing });
      engine.advanceFixedSteps(1);
      const target = engine.state.buttTargets[pose.side];
      expect(target.x - target.radius).toBeGreaterThanOrEqual(0);
      expect(target.y - target.radius).toBeGreaterThanOrEqual(0);
      expect(target.x + target.radius).toBeLessThanOrEqual(RALLY_CONFIG.arena.width);
      expect(target.y + target.radius).toBeLessThanOrEqual(RALLY_CONFIG.arena.height);
    }
  });

  it("catches a max-speed insert that would tunnel past the slot in one fixed step", () => {
    const engine = prepareSlotEngine();
    const target = slotCenter(engine, "clockhead");
    Object.assign(engine.state.excuse, {
      inPlay: true,
      x: target.x + RALLY_CONFIG.duel.excuseRadius + 5,
      y: target.y,
      prevX: target.x + RALLY_CONFIG.duel.excuseRadius + 5,
      prevY: target.y,
      vx: -RALLY_CONFIG.duel.maxSpeed,
      vy: 0,
      lastTouchedBy: "spark",
      lastTouchAt: -Infinity,
      bankState: true,
    });
    engine.advanceFixedSteps(1);
    expect(engine.state.ceremony?.snapshot).toMatchObject({
      victim: "clockhead",
      points: 2,
    });
  });
});
