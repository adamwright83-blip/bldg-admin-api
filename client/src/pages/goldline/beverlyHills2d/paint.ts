/**
 * The painter. What makes a cutout belong to a painting: it stands on the painting's own ground (a depth band, not a
 * line), it scales with depth, it is drawn in depth order with the props, its shadow falls the way the painting's
 * shadows fall (upper-left sun, hard violet shadow to the lower right), it takes a little of the scene's light, and
 * something painted stands in front of it. Then the acting: breathing, a walk cycle that stays a walk, a squash on
 * landing, and reaction portraits from the sheets' expression rows when something happens between the animals.
 *
 * The Lost Creek is one scrolling world: the courtyard painting from x 0 to 1900, a torn-paper seam, the ranch
 * painting from 1900 to 3800. The water is painted in code on top of the paintings, feathered so it has no ruled edge,
 * and its glints drift the way it is flowing.
 */
import { BOXER, CALF, PROPS, TERRIER, type Mood, type PropId, type Rect, type Sheet } from "./cells";
import { HOME_WIDTH, LEDGE_DROP, LEDGE_RANGE, R, SEAM, SPOTS, VIEW, fordEdges, groundBand, inWater, side, troughDeck, type Adventure, type Chapter } from "./adventure";

export const ASSET_BASE = "/assets/goldline/beverly-hills-2d/";
const FILES = ["02-terrier-sheet", "03-boxer-sheet", "04-calf-sheet", "05-courtyard-far", "06-courtyard-mid", "07-courtyard-near-alpha", "08-ranch-far", "09-ranch-mid", "10-ranch-near-alpha", "11-distortion-alpha", "12-coyote-sheet-alpha", "13-overlap"];
export type Art = Record<string, HTMLImageElement>;
export async function loadArt(onProgress: (n: number) => void): Promise<Art> {
  let n = 0;
  const entries = await Promise.all(
    FILES.map(
      name =>
        new Promise<[string, HTMLImageElement]>((resolve, reject) => {
          const im = new Image();
          im.onload = () => {
            onProgress(++n / FILES.length);
            resolve([name, im]);
          };
          im.onerror = () => reject(new Error(`Could not load ${name}`));
          im.src = `${ASSET_BASE}${name}.png`;
        })
    )
  );
  return Object.fromEntries(entries);
}

export const H = 800;
/** one painting is 1900 world px wide (the paintings are 1536 px; the Round-Up's field is one painting) */
export const PAINT_SCALE = 1900 / 1536;
export const PAINT_Y = -363;

// ------------------------------------------------------------------ sheet cells as clean sprites
// Each cell is cut once into its own canvas, clipped to its largest connected shape so a neighbouring drawing's
// nose never comes along, with the sun's warmth and a touch of the scene's colour multiplied in.
const cut = new Map<string, HTMLCanvasElement>();
export function sprite(art: Art, file: string, r: Rect): HTMLCanvasElement {
  const key = `${file}|${r.join(",")}`;
  const hit = cut.get(key);
  if (hit) return hit;
  const [x, y, w, h] = r;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.drawImage(art[file], x, y, w, h, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const seen = new Uint8Array(w * h);
  let best: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || d[i * 4 + 3] < 24) continue;
    const grp = [i];
    seen[i] = 1;
    for (let j = 0; j < grp.length; j++) {
      const n = grp[j], px = n % w;
      for (const m of [px > 0 ? n - 1 : -1, px < w - 1 ? n + 1 : -1, n - w, n + w]) if (m >= 0 && m < w * h && !seen[m] && d[m * 4 + 3] >= 24) {
        seen[m] = 1;
        grp.push(m);
      }
    }
    if (grp.length > best.length) best = grp;
  }
  const keep = new Uint8Array(w * h);
  for (const n of best) keep[n] = 1;
  for (let i = 0; i < w * h; i++) if (!keep[i]) d[i * 4 + 3] = 0;
  g.putImageData(img, 0, 0);
  cut.set(key, c);
  return c;
}

// ------------------------------------------------------------------ the ground
/** the ground under world x at depth d: the courtyard's band, the ranch's, lerped across the seam */
const groundY = (x: number, d: number, ch: Chapter = "creek") => {
  const [top, bottom] = groundBand(x, ch);
  return top + d * (bottom - top);
};
export const depthScale = (d: number) => 0.62 + 0.42 * d;

/** a hard-edged violet shadow cast to the lower right, the way every shadow in the paintings is cast */
export function shadow(c: CanvasRenderingContext2D, x: number, y: number, w: number, lift: number, alpha = 0.34) {
  c.save();
  c.translate(x + w * 0.16 + lift * 0.3, y + 2);
  c.scale(1, 0.26);
  c.fillStyle = `rgba(74, 44, 120, ${alpha * Math.max(0, 1 - lift / 300)})`;
  c.beginPath();
  c.ellipse(0, 0, w * 0.5, w * 0.5, -0.18, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

type Drawn = { d: number; draw: () => void };

const tints = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
function tinted(sp: HTMLCanvasElement, tint: string): HTMLCanvasElement {
  let byTint = tints.get(sp);
  if (!byTint) tints.set(sp, (byTint = new Map()));
  const hit = byTint.get(tint);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = sp.width;
  c.height = sp.height;
  const g = c.getContext("2d")!;
  g.drawImage(sp, 0, 0);
  g.globalCompositeOperation = "source-atop";
  g.fillStyle = tint;
  g.fillRect(0, 0, c.width, c.height);
  byTint.set(tint, c);
  return c;
}

export function drawSprite(c: CanvasRenderingContext2D, art: Art, sheet: Sheet, r: Rect, x: number, y: number, scale: number, face: 1 | -1, opt: { breathe?: number; squash?: number; tint?: string; alpha?: number; tongue?: number; time?: number } = {}) {
  const sp = sprite(art, sheet.file, r);
  const w = r[2] * scale, h = r[3] * scale;
  c.save();
  c.globalAlpha = opt.alpha ?? 1;
  c.translate(x, y);
  // the body breathes: a slow stretch from the feet; a landing squashes it. The sheets face left, so facing
  // right (face 1) is the mirror image.
  const sq = opt.squash ?? 0, br = opt.breathe ?? 0;
  c.scale((1 + sq * 0.12) * -face, 1 - sq * 0.1 + br);
  // the warm light is baked into a copy of the sprite, never washed over the canvas: a source-atop fill on the
  // stage would paint a pale box over the painting behind the animal
  c.drawImage(opt.tint ? tinted(sp, opt.tint) : sp, -w / 2, -h, w, h);
  // a panting tongue that swings with the trot
  if (opt.tongue) {
    const t = opt.time ?? 0;
    const mx = -w / 2 + sheet.mouth[0] * w + w * 0.05, my = -h + sheet.mouth[1] * h + h * 0.06;
    const len = h * 0.13 * opt.tongue;
    c.translate(mx, my);
    c.rotate(0.25 + Math.sin(t * 15) * 0.28);
    c.fillStyle = "#e0566e";
    c.beginPath();
    c.moveTo(-len * 0.18, 0);
    c.lineTo(len * 0.18, 0);
    c.quadraticCurveTo(len * 0.26, len * 0.9, 0, len);
    c.quadraticCurveTo(-len * 0.26, len * 0.9, -len * 0.18, 0);
    c.fill();
    c.strokeStyle = "rgba(140, 30, 60, 0.6)";
    c.lineWidth = Math.max(1, len * 0.06);
    c.beginPath();
    c.moveTo(0, len * 0.15);
    c.lineTo(0, len * 0.7);
    c.stroke();
  }
  c.restore();
}

export function propSprite(art: Art, id: PropId) {
  const [file, r] = PROPS[id];
  return { sp: sprite(art, file, r), r };
}

// ------------------------------------------------------------------ the frame
export type Frame = {
  cam: number;
  moving: boolean;
  reduced: boolean;
  restored: number;
  /** the picture of the previous scene, for the tear */
  snapshot: HTMLCanvasElement | null;
  /** wall-clock seconds, for the things that keep moving after the story stops (petals, breathing) */
  clock: number;
};

/** a flood, painted once per shape: three feathered layers, faded in at the top so it has no ruled edge */
const floods = new Map<string, HTMLCanvasElement>();
function floodLayer(x0: number, x1: number, top: number, bot: number) {
  const key = `${x0},${x1},${top},${bot}`;
  const hit = floods.get(key);
  if (hit) return hit;
  const ox = x0 - 120, oy = top - 40;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(x1 - x0 + 240);
  canvas.height = Math.ceil(bot - oy);
  const g = canvas.getContext("2d")!;
  g.translate(-ox, -oy);
  const layer = (pad: number, alpha: number, rgb: string) => {
    const lg = g.createLinearGradient(x0 - 60 - pad, 0, x1 + 60 + pad, 0);
    lg.addColorStop(0, `rgba(${rgb}, 0)`);
    lg.addColorStop(0.22, `rgba(${rgb}, ${alpha})`);
    lg.addColorStop(0.78, `rgba(${rgb}, ${alpha})`);
    lg.addColorStop(1, `rgba(${rgb}, 0)`);
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(x0 - pad, top - 20);
    g.lineTo(x1 + pad, top - 20);
    g.lineTo(x1 + 60 + pad, bot);
    g.lineTo(x0 - 60 - pad, bot);
    g.fill();
  };
  layer(30, 0.22, "70, 52, 70");
  layer(0, 0.48, "84, 160, 200");
  layer(-30, 0.3, "160, 220, 232");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "destination-in";
  const fade = g.createLinearGradient(0, 0, 0, 90);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(0,0,0,1)");
  g.fillStyle = fade;
  g.fillRect(0, 0, canvas.width, canvas.height);
  floods.set(key, canvas);
  return canvas;
}
/** a flood at a level; `skew` slides its bottom edge sideways so it lies along a diagonal creek bed */
function drawFlood(c: CanvasRenderingContext2D, alpha: number, x0: number, x1: number, top: number, bot: number, skew = 0) {
  if (alpha <= 0.01) return;
  c.save();
  c.globalAlpha = Math.min(1, alpha);
  const k = skew / (bot - top);
  c.transform(1, 0, k, 1, -k * top, 0);
  c.drawImage(floodLayer(x0, x1, top, bot), x0 - 120, top - 40);
  c.restore();
}

/** glints on moving water: they drift along `dir` (from → to) while it flows, and only shimmer while it is still */
function glints(c: CanvasRenderingContext2D, t: number, n: number, alpha: number, at: (along: number, across: number) => [number, number], flow: number, size = 1) {
  if (alpha <= 0.02) return;
  c.save();
  c.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const base = (i * 0.137) % 1;
    const k = (((base + t * 0.09 * flow) % 1) + 1) % 1;
    const across = 0.15 + ((i * 0.618) % 0.7);
    const [x, y] = at(k, across);
    const a = Math.max(0, Math.sin(k * Math.PI) * (0.45 + 0.45 * Math.sin(t * 3 + i * 1.7))) * alpha;
    c.strokeStyle = `rgba(255, 252, 236, ${a * 0.85})`;
    c.lineWidth = (1.4 + k * 1.4) * size;
    c.beginPath();
    c.moveTo(x - 7 * size, y);
    c.lineTo(x + 7 * size, y);
    c.stroke();
  }
  c.restore();
}

// ------------------------------------------------------------------ the hole the pasture fell into
const HOLE_W = 390;
/** where the hole sits on screen (world x): its sprite box, the ellipse of its opening, and depths inside it */
function holeBox(art: Art) {
  const { sp, r } = propSprite(art, "hole");
  const w = HOLE_W, h = (w * r[3]) / r[2];
  const lip = groundY(SPOTS.hole.x, 0.3);
  const top = lip - h * 0.82;
  const x = SPOTS.hole.x - w * 0.504;
  const back = top + h * 0.22;
  // sim px below the rim → screen y inside the hole (the deeper, the nearer the front lip)
  const inside = (below: number) => back + 0.55 * below;
  return { sp, x, top, w, h, back, inside, cx: SPOTS.hole.x, cy: top + h * 0.5, rx: w * 0.31, ry: h * 0.25 };
}

/** where the calf's feet are on screen: on the ground, or (lift < 0) somewhere inside the hole */
function calfFeet(art: Art, s: Adventure) {
  const k = s.calf;
  if (k.lift >= 0) return groundY(k.x, k.d) - k.lift;
  const hb = holeBox(art);
  const inHole = hb.inside(-k.lift);
  // climbing out onto the rim: from inside the hole up to the ground at the landing
  const rim = groundY(k.x, k.d);
  const out = Math.max(0, Math.min(1, (k.d - SPOTS.ledge.d) / (SPOTS.rim.d - SPOTS.ledge.d)));
  return inHole + (rim - inHole) * out;
}

// ------------------------------------------------------------------ the home painting, with the sleeping three lifted out until the end
const HOME_Y = -27;
const HOME_SCALE = VIEW / 1536;
/** where the painted three lie (image px on the overlap painting): feet centre, and how wide each is drawn */
const PAINTED_THREE = { terrier: [440, 790, 440], calf: [760, 770, 330], boxer: [1120, 780, 420] } as const;
/** the box on the overlap painting (image px) the clean floor is cloned over: x, y, w, h */
const PATCH = [40, 520, 1480, 350] as const;
let sleeperPatch: HTMLCanvasElement | null = null;
/** the floor just in front of the sleeping three, cloned up over them (their own painting's pixels, feathered) */
function patchOverSleepers(art: Art) {
  if (sleeperPatch) return sleeperPatch;
  const [w, h] = PATCH.slice(2);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  // the clean floor below them (image rows 812 to the bottom), stretched up over where they lie
  g.drawImage(art["13-overlap"], PATCH[0], 812, w, 1024 - 812, 0, 0, w, h);
  // feathered on all four sides with a wide flat middle, so no edge of the sleepers shows through
  g.globalCompositeOperation = "destination-in";
  const across = g.createLinearGradient(0, 0, w, 0);
  across.addColorStop(0, "rgba(0,0,0,0)");
  across.addColorStop(0.05, "rgba(0,0,0,1)");
  across.addColorStop(0.95, "rgba(0,0,0,1)");
  across.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = across;
  g.fillRect(0, 0, w, h);
  const down = g.createLinearGradient(0, 0, 0, h);
  down.addColorStop(0, "rgba(0,0,0,0)");
  down.addColorStop(0.16, "rgba(0,0,0,1)");
  down.addColorStop(0.9, "rgba(0,0,0,1)");
  down.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = down;
  g.fillRect(0, 0, w, h);
  sleeperPatch = c;
  return c;
}

export function paint(c: CanvasRenderingContext2D, art: Art, s: Adventure, f: Frame) {
  const t = f.reduced ? 0 : f.clock;
  c.clearRect(0, 0, VIEW, H);
  if (s.chapter === "home") {
    paintHome(c, art, s, f, t);
    tear(c, s, f);
    return;
  }
  const seamX = SEAM - f.cam;
  const tintAt = (x: number) => (x < SEAM ? "rgba(255, 214, 150, 0.1)" : "rgba(255, 196, 90, 0.12)");
  const flow = f.reduced ? 0 : s.hose && s.water.F > 0 ? 1 : s.water.trend > 0 ? -1 : 0;

  // far: sky and the far distance, slow parallax, each era behind its own half of the seam
  c.fillStyle = seamX > VIEW / 2 ? "#6ab9e7" : "#5bace3";
  c.fillRect(0, 0, VIEW, H);
  if (seamX > 0) {
    c.save();
    c.beginPath();
    c.rect(0, 0, seamX, H);
    c.clip();
    c.drawImage(art["05-courtyard-far"], -f.cam * 0.12, -140, 1600, 1067);
    c.restore();
  }
  if (seamX < VIEW) {
    c.save();
    c.beginPath();
    c.rect(Math.max(0, seamX), 0, VIEW, H);
    c.clip();
    c.drawImage(art["08-ranch-far"], -(f.cam - SEAM) * 0.12 - 60, -140, 1600, 1067);
    c.restore();
  }
  // the two paintings: the sets themselves, scrolling with the world (their ground is the ground)
  if (seamX > 0) c.drawImage(art["06-courtyard-mid"], -f.cam, PAINT_Y, 1536 * PAINT_SCALE, 1024 * PAINT_SCALE);
  if (seamX < VIEW) c.drawImage(art["09-ranch-mid"], seamX, PAINT_Y, 1536 * PAINT_SCALE, 1024 * PAINT_SCALE);

  c.save();
  c.translate(-f.cam, 0);
  // the water lies on the ground, under everything that stands on it
  paintWater(c, s, t, flow);
  seam(c, t);

  const list: Drawn[] = [];
  const prop = (id: PropId, x: number, d: number, w: number, opt: { alpha?: number; sway?: number; yOff?: number; lift?: number; order?: number } = {}) => {
    const { sp, r } = propSprite(art, id);
    const sc = depthScale(d);
    const ww = w * sc, hh = (ww * r[3]) / r[2];
    const y = groundY(x, d) + (opt.yOff ?? 0);
    list.push({
      d: opt.order ?? d,
      draw: () => {
        c.save();
        c.globalAlpha = opt.alpha ?? 1;
        if (opt.lift) shadow(c, x, y, ww * 0.8, opt.lift, 0.3);
        const sx = opt.sway ? Math.sin(t * 1.3 + x) * opt.sway : 0;
        c.transform(1, 0, sx, 1, 0, 0);
        c.drawImage(sp, x - ww / 2 - sx * y, y - hh - (opt.lift ?? 0), ww, hh);
        c.restore();
      },
    });
  };
  const animal = (sheet: Sheet, r: Rect, x: number, d: number, face: 1 | -1, lift: number, opt: { breathe?: number; squash?: number; alpha?: number; scaleMul?: number; tintOverride?: string; tongue?: number; feet?: number; order?: number } = {}) => {
    const sc = depthScale(d) * (sheet.height / sheet.stand[3]) * (opt.scaleMul ?? 1);
    const y = opt.feet ?? groundY(x, d);
    list.push({
      d: opt.order ?? d + 0.001,
      draw: () => {
        shadow(c, x, y, r[2] * sc * 0.9, lift, opt.alpha === undefined ? 0.34 : opt.alpha * 0.34);
        drawSprite(c, art, sheet, r, x, y - lift, sc, face, { breathe: opt.breathe, squash: opt.squash, tint: opt.tintOverride ?? tintAt(x), alpha: opt.alpha, tongue: opt.tongue, time: t });
      },
    });
  };
  const walkFrame = (sheet: Sheet, rate: number) => sheet.walk[Math.floor(t * rate) % sheet.walk.length];
  const breathe = (phase: number) => Math.sin(t * 2.1 + phase) * 0.012;

  // ---- 2026: the courtyard
  prop("hedge", SPOTS.hedge.x, SPOTS.hedge.d, 300);
  prop("fountain", SPOTS.fountain.x, SPOTS.fountain.d, 330);
  list.push({ d: SPOTS.fountain.d + 0.002, draw: () => fountainWater(c, art, s, t) });
  prop("hose", SPOTS.hose.x, SPOTS.hose.d, 110);
  prop("pots", SPOTS.pots.x, SPOTS.pots.d, 160);
  prop("stairs", SPOTS.stairs.x, SPOTS.stairs.d, 380, { yOff: 26 });
  prop("hedge", 70, 1.1, 300);
  prop("pots", 1280, 1.1, 190);
  if (s.flags.rescued) {
    // something followed you back: the oak limb across the doorway, beans and grass spilling from the seam
    prop("branch", SPOTS.branch.x, SPOTS.branch.d, 320);
    for (let i = 0; i < 4; i++) prop("beans", SEAM - 70 - i * 95, 0.15 + i * 0.07, 100 - i * 12, { alpha: 1 - i * 0.12 });
    for (let i = 0; i < 3; i++) prop("grass", SEAM - 40 - i * 130, 0.62 + i * 0.12, 120, { sway: 0.03 });
  }

  // ---- the 1890s: the ranch
  prop("tunnel", SPOTS.culvert.x, SPOTS.culvert.d, 260, { yOff: 30 });
  prop("sluice", SPOTS.sluice.x, SPOTS.sluice.d, 240, { yOff: 20 });
  prop("hay", SPOTS.hay.x, SPOTS.hay.d, 150);
  prop("can", s.can.x, s.can.d, 46);
  for (let i = 0; i < f.restored; i++) prop("beans", R + 300 + i * 80, 0.08, 110);
  animal(CALF, CALF.poses.lie, SPOTS.cow.x, SPOTS.cow.d, -1, 0, { scaleMul: 1.05, alpha: 0.92, breathe: breathe(1240), tintOverride: "rgba(255, 190, 90, 0.2)" });
  list.push({ d: 0.29, draw: () => paintHole(c, art, s, t) });
  for (let x = R + 80; x < R + 1900; x += 300) prop("grass", x, 1.05 + ((x / 300) % 2) * 0.03, 170, { sway: 0.03 });

  // ---- the ball on the ground, or in the air (its shadow stays on the ground)
  const toy = s.toy;
  if (toy && toy.phase !== "drain") {
    const bob = toy.phase === "drift" ? Math.sin(t * 5) * 2 : 0;
    prop("ball", toy.x, toy.d, 34, { yOff: 2 + bob, lift: toy.lift || undefined, order: toy.d + 0.0005 });
  }

  // ---- the animals
  const p = s.player, b = s.boxer, k = s.calf;
  const terrierPose = p.lap > 0 ? TERRIER.poses.sniff : p.jump > 0 && !p.perch ? TERRIER.poses.jump : p.moving ? walkFrame(TERRIER, 10) : p.charge !== null ? TERRIER.poses.crouch : TERRIER.stand;
  const happy = s.inserts.some(i => i.who === "terrier" && (i.mood === "delighted" || i.mood === "tender"));
  const panting = p.moving || happy || p.wet > 0.2;
  animal(TERRIER, terrierPose, p.x, p.d, p.face, p.jump, { breathe: p.moving ? 0 : breathe(0) * (panting ? 2.5 : 1), tongue: panting && p.jump === 0 && terrierPose === TERRIER.stand ? 1 : 0 });
  if (p.item) {
    const sc = depthScale(p.d);
    list.push({
      d: p.d + 0.002,
      draw: () => {
        const { sp, r } = propSprite(art, "ball");
        const w = 30 * sc;
        c.drawImage(sp, p.x + p.face * 36 * sc - w / 2, groundY(p.x, p.d) - p.jump - 46 * sc - (w * r[3]) / r[2] / 2, w, (w * r[3]) / r[2]);
      },
    });
  }
  if (p.charge !== null) list.push({ d: 2, draw: () => arcMeter(c, p.x, groundY(p.x, p.d) - p.jump - 118 * depthScale(p.d), p.charge ?? 0, f.reduced ? 0 : t) });
  const boxerPose =
    b.state === "nap" || b.state === "settle" ? BOXER.poses.sleep
    : b.item ? BOXER.poses.carry
    : b.state === "refuse" ? BOXER.poses.bark
    : b.state === "chase" && b.moving ? BOXER.poses.charge
    : b.moving ? walkFrame(BOXER, 8)
    : BOXER.stand;
  animal(BOXER, boxerPose, b.x, b.d, b.face, 0, { breathe: b.moving ? 0 : breathe(1.3) * (b.state === "nap" ? 1.6 : 1) });
  // the calf: on its ledge in the hole, stepping out over the trough, or following her
  const inHole = k.ledge || k.step !== null;
  const calfPose = k.step !== null ? walkFrame(CALF, 6) : k.ledge ? (s.inserts.some(i => i.who === "calf" && i.mood === "scared" && i.t < 1.2) ? CALF.poses.scared : CALF.stand) : k.moving ? walkFrame(CALF, 6) : CALF.stand;
  animal(CALF, calfPose, k.x, k.d, k.face, 0, { breathe: breathe(2.2), feet: inHole ? calfFeet(art, s) : undefined, order: inHole ? 0.2905 : undefined });

  list.sort((a, b2) => a.d - b2.d);
  for (const item of list) item.draw();
  c.restore();

  // the wet terrier drips a little
  if (p.wet > 0.2 && !f.reduced) {
    c.save();
    c.fillStyle = "rgba(120, 190, 220, 0.7)";
    for (let i = 0; i < 4; i++) {
      const y = groundY(p.x, p.d) - 30 + ((t * 90 + i * 37) % 60);
      c.beginPath();
      c.arc(p.x - f.cam + (i - 1.5) * 12, y, 2.2, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  petals(c, t, side(f.cam + VIEW / 2) === "now" ? 26 : 10);
  inserts(c, art, s);
}

/** the fountain's basin: its water level, and a calf's face rippling in it (permanent once the calf is home) */
function fountainWater(c: CanvasRenderingContext2D, art: Art, s: Adventure, t: number) {
  const { r } = propSprite(art, "fountain");
  const sc = depthScale(SPOTS.fountain.d);
  const ww = 330 * sc, hh = (ww * r[3]) / r[2];
  const ox = SPOTS.fountain.x - ww / 2, oy = groundY(SPOTS.fountain.x, SPOTS.fountain.d) - hh;
  const k = ww / r[2];
  // the inner bowl of the lower basin, measured on the sheet: centre (232, 236), radii (178, 30)
  const cx = ox + 232 * k, cy = oy + (236 + (1 - s.water.F) * 14) * k, rx = 178 * k * (0.86 + 0.14 * s.water.F), ry = 30 * k * (0.86 + 0.14 * s.water.F);
  const F = s.water.F;
  if (F > 0.03) {
    c.save();
    const blue = s.flags.rescued ? "70, 150, 190" : "96, 176, 214";
    const g = c.createRadialGradient(cx, cy, 2, cx, cy, rx);
    g.addColorStop(0, `rgba(${blue}, ${0.75 * Math.min(1, F * 1.6)})`);
    g.addColorStop(0.85, `rgba(${blue}, ${0.65 * Math.min(1, F * 1.6)})`);
    g.addColorStop(1, `rgba(${blue}, 0)`);
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
    // the calf's face, rippling: there before you know who it is
    if (F > 0.3 || s.flags.rescued) {
      const hr = CALF.heads.curious!;
      const sp = sprite(art, CALF.file, hr);
      const w = rx * 0.62, h = (w * hr[3]) / hr[2];
      c.beginPath();
      c.ellipse(cx, cy, rx * 0.95, ry * 0.9, 0, 0, Math.PI * 2);
      c.clip();
      // a reflection: upside down, squashed into the basin, rippling in bands
      c.globalAlpha = (s.flags.rescued ? 0.42 : 0.3) * Math.min(1, F * 1.6);
      const bands = 8, sq = 0.42;
      for (let i = 0; i < bands; i++) {
        const sy = (h / bands) * i * sq;
        const wob = Math.sin(t * 2.4 + i * 1.3) * 3;
        c.save();
        c.translate(cx + wob, cy - ry * 0.85 + sy + (h / bands) * sq);
        c.scale(1, -1);
        c.drawImage(sp, 0, hr[3] - (hr[3] / bands) * (i + 1), hr[2], hr[3] / bands, -w / 2, 0, w, (h / bands) * sq + 0.6);
        c.restore();
      }
    }
    c.restore();
    glints(c, t, 5, F * 0.8, (a, b) => [cx - rx * 0.8 + rx * 1.6 * a, cy - ry * 0.5 + ry * b], 0.3, 0.7);
  }
}

/** the water on the ground: the run from the hose to the drain, the lost creek, the ford, the channel */
function paintWater(c: CanvasRenderingContext2D, s: Adventure, t: number, flow: number) {
  const w = s.water;
  // the storm drain: an iron grate in a dark wet stain, painted in code
  {
    const x = SPOTS.drain.x, y = groundY(x, SPOTS.drain.d);
    c.save();
    c.translate(x, y);
    c.save();
    c.scale(1, 0.32);
    const g = c.createRadialGradient(0, 0, 10, 0, 0, 80);
    g.addColorStop(0, "rgba(46, 36, 64, 0.55)");
    g.addColorStop(1, "rgba(46, 36, 64, 0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(0, 0, 80, 0, Math.PI * 2);
    c.fill();
    c.restore();
    c.fillStyle = "#3a3346";
    c.beginPath();
    c.roundRect(-30, -8, 60, 16, 4);
    c.fill();
    c.strokeStyle = "rgba(170, 160, 190, 0.55)";
    c.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      c.beginPath();
      c.moveTo(i * 11, -6);
      c.lineTo(i * 11 - 2, 6);
      c.stroke();
    }
    c.restore();
  }
  // the hose running across the plaza to the drain: a wet ribbon, feathered, wandering a little
  const running = s.hose && w.F > 0.01 ? Math.min(1, w.F * 3) : 0;
  if (running > 0) {
    const x0 = SPOTS.hose.x + 30, x1 = SPOTS.drain.x;
    const y0 = groundY(x0, SPOTS.hose.d) + 6, y1 = groundY(x1, SPOTS.drain.d);
    const at = (k: number): [number, number] => [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k + 22 * Math.sin(k * Math.PI) + Math.sin(k * 19) * 3];
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    for (const [width, colour] of [
      [30, `rgba(84, 160, 200, ${0.16 * running})`],
      [16, `rgba(96, 176, 214, ${0.32 * running})`],
      [5, `rgba(200, 236, 244, ${0.3 * running})`],
    ] as const) {
      c.strokeStyle = colour;
      c.lineWidth = width;
      c.beginPath();
      for (let k = 0; k <= 1.0001; k += 0.04) {
        const [x, y] = at(k);
        if (k === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }
    c.restore();
    glints(c, t, 8, running, (k, b) => {
      const [x, y] = at(k);
      return [x, y + (b - 0.5) * 8];
    }, flow, 0.7);
  }
  // the lost creek, out of the culvert along the back of the meadow to the creek bed
  if (w.C > 0.02) {
    const x0 = SPOTS.culvert.x + 30, x1 = fordEdges(0.24)[0] + 50, y = groundY(x0, 0.24) + 6;
    c.save();
    c.globalAlpha = Math.min(1, w.C * 1.8);
    const g = c.createLinearGradient(0, y - 16, 0, y + 16);
    g.addColorStop(0, "rgba(84, 160, 200, 0)");
    g.addColorStop(0.5, "rgba(84, 160, 200, 0.85)");
    g.addColorStop(1, "rgba(84, 160, 200, 0)");
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(x0, y - 6);
    for (let x = x0; x <= x1; x += 40) c.lineTo(x, y - 10 - 9 * w.C + Math.sin(x * 0.02) * 4);
    for (let x = x1; x >= x0; x -= 40) c.lineTo(x, y + 10 + 9 * w.C + Math.sin(x * 0.02 + 1) * 4);
    c.fill();
    c.restore();
    glints(c, t, 12, w.C, (a, b) => [x0 + (x1 - x0) * a, y + (b - 0.5) * 14 + Math.sin((x0 + (x1 - x0) * a) * 0.02) * 4], flow);
  }
  // the ford: the painted creek bed, flooded
  if (w.ford > 0.02) {
    const top = groundY(R + 1100, 0) - 6, bot = groundY(R + 1100, 1) + 30;
    const [a0, a1] = fordEdges(0);
    const [b0] = fordEdges(1);
    drawFlood(c, w.ford * 1.5, a0, a1, top, bot, b0 - a0);
    glints(c, t, 18, w.ford, (k, across) => {
      const d = k;
      const [e0, e1] = fordEdges(d);
      return [e0 + (e1 - e0) * across, top + (bot - 30 - top) * d];
    }, flow);
  }
  // the old channel, from the ford's mouth into the hole
  if (w.channel > 0.02) {
    const x0 = R + 1560, x1 = R + 1700, top = groundY(x0, 0.28), bot = groundY(x0, 0.47);
    drawFlood(c, w.channel * 1.4, x0, x1, top, bot);
    glints(c, t, 8, w.channel, (k, across) => [x0 + (x1 - x0) * across, bot - (bot - top) * k], flow, 0.8);
  }
}

/** the hole the pasture fell into: the garage under it, the ledge, the water rising, the trough floating up */
function paintHole(c: CanvasRenderingContext2D, art: Art, s: Adventure, t: number) {
  const hb = holeBox(art);
  c.drawImage(hb.sp, hb.x, hb.top, hb.w, hb.h);
  // the concrete ledge on the back wall, where the calf is stranded
  const ly = hb.inside(LEDGE_DROP);
  const lx0 = LEDGE_RANGE[0] - 40, lx1 = LEDGE_RANGE[1] + 10;
  c.fillStyle = "rgba(40, 30, 60, 0.4)";
  c.fillRect(lx0 + 4, ly + 18, lx1 - lx0, 14);
  c.fillStyle = "#7c8794";
  c.fillRect(lx0, ly, lx1 - lx0, 18);
  c.fillStyle = "#c3cbc4";
  c.fillRect(lx0, ly, lx1 - lx0, 5);
  // the water in the hole, clipped to the opening
  const hw = s.water.hw;
  const deck = hb.inside(-troughDeck(hw));
  if (hw > 0.02) {
    c.save();
    c.beginPath();
    c.ellipse(hb.cx, hb.cy, hb.rx, hb.ry, 0, 0, Math.PI * 2);
    c.clip();
    const wy = deck + 14;
    const g = c.createLinearGradient(0, wy, 0, wy + 80);
    g.addColorStop(0, `rgba(110, 190, 210, ${0.55 + 0.25 * hw})`);
    g.addColorStop(1, `rgba(50, 110, 150, ${0.7 + 0.2 * hw})`);
    c.fillStyle = g;
    c.fillRect(hb.cx - hb.rx, wy, hb.rx * 2, hb.cy + hb.ry - wy);
    c.restore();
    glints(c, t, 6, hw, (k, across) => [hb.cx - hb.rx * 0.7 + hb.rx * 1.4 * across, wy + 4 + k * 20], 0.2, 0.8);
  }
  // the trough: on the floor when it is dry, riding the water up to the ledge
  const { sp, r } = propSprite(art, "trough");
  const tw = 150, th = (tw * r[3]) / r[2];
  const bob = hw > 0.1 ? Math.sin(t * 1.8) * 1.5 : 0;
  c.drawImage(sp, SPOTS.trough.x - tw / 2, deck - th * 0.55 + bob, tw, th);
}

/** a small arc over her head while she winds up a throw */
function arcMeter(c: CanvasRenderingContext2D, x: number, y: number, k: number, t: number) {
  c.save();
  c.lineCap = "round";
  c.lineWidth = 7;
  c.strokeStyle = "rgba(255, 248, 234, 0.85)";
  c.beginPath();
  c.arc(x, y, 26, Math.PI, Math.PI * 2);
  c.stroke();
  c.lineWidth = 5;
  c.strokeStyle = k >= 1 ? `rgba(240, 150, 60, ${0.85 + 0.15 * Math.sin(t * 14)})` : "rgba(186, 120, 220, 0.95)";
  c.beginPath();
  c.arc(x, y, 26, Math.PI, Math.PI + Math.PI * Math.max(0.02, k));
  c.stroke();
  c.restore();
}

/** the seam between the eras: the tear's own torn edge, standing still at x 1900, its fibres stirring slowly */
function seam(c: CanvasRenderingContext2D, t: number) {
  const edge = (y: number) => SEAM + Math.sin(y * 0.11 + t * 0.35) * 9 + Math.sin(y * 0.37) * 6;
  c.save();
  // a little shade on the courtyard side, as if the ranch were laid over it
  const g = c.createLinearGradient(SEAM - 40, 0, SEAM, 0);
  g.addColorStop(0, "rgba(74, 44, 120, 0)");
  g.addColorStop(1, "rgba(74, 44, 120, 0.22)");
  c.fillStyle = g;
  c.fillRect(SEAM - 40, -10, 40, H + 20);
  c.strokeStyle = "#fff8ea";
  c.lineWidth = 9;
  c.lineJoin = "round";
  c.beginPath();
  for (let y = -10; y <= H + 10; y += 14) {
    if (y === -10) c.moveTo(edge(y), y);
    else c.lineTo(edge(y), y);
  }
  c.stroke();
  c.strokeStyle = "rgba(74, 44, 120, 0.25)";
  c.lineWidth = 2;
  c.stroke();
  // fibres
  c.strokeStyle = "rgba(255, 248, 234, 0.7)";
  c.lineWidth = 1.2;
  for (let y = 0; y < H; y += 23) {
    const x = edge(y);
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + 6 + Math.sin(t * 0.8 + y) * 3, y + 4);
    c.stroke();
  }
  c.restore();
}

// ------------------------------------------------------------------ the ending: a place to walk in
function paintHome(c: CanvasRenderingContext2D, art: Art, s: Adventure, f: Frame, t: number) {
  c.drawImage(art["13-overlap"], 0, 0, 1536, 1024, 0, HOME_Y, VIEW, 1024 * HOME_SCALE);
  const lying = s.flags.ended ? 1 : s.home.lying !== null ? Math.min(1, s.home.lying / 2.5) : 0;
  // until they lie down, the painted three are not there yet: the floor in front of them is lifted over them; as
  // the live three settle, they dissolve into the painted poses
  const settle = Math.max(0, Math.min(1, (lying - 0.3) / 0.7));
  const ease = settle * settle * (3 - 2 * settle);
  if (ease < 1) {
    c.save();
    c.globalAlpha = 1 - ease;
    c.drawImage(patchOverSleepers(art), PATCH[0] * HOME_SCALE, HOME_Y + PATCH[1] * HOME_SCALE, PATCH[2] * HOME_SCALE, PATCH[3] * HOME_SCALE);
    c.restore();
  }
  // the elevator light flickers on the way down to the beans
  if (s.home.ride > 0) {
    c.save();
    c.globalAlpha = 0.18 + 0.2 * Math.abs(Math.sin(t * 18));
    c.fillStyle = "#fff2c4";
    c.fillRect(SPOTS.home.elevator - 70, 130, 145, 310);
    c.restore();
  }
  for (let i = 0; i < f.restored; i++) {
    const { sp, r } = propSprite(art, "beans");
    c.drawImage(sp, 1010 + i * 40, 420, 60, (60 * r[3]) / r[2]);
  }
  if (ease < 1) {
    const list: Drawn[] = [];
    const p = s.player, b = s.boxer, k = s.calf;
    const walk = (sheet: Sheet, rate: number) => sheet.walk[Math.floor(t * rate) % sheet.walk.length];
    const add = (sheet: Sheet, r: Rect, x: number, d: number, face: 1 | -1, lift: number, painted: readonly [number, number, number] | null) => {
      const sc0 = depthScale(d) * (sheet.height / sheet.stand[3]);
      let y = groundY(x, d, "home") - lift, sc = sc0, xx = x;
      // dissolving into the painting: towards the painted pose's place and size
      if (painted) {
        const [px, py, pw] = painted;
        xx = x + (px * HOME_SCALE - x) * ease;
        y = y + (HOME_Y + py * HOME_SCALE - y) * ease;
        sc = sc0 + ((pw * HOME_SCALE) / r[2] - sc0) * ease;
      }
      list.push({
        d,
        draw: () => {
          shadow(c, xx, y, r[2] * sc * 0.9, lift, 0.34 * (1 - ease));
          drawSprite(c, art, sheet, r, xx, y, sc, face, { alpha: 1 - ease, tint: "rgba(255, 210, 150, 0.1)", breathe: Math.sin(t * 2.1 + x) * 0.012, time: t });
        },
      });
    };
    const down = lying > 0.15;
    add(TERRIER, down ? TERRIER.poses.lie : p.lap > 0 ? TERRIER.poses.sniff : p.jump > 0 ? TERRIER.poses.jump : p.moving ? walk(TERRIER, 10) : TERRIER.stand, p.x, p.d, down ? -1 : p.face, p.jump, down ? PAINTED_THREE.terrier : null);
    add(CALF, down ? CALF.poses.lie : k.moving ? walk(CALF, 6) : CALF.stand, k.x, k.d, down ? -1 : k.face, 0, down ? PAINTED_THREE.calf : null);
    add(BOXER, down ? BOXER.poses.sleep : b.moving ? walk(BOXER, 8) : BOXER.stand, b.x, b.d, down ? 1 : b.face, 0, down ? PAINTED_THREE.boxer : null);
    list.sort((a, z) => a.d - z.d);
    for (const item of list) item.draw();
  }
  petals(c, t, lying > 0 ? 60 : f.restored ? 46 : 24);
  inserts(c, art, s);
}

// ------------------------------------------------------------------ the acting: reaction portraits
const INSERT_SHEET = { terrier: TERRIER, boxer: BOXER, calf: CALF } as const;
/** a mood a sheet has no face for borrows its nearest one */
const NEAREST: Partial<Record<Mood, Mood>> = { startled: "confused", afraid: "scared", tender: "trusting" };
function inserts(c: CanvasRenderingContext2D, art: Art, s: Adventure) {
  s.inserts.forEach((ins, n) => {
    const sheet = INSERT_SHEET[ins.who];
    const r = sheet.heads[ins.mood] ?? sheet.heads[NEAREST[ins.mood] ?? "neutral"] ?? sheet.heads.neutral ?? sheet.stand;
    const sp = sprite(art, sheet.file, r);
    const k = ins.t;
    const pop = k < 0.18 ? k / 0.18 : k > 1.3 ? Math.max(0, 1 - (k - 1.3) / 0.3) : 1;
    const ease = 1 - Math.pow(1 - pop, 3);
    const size = 150;
    const x = ins.who === "terrier" ? 190 : ins.who === "boxer" ? 640 : 1090;
    const y = 150 + n * 6;
    c.save();
    c.translate(x, y);
    c.scale(ease, ease);
    // a little acting on top of the portrait: a shake for the angry ones, a tilt for the baffled, a pant for delight
    let rot = 0, sy = 1;
    if (ins.mood === "jealous" || ins.mood === "irritated") rot = Math.sin(k * 60) * 0.05 * (1 - k / 1.6);
    if (ins.mood === "confused") rot = Math.sin(k * 3) * 0.12;
    if (ins.mood === "delighted") sy = 1 + Math.abs(Math.sin(k * 22)) * 0.05;
    if (ins.mood === "afraid" || ins.mood === "startled" || ins.mood === "scared") rot = Math.sin(k * 90) * 0.03;
    if (ins.mood === "tender" || ins.mood === "trusting") rot = Math.sin(k * 2.5) * 0.04;
    c.rotate(rot);
    c.scale(1, sy);
    // the portrait sits in a torn paper circle, like a thought
    c.fillStyle = "#fff6e6";
    c.beginPath();
    for (let a = 0; a <= 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const rr = size / 2 + 8 + Math.sin(ang * 7 + ins.id) * 4;
      c.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    c.closePath();
    c.fill();
    c.strokeStyle = "rgba(74, 44, 120, 0.35)";
    c.lineWidth = 2;
    c.stroke();
    c.beginPath();
    c.arc(0, 0, size / 2, 0, Math.PI * 2);
    c.clip();
    const sc = size / Math.max(r[2], r[3]);
    const w = r[2] * sc * 1.15, h = r[3] * sc * 1.15;
    c.drawImage(sp, -w / 2, -h / 2 + 6, w, h);
    c.restore();
  });
}

// ------------------------------------------------------------------ the paper tear into the ending
function tear(c: CanvasRenderingContext2D, s: Adventure, f: Frame) {
  if (!s.tear || !f.snapshot) return;
  const k = 1 - Math.pow(1 - s.tear.t, 2);
  const edge = VIEW + 120 - k * (VIEW + 300);
  c.save();
  c.beginPath();
  c.moveTo(-10, -10);
  c.lineTo(edge, -10);
  for (let y = -10; y <= H + 10; y += 14) c.lineTo(edge + Math.sin(y * 0.11 + s.tear.t * 2) * 16 + Math.sin(y * 0.37) * 7, y);
  c.lineTo(-10, H + 10);
  c.closePath();
  c.clip();
  c.drawImage(f.snapshot, 0, 0, VIEW, H);
  c.restore();
  // the torn white edge, with the fibres of the paper
  c.save();
  c.strokeStyle = "#fff8ea";
  c.lineWidth = 9;
  c.lineJoin = "round";
  c.beginPath();
  for (let y = -10; y <= H + 10; y += 14) {
    const x = edge + Math.sin(y * 0.11 + s.tear.t * 2) * 16 + Math.sin(y * 0.37) * 7;
    if (y === -10) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.stroke();
  c.strokeStyle = "rgba(74, 44, 120, 0.25)";
  c.lineWidth = 2;
  c.stroke();
  c.restore();
}

export function petals(c: CanvasRenderingContext2D, t: number, n: number) {
  c.save();
  for (let i = 0; i < n; i++) {
    const x = ((i * 173.3 + t * (9 + (i % 5))) % (VIEW + 30)) - 15;
    const y = ((i * 97.7 + t * (11 + (i % 3))) % (H + 40)) - 20;
    c.fillStyle = i % 2 ? "rgba(186, 133, 220, 0.7)" : "rgba(239, 181, 223, 0.7)";
    c.beginPath();
    c.ellipse(x, y, 3.5, 1.8, t + i, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

export const isWet = inWater;
