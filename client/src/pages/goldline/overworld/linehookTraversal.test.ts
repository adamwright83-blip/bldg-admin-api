import { expect, it } from "vitest";
import { GOLDLINE_OVERWORLD_MAP as map } from "./mapDefinition";
import { isWalkable, moveWithCollision } from "./navigation";
import { linehookFrame } from "./linehookTraversal";
it("blocks both authored gaps while allowing validated hook landings", () => {
  expect(isWalkable(map, { x: 273, y: 953 }, 11)).toBe(false);
  expect(isWalkable(map, { x: 270, y: 560 }, 11)).toBe(false);
  expect(moveWithCollision(map, { x: 230, y: 950 }, { x: 95, y: 0 }, 11).x).toBeLessThan(262);
  for (const node of map.traversals.filter(node => node.kind === "linehook")) {
    expect(isWalkable(map, node.entry, 11), node.id).toBe(true);
    const landing = node.path.at(-1)!;
    expect(isWalkable(map, landing, node.landingRadius), node.id).toBe(true);
    expect(linehookFrame(2150, node.entry, landing)).toMatchObject({ done: true, position: landing });
    expect(linehookFrame(1100, node.entry, landing).position).not.toEqual(landing);
  }
});
it("expresses every phase using data rather than a destination special case", () => {
  const phases = [0, 260, 400, 700, 900, 1850, 2050].map(t => linehookFrame(t, { x: 0, y: 0 }, { x: 100, y: 0 }).phase);
  expect(phases).toEqual(["AIM", "FIRE", "HOOK FLIGHT", "CATCH", "PLAYER TRAVEL", "LAND", "RELEASE"]);
});
