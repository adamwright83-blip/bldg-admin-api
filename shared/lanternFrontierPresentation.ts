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

/**
 * Lost ground never recycles the prize. The balloon already flew; it cannot
 * narratively land again. A previously held territory shows abandonment —
 * a different machine than the one that departed — so "what was" reads
 * differently from "what could be" while sharing the lock grammar.
 */
export function lostGroundKindForTerritory(territoryId: string): FrontierObjectKind {
  const original = frontierKindForTerritory(territoryId);
  const index = FRONTIER_OBJECT_KINDS.indexOf(original);
  return FRONTIER_OBJECT_KINDS[(index + 1) % FRONTIER_OBJECT_KINDS.length]!;
}
