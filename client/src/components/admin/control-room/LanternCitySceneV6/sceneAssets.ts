import { LANTERN_CITY_V5_ASSETS } from "@/components/goldline/lanternCityV5Assets";
import type { EnvironmentState } from "./sceneTypes";
/** Null slots are intentional. Props and gels cannot stand in for world artwork. */
export const SCENE_ART = {
  approved: false,
  base: null as string | null,
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
  territories: {} as Record<string, Partial<Record<EnvironmentState, string>>>,
};
export function statePlateAsset(
  territoryId: string,
  state: EnvironmentState
): string | null {
  return SCENE_ART.territories[territoryId]?.[state] ?? null;
}
