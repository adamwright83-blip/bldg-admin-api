export type LanternCityAssetState = "dormant" | "activated" | "global";

export type LanternCityWorldAsset = {
  id: string;
  category: "freedom_object" | "future_objective" | "stronghold" | "command";
  theme: string;
  state: LanternCityAssetState;
  src: string;
  aspectRatio: number;
  recommendedScale: number;
  anchorBias: "center-bottom" | "center";
  compatibleTerritoryArchetypes: readonly string[];
  source: "approved_lantern_city_concept_2026_09_06";
  version: 3;
};

const ROOT = "/assets/goldline/lantern-city/v3";

export const LANTERN_CITY_ASSETS = {
  futureCage: {
    id: "global_future_cage",
    category: "future_objective",
    theme: "family_future",
    state: "global",
    src: `/assets/goldline/lantern-city/v4/global-future-cage.png`,
    aspectRatio: 1,
    recommendedScale: 0.72,
    anchorBias: "center",
    compatibleTerritoryArchetypes: [],
    source: "approved_lantern_city_concept_2026_09_06",
    version: 3,
  },
  westHollywood: {
    id: "freedom_hot_air_balloon",
    category: "freedom_object",
    theme: "travel",
    state: "dormant",
    src: `${ROOT}/frontier-balloon-locked.png`,
    aspectRatio: 1448 / 1086,
    recommendedScale: 0.82,
    anchorBias: "center-bottom",
    compatibleTerritoryArchetypes: ["west-hollywood"],
    source: "approved_lantern_city_concept_2026_09_06",
    version: 3,
  },
  eastHollywood: {
    id: "freedom_broken_helicopter",
    category: "freedom_object",
    theme: "mobility",
    state: "dormant",
    src: `${ROOT}/frontier-helicopter-locked.png`,
    aspectRatio: 1448 / 1086,
    recommendedScale: 0.78,
    anchorBias: "center-bottom",
    compatibleTerritoryArchetypes: ["east-hollywood"],
    source: "approved_lantern_city_concept_2026_09_06",
    version: 3,
  },
  echoPark: {
    id: "freedom_toy_plane_ramp",
    category: "freedom_object",
    theme: "imaginative_flight",
    state: "dormant",
    src: `${ROOT}/frontier-toy-flight-locked.png`,
    aspectRatio: 1448 / 1086,
    recommendedScale: 0.78,
    anchorBias: "center-bottom",
    compatibleTerritoryArchetypes: ["echo-park"],
    source: "approved_lantern_city_concept_2026_09_06",
    version: 3,
  },
  artsDistrict: {
    id: "freedom_jungle_expedition",
    category: "freedom_object",
    theme: "expedition",
    state: "dormant",
    src: `${ROOT}/frontier-expedition-locked.png`,
    aspectRatio: 1448 / 1086,
    recommendedScale: 0.76,
    anchorBias: "center-bottom",
    compatibleTerritoryArchetypes: ["arts-district"],
    source: "approved_lantern_city_concept_2026_09_06",
    version: 3,
  },
} as const satisfies Record<string, LanternCityWorldAsset>;

const FRONTIER_ASSET_BY_TERRITORY: Record<string, LanternCityWorldAsset> = {
  "west-hollywood": LANTERN_CITY_ASSETS.westHollywood,
  "east-hollywood": LANTERN_CITY_ASSETS.eastHollywood,
  "echo-park": LANTERN_CITY_ASSETS.echoPark,
  "arts-district": LANTERN_CITY_ASSETS.artsDistrict,
};

export function frontierAssetForTerritory(territoryId: string) {
  return FRONTIER_ASSET_BY_TERRITORY[territoryId] ?? null;
}
