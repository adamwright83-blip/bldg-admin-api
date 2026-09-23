import type { CanonicalBuildingId } from "./buildingArt";

/**
 * Canonical click for Lantern City.
 *
 * Live Lantern City (`LanternCityScene`) and Home's mini-map
 * (`WorldGeographySurface`) both call this. The surfaces may look
 * different. They do not choose the destination.
 *
 * Opus LA opens its tower-inspection screen. Every other canonical
 * stronghold opens that building's Tower Wars. The attached customer
 * light inspects the customers; it does not enter the building.
 */
export type LanternClickTarget = "tower" | "light" | "default";

export type LanternCityClickInput = {
  buildingId?: string | null;
  target?: LanternClickTarget;
  /**
   * The entity has a customer cluster or a prospect. That opens the
   * inspector. It is not a route.
   */
  opensInspector?: boolean;
};

export type LanternCityClickResolution =
  | {
      action: "navigate";
      path: string;
      entityId: CanonicalBuildingId;
    }
  | { action: "inspect" }
  | { action: "none" };

const BUILDING_DESTINATIONS: Record<CanonicalBuildingId, string> = {
  opus_la: "/growth/opus-la-inspection",
  century_park_east: "/growth/tower-wars?building=century_park_east",
};

function canonicalBuildingId(id: string): CanonicalBuildingId | null {
  if (id === "opus_la" || id === "century_park_east") return id;
  return null;
}

export function resolveLanternCityClick(
  input: LanternCityClickInput
): LanternCityClickResolution {
  const target = input.target ?? "default";
  const buildingId = input.buildingId
    ? canonicalBuildingId(input.buildingId)
    : null;

  if (buildingId && target !== "light") {
    return {
      action: "navigate",
      path: BUILDING_DESTINATIONS[buildingId],
      entityId: buildingId,
    };
  }

  if (input.opensInspector) return { action: "inspect" };
  return { action: "none" };
}
