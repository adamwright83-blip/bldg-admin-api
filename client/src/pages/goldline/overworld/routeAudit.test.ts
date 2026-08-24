import { describe, expect, it } from "vitest";
import { OVERWORLD_AUDIT_ROUTE } from "./auditRoute";
import { GOLDLINE_OVERWORLD_MAP as map } from "./mapDefinition";
import { remapAnalogInput, stepVelocity } from "./movement";
import {
  applyCorridorAssist,
  distance,
  isWalkable,
  moveWithCollision,
} from "./navigation";
import type { OverworldPoint } from "./types";

describe("overworld full-route movement audit", () => {
  it("moves the real collider through every free-roam destination", () => {
    let position: OverworldPoint = { ...map.spawns.noticeboard! };
    let velocity: OverworldPoint = { x: 0, y: 0 };
    for (const target of OVERWORLD_AUDIT_ROUTE) {
      let frames = 0;
      while (distance(position, target) > 5 && frames < 1200) {
        const dx = target.x - position.x;
        const dy = target.y - position.y;
        const magnitude = Math.hypot(dx, dy) || 1;
        velocity = stepVelocity(
          velocity,
          remapAnalogInput(dx / magnitude, dy / magnitude),
          1 / 60
        );
        position = moveWithCollision(
          map,
          position,
          { x: velocity.x / 60, y: velocity.y / 60 },
          11
        );
        const assisted = applyCorridorAssist(map, position, 1 / 60);
        position = moveWithCollision(
          map,
          position,
          { x: assisted.x - position.x, y: assisted.y - position.y },
          11
        );
        frames += 1;
      }
      expect(
        distance(position, target),
        `blocked at ${position.x.toFixed(1)},${position.y.toFixed(1)} before ${target.x},${target.y}`
      ).toBeLessThanOrEqual(7);
      expect(isWalkable(map, position, 11)).toBe(true);
    }
  });
});
