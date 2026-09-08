import type { Point, Rect } from "./sceneTypes";
/** Coordinates are percentages of the authored stage, never geographic inputs. */
export type TerritoryPresentation = {
  primaryAnchor: Point;
  stateArtBounds: Rect;
  priority: number;
  emptyEnvironment: "infested" | "locked";
  displacementLimit: number;
  /**
   * Deterministic authored fallback positions (world-stage percent, like
   * primaryAnchor) for a customer lantern that cannot share the stronghold's
   * own anchor. Tried in order, after primaryAnchor, before the object is
   * suppressed. Never used for the stronghold itself — a tower always uses
   * primaryAnchor. Not runtime physics: fixed, authored slots only.
   */
  lanternSlots?: Point[];
};
const district = (
  x: number,
  y: number,
  priority = 3,
  emptyEnvironment: "infested" | "locked" = "locked",
  lanternSlots?: Point[]
): TerritoryPresentation => ({
  primaryAnchor: { x, y },
  stateArtBounds: { x: x - 10, y: y - 9, width: 20, height: 23 },
  priority,
  emptyEnvironment,
  displacementLimit: 150,
  lanternSlots,
});
export const TERRITORY_PRESENTATION: Record<string, TerritoryPresentation> = {
  // Strongholds anchor here too, so an unrelated customer address sharing
  // the territory needs its own authored slot(s) rather than competing for
  // the same anchor and being suppressed.
  koreatown: district(47, 49, 1, "locked", [
    { x: 55, y: 55 },
    { x: 40, y: 42 },
  ]),
  "century-city": district(20, 65, 1, "locked", [
    { x: 27, y: 72 },
    { x: 14, y: 58 },
  ]),
  "beverly-hills": district(14, 40, 2),
  "west-hollywood": district(33, 33, 2, "infested"),
  hollywood: district(50, 20, 2),
  "los-feliz": district(69, 24, 2),
  "silver-lake": district(78, 42, 3),
  "east-hollywood": district(63, 43, 3),
  "mid-city": district(38, 71, 2, "infested"),
  "echo-park": district(80, 61, 2),
  downtown: district(66, 72, 2),
  westlake: district(60, 61, 4),
  "arts-district": district(85, 76, 4),
  "hollywood-hills-west": district(32, 17, 4),
};
export function presentationFor(
  id: string,
  world: Point
): TerritoryPresentation {
  return (
    TERRITORY_PRESENTATION[id] ??
    district(
      Math.min(78, Math.max(18, world.x)),
      Math.min(74, Math.max(20, world.y)),
      5
    )
  );
}
