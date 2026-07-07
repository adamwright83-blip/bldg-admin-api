import { describe, expect, it } from "vitest";
import { FIXED_STEP_MS, RALLY_CONFIG } from "./rallyConfig";
import { RallyEngine } from "./rallyEngine";
import { predictReceiptPath } from "./rallyRenderer";

const playing = () => {
  const engine = new RallyEngine({ controlMode: "flight", scoringMode: "buttHybrid", seed: 712 });
  engine.start();
  engine.state.serveAt = null;
  engine.state.powers.aiLoadout = [];
  return engine;
};

const exposeClockTarget = (engine: RallyEngine) => {
  engine.state.clockhead.exposedUntil = engine.state.timeMs + 2000;
  engine.state.clockhead.facing = { x: 1, y: 0 };
  engine.advanceFixedSteps(1);
  return engine.state.buttTargets.clockhead;
};

describe("Rally power loadout", () => {
  it("uses seeded AI picks and exactly two slots", () => {
    const one = new RallyEngine({ controlMode: "flight", seed: 44 });
    const two = new RallyEngine({ controlMode: "flight", seed: 44 });
    expect(one.state.powers.aiLoadout).toEqual(two.state.powers.aiLoadout);
    expect(new Set(one.state.powers.aiLoadout).size).toBe(RALLY_CONFIG.powers.slots);
  });

  it("lets HARD NO consume a sealed candidate before score commit", () => {
    const engine = playing();
    engine.state.powers.loadout = ["hardNo", "receipts"];
    expect(engine.beginPower(0)).toBe(true);
    exposeClockTarget(engine);
    const target = engine.state.buttTargets.spark;
    Object.assign(engine.state.excuse, {
      inPlay: true,
      x: target.x + target.radius + RALLY_CONFIG.excuse.radius + 2,
      y: target.y,
      prevX: target.x + target.radius + RALLY_CONFIG.excuse.radius + 2,
      prevY: target.y,
      vx: -RALLY_CONFIG.excuse.maxSpeed,
      vy: 0,
      lastTouchAt: -Infinity,
    });
    engine.advanceFixedSteps(1);
    expect(engine.state.ceremony).toBeNull();
    expect(engine.state.sparkScore).toBe(0);
    expect(engine.state.clockheadScore).toBe(0);
    expect(engine.state.powers.hardNoUntil.spark).toBe(0);
    expect(engine.consumeEvents().some(event => event.type === "shield_break")).toBe(true);
  });

  it("telegraphs RED TAPE, then uses its visible segment once", () => {
    const engine = playing();
    engine.state.powers.loadout = ["redTape", "hardNo"];
    expect(engine.beginPower(0, 600, 325)).toBe(true);
    expect(engine.state.powers.placement).not.toBeNull();
    expect(engine.confirmPower()).toBe(true);
    const tape = engine.state.powers.redTape!;
    engine.advanceFixedSteps(Math.ceil(RALLY_CONFIG.powers.redTape.telegraphMs / FIXED_STEP_MS) + 1);
    const normal = { x: -Math.sin(tape.angle), y: Math.cos(tape.angle) };
    Object.assign(engine.state.excuse, {
      inPlay: true,
      x: tape.x + normal.x * 45,
      y: tape.y + normal.y * 45,
      prevX: tape.x + normal.x * 45,
      prevY: tape.y + normal.y * 45,
      vx: -normal.x * 500,
      vy: -normal.y * 500,
      lastTouchAt: -Infinity,
    });
    engine.advanceFixedSteps(2);
    expect(tape.consumed).toBe(true);
    expect(engine.state.excuse.bankState).toBe(true);
  });

  it("auto-confirms placement and makes DEADLINE STAMP launch on slam", () => {
    const engine = playing();
    engine.state.powers.loadout = ["deadlineStamp", "receipts"];
    engine.beginPower(0, 600, 325);
    engine.advanceFixedSteps(Math.ceil(RALLY_CONFIG.powers.placementMaxMs / FIXED_STEP_MS) + 1);
    expect(engine.state.powers.placement).toBeNull();
    const stamp = engine.state.powers.deadlineStamp!;
    Object.assign(engine.state.excuse, {
      inPlay: true,
      x: stamp.x,
      y: stamp.y,
      prevX: stamp.x,
      prevY: stamp.y,
      vx: 100,
      vy: 0,
      lastTouchAt: -Infinity,
    });
    engine.advanceFixedSteps(Math.ceil(RALLY_CONFIG.powers.deadlineStamp.telegraphMs / FIXED_STEP_MS) + 2);
    expect(stamp.slammed).toBe(true);
    expect(Math.hypot(engine.state.excuse.vx, engine.state.excuse.vy)).toBeGreaterThan(100);
  });

  it("keeps RECEIPTS deterministic and within its lookahead budget", () => {
    const engine = playing();
    engine.state.excuse.inPlay = true;
    engine.state.excuse.vx = 700;
    engine.state.excuse.vy = -280;
    const first = predictReceiptPath(engine.state);
    const second = predictReceiptPath(engine.state);
    expect(first).toEqual(second);
    expect(first).toHaveLength(RALLY_CONFIG.powers.receipts.lookaheadSteps);
    const started = performance.now();
    for (let run = 0; run < 200; run += 1) predictReceiptPath(engine.state);
    const averageMs = (performance.now() - started) / 200;
    expect(averageMs).toBeLessThanOrEqual(RALLY_CONFIG.powers.receipts.perfBudgetMs);
  });
});
