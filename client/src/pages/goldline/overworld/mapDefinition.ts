import type {
  OverworldMapDefinition,
  OverworldPoint,
  WalkableSurface,
} from "./types";

function ellipse(
  id: string,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  material: WalkableSurface["material"] = "stone",
  count = 16
): WalkableSurface {
  const polygon: OverworldPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    polygon.push({
      x: cx + Math.cos(angle) * rx,
      y: cy + Math.sin(angle) * ry,
    });
  }
  return { id, material, polygon };
}

/**
 * Authored against goldline-overworld-clean.png (848×1854). The artwork is
 * presentation; this definition is the physical world. New art cannot silently
 * change geography without also changing this versioned contract.
 */
export const GOLDLINE_OVERWORLD_MAP: OverworldMapDefinition = {
  id: "goldline-global-overworld",
  version: 3,
  width: 848,
  height: 1854,
  defaultSpawnId: "noticeboard",
  spawns: {
    noticeboard: { x: 126, y: 1690, surfaceId: "noticeboard-terrace" },
    greystarEntrance: { x: 422, y: 906, surfaceId: "greystar-apron" },
  },
  surfaces: [
    {
      id: "noticeboard-terrace",
      material: "stone",
      polygon: [
        { x: 0, y: 1854 },
        { x: 0, y: 1665 },
        { x: 62, y: 1580 },
        { x: 143, y: 1508 },
        { x: 206, y: 1420 },
        { x: 265, y: 1440 },
        { x: 225, y: 1515 },
        { x: 170, y: 1585 },
        { x: 154, y: 1705 },
        { x: 194, y: 1854 },
      ],
    },
    ellipse("lower-crossroads", 206, 1450, 55, 48, "grass"),
    ellipse("dry-cleaner-settlement", 116, 1165, 118, 188, "wood", 20),
    ellipse("greystar-apron", 423, 890, 154, 132, "stone", 20),
    ellipse("relic-vault", 459, 1248, 112, 100, "crystal"),
    ellipse("training-grounds", 703, 1470, 128, 152, "wood"),
    ellipse("oasis-market", 708, 1010, 119, 170, "grass"),
    ellipse("heavenstalk-base", 424, 620, 143, 116, "grass"),
    ellipse("treehollow", 126, 390, 112, 124, "wood"),
    ellipse("horizon-sail", 707, 334, 112, 112, "wood"),
  ],
  corridors: [
    {
      id: "noticeboard-climb",
      material: "stone",
      halfWidth: 43,
      points: [
        { x: 126, y: 1690 },
        { x: 112, y: 1580 },
        { x: 168, y: 1490 },
        { x: 219, y: 1438 },
      ],
    },
    {
      id: "lower-to-dry-cleaner",
      material: "stone",
      halfWidth: 34,
      points: [
        { x: 190, y: 1465 },
        { x: 133, y: 1370 },
        { x: 112, y: 1260 },
        { x: 116, y: 1165 },
      ],
    },
    {
      id: "greystar-rope-bridge",
      material: "wood",
      halfWidth: 23,
      centerAssist: 0.2,
      points: [
        { x: 154, y: 1105 },
        { x: 225, y: 1060 },
        { x: 303, y: 1018 },
        { x: 360, y: 975 },
        { x: 398, y: 925 },
        { x: 422, y: 890 },
      ],
    },
    {
      id: "relic-bridge",
      material: "wood",
      halfWidth: 20,
      centerAssist: 0.22,
      points: [
        { x: 238, y: 1425 },
        { x: 318, y: 1378 },
        { x: 383, y: 1320 },
        { x: 459, y: 1248 },
      ],
    },
    {
      id: "training-bridge",
      material: "wood",
      halfWidth: 22,
      centerAssist: 0.2,
      points: [
        { x: 220, y: 1492 },
        { x: 260, y: 1510 },
        { x: 390, y: 1550 },
        { x: 520, y: 1565 },
        { x: 625, y: 1515 },
        { x: 703, y: 1470 },
      ],
    },
    {
      id: "greystar-oasis-bridge",
      material: "wood",
      halfWidth: 21,
      centerAssist: 0.2,
      points: [
        { x: 520, y: 940 },
        { x: 600, y: 973 },
        { x: 655, y: 997 },
        { x: 708, y: 1010 },
      ],
    },
    {
      id: "greystar-heavenstalk-stairs",
      material: "stone",
      halfWidth: 31,
      points: [
        { x: 423, y: 805 },
        { x: 412, y: 742 },
        { x: 418, y: 675 },
        { x: 424, y: 620 },
      ],
    },
    {
      id: "treehollow-bridge",
      material: "wood",
      halfWidth: 19,
      centerAssist: 0.24,
      points: [
        { x: 325, y: 615 },
        { x: 260, y: 560 },
        { x: 202, y: 500 },
        { x: 150, y: 430 },
        { x: 126, y: 390 },
      ],
    },
    {
      id: "horizon-tether",
      material: "wood",
      halfWidth: 18,
      centerAssist: 0.28,
      points: [
        { x: 532, y: 610 },
        { x: 590, y: 535 },
        { x: 637, y: 452 },
        { x: 680, y: 375 },
        { x: 707, y: 334 },
      ],
    },
  ],
  destinations: [
    {
      id: "greystar-6",
      name: "GREYSTAR 6",
      subtitle: "Colosseum Mission",
      point: { x: 422, y: 906 },
      approachRadius: 96,
      entranceRadius: 34,
      action: "enter",
    },
    {
      id: "dry-cleaner-hunt",
      name: "DRY CLEANER HUNT",
      subtitle: "Next Lead Mission",
      point: { x: 105, y: 1110 },
      approachRadius: 76,
      entranceRadius: 42,
      action: "inspect",
    },
    {
      id: "relic-vault",
      name: "RELIC VAULT",
      subtitle: "Upgrades & Relics",
      point: { x: 459, y: 1205 },
      approachRadius: 78,
      entranceRadius: 42,
      action: "inspect",
    },
    {
      id: "training-grounds",
      name: "TRAINING GROUNDS",
      subtitle: "Daily XP",
      point: { x: 700, y: 1410 },
      approachRadius: 82,
      entranceRadius: 45,
      action: "inspect",
    },
    {
      id: "oasis-market",
      name: "OASIS MARKET",
      subtitle: "Resources & Tools",
      point: { x: 704, y: 950 },
      approachRadius: 78,
      entranceRadius: 45,
      action: "inspect",
    },
    {
      id: "heavenstalk",
      name: "HEAVENSTALK",
      subtitle: "Ascend to New Heights",
      point: { x: 425, y: 566 },
      approachRadius: 84,
      entranceRadius: 46,
      action: "traverse",
      traversalId: "heavenstalk-climb",
    },
    {
      id: "treehollow",
      name: "TREEHOLLOW",
      subtitle: "Hidden Opportunities",
      point: { x: 112, y: 348 },
      approachRadius: 75,
      entranceRadius: 42,
      action: "traverse",
      traversalId: "treehollow-drop",
    },
    {
      id: "horizon-sail",
      name: "THE HORIZON SAIL",
      subtitle: "High Value Accounts",
      point: { x: 710, y: 288 },
      approachRadius: 80,
      entranceRadius: 45,
      action: "traverse",
      traversalId: "horizon-board",
    },
  ],
  traversals: [
    {
      id: "heavenstalk-climb",
      label: "CLIMB",
      entry: { x: 425, y: 566 },
      entryRadius: 46,
      path: [
        { x: 425, y: 566 },
        { x: 425, y: 500 },
        { x: 426, y: 445 },
      ],
      exitSurfaceId: "heavenstalk-base",
    },
    {
      id: "treehollow-drop",
      label: "DROP",
      entry: { x: 112, y: 348 },
      entryRadius: 42,
      path: [
        { x: 112, y: 348 },
        { x: 118, y: 375 },
        { x: 126, y: 390 },
      ],
      exitSurfaceId: "treehollow",
    },
    {
      id: "horizon-board",
      label: "BOARD",
      entry: { x: 710, y: 288 },
      entryRadius: 45,
      path: [
        { x: 710, y: 288 },
        { x: 706, y: 310 },
        { x: 707, y: 334 },
      ],
      exitSurfaceId: "horizon-sail",
    },
  ],
  occluders: [
    {
      id: "noticeboard-foreground",
      polygon: [
        { x: 0, y: 1710 },
        { x: 260, y: 1660 },
        { x: 280, y: 1854 },
        { x: 0, y: 1854 },
      ],
    },
    {
      id: "treehollow-canopy",
      polygon: [
        { x: 0, y: 0 },
        { x: 265, y: 0 },
        { x: 240, y: 340 },
        { x: 0, y: 470 },
      ],
    },
    {
      id: "greystar-front-wall-left",
      polygon: [
        { x: 270, y: 810 },
        { x: 382, y: 810 },
        { x: 382, y: 920 },
        { x: 305, y: 920 },
      ],
    },
    {
      id: "greystar-front-wall-right",
      polygon: [
        { x: 465, y: 810 },
        { x: 575, y: 810 },
        { x: 550, y: 920 },
        { x: 465, y: 920 },
      ],
    },
  ],
};
