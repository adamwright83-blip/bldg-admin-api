import { describe, expect, it } from "vitest";
import { GOLDLINE_OVERWORLD_MAP as map } from "./mapDefinition";
import {
  closestPointOnCorridor,
  isWalkable,
  moveWithCollision,
  nearestValidPoint,
} from "./navigation";

describe("overworld navigation contract", () => {
  it("connects Noticeboard to Greystar without crossing sky", () => {
    const step = 8;
    const start = map.spawns.noticeboard!;
    const finish = map.spawns.greystarEntrance!;
    const queue: Array<[number, number]> = [
      [Math.round(start.x / step) * step, Math.round(start.y / step) * step],
    ];
    const visited = new Set(queue.map(point => point.join(",")));
    let reached = false;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const [x, y] = queue[cursor]!;
      if (Math.hypot(x - finish.x, y - finish.y) < 18) reached = true;
      for (const [dx, dy] of [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
      ]) {
        const next: [number, number] = [x + dx, y + dy];
        const key = next.join(",");
        if (
          !visited.has(key) &&
          isWalkable(map, { x: next[0], y: next[1] }, 11)
        ) {
          visited.add(key);
          queue.push(next);
        }
      }
    }
    expect(reached).toBe(true);
    for (const destination of map.destinations) {
      expect(
        queue.some(
          ([x, y]) =>
            Math.hypot(x - destination.point.x, y - destination.point.y) < 20
        ),
        `${destination.id} should be reachable through authored terrain`
      ).toBe(true);
    }
  });

  it("slides at terrain edges and never accepts cloud space", () => {
    const start = map.spawns.noticeboard!;
    const result = moveWithCollision(map, start, { x: -500, y: 0 }, 11);
    expect(isWalkable(map, result, 11)).toBe(true);
    expect(result.x).toBeGreaterThan(0);
  });

  it("contains the player inside the authored Greystar bridge", () => {
    const bridge = map.corridors.find(
      item => item.id === "greystar-rope-bridge"
    )!;
    const outside = { x: 280, y: 960 };
    expect(closestPointOnCorridor(outside, bridge).distance).toBeGreaterThan(
      bridge.halfWidth
    );
    expect(isWalkable(map, outside, 11)).toBe(false);
  });

  it("gates Greystar at the painted entrance rather than the arena floor", () => {
    const greystar = map.destinations.find(item => item.id === "greystar-6")!;
    expect(greystar.point).toEqual({ x: 422, y: 906 });
    expect(
      Math.hypot(423 - greystar.point.x, 842 - greystar.point.y)
    ).toBeGreaterThan(greystar.entranceRadius);
  });

  it("recovers invalid checkpoints to valid grounded space", () => {
    const recovered = nearestValidPoint(map, { x: 800, y: 800 }, 11);
    expect(isWalkable(map, recovered, 11)).toBe(true);
  });

  it("gates every traversal with valid entry and exit surfaces", () => {
    for (const traversal of map.traversals) {
      expect(isWalkable(map, traversal.entry)).toBe(true);
      expect(
        map.surfaces.some(surface => surface.id === traversal.exitSurfaceId)
      ).toBe(true);
      expect(traversal.path.length).toBeGreaterThan(1);
    }
  });
});
