/**
 * The painter. What makes a cutout belong to a painting: it stands on the painting's own ground (a depth band, not a
 * line), it scales with depth, it is drawn in depth order with the props, its shadow falls the way the painting's
 * shadows fall (upper-left sun, hard violet shadow to the lower right), it takes a little of the scene's light, and
 * something painted stands in front of it. Then the acting: breathing, a walk cycle that stays a walk, a squash on
 * landing, and reaction portraits from the sheets' expression rows when something happens between the animals.
 */
import { BOXER, CALF, COYOTE, PROPS, TERRIER, type Mood, type PropId, type Rect, type Sheet } from "./cells";
import { CHAPTERS, GROUND, SPOTS, VIEW, WIDTH, inWater, type Adventure, type Chapter } from "./adventure";

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
const PAINT_SCALE = WIDTH / 1536; // the mid paintings are 1536 wide; the world is one painting wide at 1x
const PAINT_Y = -363;

// ------------------------------------------------------------------ sheet cells as clean sprites
// Each cell is cut once into its own canvas, clipped to its largest connected shape so a neighbouring drawing's
// nose never comes along, with the sun's warmth and a touch of the scene's colour multiplied in.
const cut = new Map<string, HTMLCanvasElement>();
function sprite(art: Art, file: string, r: Rect): HTMLCanvasElement {
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
type Stage = { top: number; bottom: number };
const stage = (ch: Chapter): Stage => ({ top: GROUND[ch][0], bottom: GROUND[ch][1] });
const groundY = (st: Stage, d: number) => st.top + d * (st.bottom - st.top);
const depthScale = (d: number) => 0.62 + 0.42 * d;

/** a hard-edged violet shadow cast to the lower right, the way every shadow in the paintings is cast */
function shadow(c: CanvasRenderingContext2D, x: number, y: number, w: number, lift: number, alpha = 0.34) {
  c.save();
  c.translate(x + w * 0.16 + lift * 0.3, y + 2);
  c.scale(1, 0.26);
  c.fillStyle = `rgba(74, 44, 120, ${alpha * (1 - lift / 300)})`;
  c.beginPath();
  c.ellipse(0, 0, w * 0.5, w * 0.5, -0.18, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

type Drawn = { d: number; draw: () => void };

function drawSprite(c: CanvasRenderingContext2D, art: Art, sheet: Sheet, r: Rect, x: number, y: number, scale: number, face: 1 | -1, opt: { breathe?: number; squash?: number; tint?: string; alpha?: number; tongue?: number; time?: number } = {}) {
  const sp = sprite(art, sheet.file, r);
  const w = r[2] * scale, h = r[3] * scale;
  c.save();
  c.globalAlpha = opt.alpha ?? 1;
  c.translate(x, y);
  // the body breathes: a slow stretch from the feet; a landing squashes it. The sheets face left, so facing
  // right (face 1) is the mirror image.
  const sq = opt.squash ?? 0, br = opt.breathe ?? 0;
  c.scale((1 + sq * 0.12) * -face, 1 - sq * 0.1 + br);
  c.drawImage(sp, -w / 2, -h, w, h);
  if (opt.tint) {
    c.globalCompositeOperation = "source-atop";
    c.fillStyle = opt.tint;
    c.fillRect(-w / 2, -h, w, h);
    c.globalCompositeOperation = "source-over";
  }
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

function propSprite(art: Art, id: PropId) {
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
};

export function paint(c: CanvasRenderingContext2D, art: Art, s: Adventure, f: Frame) {
  const t = f.reduced ? 0 : s.time;
  c.clearRect(0, 0, VIEW, H);
  if (s.chapter === "home") {
    c.drawImage(art["13-overlap"], 0, 0, 1536, 1024, 0, -27, VIEW, 854);
    for (let i = 0; i < f.restored; i++) {
      const { sp, r } = propSprite(art, "beans");
      c.drawImage(sp, 860 + i * 66, 735, 96, (96 * r[3]) / r[2]);
    }
    petals(c, t, f.restored ? 46 : 20);
    tear(c, s, f);
    return;
  }
  const ch = s.chapter;
  const courtyard = ch === "courtyard";
  const st = stage(ch);
  const tint = courtyard ? "rgba(255, 214, 150, 0.1)" : "rgba(255, 196, 90, 0.12)";

  // far: sky and the far distance, slow parallax
  c.fillStyle = courtyard ? "#6ab9e7" : "#5bace3";
  c.fillRect(0, 0, VIEW, H);
  c.drawImage(art[courtyard ? "05-courtyard-far" : "08-ranch-far"], -f.cam * 0.12, -140, 1600, 1067);
  if (ch === "distortion") {
    const { sp, r } = propSprite(art, "ghost");
    c.save();
    c.globalAlpha = 0.32 + Math.sin(t * 0.6) * 0.07;
    c.drawImage(sp, 1120 - f.cam * 0.18, 300, 230, (230 * r[3]) / r[2]);
    c.restore();
  }
  // the painting: the set itself, scrolls with the world (its ground is the ground)
  c.drawImage(art[courtyard ? "06-courtyard-mid" : "09-ranch-mid"], -f.cam, PAINT_Y, 1536 * PAINT_SCALE, 1024 * PAINT_SCALE);

  c.save();
  c.translate(-f.cam, 0);
  const list: Drawn[] = [];
  const prop = (id: PropId, x: number, d: number, w: number, opt: { alpha?: number; sway?: number; yOff?: number } = {}) => {
    const { sp, r } = propSprite(art, id);
    const sc = depthScale(d);
    const ww = w * sc, hh = (ww * r[3]) / r[2];
    const y = groundY(st, d) + (opt.yOff ?? 0);
    list.push({
      d,
      draw: () => {
        c.save();
        c.globalAlpha = opt.alpha ?? 1;
        const sx = opt.sway ? Math.sin(t * 1.3 + x) * opt.sway : 0;
        c.transform(1, 0, sx, 1, 0, 0);
        c.drawImage(sp, x - ww / 2 - sx * y, y - hh, ww, hh);
        c.restore();
      },
    });
  };
  const animal = (sheet: Sheet, r: Rect, x: number, d: number, face: 1 | -1, lift: number, opt: { breathe?: number; squash?: number; alpha?: number; scaleMul?: number; tintOverride?: string; tongue?: number } = {}) => {
    const sc = depthScale(d) * (sheet.height / sheet.stand[3]) * (opt.scaleMul ?? 1);
    const y = groundY(st, d);
    list.push({
      d: d + 0.001,
      draw: () => {
        shadow(c, x, y, r[2] * sc * 0.9, lift, opt.alpha === undefined ? 0.34 : opt.alpha * 0.34);
        drawSprite(c, art, sheet, r, x, y - lift, sc, face, { breathe: opt.breathe, squash: opt.squash, tint: opt.tintOverride ?? tint, alpha: opt.alpha, tongue: opt.tongue, time: t });
      },
    });
  };
  const walkFrame = (sheet: Sheet, rate: number) => sheet.walk[Math.floor(t * rate) % sheet.walk.length];
  const breathe = (phase: number) => Math.sin(t * 2.1 + phase) * 0.012;

  // ---- the set dressing, in depth
  if (courtyard) {
    prop("hedge", SPOTS.courtyard.hedge.x, SPOTS.courtyard.hedge.d, 300);
    prop("fountain", SPOTS.courtyard.fountain.x, SPOTS.courtyard.fountain.d, 330);
    prop("pots", SPOTS.courtyard.pots.x, SPOTS.courtyard.pots.d, 160);
    prop("stairs", SPOTS.courtyard.stairs.x, SPOTS.courtyard.stairs.d, 380, { yOff: 26 });
    // something painted in front of her: a second hedge and pots at the front edge
    prop("hedge", 70, 1.1, 300, { alpha: 1 });
    prop("pots", 1840, 1.1, 190);
  } else if (ch === "pasture") {
    prop("tunnel", SPOTS.pasture.tunnel.x, SPOTS.pasture.tunnel.d, 260, { yOff: 30 });
    prop("gate", SPOTS.pasture.gate.x + (s.flags.gate ? -70 : 0), SPOTS.pasture.gate.d, s.flags.gate ? 190 : 470, { alpha: s.flags.gate ? 0.7 : 1 });
    prop("sluice", SPOTS.pasture.sluice.x, SPOTS.pasture.sluice.d, 240, { yOff: 20 });
    for (let i = 0; i < f.restored; i++) prop("beans", 1600 + i * 80, 0.12, 110);
    // the cows, at the back of the meadow: three different animals doing three different things, slowly
    const cows: [Rect, number, number, 1 | -1][] = [[CALF.poses.lie, 1240, 0.04, -1]];
    for (const [r, x, d, face] of cows) animal(CALF, r, x, d, face, 0, { scaleMul: 1.05, alpha: 0.92, breathe: breathe(x), tintOverride: "rgba(255, 190, 90, 0.2)" });
    // the water, while it is high
    if (!s.flags.water) {
      list.push({
        d: 0.35,
        draw: () => {
          c.save();
          c.fillStyle = "rgba(96, 176, 214, 0.55)";
          c.beginPath();
          c.moveTo(SPOTS.pasture.waterX0, groundY(st, 0.2));
          c.lineTo(SPOTS.pasture.waterX1, groundY(st, 0.2));
          c.lineTo(SPOTS.pasture.waterX1 + 60, st.bottom + 30);
          c.lineTo(SPOTS.pasture.waterX0 - 60, st.bottom + 30);
          c.fill();
          c.strokeStyle = "rgba(220, 248, 240, 0.8)";
          c.lineWidth = 2.5;
          for (let i = 0; i < 9; i++) {
            const y = groundY(st, 0.25 + i * 0.085);
            c.beginPath();
            c.moveTo(SPOTS.pasture.waterX0 + Math.sin(t * 1.8 + i) * 12 - i * 5, y);
            c.lineTo(SPOTS.pasture.waterX1 + Math.sin(t * 1.8 + i) * 12 + i * 5, y);
            c.stroke();
          }
          c.restore();
        },
      });
    }
    // front grass: what stands in front of the animals
    for (let x = 80; x < WIDTH; x += 300) prop("grass", x, 1.05 + ((x / 300) % 2) * 0.03, 170, { sway: 0.03 });
  } else {
    prop("sluice", SPOTS.distortion.sluice.x, SPOTS.distortion.sluice.d, 230, { yOff: 20 });
    // the tear in the ground, and the garage under it
    const { sp, r } = propSprite(art, "hole");
    list.push({
      d: 0.3,
      draw: () => {
        const w = 720, hh = (w * r[3]) / r[2];
        c.drawImage(sp, SPOTS.distortion.hole.x - w / 2, groundY(st, 0.75) - hh + 120, w, hh);
      },
    });
    // the concrete ledge inside the hole, rising with the water
    const ledgeLift = s.flags.water ? 0 : 92;
    list.push({
      d: 0.45,
      draw: () => {
        const y = groundY(st, SPOTS.distortion.ledge.d) + ledgeLift;
        c.fillStyle = "#6f7a86";
        c.fillRect(SPOTS.distortion.ledge.x - 150, y, 300, 24);
        c.fillStyle = "#aeb9b4";
        c.fillRect(SPOTS.distortion.ledge.x - 150, y, 300, 6);
        if (s.flags.water) {
          c.fillStyle = "rgba(110, 190, 200, 0.6)";
          c.fillRect(SPOTS.distortion.ledge.x - 180, y + 24, 360, 120);
        }
      },
    });
    if (s.flags.tether) {
      list.push({
        d: 0.56,
        draw: () => {
          c.strokeStyle = "#b98646";
          c.lineWidth = 5;
          c.beginPath();
          c.moveTo(s.boxer.x + 70, groundY(st, s.boxer.d) - 70);
          c.quadraticCurveTo((s.boxer.x + s.player.x) / 2, groundY(st, 0.58) - 10, s.player.x - 30 * s.player.face, groundY(st, s.player.d) - 40 - s.player.jump);
          c.stroke();
        },
      });
    }
    for (let x = 60; x < WIDTH; x += 320) prop("grass", x, 1.06, 160, { sway: 0.03 });
  }

  // ---- toys on the ground
  if (s.toy) {
    const id: PropId = s.toy.kind;
    prop(id, s.toy.x, s.toy.d, id === "ball" ? 34 : id === "stick" ? 95 : 70, { yOff: 2 });
  }

  // ---- the animals
  const p = s.player, b = s.boxer, k = s.calf;
  const landing = p.jump === 0 && p.vy < -20 ? 0 : 0;
  // terrier
  const terrierPose = p.jump > 0 ? TERRIER.poses.jump : p.moving ? walkFrame(TERRIER, 10) : s.inserts.some(i => i.who === "terrier" && i.mood === "jealous" && i.t < 1.4) ? TERRIER.poses.lie : TERRIER.stand;
  const happy = s.inserts.some(i => i.who === "terrier" && (i.mood === "delighted" || i.mood === "tender"));
  const panting = p.moving || happy || p.wet > 0.2;
  animal(TERRIER, terrierPose, p.x, p.d, p.face, p.jump, { breathe: p.moving ? 0 : breathe(0) * (panting ? 2.5 : 1), squash: landing, tongue: panting && p.jump === 0 && terrierPose !== TERRIER.poses.lie ? 1 : 0 });
  if (p.item) {
    const id: PropId = p.item;
    const sc = depthScale(p.d);
    list.push({
      d: p.d + 0.002,
      draw: () => {
        const { sp, r } = propSprite(art, id);
        const w = (id === "ball" ? 30 : id === "stick" ? 80 : 60) * sc;
        c.drawImage(sp, p.x + p.face * 36 * sc - w / 2, groundY(st, p.d) - p.jump - 46 * sc - (w * r[3]) / r[2] / 2, w, (w * r[3]) / r[2]);
      },
    });
  }
  // boxer
  const boxerPose =
    b.state === "sleep" ? BOXER.poses.sleep
    : b.state === "charge" ? BOXER.poses.charge
    : b.item === "ball" ? BOXER.poses.carry
    : b.item && b.moving ? walkFrame(BOXER, 8)
    : b.state === "settle" ? BOXER.poses.sleep
    : b.moving ? walkFrame(BOXER, 8)
    : BOXER.stand;
  animal(BOXER, boxerPose, b.x, b.d, b.face, 0, { breathe: b.moving ? 0 : breathe(1.3) * (b.state === "sleep" ? 1.6 : 1) });
  if (b.item && b.item !== "ball" && b.state !== "sleep") {
    const id: PropId = b.item;
    const sc = depthScale(b.d);
    list.push({
      d: b.d + 0.002,
      draw: () => {
        const { sp, r } = propSprite(art, id);
        const w = (id === "stick" ? 90 : 64) * sc;
        c.drawImage(sp, b.x + b.face * 62 * sc - w / 2, groundY(st, b.d) - 78 * sc - (w * r[3]) / r[2] / 2, w, (w * r[3]) / r[2]);
      },
    });
  }
  // calf
  if (ch === "pasture" || ch === "distortion") {
    const nuzzling = ch === "pasture" && k.met && !k.moving && Math.abs(k.x - b.x) < 180;
    const calfPose = k.ledge ? (s.flags.water ? CALF.stand : CALF.poses.scared) : k.moving ? walkFrame(CALF, 6) : nuzzling ? CALF.poses.nuzzle : CALF.stand;
    const calfLift = k.ledge ? -(s.flags.water ? 0 : 92) : 0;
    animal(CALF, calfPose, k.x, k.d, k.ledge ? -1 : k.face, calfLift, { breathe: breathe(2.2) });
  }
  // coyote
  if (ch === "distortion" && s.coyote.state !== "hidden" && s.coyote.state !== "gone") {
    const co = s.coyote;
    animal(COYOTE, co.state === "flee" ? walkFrame(COYOTE, 12) : COYOTE.poses.slink, co.x, co.d, co.face, 0, { breathe: breathe(3) });
  }

  list.sort((a, b2) => a.d - b2.d);
  for (const item of list) item.draw();
  c.restore();

  // the wet terrier drips a little
  if (p.wet > 0.2 && !f.reduced) {
    c.save();
    c.fillStyle = "rgba(120, 190, 220, 0.7)";
    for (let i = 0; i < 4; i++) {
      const y = groundY(st, p.d) - 30 + ((t * 90 + i * 37) % 60);
      c.beginPath();
      c.arc(p.x - f.cam + (i - 1.5) * 12, y, 2.2, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  petals(c, t, courtyard ? 26 : 10);
  inserts(c, art, s);
  tear(c, s, f);
}

// ------------------------------------------------------------------ the acting: reaction portraits
const INSERT_SHEET = { terrier: TERRIER, boxer: BOXER, calf: CALF } as const;
function inserts(c: CanvasRenderingContext2D, art: Art, s: Adventure) {
  s.inserts.forEach((ins, n) => {
    const sheet = INSERT_SHEET[ins.who];
    const r = sheet.heads[ins.mood] ?? sheet.heads.neutral ?? sheet.stand;
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
    if (ins.mood === "afraid" || ins.mood === "startled") rot = Math.sin(k * 90) * 0.03;
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

// ------------------------------------------------------------------ the paper tear between scenes
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

function petals(c: CanvasRenderingContext2D, t: number, n: number) {
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

export const placeName = (ch: Chapter) => CHAPTERS[ch].place;
export const isWet = inWater;
