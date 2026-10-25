import { CHAPTERS, prompt, type Adventure } from "./adventure";
export const ASSET_BASE = "/assets/goldline/beverly-hills-2d/";
const FILES = [
  "02-terrier-sheet",
  "03-boxer-sheet",
  "04-calf-sheet",
  "05-courtyard-far",
  "06-courtyard-mid",
  "07-courtyard-near-alpha",
  "08-ranch-far",
  "09-ranch-mid",
  "10-ranch-near-alpha",
  "11-distortion-alpha",
  "13-overlap",
  "12-coyote-sheet-alpha",
];
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
type Rect = [number, number, number, number];
const terrier: Rect[] = [
  [10, 153, 245, 220],
  [257, 157, 270, 216],
  [523, 170, 266, 200],
  [776, 163, 306, 182],
  [1047, 179, 225, 194],
  [1280, 170, 242, 198],
  [29, 415, 217, 250],
  [270, 560, 326, 104],
  [622, 547, 315, 114],
  [956, 446, 272, 227],
];
const boxer: Rect[] = [
  [36, 106, 290, 243],
  [328, 125, 323, 224],
  [670, 129, 241, 220],
  [885, 131, 230, 217],
  [1084, 131, 232, 218],
  [1280, 130, 245, 219],
  [12, 533, 443, 139],
  [441, 377, 345, 300],
  [821, 398, 329, 284],
  [1174, 452, 348, 231],
];
const calf: Rect[] = [
  [20, 87, 310, 269],
  [337, 92, 339, 265],
  [638, 92, 326, 265],
  [945, 91, 316, 264],
  [1238, 91, 291, 265],
  [19, 414, 447, 230],
  [503, 469, 283, 185],
  [802, 408, 350, 255],
];
// Atlas cells overlap in bounding-box space. Clip to the connected alpha silhouette
// so a neighboring animal's nose never enters a walk cycle. Source pixels are untouched.
const silhouettes = new WeakMap<HTMLImageElement, Map<string, Path2D>>();
function silhouette(image: HTMLImageElement, r: Rect): Path2D {
  let cache = silhouettes.get(image);
  if (!cache) {
    cache = new Map();
    silhouettes.set(image, cache);
  }
  const key = r.join(",");
  const cached = cache.get(key);
  if (cached) return cached;
  const sheet = document.createElement("canvas");
  sheet.width = r[2];
  sheet.height = r[3];
  const ctx = sheet.getContext("2d")!;
  ctx.drawImage(image, ...r, 0, 0, r[2], r[3]);
  const pixels = ctx.getImageData(0, 0, r[2], r[3]).data;
  const w = r[2],
    h = r[3],
    seen = new Uint8Array(w * h);
  let largest: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || pixels[i * 4 + 3] < 32) continue;
    const group = [i];
    seen[i] = 1;
    for (let j = 0; j < group.length; j++) {
      const n = group[j],
        x = n % w;
      for (const next of [
        x > 0 ? n - 1 : -1,
        x < w - 1 ? n + 1 : -1,
        n - w,
        n + w,
      ])
        if (
          next >= 0 &&
          next < w * h &&
          !seen[next] &&
          pixels[next * 4 + 3] >= 32
        ) {
          seen[next] = 1;
          group.push(next);
        }
    }
    if (group.length > largest.length) largest = group;
  }
  const mask = new Uint8Array(w * h);
  for (const n of largest) mask[n] = 1;
  const path = new Path2D();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const from = x;
      while (x + 1 < w && mask[y * w + x + 1]) x++;
      path.rect(from - 0.6, y - 0.6, x - from + 2.2, 2.2);
    }
  cache.set(key, path);
  return path;
}
export const PROPS = {
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
} satisfies Record<string, [string, Rect]>;
function region(
  c: CanvasRenderingContext2D,
  art: Art,
  key: string,
  r: Rect,
  x: number,
  y: number,
  w: number,
  h: number
) {
  c.drawImage(art[key], ...r, x, y, w, h);
}
function prop(
  c: CanvasRenderingContext2D,
  art: Art,
  id: keyof typeof PROPS,
  x: number,
  ground: number,
  w: number,
  alpha = 1
) {
  const [key, r] = PROPS[id];
  const h = (w * r[3]) / r[2];
  c.save();
  c.globalAlpha = alpha;
  if (id === "ghost") {
    c.beginPath();
    c.moveTo(x - w * 0.48, ground);
    c.lineTo(x - w * 0.48, ground - h * 0.35);
    c.lineTo(x - w * 0.33, ground - h * 0.4);
    c.lineTo(x - w * 0.33, ground - h * 0.64);
    c.lineTo(x - w * 0.15, ground - h * 0.7);
    c.lineTo(x - w * 0.15, ground - h * 0.95);
    c.lineTo(x + w * 0.1, ground - h);
    c.lineTo(x + w * 0.3, ground - h * 0.93);
    c.lineTo(x + w * 0.3, ground - h * 0.78);
    c.lineTo(x + w * 0.48, ground - h * 0.72);
    c.lineTo(x + w * 0.48, ground);
    c.closePath();
    c.clip();
  }
  if (id === "fountain") {
    c.beginPath();
    c.moveTo(x - w / 2, ground - h);
    c.lineTo(x - w / 2 + w * 0.78, ground - h);
    c.lineTo(x - w / 2 + w * 0.78, ground - h * 0.48);
    c.lineTo(x + w / 2, ground - h * 0.48);
    c.lineTo(x + w / 2, ground);
    c.lineTo(x - w / 2, ground);
    c.closePath();
    c.clip();
  }
  if (id === "stairs") {
    c.beginPath();
    c.moveTo(x - w / 2, ground - h);
    c.lineTo(x - w / 2 + w * 0.81, ground - h);
    c.lineTo(x - w / 2 + w * 0.81, ground - h * 0.56);
    c.lineTo(x + w / 2, ground - h * 0.56);
    c.lineTo(x + w / 2, ground);
    c.lineTo(x - w / 2, ground);
    c.closePath();
    c.clip();
  }
  region(c, art, key, r, x - w / 2, ground - h, w, h);
  c.restore();
}
function animal(
  c: CanvasRenderingContext2D,
  art: Art,
  who: "terrier" | "boxer" | "calf",
  frame: number,
  x: number,
  y: number,
  face: number,
  time: number,
  moving: boolean,
  perspective = 1
) {
  const frames = who === "terrier" ? terrier : who === "boxer" ? boxer : calf;
  const r = frames[frame] ?? frames[0];
  const key =
    who === "terrier"
      ? "02-terrier-sheet"
      : who === "boxer"
        ? "03-boxer-sheet"
        : "04-calf-sheet";
  // Fixed pixels-to-world scale preserves model proportions across irregular animation cells.
  const scale =
    (who === "terrier" ? 0.48 : who === "boxer" ? 0.65 : 0.66) * perspective;
  const w = r[2] * scale,
    h = r[3] * scale;
  c.save();
  c.fillStyle = "#49306555";
  c.beginPath();
  c.ellipse(x, y + 3, w * 0.37, 10, 0, 0, Math.PI * 2);
  c.fill();
  c.translate(
    x,
    y - (moving ? Math.abs(Math.sin(time * 13)) * 3 : Math.sin(time * 2) * 1.5)
  );
  c.scale(face > 0 ? -1 : 1, 1);
  c.translate(-w / 2, -h);
  c.scale(scale, scale);
  c.clip(silhouette(art[key], r));
  region(c, art, key, r, 0, 0, r[2], r[3]);
  c.restore();
}
function marker(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  time: number,
  label = ""
) {
  c.save();
  c.translate(x, y + Math.sin(time * 3) * 4);
  c.strokeStyle = "#fff8dc";
  c.lineWidth = 2;
  c.fillStyle = "#3d355caa";
  c.beginPath();
  c.arc(0, 0, 17, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  c.fillStyle = "#fff8dc";
  c.textAlign = "center";
  c.font = "600 15px sans-serif";
  c.fillText(label || "·", 0, 5);
  c.restore();
}
export function paint(
  c: CanvasRenderingContext2D,
  art: Art,
  s: Adventure,
  cam: number,
  moving: boolean,
  reduced: boolean,
  restored: number
) {
  const W = 1280,
    H = 800,
    G = 667,
    t = reduced ? 0 : s.time;
  c.clearRect(0, 0, W, H);
  if (s.chapter === "home") {
    c.drawImage(art["13-overlap"], 0, 0, 1536, 1024, 0, -27, W, 854);
    // Soft living detail over the final painting: petals drift while the family rests.
    for (let i = 0; i < restored; i++)
      prop(c, art, "beans", 865 + i * 65, 785, 95);
    petals(c, t, restored ? 50 : 22, W, H);
    return;
  }
  const courtyard = s.chapter === "courtyard";
  c.fillStyle = courtyard ? "#6ab9e7" : "#5bace3";
  c.fillRect(0, 0, W, H);
  c.drawImage(
    art[courtyard ? "05-courtyard-far" : "08-ranch-far"],
    -cam * 0.08,
    -140,
    1600,
    1067
  );
  if (s.chapter === "distortion") {
    prop(
      c,
      art,
      "ghost",
      950 - cam * 0.15,
      570,
      280,
      0.35 + Math.sin(t * 0.5) * 0.08
    );
  }
  c.drawImage(
    art[courtyard ? "06-courtyard-mid" : "09-ranch-mid"],
    -cam * 0.2,
    -363,
    1900,
    1267
  );
  c.save();
  c.translate(-cam, 0);
  if (courtyard) {
    prop(c, art, "hedge", 70, G + 5, 260);
    prop(c, art, "fountain", 820, G + 12, 310);
    prop(c, art, "pots", 1130, G + 8, 150);
    prop(c, art, "stairs", 1700, G + 35, 370);
    if (!s.item && !s.chase) prop(c, art, "ball", s.toy ?? 480, G + 3, 36);
    marker(c, 1690, 430, t, s.passage ? "↓" : "?");
  } else if (s.chapter === "pasture") {
    for (let i = 0; i < 3; i++)
      animal(
        c,
        art,
        "calf",
        7,
        1150 + i * 270,
        490 + i * 8,
        i % 2 ? 1 : -1,
        t,
        false,
        0.43
      );
    const cr: Rect = s.spooked ? [0, 0, 420, 345] : [0, 345, 420, 290];
    c.save();
    c.translate(s.coyote - cam * 0.0, 610);
    c.scale(s.spooked ? -0.48 : 0.48, 0.48);
    c.translate(-cr[2] / 2, -cr[3]);
    c.clip(silhouette(art["12-coyote-sheet-alpha"], cr));
    region(c, art, "12-coyote-sheet-alpha", cr, 0, 0, cr[2], cr[3]);
    c.restore();
    for (let i = 0; i < restored; i++)
      prop(c, art, "beans", 2200 + i * 90, G + 7, 110);

    if (!s.gate) prop(c, art, "gate", 1550, G + 5, 460);
    else {
      c.save();
      c.globalAlpha = 0.65;
      prop(c, art, "gate", 1480, G + 5, 160);
      c.restore();
    }
    prop(c, art, "sluice", 2010, G + 30, 255);
    prop(c, art, "tunnel", 85, G + 40, 255);
    if (!s.gate && !s.item && !s.chase)
      prop(c, art, "stick", s.toy ?? 1250, G + 10, 100);
    if (!s.water) {
      c.fillStyle = "#5fafd6bb";
      c.beginPath();
      c.moveTo(1750, G + 8);
      c.lineTo(1905, G + 8);
      c.lineTo(1960, 800);
      c.lineTo(1690, 800);
      c.fill();
      c.strokeStyle = "#c9f7ee";
      c.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        const y = G + 25 + i * 17;
        c.beginPath();
        c.moveTo(1750 + Math.sin(t * 2 + i) * 10, y);
        c.lineTo(1900 + Math.sin(t * 2 + i) * 10, y);
        c.stroke();
      }
    }
    for (let x = 2260; x < 2860; x += 180)
      prop(c, art, "beans", x, G + 12, 160);
    if (s.water) {
      prop(c, art, "hole", 2790, G + 170, 420, 0.9);
      prop(c, art, "ghost", 2540, 480, 230, 0.38);
    }
    if (s.metCalf)
      animal(
        c,
        art,
        "calf",
        Math.abs(s.calf - (s.boxer - 135)) > 20
          ? 1 + (Math.floor(t * 6) % 4)
          : 0,
        s.calf,
        G,
        Math.sign(s.boxer - s.calf),
        t,
        true
      );
    else animal(c, art, "calf", 0, s.calf, G, -1, t, false);
    if (!s.metCalf) marker(c, 1080, 440, t, "♡");
    if (s.gate && !s.water) marker(c, 2010, 420, t, "↻");
  } else {
    prop(c, art, "hole", 1460, 870, 850);
    prop(c, art, "sluice", 1070, G + 20, 240);
    if (!s.item && !s.tether) prop(c, art, "rope", 400, G + 5, 90);
    // Solid ledge advances upward with the opened waterway; animals are never hurt.
    const ledgeY = s.water ? G : 750;
    c.fillStyle = "#778383";
    c.fillRect(1330, ledgeY, 330, 27);
    c.fillStyle = "#b5c5b1";
    c.fillRect(1330, ledgeY, 330, 7);
    if (s.water) {
      c.fillStyle = "#6dbbc3aa";
      c.fillRect(1310, ledgeY + 27, 375, 130);
    }
    animal(c, art, "calf", s.rescued ? 0 : 6, s.calf, ledgeY, -1, t, false);
    if (s.tether) {
      c.strokeStyle = "#b98646";
      c.lineWidth = 6;
      c.beginPath();
      c.moveTo(s.boxer + 70, G - 90);
      c.quadraticCurveTo(870, G - 20, s.x - 35, G - 44 - s.jump);
      c.stroke();
    }
    marker(
      c,
      s.tether ? 1070 : 700,
      s.tether ? 430 : 550,
      t,
      s.tether ? "↻" : "∞"
    );
  }
  const boxerMoving = s.chase > 0 || Math.abs(s.boxer - (s.x - 160)) > 25;
  const boxerFace =
    s.chase && s.toy !== null
      ? Math.sign(s.toy - s.boxer)
      : s.chapter === "pasture" && !s.water && s.boxer > 1680
        ? -1
        : Math.sign(s.x - s.boxer);
  animal(
    c,
    art,
    "boxer",
    s.tether ? 7 : boxerMoving ? 1 + (Math.floor(t * 7) % 5) : 0,
    s.boxer,
    G,
    boxerFace,
    t,
    boxerMoving && !s.tether
  );
  if (s.chase && s.toy !== null)
    prop(
      c,
      art,
      courtyard ? "ball" : "stick",
      Math.abs(s.boxer - s.toy) < 40 ? s.boxer + boxerFace * 70 : s.toy,
      Math.abs(s.boxer - s.toy) < 40 ? G - 75 : G + 3,
      courtyard ? 34 : 80
    );
  const playerFrame =
    s.jump > 0
      ? 3
      : moving
        ? 1 + (Math.floor(t * 9) % 5)
        : s.metCalf && !s.gate && s.memory > 0 && s.chapter === "pasture"
          ? 7
          : 0;
  animal(c, art, "terrier", playerFrame, s.x, G - s.jump, s.facing, t, moving);
  if (s.item)
    prop(
      c,
      art,
      s.item,
      s.x + s.facing * 51,
      G - 24 - s.jump,
      s.item === "ball" ? 27 : s.item === "rope" ? 55 : 65
    );
  if (s.rescued) {
    marker(c, s.x + 45, G - 180, t, "♡");
  }
  // Foreground silhouettes use the painted asset sheet, with stronger parallax.
  if (!courtyard)
    for (let x = 100; x < CHAPTERS[s.chapter].width; x += 370)
      prop(c, art, "grass", x + Math.sin(t + x) * 2, 850, 160);
  const p = prompt(s);
  if (p) marker(c, s.x, G - 150 - s.jump, t, "E");
  c.restore();
  petals(c, t, courtyard ? 30 : 12, W, H);
}
function petals(
  c: CanvasRenderingContext2D,
  t: number,
  n: number,
  w: number,
  h: number
) {
  c.save();
  for (let i = 0; i < n; i++) {
    const x = ((i * 173.3 + t * (9 + (i % 5))) % (w + 30)) - 15;
    const y = ((i * 97.7 + t * (11 + (i % 3))) % (h + 40)) - 20;
    c.fillStyle = i % 2 ? "#ba85dcb0" : "#efb5dfb0";
    c.beginPath();
    c.ellipse(x, y, 3.5, 1.8, t + i, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}
