import { describe, expect, it } from "vitest";
import { RALLY_CONFIG } from "./rallyConfig";
import { RallyEngine } from "./rallyEngine";

describe("announcer and juice determinism", () => {
  it("rotates only locked Clockhead score barks from seeded RNG", () => {
    const scoreAgainst = (seed: number) => {
      const engine = new RallyEngine({ controlMode: "flight", seed, scoringMode: "portal" });
      engine.start();
      engine.state.serveAt = null;
      Object.assign(engine.state.excuse, {
        inPlay: true,
        x: 5,
        y: 330,
        prevX: 5,
        prevY: 330,
        vx: -RALLY_CONFIG.excuse.maxSpeed,
        vy: 0,
      });
      engine.advanceFixedSteps(1);
      return engine.state.ceremony?.snapshot.bark;
    };
    const bark = scoreAgainst(77);
    expect(bark).toBe(scoreAgainst(77));
    expect([
      "FILED UNDER: TOMORROW.",
      "SNOOZE BUTTON WINS.",
      "DEADLINE? WHAT DEADLINE?",
    ]).toContain(bark);
  });

  it("gives repeated effects deterministic non-identical audio variation", () => {
    const collect = () => {
      const engine = new RallyEngine({ controlMode: "flight", seed: 2026 });
      engine.start();
      const values: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        engine.setBreath(true);
        values.push(...engine.consumeEvents()
          .filter(event => event.type === "breath_start")
          .map(event => event.variation!));
        engine.setBreath(false);
      }
      return values;
    };
    const first = collect();
    expect(first).toEqual(collect());
    expect(new Set(first.map(value => value.toFixed(6))).size).toBe(20);
    expect(first.every(value => value >= -1 && value <= 1)).toBe(true);
  });
});
