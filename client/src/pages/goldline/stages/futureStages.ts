import type { OverworldMapDefinition } from "../overworld/types";
import type { GoldlineStageDefinition } from "./stageDefinition";

const WAYWARD_MAP: OverworldMapDefinition = {
  id: "wayward-tethered-deck", version: 1, width: 1536, height: 658,
  defaultSpawnId: "near-deck",
  spawns: { "near-deck": { x: 760, y: 585, surfaceId: "near-deck" } },
  surfaces: [
    { id: "near-deck", material: "wood", polygon: [
      { x: 205, y: 640 }, { x: 1335, y: 640 }, { x: 1090, y: 455 }, { x: 445, y: 455 },
    ] },
    { id: "left-cache-reach", material: "wood", polygon: [
      { x: 230, y: 600 }, { x: 500, y: 600 }, { x: 480, y: 510 }, { x: 290, y: 500 },
    ] },
    { id: "upper-tether", material: "wood", polygon: [
      { x: 670, y: 405 }, { x: 866, y: 405 }, { x: 824, y: 285 }, { x: 712, y: 285 },
    ] },
  ],
  corridors: [
    { id: "cache-side-route", material: "wood", halfWidth: 44, points: [
      { x: 500, y: 560 }, { x: 400, y: 555 }, { x: 315, y: 545 },
    ] },
  ],
  occluders: [
    { id: "left-rope-and-crates", polygon: [
      { x: 0, y: 390 }, { x: 500, y: 440 }, { x: 470, y: 658 }, { x: 0, y: 658 },
    ] },
    { id: "right-rigging-and-rail", polygon: [
      { x: 1100, y: 435 }, { x: 1536, y: 390 }, { x: 1536, y: 658 }, { x: 1060, y: 658 },
    ] },
  ],
  destinations: [
    { id: "tether-guardian", name: "TETHER GUARDIAN", subtitle: "Stone, bronze and generations of rope law", point: { x: 925, y: 505 }, approachRadius: 105, entranceRadius: 56, action: "inspect" },
    { id: "forbidden-hull-cache", name: "FORBIDDEN HULL CACHE", subtitle: "A seam is waking beneath the rope", point: { x: 315, y: 545 }, approachRadius: 115, entranceRadius: 48, action: "inspect" },
    { id: "wayward-linehook", name: "BROKEN SPAN", subtitle: "The deck ends here. Cast Linehook into the tether ring.", point: { x: 768, y: 442 }, approachRadius: 105, entranceRadius: 50, action: "traverse", traversalId: "linehook-pull" },
    { id: "mooring-city-barrier", name: "MOORING CITY", subtitle: "The outer tether is still sealed", point: { x: 768, y: 330 }, approachRadius: 85, entranceRadius: 38, action: "enter" },
  ],
  traversals: [{
    id: "linehook-pull", label: "LINEHOOK", entry: { x: 768, y: 442 }, entryRadius: 50,
    path: [{ x: 768, y: 442 }, { x: 758, y: 421 }, { x: 776, y: 384 }, { x: 768, y: 350 }],
    exitSurfaceId: "upper-tether",
  }],
};

export const WAYWARD_APPROACH_STAGE: GoldlineStageDefinition = {
  map: WAYWARD_MAP,
  presentation: {
    referenceAsset: "bridge_to_the_floating_sky_fortress.png",
    backgroundAsset: "/assets/goldline/wayward/bridge-to-mooring-city.webp",
    provisionalArt: false,
    playerHeight: 178,
    foregroundMasks: WAYWARD_MAP.occluders.map(region => ({ ...region, source: "/assets/goldline/wayward/ship-deck-foreground.webp" })),
    environmentLayers: [
      {
        id: "awakening-ship-deck",
        imageUrl: "/assets/goldline/wayward/awakening-ship-deck.webp",
        zIndex: 20,
        phaseAlpha: { dormant: 0, waking: 0.48, active: 0.92 },
        behavior: "state-crossfade",
        offsetY: -105,
      },
      {
        id: "ship-deck-foreground",
        imageUrl: "/assets/goldline/wayward/ship-deck-foreground.webp",
        zIndex: 9000,
        phaseAlpha: { dormant: 1, waking: 1, active: 1 },
        behavior: "foreground-parallax",
        parallaxFactor: 0.018,
      },
    ],
    entityAssets: {
      "tether-guardian": "/assets/goldline/wayward/tether-guardian.webp",
      "wayward-linehook": "/assets/goldline/wayward/broken-span-tether-ring.webp",
    },
    liveEntityIds: ["trailblazer", "tether-guardian", "wayward-linehook", "forbidden-hull-cache", "gold-line", "awakening-ship-deck"],
    depth: { nearY: 600, farY: 250, nearScale: 1.08, farScale: 0.62, farSpeedFactor: 0.84 },
    camera: { zoom: 1.18, damping: 0.12, lookAheadSeconds: 0.15, start: { x: 760, y: 585 } },
  },
};

/** Compatibility-only contract. Crystal gameplay remains PR2. */
export const CRYSTAL_CHASM_STAGE: GoldlineStageDefinition = {
  map: {
    id: "crystal-chasm", version: 1, width: 1916, height: 821, defaultSpawnId: "lower-shelf",
    spawns: { "lower-shelf": { x: 690, y: 750, surfaceId: "lower-shelf" } },
    surfaces: [{ id: "lower-shelf", material: "crystal", polygon: [
      { x: 220, y: 810 }, { x: 1180, y: 810 }, { x: 1030, y: 640 }, { x: 390, y: 625 },
    ] }],
    corridors: [{ id: "fractured-central-path", material: "crystal", halfWidth: 82, points: [
      { x: 780, y: 650 }, { x: 850, y: 540 }, { x: 920, y: 430 }, { x: 955, y: 330 },
    ] }],
    occluders: [], destinations: [], traversals: [],
  },
  presentation: {
    referenceAsset: "d9174aa3-4cc6-4ea3-9fa1-b1823f5a72ad.png", backgroundAsset: null, provisionalArt: true,
    playerHeight: 150, foregroundMasks: [], environmentLayers: [], entityAssets: {},
    liveEntityIds: ["trailblazer", "prism-regent", "crystal-anchors", "trace", "recall"],
    depth: { nearY: 790, farY: 315, nearScale: 1, farScale: 0.5, farSpeedFactor: 0.78 },
    camera: { zoom: 1.8, damping: 0.1, lookAheadSeconds: 0.14, start: { x: 690, y: 750 } },
  },
};

export const FUTURE_GOLDLINE_STAGES = [WAYWARD_APPROACH_STAGE, CRYSTAL_CHASM_STAGE] as const;
