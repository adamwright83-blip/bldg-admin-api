import { LANTERN_CITY_V5_ASSETS } from "@/components/goldline/lanternCityV5Assets";
import type { EnvironmentState } from "./sceneTypes";
/** Null slots are intentional. Props and gels cannot stand in for world artwork. */
export const SCENE_ART = {
  approved: false,
  // Approved pilot base — the V5 previewBase below remains the fallback
  // for everything this base doesn't yet cover.
  base: "/assets/goldline/lantern-city/v6/world-neutral.png" as string | null,
  lanterns: { active: null, dimming: null, dark: null } as Record<
    "active" | "dimming" | "dark",
    string | null
  >,
  strongholds: { opus_la: null, century_park_east: null } as Record<
    "opus_la" | "century_park_east",
    string | null
  >,
  lock: null as string | null,
  previewBase: LANTERN_CITY_V5_ASSETS.world.master,
  // Pilot-only: four approved territory plates. Every other territory/state
  // stays missing on purpose — no manufactured fallbacks.
  territories: {
    koreatown: {
      healthy: "/assets/goldline/lantern-city/v6/territories/koreatown/healthy.png",
    },
    "east-hollywood": {
      cooling:
        "/assets/goldline/lantern-city/v6/territories/east-hollywood/cooling.png",
    },
    "mid-city": {
      infested:
        "/assets/goldline/lantern-city/v6/territories/mid-city/infested.png",
    },
    hollywood: {
      locked: "/assets/goldline/lantern-city/v6/territories/hollywood/locked.png",
    },
  } as Record<string, Partial<Record<EnvironmentState, string>>>,
};
export function statePlateAsset(
  territoryId: string,
  state: EnvironmentState
): string | null {
  return SCENE_ART.territories[territoryId]?.[state] ?? null;
}
