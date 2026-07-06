import { describe, expect, it } from "vitest";
import { RallyEngine } from "./rallyEngine";
import { FIXED_STEP_MS, RALLY_CONFIG } from "./rallyConfig";

const playingEngine = (options: ConstructorParameters<typeof RallyEngine>[0] = {}) => {
  const engine = new RallyEngine({ scoringMode: "portal", ...options });
  engine.start();
  engine.state.serveAt = null;
  return engine;
};

const putExcuseInPlay = (engine: RallyEngine) => {
  engine.state.excuse.inPlay = true;
  engine.state.excuse.lastTouchAt = -Infinity;
};

describe("RallyEngine physics", () => {
  it("applies Fire Breath force immediately while anticipation is still building", () => {
    const engine = playingEngine();
    putExcuseInPlay(engine);
    Object.assign(engine.state.excuse, {
      x: engine.state.spark.x + 140,
      y: engine.state.spark.y,
      prevX: engine.state.spark.x + 140,
      prevY: engine.state.spark.y,
      vx: 0,
      vy: 0,
    });
    engine.setAim(engine.state.excuse.x, engine.state.excuse.y);
    engine.setBreath(true);
    expect(engine.consumeEvents().some(event => event.type === "breath_start")).toBe(true);
    engine.advanceFixedSteps(1);
    expect(engine.state.spark.breathHeldMs).toBeLessThan(
      RALLY_CONFIG.spark.breathAnticipationMs
    );
    expect(engine.state.excuse.vx).toBeGreaterThan(0);
    expect(engine.consumeEvents().some(event => event.type === "breath_contact")).toBe(true);
  });

  it("makes charged ignite visual and forceful without staggering Clockhead", () => {
    const engine = playingEngine();
    putExcuseInPlay(engine);
    Object.assign(engine.state.excuse, {
      x: engine.state.spark.x + 140,
      y: engine.state.spark.y,
      prevX: engine.state.spark.x + 140,
      prevY: engine.state.spark.y,
      vx: 0,
      vy: 0,
    });
    engine.setAim(engine.state.excuse.x, engine.state.excuse.y);
    engine.setBreath(true);
    engine.advanceFixedSteps(
      Math.ceil(RALLY_CONFIG.spark.chargedBreathMs / FIXED_STEP_MS) + 1
    );
    engine.setBreath(false);
    expect(engine.state.excuse.ignitedUntil).toBeGreaterThan(engine.state.timeMs);
    expect(engine.consumeEvents().some(event => event.type === "charged_release")).toBe(true);
    Object.assign(engine.state.excuse, {
      x: engine.state.clockhead.x - 70,
      y: engine.state.clockhead.y,
      prevX: engine.state.clockhead.x - 70,
      prevY: engine.state.clockhead.y,
      vx: 420,
      vy: 0,
      lastTouchAt: -Infinity,
    });
    engine.advanceFixedSteps(1);
    expect(engine.state.clockhead.staggerUntil).toBe(0);
  });

  it("applies wall restitution", () => {
    const engine = playingEngine();
    putExcuseInPlay(engine);
    Object.assign(engine.state.excuse, { x: 500, y: 32, prevX: 500, prevY: 32, vx: 0, vy: -400 });
    engine.advanceFixedSteps(1);
    expect(engine.state.excuse.vy).toBeCloseTo(400 * RALLY_CONFIG.arena.wallRestitution, 4);
    expect(engine.state.excuse.y).toBe(RALLY_CONFIG.excuse.radius);
  });

  it("adds controlled energy on a corner-bumper bank", () => {
    const engine = playingEngine({ seed: 99 });
    putExcuseInPlay(engine);
    Object.assign(engine.state.excuse, { x: 82, y: 82, prevX: 82, prevY: 82, vx: -300, vy: -300 });
    const before = Math.hypot(engine.state.excuse.vx, engine.state.excuse.vy);
    engine.advanceFixedSteps(1);
    const after = Math.hypot(engine.state.excuse.vx, engine.state.excuse.vy);
    expect(after).toBeCloseTo(before * RALLY_CONFIG.arena.bumperRestitution, 4);
    expect(engine.consumeEvents().some(event => event.type === "bumper_bank")).toBe(true);
  });

  it("reflects a body block without scoring", () => {
    const engine = playingEngine();
    putExcuseInPlay(engine);
    Object.assign(engine.state.excuse, {
      x: engine.state.spark.x + 70,
      y: engine.state.spark.y,
      prevX: engine.state.spark.x + 70,
      prevY: engine.state.spark.y,
      vx: -420,
      vy: 0,
    });
    engine.advanceFixedSteps(1);
    expect(engine.state.excuse.vx).toBeGreaterThan(0);
    expect(engine.state.sparkScore).toBe(0);
    expect(engine.state.clockheadScore).toBe(0);
  });

  it("keeps return speed monotonic and caps it at tier three", () => {
    const engine = playingEngine();
    putExcuseInPlay(engine);
    let previousSpeed = RALLY_CONFIG.excuse.serveSpeed;
    for (let index = 0; index < 30; index += 1) {
      const sparkTurn = index % 2 === 0;
      const fighter = sparkTurn ? engine.state.spark : engine.state.clockhead;
      Object.assign(engine.state.excuse, {
        x: fighter.x + (sparkTurn ? 70 : -70),
        y: fighter.y,
        prevX: fighter.x + (sparkTurn ? 70 : -70),
        prevY: fighter.y,
        vx: sparkTurn ? -previousSpeed : previousSpeed,
        vy: 0,
        lastTouchAt: -Infinity,
      });
      engine.advanceFixedSteps(1);
      const speed = Math.hypot(engine.state.excuse.vx, engine.state.excuse.vy);
      expect(speed).toBeGreaterThanOrEqual(previousSpeed - 0.001);
      expect(speed).toBeLessThanOrEqual(RALLY_CONFIG.excuse.maxSpeed);
      previousSpeed = speed;
    }
    Object.assign(engine.state.excuse, {
      x: engine.state.spark.x + 70,
      y: engine.state.spark.y,
      prevX: engine.state.spark.x + 70,
      prevY: engine.state.spark.y,
      vx: -979,
      vy: 0,
      rallyCount: 0,
      lastTouchAt: -Infinity,
    });
    engine.advanceFixedSteps(1);
    previousSpeed = Math.hypot(engine.state.excuse.vx, engine.state.excuse.vy);
    expect(previousSpeed).toBe(RALLY_CONFIG.excuse.maxSpeed);
    expect(engine.state.excuse.speedTier).toBe(3);
  });

  it("produces the same state hash for the same fixed input script", () => {
    const run = () => {
      const engine = new RallyEngine({ seed: 424242 });
      engine.start();
      engine.setMovement(1, -0.25);
      engine.advanceFixedSteps(120);
      engine.setAim(800, 240);
      engine.setBreath(true);
      engine.advanceFixedSteps(180);
      engine.setBreath(false);
      engine.dash();
      engine.advanceFixedSteps(240);
      return engine.stateHash();
    };
    expect(run()).toBe(run());
  });

  it("honors reduced motion without changing gameplay", () => {
    const engine = playingEngine({ reducedMotion: true });
    putExcuseInPlay(engine);
    Object.assign(engine.state.excuse, {
      x: engine.state.spark.x + 70,
      y: engine.state.spark.y,
      vx: -500,
      vy: 0,
      lastTouchAt: -Infinity,
    });
    engine.advanceFixedSteps(1);
    expect(engine.state.trauma).toBe(0);
    expect(engine.state.excuse.vx).toBeGreaterThan(0);
  });

  it("uses a 120 Hz fixed step", () => {
    expect(FIXED_STEP_MS).toBeCloseTo(1000 / 120, 8);
  });
});
