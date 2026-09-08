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
  // Complete: all 14 authored territories x 4 states — koreatown,
  // century-city and hollywood are bespoke art confirmed to match the
  // painterly board; every other territory is generated directly from the
  // master world crop at its own authored stateArtBounds (see
  // scripts/generate-lantern-city-v6-derived-territory-art.py), which
  // guarantees identical geography/camera across all four of its own
  // states and against the board itself. Every territory not in this list
  // stays entirely missing on purpose — no manufactured fallbacks, no
  // reused sibling-state or sibling-territory image.
  territories: {
    "koreatown": {
      healthy: "/assets/goldline/lantern-city/v6/territories/koreatown/healthy.png",
      cooling: "/assets/goldline/lantern-city/v6/territories/koreatown/cooling.png",
      infested: "/assets/goldline/lantern-city/v6/territories/koreatown/infested.png",
      locked: "/assets/goldline/lantern-city/v6/territories/koreatown/locked.png",
    },
    "century-city": {
      healthy: "/assets/goldline/lantern-city/v6/territories/century-city/healthy.png",
      cooling: "/assets/goldline/lantern-city/v6/territories/century-city/cooling.png",
      infested: "/assets/goldline/lantern-city/v6/territories/century-city/infested.png",
      locked: "/assets/goldline/lantern-city/v6/territories/century-city/locked.png",
    },
    "beverly-hills": {
      healthy: "/assets/goldline/lantern-city/v6/territories/beverly-hills/healthy.png",
      cooling: "/assets/goldline/lantern-city/v6/territories/beverly-hills/cooling.png",
      infested: "/assets/goldline/lantern-city/v6/territories/beverly-hills/infested.png",
      locked: "/assets/goldline/lantern-city/v6/territories/beverly-hills/locked.png",
    },
    "west-hollywood": {
      healthy: "/assets/goldline/lantern-city/v6/territories/west-hollywood/healthy.png",
      cooling: "/assets/goldline/lantern-city/v6/territories/west-hollywood/cooling.png",
      infested: "/assets/goldline/lantern-city/v6/territories/west-hollywood/infested.png",
      locked: "/assets/goldline/lantern-city/v6/territories/west-hollywood/locked.png",
    },
    "hollywood": {
      healthy: "/assets/goldline/lantern-city/v6/territories/hollywood/healthy.png",
      cooling: "/assets/goldline/lantern-city/v6/territories/hollywood/cooling.png",
      infested: "/assets/goldline/lantern-city/v6/territories/hollywood/infested.png",
      locked: "/assets/goldline/lantern-city/v6/territories/hollywood/locked.png",
    },
    "los-feliz": {
      healthy: "/assets/goldline/lantern-city/v6/territories/los-feliz/healthy.png",
      cooling: "/assets/goldline/lantern-city/v6/territories/los-feliz/cooling.png",
      infested: "/assets/goldline/lantern-city/v6/territories/los-feliz/infested.png",
      locked: "/assets/goldline/lantern-city/v6/territories/los-feliz/locked.png",
    },
    "silver-lake": {
      healthy: "/assets/goldline/lantern-city/v6/territories/silver-lake/healthy.png",
      cooling: "/assets/goldline/lantern-city/v6/territories/silver-lake/cooling.png",
      infested: "/assets/goldline/lantern-city/v6/territories/silver-lake/infested.png",
      locked: "/assets/goldline/lantern-city/v6/territories/silver-lake/locked.png",
    },
    "east-hollywood": {
      healthy: "/assets/goldline/lantern-city/v6/territories/east-hollywood/healthy.png",
      cooling: "/assets/goldline/lantern-city/v6/territories/east-hollywood/cooling.png",
      infested: "/assets/goldline/lantern-city/v6/territories/east-hollywood/infested.png",
      locked: "/assets/goldline/lantern-city/v6/territories/east-hollywood/locked.png",
    },
    "mid-city": {
      healthy: "/assets/goldline/lantern-city/v6/territories/mid-city/healthy.png",
      cooling: "/assets/goldline/lantern-city/v6/territories/mid-city/cooling.png",
      infested: "/assets/goldline/lantern-city/v6/territories/mid-city/infested.png",
      locked: "/assets/goldline/lantern-city/v6/territories/mid-city/locked.png",
    },
    "echo-park": {
      healthy: "/assets/goldline/lantern-city/v6/territories/echo-park/healthy.png",
      cooling: "/assets/goldline/lantern-city/v6/territories/echo-park/cooling.png",
      infested: "/assets/goldline/lantern-city/v6/territories/echo-park/infested.png",
      locked: "/assets/goldline/lantern-city/v6/territories/echo-park/locked.png",
    },
    "downtown": {
      healthy: "/assets/goldline/lantern-city/v6/territories/downtown/healthy.png",
      cooling: "/assets/goldline/lantern-city/v6/territories/downtown/cooling.png",
      infested: "/assets/goldline/lantern-city/v6/territories/downtown/infested.png",
      locked: "/assets/goldline/lantern-city/v6/territories/downtown/locked.png",
    },
    "westlake": {
      healthy: "/assets/goldline/lantern-city/v6/territories/westlake/healthy.png",
      cooling: "/assets/goldline/lantern-city/v6/territories/westlake/cooling.png",
      infested: "/assets/goldline/lantern-city/v6/territories/westlake/infested.png",
      locked: "/assets/goldline/lantern-city/v6/territories/westlake/locked.png",
    },
    "arts-district": {
      healthy: "/assets/goldline/lantern-city/v6/territories/arts-district/healthy.png",
      cooling: "/assets/goldline/lantern-city/v6/territories/arts-district/cooling.png",
      infested: "/assets/goldline/lantern-city/v6/territories/arts-district/infested.png",
      locked: "/assets/goldline/lantern-city/v6/territories/arts-district/locked.png",
    },
    "hollywood-hills-west": {
      healthy: "/assets/goldline/lantern-city/v6/territories/hollywood-hills-west/healthy.png",
      cooling: "/assets/goldline/lantern-city/v6/territories/hollywood-hills-west/cooling.png",
      infested: "/assets/goldline/lantern-city/v6/territories/hollywood-hills-west/infested.png",
      locked: "/assets/goldline/lantern-city/v6/territories/hollywood-hills-west/locked.png",
    },
  } as Record<string, Partial<Record<EnvironmentState, string>>>,
};
export function statePlateAsset(
  territoryId: string,
  state: EnvironmentState
): string | null {
  return SCENE_ART.territories[territoryId]?.[state] ?? null;
}
