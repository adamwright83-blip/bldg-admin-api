import { describe, expect, it } from "vitest";
import {
  canonicalIslandFor, buildField, coastAt, layoutIslands, ontoLand, ownerAt, repairOutlines, ringArea, S, type Outline, type WorldManifest,
} from "./islandLayout";

// two neighbourhoods sharing a border, like Hollywood and East Hollywood
const WEST: Outline = { n: "Hollywood", served: true, p: [[-3000, -1500], [0, -1500], [0, 1500], [-3000, 1500]] };
const EAST: Outline = { n: "Koreatown", served: true, p: [[0, -1500], [3000, -1500], [3000, 1500], [0, 1500]] };
const BOUNDS: [number, number, number, number] = [-3000, -1500, 3000, 1500];

function manifest(): WorldManifest {
  return {
    origin: [34.08, -118.33], kx: 92198, kz: 110540, bounds: BOUNDS, outline: [WEST, EAST],
    terrain: { cell: 500, nx: 13, nz: 7, h: new Array(13 * 7).fill(500) }, water: [], parks: [], major: {},
  };
}

describe("island board layout", () => {
  const f = buildField([WEST, EAST], BOUNDS, 40, 800);

  it("pulls neighbours apart: land inside each, water along the shared border", () => {
    expect(ownerAt(f, -1500, 0)).toBe(0);
    expect(ownerAt(f, 1500, 0)).toBe(1);
    expect(coastAt(f, -1500, 0)).toBeGreaterThan(300);
    // the shared border becomes a channel
    expect(coastAt(f, 0, 0)).toBeLessThan(-40);
    expect(ownerAt(f, 0, 0)).toBe(-1);
    // and outside every neighbourhood is open sea
    expect(coastAt(f, 0, 2400)).toBeLessThan(-200);
  });

  it("steps a customer standing in the channel onto the nearest island", () => {
    const p = ontoLand(f, 20, 0, 30);
    expect(p.ok).toBe(true);
    expect(coastAt(f, p.x, p.z)).toBeGreaterThan(29);
    expect(ownerAt(f, p.x, p.z)).toBe(1);
  });

  it("redraws the three sliver outlines the manifest ships with", () => {
    const fixed = repairOutlines([
      { n: "Hancock Park", served: false, p: [[1153.9, -55.3], [-487.4, 2310.2], [1153.9, -55.3]] },
      { n: "Larchmont", served: false, p: [[2417, -66], [2721, 730], [1154, -55]] },
      { n: "Windsor Square", served: false, p: [[2315, 740], [2324, 1237], [2280, 2282], [1190, 2321], [2315, 740]] },
      WEST,
    ]);
    expect(ringArea(fixed[0].p)).toBeGreaterThan(3e6);
    expect(ringArea(fixed[1].p)).toBeGreaterThan(1e6);
    expect(ringArea(fixed[2].p)).toBeGreaterThan(1.5e6);
    expect(fixed[3]).toBe(WEST);
  });

  it("lays out every building on its own island, off the water, the same way every time", () => {
    const M = manifest();
    const env = {
      field: f, height: () => 80, road: () => 400, roadNamed: () => 1e9, park: () => false,
      lake: (x: number, z: number) => Math.hypot(x + 1500, z) < 250,
    };
    const a = layoutIslands(M, env), b = layoutIslands(M, env);
    expect(a).toEqual(b);
    for (const isl of a) {
      expect(isl.plans.length).toBeGreaterThan(20);
      expect(isl.trees.length).toBeGreaterThan(20);
      for (const p of isl.plans) {
        const x = p.x * S, z = p.z * S;
        expect(ownerAt(f, x, z)).toBe(isl.index);
        expect(coastAt(f, x, z)).toBeGreaterThan(0);
        expect(Math.hypot(x + 1500, z)).toBeGreaterThan(250);
      }
    }
    // building ids are unique across the whole board (the lantern lookup is keyed by them)
    const ids = a.flatMap(i => i.plans.map(p => p.i));
    expect(new Set(ids).size).toBe(ids.length);
  });
});


describe("canonical island admission", () => {
  const islands = [{ name: "Century City", index: 0 }, { name: "Hollywood", index: 1 }];
  it("admits the classified territory regardless of presentation position", () => {
    expect(canonicalIslandFor(islands, "Century City")).toBe(islands[0]);
  });
  it("keeps unknown geography and territories outside the board unplaced", () => {
    expect(canonicalIslandFor(islands)).toBeNull();
    expect(canonicalIslandFor(islands, "University Park")).toBeNull();
  });
});
