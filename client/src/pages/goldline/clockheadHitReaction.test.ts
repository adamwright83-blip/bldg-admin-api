import { describe, expect, it } from "vitest";
import {
  BLADE_REACH,
  CLOCKHEAD_DIAL_RADIUS,
  HIT_REACTION,
  contactPoint,
  decayTrauma,
  hitFlashAt,
  rattleAt,
} from "./clockheadHitReaction";
import { CLOCKHEAD_WINDING_CENTER, artPoint, stageDistance, torsoPoint } from "./colosseumStage";

const FACE = CLOCKHEAD_WINDING_CENTER;
const TORSO = torsoPoint(artPoint(50, 49));

describe("where the Lineblade connects", () => {
  it("lands on his dial, on her side of the mainspring", () => {
    for (const combo of [1, 2, 3]) {
      const at = contactPoint(FACE, TORSO, combo);
      expect(stageDistance(at, FACE)).toBeLessThanOrEqual(CLOCKHEAD_DIAL_RADIUS);
      expect(stageDistance(at, TORSO)).toBeLessThan(stageDistance(FACE, TORSO));
    }
  });

  it("sparks off his face, not her: at least a blade's length from her, however close she stands", () => {
    for (const feet of [artPoint(50, 49), artPoint(50, 46), artPoint(47, 52)]) {
      const torso = torsoPoint(feet);
      const at = contactPoint(FACE, torso, 1);
      const room = stageDistance(FACE, torso);
      expect(stageDistance(at, torso)).toBeGreaterThanOrEqual(Math.min(room, BLADE_REACH) - 1e-9);
    }
  });

  it("puts each hit of a combo on fresh brass", () => {
    const hits = [1, 2, 3].map(combo => contactPoint(FACE, TORSO, combo));
    expect(stageDistance(hits[0]!, hits[1]!)).toBeGreaterThan(2);
    expect(stageDistance(hits[1]!, hits[2]!)).toBeGreaterThan(2);
  });
});

describe("how he flashes when hit", () => {
  it("goes white-hot first, then red", () => {
    const first = hitFlashAt(0, false);
    expect(first.white).toBeGreaterThan(0.8);
    const settled = hitFlashAt(HIT_REACTION.whitePopMs + 10, false);
    expect(settled.white).toBe(0);
    expect(settled.red).toBeGreaterThan(0.7);
  });

  it("flushes once per hit and never strobes (photosensitivity)", () => {
    for (const finisher of [false, true]) {
      const total = finisher ? HIT_REACTION.flash.finisher.totalMs : HIT_REACTION.flash.hit.totalMs;
      let peaked = false;
      let previous = 0;
      for (let t = 0; t <= total + 20; t += 5) {
        const red = hitFlashAt(t, finisher).red;
        if (peaked) expect(red, `red rose again at ${t}ms`).toBeLessThanOrEqual(previous + 1e-9);
        if (red < previous) peaked = true;
        previous = red;
      }
      expect(hitFlashAt(total, finisher)).toEqual({ red: 0, white: 0 });
    }
  });

  it("hits harder and longer on a finisher", () => {
    const at = HIT_REACTION.flash.hit.totalMs - 20;
    expect(hitFlashAt(at, true).red).toBeGreaterThan(hitFlashAt(at, false).red);
  });
});

describe("how he rattles", () => {
  it("shakes hard at the moment of impact and settles on its own", () => {
    const peak = Math.max(
      ...Array.from({ length: 30 }, (_, i) => Math.abs(rattleAt(HIT_REACTION.trauma.finisher, i * 7).rotate))
    );
    expect(peak).toBeGreaterThan(1.5);
    let trauma: number = HIT_REACTION.trauma.finisher;
    for (let t = 0; t < 600; t += 16) trauma = decayTrauma(trauma, 16);
    expect(trauma).toBe(0);
    expect(rattleAt(trauma, 1234)).toEqual({ x: 0, y: 0, rotate: 0, scale: 1 });
  });

  it("keeps an ordinary hit smaller than a finisher", () => {
    const size = (trauma: number) =>
      Math.max(...Array.from({ length: 40 }, (_, i) => Math.hypot(rattleAt(trauma, i * 5).x, rattleAt(trauma, i * 5).y)));
    expect(size(HIT_REACTION.trauma.hit)).toBeLessThan(size(HIT_REACTION.trauma.finisher));
  });
});
