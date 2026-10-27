import { describe, expect, it } from "vitest";
import { DEPTH, ELEV_X0, ELEV_X1, FLOORS, PLAYER_RADIUS, ROOF_POOL, ROPES, ROPE_HOLE_RADIUS, ROPE_LANDING_DX, WIDTH, hitsCollider, ropeLanding, staticColliders } from "./cpeLayout";

/**
 * The ropes must land her somewhere she can walk away from. PR #710 enlarged the pool's collider and the laundry rope
 * then dropped her inside it; her step is shorter than the clearance so she was stuck on the roof. These walk the
 * same collider list the game uses (cpeLayout.staticColliders) with the same radius and the same step the game takes.
 */
const STEP = 0.2; // under the game's largest step (sprint, paper), so a first step that passes here passes in the game
const colliders = staticColliders();
const free = (floor: number, x: number, z: number) =>
  z <= -0.35 && z >= -DEPTH + 0.35 && !colliders.some(b => b.floor === floor && hitsCollider(b, x, z, PLAYER_RADIUS));

/**
 * Can she get from here to there at all? A flood fill over a 10 cm grid of free cells, moving one cell at a time, so
 * a route that needs a detour (round the pool, through a doorway) counts, and a landing boxed in by furniture does not.
 */
function reachable(floor: number, from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  const G = 0.1;
  const X0 = 0.3, X1 = WIDTH - 0.3, Z0 = -DEPTH + 0.35, Z1 = -0.35;
  const cols = Math.round((X1 - X0) / G) + 1, rows = Math.round((Z1 - Z0) / G) + 1;
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi - 1, Math.round(v)));
  const cell = (p: { x: number; z: number }) => [clamp((p.x - X0) / G, cols), clamp((p.z - Z0) / G, rows)] as const;
  const [sx, sz] = cell(from), [tx, tz] = cell(to);
  if (!free(floor, X0 + sx * G, Z0 + sz * G)) return false;
  const seen = new Uint8Array(cols * rows);
  const queue: number[] = [sx + sz * cols];
  seen[queue[0]] = 1;
  while (queue.length) {
    const i = queue.shift()!;
    const cx = i % cols, cz = Math.floor(i / cols);
    if (cx === tx && cz === tz) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
      const j = nx + nz * cols;
      if (seen[j] || !free(floor, X0 + nx * G, Z0 + nz * G)) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return false;
}

describe("Century Park East ropes", () => {
  for (const rope of ROPES) {
    const above = rope.floor + 1;
    const landing = ropeLanding(rope);
    const name = `${FLOORS[rope.floor].name} → ${FLOORS[above].name}`;

    it(`${name}: she lands clear of everything and can take a first step in every direction`, () => {
      expect(free(above, landing.x, landing.z)).toBe(true);
      for (const [dx, dz] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) expect(free(above, landing.x + dx, landing.z + dz)).toBe(true);
    });

    it(`${name}: the hole in the floor above is not under any furniture`, () => {
      const furniture = colliders.filter(b => b.floor === above && b.x0 > 0.25 && b.x1 < 37.75);
      for (const b of furniture) expect(hitsCollider(b, rope.x, rope.z, ROPE_HOLE_RADIUS)).toBe(false);
    });

    it(`${name}: from the landing she can reach the elevator, and the far end of the floor`, () => {
      const elevator = { x: (ELEV_X0 + ELEV_X1) / 2, z: -2.4 };
      expect(reachable(above, landing, elevator)).toBe(true);
      expect(reachable(above, landing, { x: 1.0, z: -1.0 })).toBe(true);
      expect(reachable(above, landing, { x: WIDTH - 1.0, z: -1.0 })).toBe(true);
    });

    it(`${name}: a landing inside a piece of furniture would fail this test (the fill is not trivially true)`, () => {
      const b = colliders.find(c => c.floor === above && c.x0 > 0.25 && c.x1 < 37.75)!;
      expect(reachable(above, { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 }, landing)).toBe(false);
    });

    it(`${name}: she can stand next to the hole to slide back down`, () => {
      // the prompt needs her within 1.15 m of the hole; the landing itself is 0.9 m away
      expect(Math.hypot(landing.x - rope.x, landing.z - rope.z)).toBeLessThan(1.15);
    });
  }

  it("the roof pool starts east of the laundry rope's hole and its landing", () => {
    const rope = ROPES[1];
    expect(rope.floor).toBe(1);
    expect(ROOF_POOL.x0).toBeGreaterThan(rope.x + ROPE_HOLE_RADIUS);
    expect(ROOF_POOL.x0).toBeGreaterThan(rope.x + ROPE_LANDING_DX + PLAYER_RADIUS);
    expect(ropeLanding(rope).z).toBeGreaterThan(ROOF_POOL.z1 + PLAYER_RADIUS + 0.1);
  });
});
