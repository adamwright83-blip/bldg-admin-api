import { describe, expect, it } from "vitest";
import {
  ROLL,
  SPAN,
  aimAt,
  boomCrate,
  crateShove,
  obstructionsAt,
  planSwing,
  resolveCast,
  ringPosition,
  shipRoll,
  swingPoint,
  type Vec,
} from "./holdTheLine";

const HAND_HEIGHT = 150;
const hand = (x: number): Vec => ({ x, y: 452 - HAND_HEIGHT });
const ringAt = (t: number) => ringPosition(t, shipRoll(t).angle);

function clearFraction(x: number, seconds = 12, step = 0.05) {
  let clear = 0;
  let samples = 0;
  for (let t = 0; t < seconds; t += step) {
    const aim = aimAt(hand(x), ringAt(t), obstructionsAt(t));
    if (aim.inRange && aim.clear) clear += 1;
    samples += 1;
  }
  return clear / samples;
}

describe("Hold the Line: the ship's end never sits still", () => {
  it("is deterministic and rolls heavy only after the first warning", () => {
    expect(shipRoll(3.3)).toEqual(shipRoll(3.3));
    expect(shipRoll(ROLL.firstHeavyAt - ROLL.telegraph - 0.01).heavy).toBe(false);
    const warn = shipRoll(ROLL.firstHeavyAt - ROLL.telegraph * 0.5);
    expect(warn.telegraph).toBeGreaterThan(0);
    expect(warn.heavy).toBe(false);
    const heavy = shipRoll(ROLL.firstHeavyAt + ROLL.heavyLength / 2);
    expect(heavy.heavy).toBe(true);
    expect(heavy.angle).toBeGreaterThan(ROLL.heavy * 0.6);
  });

  it("stays calm once the crossing is done", () => {
    for (let t = 0; t < 40; t += 0.5) expect(shipRoll(t, true).heavy).toBe(false);
  });
});

describe("Hold the Line: the cast is a physical question", () => {
  it("cannot reach the ring from the far planks", () => {
    const aim = aimAt(hand(210), ringAt(0), []);
    expect(aim.inRange).toBe(false);
  });

  it("reads a rope swinging through the line as a foul, and a clear sky as clean", () => {
    const ring = { x: 770, y: 297 };
    expect(aimAt(hand(560), ring, []).clear).toBe(true);
    const rope = { kind: "rope" as const, id: "test", points: [{ x: 660, y: 0 }, { x: 660, y: 400 }], radius: 5 };
    const blocked = aimAt(hand(560), ring, [rope]);
    expect(blocked.clear).toBe(false);
    expect(blocked.blockedBy?.id).toBe("test");
  });

  it("always opens a clean window from the edge, within a few seconds", () => {
    expect(clearFraction(620)).toBeGreaterThan(0.3);
  });

  it("makes the safer planks the slower line: clean far less often from further back", () => {
    const edge = clearFraction(620);
    const back = clearFraction(430);
    expect(back).toBeGreaterThan(0);
    expect(back).toBeLessThan(edge);
  });

  it("bites when the ring is still there when the hook arrives, and fouls on what swings into its path", () => {
    const start = hand(600);
    const ring = { x: 770, y: 297 };
    const still = () => ring;
    expect(resolveCast(start, ring, 0, 1, still, () => []).kind).toBe("bite");
    const rope = { kind: "rope" as const, id: "late", points: [{ x: 700, y: 0 }, { x: 700, y: 500 }], radius: 5 };
    // The rope swings in only after the cast has left her hand.
    const outcome = resolveCast(start, ring, 0, 1, still, time => (time > 0.02 ? [rope] : []));
    expect(outcome.kind).toBe("foul");
  });

  it("misses when the ring has moved on by the time the hook gets there", () => {
    const outcome = resolveCast(hand(600), { x: 770, y: 297 }, 0, 1, () => ({ x: 900, y: 297 }), () => []);
    expect(outcome.kind).toBe("miss");
  });
});

describe("Hold the Line: the crate on the boom", () => {
  it("sweeps the deck's edge at some point in every swing, and never reaches the back planks", () => {
    let hitsEdge = false;
    let hitsBack = false;
    for (let t = 0; t < SPAN.boom.period; t += 0.02) {
      if (crateShove(t, { x: 600, y: 452 }, 196)) hitsEdge = true;
      if (crateShove(t, { x: 350, y: 452 }, 196)) hitsBack = true;
    }
    expect(hitsEdge).toBe(true);
    expect(hitsBack).toBe(false);
  });

  it("shoves in the direction it is travelling", () => {
    for (let t = 0; t < SPAN.boom.period; t += 0.02) {
      const shove = crateShove(t, { x: 600, y: 452 }, 196);
      if (!shove) continue;
      const crate = boomCrate(t);
      const vx = -Math.cos(crate.angle) * SPAN.boom.length * crate.angularVelocity;
      expect(Math.sign(shove.x)).toBe(Math.sign(vx));
    }
  });
});

describe("Hold the Line: the swing", () => {
  it("reels a long cast all the way to the planks' end before she leaves them", () => {
    const ring = { x: 770, y: 297 };
    const plan = planSwing({ x: 420, y: 452 }, HAND_HEIGHT, ring, { x: 1030, y: 438 }, true, 634);
    expect(plan.reelTo).toEqual({ x: 634, y: 452 });
    expect(plan.reelSeconds).toBeGreaterThan(0.2);
  });

  it("swings short, under the ring, and comes up on the far side", () => {
    const ring = { x: 770, y: 297 };
    const plan = planSwing({ x: 630, y: 452 }, HAND_HEIGHT, ring, { x: 1030, y: 438 }, true, 634);
    expect(plan.reelTo).toBeNull();
    expect(plan.radius).toBeLessThanOrEqual(176);
    const bottom = swingPoint(plan, ring, 0.5);
    expect(bottom.y).toBeGreaterThan(ring.y);
    const end = swingPoint(plan, ring, 1);
    expect(end.x).toBeGreaterThan(ring.x);
    // Her hands never pass below the planks' level plus her own height: no swinging under the decks.
    for (let f = 0; f <= 1; f += 0.05) expect(swingPoint(plan, ring, f).y).toBeLessThan(ring.y + 180);
  });
});
