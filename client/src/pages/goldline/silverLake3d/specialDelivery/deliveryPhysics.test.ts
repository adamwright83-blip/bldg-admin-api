import { describe, expect, it } from "vitest";
import { COURSE } from "./deliveryCourse";
import {
  MAX_PULL,
  MIN_PULL,
  STEP,
  createWorld,
  launch,
  simulate,
  step,
  type FlightInput,
  type V2,
} from "./deliveryPhysics";

/**
 * The airmail course is a real simulation, not an animation: these prove the same input always gives the same
 * flight, that the player's choices change it, and that each route and secret can be reached by an input a player
 * could give (recorded below), without the courtyard ever scripting an outcome.
 */

const at = (deg: number, pull: number): V2 => ({
  x: Math.cos((deg * Math.PI) / 180) * pull,
  y: Math.sin((deg * Math.PI) / 180) * pull,
});

// recorded inputs, found by searching the simulation; wings `at` is in 1/240 s steps after the launch
const DIRECT: FlightInput = { pull: { x: 1.0332, y: 0.4818 }, wings: [] };
const FAN_AND_LINE: FlightInput = {
  pull: { x: 1.0931, y: 0.1927 },
  wings: [{ at: 36, open: true }],
};
const THREE_CUPS: FlightInput = {
  pull: { x: 0.9201, y: 0.9042 },
  wings: [{ at: 108, open: true }],
};
const CAT_ASSIST: FlightInput = {
  pull: { x: 0.7086, y: 0.7337 },
  wings: [{ at: 0, open: true }],
};

function trace(input: FlightInput) {
  const path: V2[] = [];
  const w = simulate(COURSE, input, "up", { trace: path, traceEvery: 12 });
  return { w, path };
}

describe("special delivery physics", () => {
  it("is deterministic: the same input flies the same flight", () => {
    const a = trace(THREE_CUPS);
    const b = trace(THREE_CUPS);
    expect(b.path).toEqual(a.path);
    expect(b.w.via).toEqual(a.w.via);
    expect(b.w.events.map(e => e.kind)).toEqual(a.w.events.map(e => e.kind));
  });

  it("ignores a pull too small to mean it (a tap is not a launch)", () => {
    const w = createWorld(COURSE);
    expect(launch(w, COURSE, at(40, MIN_PULL * 0.6))).toBe(false);
    expect(w.phase).toBe("ready");
    expect(launch(w, COURSE, at(40, MIN_PULL * 1.5))).toBe(true);
  });

  it("launches harder the further back you pull", () => {
    const soft = createWorld(COURSE);
    const hard = createWorld(COURSE);
    launch(soft, COURSE, at(40, 0.4));
    launch(hard, COURSE, at(40, MAX_PULL));
    expect(Math.hypot(hard.v.x, hard.v.y)).toBeGreaterThan(
      Math.hypot(soft.v.x, soft.v.y) * 2
    );
  });

  it("opening the wings changes the flight: on a flat throw an open glider climbs and floats, a folded dart stays flat", () => {
    const folded = trace({ pull: at(30, 0.6), wings: [] });
    const open = trace({ pull: at(30, 0.6), wings: [{ at: 0, open: true }] });
    const peak = (p: V2[]) => Math.max(...p.map(q => q.y));
    expect(peak(open.path)).toBeGreaterThan(peak(folded.path) + 1);
    expect(open.w.t).toBeGreaterThan(folded.w.t + 0.5);
  });

  it("the fan is a real updraft: an open glider over it rises, and turning the fan changes the flight", () => {
    const input: FlightInput = {
      pull: at(60, 0.55),
      wings: [{ at: 0, open: true }],
    };
    const up = simulate(COURSE, input, "up");
    const back = simulate(COURSE, input, "back");
    expect(up.events.some(e => e.kind === "fan_enter")).toBe(true);
    expect([up.restWhere, up.via.join(">")]).not.toEqual([
      back.restWhere,
      back.via.join(">"),
    ]);
  });

  it("a direct lob, with nothing but the fan's breath on it, reaches Bella's basket", () => {
    const { w } = trace(DIRECT);
    expect(w.outcome).toBe("delivered");
    expect(w.via.filter(v => v !== "fan")).toEqual([]);
  });

  it("the washing line genuinely changes outcomes: this throw only reaches the basket because it bounces off the line", () => {
    const { w } = trace(FAN_AND_LINE);
    expect(w.outcome).toBe("delivered");
    expect(w.via).toContain("fan");
    expect(w.via).toContain("line");
    // take the line (and the sheet on it) out of the courtyard and the same throw misses
    const noLine = {
      ...COURSE,
      line: { ...COURSE.line, a: { x: -50, y: 40 }, b: { x: -49, y: 40 } },
    };
    const without = simulate(noLine, FAN_AND_LINE);
    expect(without.via).not.toContain("line");
    expect(without.outcome).not.toBe("delivered");
  });

  it("all three cups can be rung in order in one flight by a real input", () => {
    const { w } = trace(THREE_CUPS);
    expect(w.cupSequence.join(",")).toContain("0,1,2");
    expect(
      w.events
        .filter(e => e.kind === "cup")
        .map(e => (e as { index: number }).index)
        .slice(0, 3)
    ).toEqual([0, 1, 2]);
  });

  it("Cleo's tail can flick a glider into the basket, but only from a physical sequence (it landed on her tail)", () => {
    const { w } = trace(CAT_ASSIST);
    expect(w.outcome).toBe("delivered");
    const kinds = w.events.map(e => e.kind);
    expect(kinds.indexOf("cat_tail_land")).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf("cat_fling")).toBeGreaterThan(
      kinds.indexOf("cat_tail_land")
    );
    expect(kinds.indexOf("basket")).toBeGreaterThan(kinds.indexOf("cat_fling"));
  });

  it("hitting the cat is not a win: most flights that touch Cleo still miss", () => {
    let touched = 0;
    let rescued = 0;
    for (let deg = 5; deg <= 85; deg += 5)
      for (let pull = 0.3; pull <= MAX_PULL; pull += 0.1)
        for (const wings of [
          [],
          [{ at: 0, open: true }],
        ] as FlightInput["wings"][]) {
          const w = simulate(COURSE, { pull: at(deg, pull), wings });
          if (!w.via.includes("cat")) continue;
          touched++;
          if (w.outcome === "delivered" && w.via.includes("tail")) rescued++;
        }
    expect(touched).toBeGreaterThan(20);
    expect(rescued).toBeGreaterThan(0);
    expect(rescued / touched).toBeLessThan(0.15);
  });

  it("flights end within a few seconds, and a wedged glider never hangs the course", () => {
    for (let deg = 5; deg <= 85; deg += 10)
      for (let pull = 0.3; pull <= MAX_PULL; pull += 0.15) {
        const w = simulate(COURSE, {
          pull: at(deg, pull),
          wings: [{ at: 0, open: true }],
        });
        expect(w.phase).toBe("done");
        expect(w.t).toBeLessThan(9);
      }
  });

  it("the environment keeps living between flights (cups swing, the cat wakes and settles)", () => {
    const w = createWorld(COURSE);
    w.cups[1].omega = 3;
    for (let i = 0; i < Math.round(2 / STEP); i++) step(w, COURSE);
    expect(Math.abs(w.cups[1].omega)).toBeLessThan(3);
    expect(w.phase).toBe("ready");
  });
});
