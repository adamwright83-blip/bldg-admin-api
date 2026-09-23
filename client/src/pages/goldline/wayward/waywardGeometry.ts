import type { Vec } from "./holdTheLine";

/** Walkable ground and staging points for the voyage, one place for scenes and collision maps. */

export const DECK_WALK: Vec[] = [
  { x: 212, y: 640 }, { x: 1330, y: 640 }, { x: 1090, y: 462 }, { x: 448, y: 462 },
];
export const CACHE_REACH: Vec[] = [
  { x: 232, y: 600 }, { x: 500, y: 600 }, { x: 482, y: 510 }, { x: 292, y: 502 },
];
export const HULL_CACHE: Vec = { x: 318, y: 546 };
/** Walk into the head of the broken span and the camera goes out to meet it. */
export const SPAN_TRIGGER = { minX: 732, maxX: 880, maxY: 470 };
export const DECK_SPAWN: Vec = { x: 760, y: 606 };
export const GUARDIAN: Vec = { x: 972, y: 468 };
export const GUARDIAN_HEIGHT = 205;
/** Glow points on the guardian plate (720×900), relative to its anchor. */
export const GUARDIAN_LIGHTS = [
  { x: 282, y: 104, r: 5 },
  { x: 262, y: 262, r: 9 },
  { x: 590, y: 440, r: 12 },
];


/** The clear planks between the lashed cargo and the broken edge, plus the strip in front of the coils. */
export const SHIP_WALK: Vec[] = [
  { x: 196, y: 444 }, { x: 330, y: 440 }, { x: 334, y: 394 }, { x: 560, y: 388 }, { x: 640, y: 398 },
  { x: 664, y: 414 }, { x: 652, y: 440 }, { x: 560, y: 452 }, { x: 420, y: 460 }, { x: 196, y: 462 },
];
export const SHIP_WALK_BROKEN: Vec[] = [
  { x: 196, y: 444 }, { x: 330, y: 440 }, { x: 334, y: 394 }, { x: 488, y: 390 }, { x: 496, y: 420 },
  { x: 486, y: 456 }, { x: 420, y: 460 }, { x: 196, y: 462 },
];
export const CITY_WALK: Vec[] = [
  { x: 952, y: 410 }, { x: 1040, y: 398 }, { x: 1200, y: 398 }, { x: 1470, y: 406 },
  { x: 1490, y: 440 }, { x: 1460, y: 478 }, { x: 1250, y: 482 }, { x: 1060, y: 470 }, { x: 975, y: 450 },
];
export const BOLLARD = { x: 1330, y: 430, rx: 44, ry: 17 };
export const ANCHOR_BOLLARD: Vec = { x: 150, y: 432 };
export const CLAMP_POINT: Vec = { x: 1092, y: 418 };


export const SAIL_WALK: Vec[] = [
  { x: 300, y: 646 }, { x: 1236, y: 646 }, { x: 1060, y: 470 }, { x: 488, y: 470 },
];
export const BOW_POINT: Vec = { x: 772, y: 478 };
export const SAIL_SPAWN: Vec = { x: 742, y: 590 };

