/**
 * Where every drawing sits on the approved sheets (pixel boxes on the 1536×1024 PNGs). Body poses are side views
 * facing left; heads are three-quarter portraits, used for the reaction inserts. Measured by scanning the sheets'
 * alpha for connected drawings, then checked by eye.
 */
export type Rect = [number, number, number, number];

export type Mood =
  | "neutral"
  | "suspicious"
  | "jealous"
  | "irritated"
  | "confused"
  | "delighted"
  | "afraid"
  | "tender"
  | "smug"
  | "sleepy"
  | "startled"
  | "guilty"
  | "curious"
  | "scared"
  | "trusting";

export type Sheet = {
  file: string;
  /** standing, then the walk cycle, then named poses */
  stand: Rect;
  walk: Rect[];
  poses: Record<string, Rect>;
  heads: Partial<Record<Mood, Rect>>;
  /** metres-ish: how tall the standing pose is in world units at depth 1 */
  height: number;
  /** where the mouth is on the standing pose, as a fraction of the box (for the tongue and the carried item) */
  mouth: [number, number];
};

export const TERRIER: Sheet = {
  file: "02-terrier-sheet",
  stand: [10, 153, 245, 220],
  walk: [
    [257, 157, 270, 216],
    [523, 170, 266, 200],
    [776, 163, 306, 182],
    [1047, 179, 225, 194],
    [1280, 170, 242, 198],
  ],
  poses: {
    sit: [29, 415, 217, 250],
    lie: [270, 560, 326, 104],
    crouch: [622, 547, 315, 114],
    sniff: [956, 446, 272, 227],
    jump: [1242, 412, 283, 225],
  },
  heads: {
    neutral: [8, 727, 216, 206],
    suspicious: [208, 733, 200, 200],
    jealous: [392, 736, 216, 196],
    irritated: [584, 732, 200, 201],
    confused: [768, 720, 208, 212],
    delighted: [968, 725, 200, 207],
    afraid: [1160, 753, 208, 180],
    tender: [1352, 736, 173, 197],
  },
  height: 105,
  mouth: [0.06, 0.38],
};

export const BOXER: Sheet = {
  file: "03-boxer-sheet",
  stand: [36, 106, 290, 243],
  walk: [
    [328, 125, 323, 224],
    [670, 129, 241, 220],
    [885, 131, 230, 217],
    [1084, 131, 232, 218],
    [1280, 130, 245, 219],
  ],
  poses: {
    sleep: [12, 533, 443, 139],
    carry: [441, 377, 345, 300],
    bark: [821, 398, 329, 284],
    charge: [1174, 452, 348, 231],
  },
  heads: {
    neutral: [19, 736, 196, 227],
    sleepy: [215, 736, 196, 227],
    confused: [411, 736, 197, 227],
    irritated: [592, 754, 195, 209],
    startled: [787, 754, 195, 209],
    guilty: [982, 754, 194, 209],
    delighted: [1168, 760, 192, 202],
    tender: [1352, 755, 173, 208],
  },
  height: 150,
  mouth: [0.08, 0.3],
};

export const CALF: Sheet = {
  file: "04-calf-sheet",
  stand: [20, 87, 310, 269],
  walk: [
    [337, 92, 339, 265],
    [638, 92, 326, 265],
    [945, 91, 316, 264],
    [1238, 91, 291, 265],
  ],
  poses: {
    run: [19, 414, 447, 230],
    lie: [503, 469, 283, 185],
    nuzzle: [802, 408, 350, 255],
    scared: [1185, 431, 324, 230],
  },
  heads: {
    curious: [20, 713, 242, 244],
    delighted: [283, 717, 232, 241],
    scared: [529, 718, 237, 240],
    sleepy: [770, 720, 246, 237],
    confused: [1021, 720, 259, 238],
    trusting: [1294, 723, 227, 235],
  },
  height: 150,
  mouth: [0.05, 0.3],
};

export const COYOTE: Sheet = {
  file: "12-coyote-sheet-alpha",
  stand: [34, 39, 382, 304],
  walk: [
    [360, 50, 408, 291],
    [736, 46, 416, 297],
    [1112, 46, 410, 298],
  ],
  poses: { slink: [37, 349, 395, 285], sit: [836, 358, 340, 275] },
  heads: { afraid: [38, 650, 336, 345], curious: [402, 650, 321, 347] },
  height: 150,
  mouth: [0.05, 0.3],
};

export type PropId =
  | "fountain"
  | "stairs"
  | "ball"
  | "stick"
  | "hedge"
  | "pots"
  | "gate"
  | "sluice"
  | "grass"
  | "beans"
  | "rope"
  | "tunnel"
  | "hole"
  | "ghost"
  | "hose"
  | "trough"
  | "hay"
  | "branch"
  | "can";
export const PROPS: Record<PropId, [string, Rect]> = {
  fountain: ["07-courtyard-near-alpha", [0, 0, 490, 440]],
  stairs: ["07-courtyard-near-alpha", [0, 470, 575, 530]],
  ball: ["07-courtyard-near-alpha", [610, 765, 210, 170]],
  stick: ["07-courtyard-near-alpha", [825, 775, 350, 170]],
  hedge: ["07-courtyard-near-alpha", [410, 25, 560, 230]],
  pots: ["07-courtyard-near-alpha", [920, 390, 300, 300]],
  gate: ["10-ranch-near-alpha", [0, 0, 925, 300]],
  sluice: ["10-ranch-near-alpha", [480, 265, 530, 375]],
  grass: ["10-ranch-near-alpha", [525, 635, 300, 335]],
  beans: ["10-ranch-near-alpha", [820, 640, 460, 330]],
  rope: ["10-ranch-near-alpha", [1260, 815, 275, 190]],
  tunnel: ["10-ranch-near-alpha", [970, 290, 565, 350]],
  hole: ["11-distortion-alpha", [0, 0, 1190, 585]],
  ghost: ["11-distortion-alpha", [975, 245, 560, 730]],
  // The Lost Creek: drawings already on the approved sheets, each one a single connected shape inside its box
  hose: ["07-courtyard-near-alpha", [1233, 477, 285, 210]],
  trough: ["10-ranch-near-alpha", [918, 52, 588, 246]],
  hay: ["10-ranch-near-alpha", [18, 354, 464, 236]],
  branch: ["10-ranch-near-alpha", [25, 624, 509, 303]],
  can: ["10-ranch-near-alpha", [1288, 615, 191, 190]],
};
