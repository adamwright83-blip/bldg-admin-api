import { stableHash } from "./lanternTerritoryVisualState";

export type FrontierObjectKind =
  | "balloon"
  | "helicopter"
  | "toyFlight"
  | "excursion"
  | "expedition";

export const FRONTIER_OBJECT_KINDS: readonly FrontierObjectKind[] = [
  "balloon",
  "helicopter",
  "toyFlight",
  "excursion",
  "expedition",
];

const AUTHORED_FRONTIER: Record<string, FrontierObjectKind> = {
  "west-hollywood": "balloon",
  "east-hollywood": "helicopter",
  "echo-park": "toyFlight",
  "arts-district": "expedition",
};

export function frontierKindForTerritory(territoryId: string): FrontierObjectKind {
  return (
    AUTHORED_FRONTIER[territoryId] ??
    FRONTIER_OBJECT_KINDS[stableHash(territoryId) % FRONTIER_OBJECT_KINDS.length]!
  );
}

export function lostGroundKindForTerritory(territoryId: string): FrontierObjectKind {
  return frontierKindForTerritory(territoryId);
}
