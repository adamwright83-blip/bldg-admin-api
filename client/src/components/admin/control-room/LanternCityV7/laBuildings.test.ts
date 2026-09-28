import { describe, expect, it } from "vitest";
import { buildLA, K, LABuilder, planCorners, planLA, type Arch, type PlanInput } from "./laBuildings";

const base = (over: Partial<PlanInput>): PlanInput => ({
  i: 1, cx: 0, cz: 0, h: 4.5, u: 0, type: "house", hood: "Silver Lake",
  x: 0, z: 0, fx: 0, fz: 1, W: 11, D: 15, fill: 0.9, ...over,
});
const open = () => false;
const flat = () => 0;

describe("LA building set", () => {
  it("reads the footprint: houses, apartments, shops, towers, warehouses", () => {
    const archOf = (o: Partial<PlanInput>) => planLA(base(o), open).arch;
    expect(["craftsman", "spanish", "ranch", "estate"]).toContain(archOf({ type: "house" }));
    expect(["dingbat", "walkup", "courtyard"]).toContain(archOf({ type: "apartments", h: 8, W: 16, D: 20 }));
    expect(archOf({ type: "apartments", h: 16, W: 20, D: 24 })).toBe("walkup");
    expect(archOf({ type: "retail", h: 5, W: 14, D: 20 })).toBe("storefront");
    expect(archOf({ type: "office", h: 80, W: 40, D: 40 })).toBe("tower");
    expect(archOf({ type: "industrial", h: 7, W: 40, D: 50 })).toBe("warehouse");
    expect(archOf({ type: "garage", h: 3, W: 6, D: 6 })).toBe("garage");
  });

  it("is deterministic per building, so a tile rebuild never reshuffles the street", () => {
    const a = planLA(base({ i: 4242 }), open), b = planLA(base({ i: 4242 }), open);
    expect(a).toEqual(b);
  });

  it("keeps the real footprint (never stretched past it) and faces the street", () => {
    const p = planLA(base({ W: 12, D: 18, fill: 1 }), open);
    expect(p.W).toBeLessThanOrEqual(12);
    expect(p.D).toBeLessThanOrEqual(18);
    const [x, z] = planCorners(p).reduce((s, c) => [s[0] + c[0] / 4, s[1] + c[1] / 4], [0, 0]);
    expect(Math.hypot(x - p.x, z - p.z)).toBeLessThan(1e-9);
  });

  it("only digs a backyard pool where no neighbour stands", () => {
    const withRoom = Array.from({ length: 40 }, (_, i) => planLA(base({ i, hood: "Beverly Hills", W: 14, D: 18 }), open));
    expect(withRoom.some(p => p.pool)).toBe(true);
    const packed = Array.from({ length: 40 }, (_, i) => planLA(base({ i, hood: "Beverly Hills", W: 14, D: 18 }), () => true));
    expect(packed.every(p => !p.pool)).toBe(true);
  });

  it("builds clean geometry for every archetype", () => {
    const inputs: Record<Arch, Partial<PlanInput>> = {
      craftsman: { type: "house", hood: "Koreatown" },
      spanish: { type: "church", h: 8 },
      ranch: { type: "house", hood: "Century City" },
      estate: { type: "house", hood: "Beverly Hills", W: 20, D: 18, h: 8 },
      dingbat: { type: "apartments", h: 8, W: 14, D: 18, hood: "Koreatown" },
      courtyard: { type: "apartments", h: 7, W: 26, D: 30, hood: "West Hollywood" },
      walkup: { type: "apartments", h: 16, W: 20, D: 26 },
      storefront: { type: "retail", h: 5, W: 14, D: 20 },
      office: { type: "commercial", h: 20, W: 30, D: 30 },
      tower: { type: "office", h: 90, W: 40, D: 44 },
      warehouse: { type: "industrial", h: 8, W: 40, D: 60 },
      garage: { type: "garage", h: 3, W: 6, D: 6 },
    };
    const seen = new Set<Arch>();
    for (const [want, o] of Object.entries(inputs) as [Arch, Partial<PlanInput>][]) {
      // archetype choice is seeded per building: walk seeds until this one comes up
      let p = planLA(base({ ...o, i: 0 }), open);
      for (let i = 1; p.arch !== want && i < 400; i++) p = planLA(base({ ...o, i }), open);
      expect(p.arch).toBe(want);
      seen.add(p.arch);
      const g = buildLA([p], flat, () => o.hood ?? null);
      const pos = g.getAttribute("position").array as Float32Array;
      expect(pos.length).toBeGreaterThan(0);
      expect(pos.every(Number.isFinite)).toBe(true);
      expect(g.index!.count % 3).toBe(0);
      // nothing pokes far outside its lot or above its roof line
      for (let k = 0; k < pos.length; k += 3) {
        expect(Math.abs(pos[k])).toBeLessThan(p.W + p.D);
        expect(pos[k + 1]).toBeLessThan(p.top + 4);
      }
    }
    expect(seen.size).toBe(12);
  });

  it("lights the LA details: glass, lamps, and a helipad beacon on the towers", () => {
    let t = planLA(base({ type: "office", h: 90, W: 40, D: 44 }), open);
    const g = buildLA([t], flat, () => null);
    const kinds = new Set(Array.from(g.getAttribute("aK").array as Uint8Array));
    expect(kinds.has(K.BEACON)).toBe(true);
    expect(kinds.has(K.LAMP)).toBe(true);
    t = planLA(base({ type: "retail", h: 5, W: 14, D: 20 }), open);
    expect(new Set(Array.from(buildLA([t], flat, () => null).getAttribute("aK").array as Uint8Array)).has(K.GLASS)).toBe(true);
  });

  it("builds a tile in slices without changing the result", () => {
    const plans = Array.from({ length: 60 }, (_, i) => planLA(base({ i, x: i * 30 }), open));
    const whole = buildLA(plans, flat, () => null);
    const b = new LABuilder(plans, flat, () => null);
    let steps = 0;
    while (!b.step(0)) steps++;
    expect(steps).toBeGreaterThan(0);
    expect(Array.from(b.geometry().getAttribute("position").array)).toEqual(Array.from(whole.getAttribute("position").array));
  });
});
