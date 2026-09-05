/**
 * THE BOARD KIT'S ONE JOB: never bake in a single-tile assumption.
 *
 * The failure this suite exists to prevent is not visual. It is that the board
 * quietly becomes "Los Angeles, seven copies of one picture" — which works
 * today, looks cheap immediately, and cannot generate Phoenix at all.
 *
 * So the tests below mostly prove properties that hold for ANY registry: pass
 * one variant, pass twenty, pass a set with no safe mirror, and the layout logic
 * still behaves. Several of them run against a synthetic registry for exactly
 * that reason — asserting on today's seven entries would pin the content rather
 * than the architecture.
 */
import { describe, expect, it } from "vitest";
import {
  BOARD_KIT_ASSETS,
  BRIDGE_MODULES,
  ISLAND_VARIANTS,
  PLINTH_VARIANTS,
  assignIslands,
  authoredIslandCount,
  boardHash,
  bridgeAxisBetween,
  type BoardPlacementInput,
  type IslandVariant,
} from "./goldlineBoardKit";

/** A registry of N distinct shapes, for testing rules rather than content. */
function syntheticVariants(count: number): IslandVariant[] {
  return Array.from({ length: count }, (_, index) => ({
    ...ISLAND_VARIANTS[0],
    id: `shape-${index}` as IslandVariant["id"],
    displayName: `Shape ${index}`,
  }));
}

const grid = (count: number, spacing = 8): BoardPlacementInput[] =>
  Array.from({ length: count }, (_, index) => ({
    stableKey: `territory-${index}`,
    position: { x: 10 + (index % 5) * spacing, y: 10 + Math.floor(index / 5) * spacing },
  }));

describe("registry shape", () => {
  it("declares every piece's own geometry rather than a shared constant", () => {
    for (const variant of ISLAND_VARIANTS) {
      for (const edge of ["north", "east", "south", "west"] as const) {
        const socket = variant.sockets[edge];
        expect(socket.x).toBeGreaterThanOrEqual(0);
        expect(socket.x).toBeLessThanOrEqual(1);
        expect(socket.y).toBeGreaterThanOrEqual(0);
        expect(socket.y).toBeLessThanOrEqual(1);
      }
      expect(variant.plinthAnchor.x).toBeGreaterThan(0);
      expect(variant.rotations.length).toBeGreaterThan(0);
      const [min, max] = variant.scaleRange;
      expect(min).toBeGreaterThan(0);
      expect(max).toBeGreaterThanOrEqual(min);
    }
  });

  it("gives silhouettes genuinely different geometry, not one shape renamed", () => {
    // If every entry shared identical sockets and scale bands, the registry
    // would be decoration over a single tile — the exact thing it replaces.
    const socketFingerprints = new Set(
      ISLAND_VARIANTS.map(v => JSON.stringify(v.sockets))
    );
    const scaleFingerprints = new Set(
      ISLAND_VARIANTS.map(v => JSON.stringify(v.scaleRange))
    );
    expect(socketFingerprints.size).toBeGreaterThan(1);
    expect(scaleFingerprints.size).toBeGreaterThan(1);
  });

  it("marks silhouettes that must not be mirrored", () => {
    // A pier reaching out to sea, a lit frontage, a one-way interchange: a flip
    // reverses the read. At least one variant has to know that about itself.
    expect(ISLAND_VARIANTS.some(v => !v.mirrorSafe)).toBe(true);
  });

  it("reports honestly how much authored art actually exists", () => {
    const counts = authoredIslandCount();
    expect(counts.total).toBe(ISLAND_VARIANTS.length);
    expect(counts.authored + counts.scaffold).toBe(counts.total);
  });

  it("resolves a scaffolded plinth to nothing, never to a wrong picture", () => {
    for (const plinth of PLINTH_VARIANTS) {
      if (plinth.status === "scaffold") expect(plinth.art).toBe("");
      else expect(plinth.art).toContain("/assets/");
    }
  });

  it("points every real asset path at the kit", () => {
    for (const url of Object.values(BRIDGE_MODULES))
      expect(url.startsWith(BOARD_KIT_ASSETS)).toBe(true);
  });
});

describe("assignment is deterministic", () => {
  it("gives the same territory the same silhouette across reloads", () => {
    const input = grid(7);
    const first = assignIslands(input);
    const second = assignIslands(input);
    expect(second.map(p => p.variant.id)).toEqual(first.map(p => p.variant.id));
    expect(second.map(p => p.scale)).toEqual(first.map(p => p.scale));
    expect(second.map(p => p.mirrored)).toEqual(first.map(p => p.mirrored));
  });

  it("does not change the board when the caller reorders its query results", () => {
    // Placement must be a property of the territories, not of the array they
    // arrived in — otherwise a refetch reshuffles the world.
    const input = grid(7);
    const forward = assignIslands(input);
    const reversed = assignIslands([...input].reverse());
    const byKey = (list: typeof forward) =>
      Object.fromEntries(list.map(p => [p.stableKey, p.variant.id]));
    expect(byKey(reversed)).toEqual(byKey(forward));
  });

  it("keeps a territory's silhouette when an unrelated territory disappears", () => {
    // Deterministic-from-key, so removing a distant territory must not
    // re-skin the survivors.
    const input = grid(7, 30);
    const before = assignIslands(input);
    const after = assignIslands(input.slice(0, 6));
    for (const placement of after) {
      const previous = before.find(p => p.stableKey === placement.stableKey)!;
      expect(placement.variant.id).toBe(previous.variant.id);
    }
  });

  it("hashes stably and never negative", () => {
    expect(boardHash("abc")).toBe(boardHash("abc"));
    expect(boardHash("abc")).not.toBe(boardHash("abd"));
    for (const key of ["", "a", "territory-999", "éè"])
      expect(boardHash(key)).toBeGreaterThanOrEqual(0);
  });
});

describe("no adjacent clones", () => {
  it("never gives two nearby territories the same silhouette when it can avoid it", () => {
    // Tight cluster, plenty of shapes: every neighbour must differ.
    const clustered: BoardPlacementInput[] = Array.from({ length: 6 }, (_, i) => ({
      stableKey: `t-${i}`,
      position: { x: 40 + i * 3, y: 40 },
    }));
    const placed = assignIslands(clustered, syntheticVariants(10));
    const ids = placed.map(p => p.variant.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("still places every territory when there are more neighbours than shapes", () => {
    // Degrades rather than throwing or dropping a territory. The honest fix for
    // this board is more art, and the test says so by not pretending otherwise.
    const clustered: BoardPlacementInput[] = Array.from({ length: 9 }, (_, i) => ({
      stableKey: `t-${i}`,
      position: { x: 40 + i * 2, y: 40 },
    }));
    const placed = assignIslands(clustered, syntheticVariants(3));
    expect(placed).toHaveLength(9);
    for (const placement of placed) expect(placement.variant).toBeDefined();
  });

  it("allows a silhouette to repeat once territories are genuinely far apart", () => {
    // Reuse across a wide board is correct; the rule is about adjacency, not
    // global uniqueness, or a large city would need a hundred islands.
    const spread: BoardPlacementInput[] = [
      { stableKey: "a", position: { x: 5, y: 5 } },
      { stableKey: "b", position: { x: 95, y: 95 } },
    ];
    const placed = assignIslands(spread, syntheticVariants(1));
    expect(placed.map(p => p.variant.id)).toEqual(["shape-0", "shape-0"]);
  });

  it("works with a registry of one, which is the scaffold case", () => {
    const placed = assignIslands(grid(4), syntheticVariants(1));
    expect(placed).toHaveLength(4);
  });

  it("returns nothing rather than crashing on an empty registry", () => {
    expect(assignIslands(grid(3), [])).toEqual([]);
  });
});

describe("dressing is secondary, never the answer to variety", () => {
  it("respects each silhouette's declared scale band", () => {
    for (const placement of assignIslands(grid(7))) {
      const [min, max] = placement.variant.scaleRange;
      expect(placement.scale).toBeGreaterThanOrEqual(min);
      expect(placement.scale).toBeLessThanOrEqual(max);
    }
  });

  it("never mirrors a silhouette that declared itself unsafe to mirror", () => {
    const placed = assignIslands(grid(40, 3));
    for (const placement of placed)
      if (!placement.variant.mirrorSafe) expect(placement.mirrored).toBe(false);
  });

  it("only ever uses a rotation the silhouette declared", () => {
    for (const placement of assignIslands(grid(40, 3)))
      expect(placement.variant.rotations).toContain(placement.rotation);
  });
});

describe("bridges span real board points", () => {
  it("picks the module whose authored perspective runs the right way", () => {
    const origin = { x: 50, y: 50 };
    // Expected values read off projection.json, not off the implementation.
    // Screen y grows downward, so the asset's "north" is the smaller y.
    expect(bridgeAxisBetween(origin, { x: 70, y: 70 })).toBe("nw_se");
    expect(bridgeAxisBetween(origin, { x: 70, y: 30 })).toBe("sw_ne");
    expect(bridgeAxisBetween(origin, { x: 30, y: 70 })).toBe("ne_sw");
    expect(bridgeAxisBetween(origin, { x: 30, y: 30 })).toBe("se_nw");
  });

  it("is the exact inverse when travelled the other way", () => {
    // The kit ships two artworks plus their 180 degree counterparts, so a
    // crossing must resolve to opposite modules depending on direction.
    const a = { x: 20, y: 20 };
    const b = { x: 80, y: 80 };
    expect(bridgeAxisBetween(a, b)).toBe("nw_se");
    expect(bridgeAxisBetween(b, a)).toBe("se_nw");
  });
});
