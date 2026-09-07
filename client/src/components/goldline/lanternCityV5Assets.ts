const ROOT = "/assets/goldline/lantern-city/v5";

export const LANTERN_CITY_V5_ASSETS = {
  world: {
    master: `${ROOT}/lantern-city-master-v5.png`,
    foregroundDepth: `${ROOT}/lantern-city-foreground-depth-v5.png`,
  },
  territoryGels: {
    healthy: `${ROOT}/gel-healthy.png`,
    at_risk: `${ROOT}/gel-at-risk.png`,
    cooling: `${ROOT}/gel-cooling.png`,
    overgrown: `${ROOT}/gel-overgrown.png`,
    infested: `${ROOT}/gel-infested.png`,
    closed_construction: `${ROOT}/gel-closed-construction.png`,
    lost_ground: `${ROOT}/gel-lost-ground.png`,
    locked_opportunity: `${ROOT}/gel-locked-opportunity.png`,
  },
  lanterns: {
    active: `${ROOT}/lantern-active.png`,
    cooling: `${ROOT}/lantern-cooling.png`,
    quiet: `${ROOT}/lantern-quiet.png`,
    hearth: `${ROOT}/lantern-hearth-recurring.png`,
    opportunity: `${ROOT}/lantern-opportunity.png`,
    spark: `${ROOT}/lantern-signal-spark.png`,
    ember: `${ROOT}/lantern-answer-ember.png`,
    restored: `${ROOT}/lantern-restored-burst.png`,
  },
  decayProps: {
    overgrowthVinesA: `${ROOT}/overgrowth-vines-a.png`,
    overgrowthVinesB: `${ROOT}/overgrowth-vines-b.png`,
    ratHero: `${ROOT}/rat-hero.png`,
    ratSwarm: `${ROOT}/rat-swarm.png`,
    cockroachHero: `${ROOT}/cockroach-hero.png`,
    cockroachSwarm: `${ROOT}/cockroach-swarm.png`,
    toxicFumesA: `${ROOT}/toxic-fumes-a.png`,
    toxicFumesB: `${ROOT}/toxic-fumes-b.png`,
    neglectTrash: `${ROOT}/neglect-trash-grime.png`,
    constructionScaffold: `${ROOT}/construction-scaffold-cluster.png`,
    constructionPlywood: `${ROOT}/construction-plywood-barricade.png`,
    constructionBarriers: `${ROOT}/construction-road-barriers.png`,
    constructionBoarded: `${ROOT}/construction-boarded-block.png`,
  },
  frontier: {
    balloon: `${ROOT}/frontier-balloon-dormant-v5.png`,
    helicopter: `${ROOT}/frontier-helicopter-dormant-v5.png`,
    toyFlight: `${ROOT}/frontier-toy-flight-dormant-v5.png`,
    excursion: `${ROOT}/frontier-excursion-dormant-v5.png`,
    expedition: `${ROOT}/frontier-expedition-dormant-v5.png`,
    lock: `${ROOT}/frontier-lock.png`,
  },
  lostGround: {
    balloonMooring: `${ROOT}/lost-balloon-mooring.png`,
    lighterWagon: `${ROOT}/lost-lantern-lighter-wagon.png`,
    expeditionCamp: `${ROOT}/lost-expedition-camp.png`,
    abandonedHelipad: `${ROOT}/lost-abandoned-helipad.png`,
  },
  arsenal: {
    wheelFrame: `${ROOT}/arsenal-wheel-frame.png`,
    signalFlare: `${ROOT}/tool-signal-flare.png`,
    recallBell: `${ROOT}/tool-recall-bell.png`,
    courierSprite: `${ROOT}/tool-courier-sprite.png`,
    goldenSeal: `${ROOT}/tool-golden-seal.png`,
    cooldownRune: `${ROOT}/tool-cooldown-rune.png`,
  },
  commandDeck: {
    frame: `${ROOT}/command-dock-frame.png`,
    buttonIdle: `${ROOT}/command-button-idle.png`,
    buttonActive: `${ROOT}/command-button-active.png`,
  },
  hud: {
    todayQuest: `${ROOT}/today-quest-parchment.png`,
    mapLegend: `${ROOT}/map-legend-frame.png`,
    iconMap: `${ROOT}/icon-map.png`,
    iconMissions: `${ROOT}/icon-missions.png`,
    iconCompanions: `${ROOT}/icon-companions.png`,
    iconArsenal: `${ROOT}/icon-arsenal.png`,
    iconBuildings: `${ROOT}/icon-buildings.png`,
    iconConquest: `${ROOT}/icon-conquest.png`,
  },
} as const;

import type { FrontierObjectKind } from "@shared/lanternFrontierPresentation";
export type { FrontierObjectKind };
export {
  frontierKindForTerritory,
  FRONTIER_OBJECT_KINDS,
} from "@shared/lanternFrontierPresentation";

export function frontierAssetSrc(kind: FrontierObjectKind): string {
  return LANTERN_CITY_V5_ASSETS.frontier[kind];
}

export function lostGroundAssetForFrontierKind(kind: FrontierObjectKind): string {
  switch (kind) {
    case "balloon":
      return LANTERN_CITY_V5_ASSETS.lostGround.balloonMooring;
    case "helicopter":
      return LANTERN_CITY_V5_ASSETS.lostGround.abandonedHelipad;
    case "expedition":
    case "excursion":
      return LANTERN_CITY_V5_ASSETS.lostGround.expeditionCamp;
    default:
      return LANTERN_CITY_V5_ASSETS.lostGround.lighterWagon;
  }
}

/** Preload hero world + primary lantern art for first paint. */
export const LANTERN_CITY_V5_PRELOAD: readonly string[] = [
  LANTERN_CITY_V5_ASSETS.world.master,
  LANTERN_CITY_V5_ASSETS.lanterns.active,
  LANTERN_CITY_V5_ASSETS.lanterns.cooling,
  LANTERN_CITY_V5_ASSETS.lanterns.quiet,
  LANTERN_CITY_V5_ASSETS.frontier.lock,
];
