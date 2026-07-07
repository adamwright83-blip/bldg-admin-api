import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

describe("duel AI mood brain", () => {
  it("logs seeded AI decisions and keeps them deterministic for the same script", () => {
    const run = () => {
      const engine = new RallyEngine({ controlMode: "duel", seed: 9901 });
      engine.start();
      engine.state.serveAt = null;
      Object.assign(engine.state.excuse, {
        inPlay: true,
        x: 610,
        y: 330,
        prevX: 610,
        prevY: 330,
        vx: 120,
        vy: -60,
        lastTouchedBy: "spark",
        lastTouchAt: -Infinity,
      });
      engine.advanceFixedSteps(260);
      return {
        hash: engine.stateHash(),
        aiLog: engine.getReplayRecord().inputLog.filter(event => event.type === "ai_decision"),
      };
    };
    const first = run();
    expect(first.aiLog.length).toBeGreaterThan(0);
    expect(first).toEqual(run());
  });

  it("queues a delayed defensive read when the player strikes", () => {
    const engine = duelEngine();
    engine.state.excuse.x = engine.state.spark.x + 90;
    engine.state.excuse.y = engine.state.spark.y - 10;
    expect(engine.duelStrike("loft")).toBe(true);
    const queued = engine.getReplayRecord().inputLog.find(
      event => event.type === "ai_decision" && event.payload?.action === "queue_read"
    );
    expect(queued).toBeTruthy();
    engine.advanceFixedSteps(Math.ceil(RALLY_CONFIG.duel.aiReadDelayMs / FIXED_STEP_MS) + 4);
    expect(engine.state.duel.aiReadQueue).toHaveLength(0);
  });

  it("raises and then decays AI tilt when Clockhead concedes", () => {
    const engine = prepareSlotEngine();
    placeExcuseAtSlot(engine, "clockhead", -360, 0, false, "spark");
    engine.advanceFixedSteps(1);
    reachDuelImpact(engine);
    expect(engine.state.duel.aiTilt).toBeGreaterThanOrEqual(RALLY_CONFIG.duel.tiltConcede - 0.001);
    const tilted = engine.state.duel.aiTilt;
    engine.advanceFrame(RALLY_CONFIG.duel.ceremonyMs + 1);
    engine.advanceFixedSteps(120);
    expect(engine.state.duel.aiTilt).toBeLessThan(tilted);
  });
});

describe("duel meter powers and rescue", () => {
  it("activates Fire Surge, boosts the next strike, and pierces Clockhead once", () => {
    const engine = duelEngine();
    engine.state.duel.spark.meter = 100;
    expect(engine.duelPower()).toBe(true);
    expect(engine.state.duel.spark.meter).toBe(0);
    engine.state.excuse.x = engine.state.spark.x + 90;
    engine.state.excuse.y = engine.state.spark.y - 10;
    expect(engine.duelStrike("strike")).toBe(true);
    expect(speed(engine)).toBeGreaterThan(RALLY_CONFIG.duel.strikeFlatSpeed);
    expect(engine.state.excuse.ignitedUntil).toBeGreaterThan(engine.state.timeMs);

    engine.state.duel.clockhead.strikeCooldownUntil = Number.MAX_SAFE_INTEGER;
    engine.state.duel.aiThinkAt = Number.MAX_SAFE_INTEGER;
    engine.state.duel.aiIntentUntil = Number.MAX_SAFE_INTEGER;
    Object.assign(engine.state.excuse, {
      x: engine.state.clockhead.x - 20,
      y: engine.state.clockhead.y - RALLY_CONFIG.clockhead.radius * 0.2,
      prevX: engine.state.clockhead.x - 20,
      prevY: engine.state.clockhead.y - RALLY_CONFIG.clockhead.radius * 0.2,
      vx: 520,
      vy: 0,
      lastTouchedBy: "spark",
      lastTouchAt: -Infinity,
      ignitedUntil: engine.state.timeMs + RALLY_CONFIG.duel.ignitedMs,
      piercedClockheadBlock: false,
    });
    engine.advanceFixedSteps(1);
    expect(engine.state.excuse.lastTouchedBy).toBe("spark");
    expect(engine.state.excuse.piercedClockheadBlock).toBe(true);
  });

  it("casts Time Freeze at a mean moment, opens rescue, and accepts with duel triple force", () => {
    const engine = duelEngine();
    engine.state.duel.clockhead.meter = 100;
    engine.state.duel.spark.grounded = false;
    Object.assign(engine.state.excuse, {
      x: engine.state.spark.x + 180,
      y: engine.state.spark.y - 90,
      prevX: engine.state.spark.x + 180,
      prevY: engine.state.spark.y - 90,
      vx: -420,
      vy: 0,
      lastTouchedBy: "clockhead",
      lastTouchAt: -Infinity,
    });
    engine.advanceFixedSteps(1);
    expect(engine.consumeEvents().some(event => event.type === "freeze_cast")).toBe(true);
    engine.advanceFixedSteps(Math.ceil(RALLY_CONFIG.duel.freezeTelegraphMs / FIXED_STEP_MS) + 1);
    expect(engine.state.spark.frozenUntil).toBeGreaterThan(engine.state.timeMs);
    expect(engine.state.mission.status).toBe("ready");
    expect(engine.acceptRescue()).toBe(true);
    expect(engine.state.spark.frozenUntil).toBe(engine.state.timeMs);
    expect(engine.state.excuse.lastTouchedBy).toBe("spark");
    expect(speed(engine)).toBeCloseTo(RALLY_CONFIG.duel.maxSpeed, 6);
  });
});

describe("duel P6 determinism gates", () => {
  it("keeps Math.random banned from the headless engine", () => {
    const engineSource = readFileSync(
      fileURLToPath(new URL("./rallyEngine.ts", import.meta.url)),
      "utf8"
    );
    expect(engineSource).not.toContain("Math.random");
  });

  it("hashes identically across a scripted duel with AI decisions and powers", () => {
    const run = () => {
      const engine = new RallyEngine({ controlMode: "duel", seed: 13579 });
      engine.start();
      engine.state.serveAt = null;
      engine.state.duel.spark.meter = 100;
      expect(engine.duelPower()).toBe(true);
      Object.assign(engine.state.excuse, {
        inPlay: true,
        x: engine.state.spark.x + 90,
        y: engine.state.spark.y - 10,
        prevX: engine.state.spark.x + 90,
        prevY: engine.state.spark.y - 10,
        vx: 0,
        vy: 0,
        lastTouchedBy: "clockhead",
        lastTouchAt: -Infinity,
      });
      engine.duelStrike("strike");
      engine.advanceFixedSteps(45);
      engine.state.duel.clockhead.meter = 100;
      engine.state.duel.spark.grounded = false;
      Object.assign(engine.state.excuse, {
        x: engine.state.spark.x + 180,
        y: engine.state.spark.y - 90,
        prevX: engine.state.spark.x + 180,
        prevY: engine.state.spark.y - 90,
        vx: -420,
        vy: 0,
        lastTouchedBy: "clockhead",
        lastTouchAt: -Infinity,
      });
      engine.advanceFixedSteps(Math.ceil(RALLY_CONFIG.duel.freezeTelegraphMs / FIXED_STEP_MS) + 12);
      if (engine.state.mission.status === "ready") engine.acceptRescue();
      engine.advanceFixedSteps(90);
      return {
        hash: engine.stateHash(),
        aiEvents: engine.getReplayRecord().inputLog.filter(event => event.type === "ai_decision").length,
        powerEvents: engine.getReplayRecord().inputLog.filter(event => event.type === "power_cast").length,
      };
    };
    const first = run();
    expect(first.aiEvents).toBeGreaterThan(0);
    expect(first.powerEvents).toBeGreaterThan(0);
    expect(first).toEqual(run());
  });
});
