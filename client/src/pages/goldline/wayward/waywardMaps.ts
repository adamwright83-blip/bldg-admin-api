import type { OverworldMapDefinition, OverworldPoint } from "../overworld/types";
import { BOLLARD, CACHE_REACH, CITY_WALK, DECK_SPAWN, DECK_WALK, GUARDIAN, SAIL_SPAWN, SAIL_WALK, SHIP_WALK, SHIP_WALK_BROKEN } from "./waywardGeometry";

/**
 * The voyage's walkable ground, in the production physical-world schema, so
 * collision and edge-sliding are the shared `overworld/navigation.ts`
 * primitives (`isWalkable`, `moveWithCollision`), not a second system.
 */
function ellipse(center: OverworldPoint, rx: number, ry: number, steps = 16): OverworldPoint[] {
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return { x: center.x + Math.cos(a) * rx, y: center.y + Math.sin(a) * ry };
  });
}

function map(id: string, surface: OverworldPoint[], spawn: OverworldPoint, extra: Partial<OverworldMapDefinition> = {}): OverworldMapDefinition {
  return {
    id,
    version: 1,
    width: 1536,
    height: 658,
    defaultSpawnId: "start",
    spawns: { start: { ...spawn, surfaceId: `${id}-planks` } },
    surfaces: [{ id: `${id}-planks`, material: "wood", polygon: surface }, ...(extra.surfaces ?? [])],
    corridors: [],
    occluders: [],
    destinations: [],
    traversals: [],
    blockedRegions: extra.blockedRegions ?? [],
  };
}

const guardianFootprint = { id: "tether-guardian", polygon: ellipse({ x: GUARDIAN.x, y: GUARDIAN.y + 4 }, 74, 20) };

export const DECK_MAP = map("wayward-deck", DECK_WALK, DECK_SPAWN, {
  surfaces: [{ id: "wayward-deck-cache-reach", material: "wood", polygon: CACHE_REACH }],
  blockedRegions: [guardianFootprint],
});

export const SAIL_MAP = map("wayward-under-sail", SAIL_WALK, SAIL_SPAWN, { blockedRegions: [guardianFootprint] });

export const SHIP_END_MAP = map("wayward-ship-end", SHIP_WALK, { x: 420, y: 440 });
export const SHIP_END_BROKEN_MAP = map("wayward-ship-end-broken", SHIP_WALK_BROKEN, { x: 400, y: 440 });
export const CITY_STAGE_MAP = map("mooring-stage", CITY_WALK, { x: 1030, y: 438 }, {
  blockedRegions: [{ id: "mooring-bollard", polygon: ellipse({ x: BOLLARD.x, y: BOLLARD.y }, BOLLARD.rx, BOLLARD.ry) }],
});
