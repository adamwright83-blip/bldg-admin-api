import { describe, expect, it } from "vitest";
import { CREEK, DURATION, HOLE, PEN, centroid, lostCount, newHerd, pennedCount, shepherd, tickHerd, type Herd, type HerdInput } from "./herd";

const idle: HerdInput = { dx: 0, dz: 0, sprint: false, bark: false };
const step = (h: Herd, seconds: number, input: HerdInput | ((h: Herd) => HerdInput) = idle) => {
  for (let n = 0; n < seconds * 60 && !h.over; n++) tickHerd(h, 1 / 60, typeof input === "function" ? input(h) : input);
};
const one = (h: Herd) => h.cows.find(c => !c.calf)!;

describe("the round-up", () => {
  it("a cow drifts away from the terrier; left alone, it grazes", () => {
    const h = newHerd(7);
    const c = one(h);
    h.cows = [c];
    c.x = 500;
    c.z = 120;
    h.dog.x = 400;
    h.dog.z = 120;
    step(h, 1.2);
    expect(c.x).toBeGreaterThan(530);
    h.dog.x = 50;
    step(h, 6);
    expect(Math.hypot(c.vx, c.vz)).toBeLessThan(40);
  });

  it("a bark scatters the cows near her and startles them", () => {
    const h = newHerd(3);
    const c = one(h);
    h.cows = [c];
    c.x = 600;
    c.z = 120;
    h.dog.x = 380;
    h.dog.z = 120;
    step(h, 0.1);
    const before = c.x;
    tickHerd(h, 1 / 60, { ...idle, bark: true });
    expect(h.events.some(e => e.kind === "bark")).toBe(true);
    expect(c.startle).toBeGreaterThan(0);
    step(h, 0.6);
    expect(c.x).toBeGreaterThan(before + 60);
  });

  it("running away from the herd sends the boxer charging into it", () => {
    const h = newHerd(11);
    h.boxer.cool = 0;
    h.cows.forEach((c, i) => {
      c.x = 700 + (i % 3) * 30;
      c.z = 100 + Math.floor(i / 3) * 30;
    });
    h.dog.x = 560;
    h.dog.z = 120;
    h.boxer.x = 500;
    h.boxer.z = 120;
    step(h, 0.4, { dx: -1, dz: 0, sprint: true, bark: false });
    expect(h.boxer.state).toBe("charge");
    expect(h.events.some(e => e.kind === "charge")).toBe(true);
    // and he goes through them, not to her
    expect(h.boxer.aim.x).toBeGreaterThan(700);
  });

  it("the boxer will not follow her into the creek", () => {
    const h = newHerd(5);
    h.cows = [one(h)];
    h.cows[0].x = 300;
    h.dog.x = CREEK.x0 - 40;
    h.dog.z = 0;
    h.boxer.x = CREEK.x0 - 150;
    h.boxer.z = 0;
    step(h, 3, { dx: 1, dz: 0, sprint: false, bark: false });
    expect(h.dog.x).toBeGreaterThan(CREEK.x1);
    // the creek runs on a diagonal: he stays on the near bank at his own depth
    expect(h.boxer.x).toBeLessThan(CREEK.x0 + CREEK.slope * h.boxer.z);
  });

  it("the pen takes cows only through the gate, and keeps them", () => {
    const h = newHerd(9);
    const [a, b] = h.cows.filter(c => !c.calf);
    h.cows = [a, b];
    a.x = PEN.x0 - 20;
    a.z = 20; // beside the fence, not the gate
    a.vx = 200;
    b.x = PEN.x0 - 20;
    b.z = (PEN.gate0 + PEN.gate1) / 2;
    b.vx = 200;
    h.dog.x = PEN.x0 - 140;
    h.dog.z = 60;
    step(h, 1.5, idle);
    expect(a.state).not.toBe("penned");
    expect(a.x).toBeLessThan(PEN.x0);
    expect(b.state).toBe("penned");
    h.dog.x = PEN.x0 + 200;
    step(h, 3);
    expect(b.state).toBe("penned");
    expect(b.x).toBeGreaterThan(PEN.x0);
  });

  it("a cow that walks into the tear is lost to the wrong century", () => {
    const h = newHerd(4);
    const c = one(h);
    h.cows = [c];
    c.x = HOLE.x - 10;
    c.z = HOLE.z;
    step(h, 1.2);
    expect(c.state).toBe("lost");
    expect(lostCount(h)).toBe(1);
  });

  it("the coyote comes at dusk; two barks send it off", () => {
    const h = newHerd(2);
    h.time = DURATION * 0.5 + 0.1;
    step(h, 0.1);
    expect(h.coyote.state).toBe("stalk");
    h.dog.x = h.coyote.x + 100;
    h.dog.z = h.coyote.z;
    tickHerd(h, 1 / 60, { ...idle, bark: true });
    step(h, 1.2);
    h.dog.x = h.coyote.x + 100;
    h.dog.z = h.coyote.z;
    tickHerd(h, 1 / 60, { ...idle, bark: true });
    expect(h.coyote.state).toBe("flee");
  });

  it("the round ends with stars when the last cow is home", () => {
    const h = newHerd(1);
    for (const c of h.cows) {
      c.state = "penned";
      c.x = PEN.x0 + 100;
    }
    step(h, 0.1);
    expect(h.over?.penned).toBe(h.cows.length);
    expect(h.over?.stars).toBe(3);
  });

  it("it can be won: a plain sheepdog gets most of the herd home before dark, on several seeds", () => {
    const results = [101, 202, 303, 404, 505].map(seed => {
      const h = newHerd(seed);
      step(h, DURATION + 1, shepherd);
      return pennedCount(h) / h.cows.length;
    });
    const mean = results.reduce((a, b) => a + b, 0) / results.length;
    expect(mean).toBeGreaterThanOrEqual(0.6);
  });

  it("the same seed and the same hands play out the same way", () => {
    const run = () => {
      const h = newHerd(42);
      step(h, 40, shepherd);
      return JSON.stringify(h.cows.map(c => [Math.round(c.x), Math.round(c.z), c.state]));
    };
    expect(run()).toBe(run());
  });
});
