/**
 * Lantern City's own building set: Los Angeles, built in code.
 *
 * Every OpenStreetMap footprint on the board becomes one of twelve LA archetypes, generated at its
 * real size (nothing is stretched from a stock model), turned to face its real street, and picked
 * from the building's OSM type, height, footprint and neighbourhood:
 *
 *   craftsman · spanish · ranch · estate            houses
 *   dingbat · courtyard · walkup                    apartments
 *   storefront · office · tower · warehouse · garage  everything else
 *
 * The look is "stucco at blue hour": sun-bleached LA pastels and terracotta under an evening sky,
 * with the small lived-in things that make LA read as LA — porch lights, backyard pools, dingbat
 * starbursts, neon over the corner store, helipads and red beacons on the towers. Geometry carries a
 * per-vertex surface kind (K) and the shader in lanternWorld.ts does the rest (windows on the big
 * facades, tile ridges, awning stripes, pool light, neon), so a whole neighbourhood stays cheap.
 */
import * as THREE from "three";

/** vertical exaggeration so height still reads from the tilted board; the far boxes use it too */
export const VS = 1.3;
/** one storey, in world units */
export const FLOOR = 3.1 * VS;

/** surface kinds, read by the building shader */
export const K = {
  WALL: 0, ROOF: 1, GLASS: 2, TRIM: 3, POOL: 4, NEON: 5, LAMP: 6, GRID: 7, AWNING: 8, DARK: 9,
  CURTAIN: 10, TILE: 11, BREEZE: 12, SHUTTER: 13, CORRUGATED: 14, RIBBON: 15, BEACON: 16, SOLAR: 17, LAWN: 18,
} as const;

export type Arch =
  | "craftsman" | "spanish" | "ranch" | "estate"
  | "dingbat" | "courtyard" | "walkup"
  | "storefront" | "office" | "tower" | "warehouse" | "garage";

/** where and what a building is; cheap to make for a whole tile (shadows and orbs use it too) */
export type Plan = {
  i: number;
  arch: Arch;
  x: number; z: number;        // footprint centre
  fx: number; fz: number;      // unit direction the front faces (toward the street)
  W: number; D: number;        // width along the street, depth away from it
  H: number;                   // wall height, world units
  top: number;                 // highest point above the base (roof, crown), world units
  cx: number; cz: number;      // OSM centroid (the fog mask samples here)
  seed: number;
  pool: { x: number; z: number; w: number; d: number } | null;   // local, behind the house
};

export type PlanInput = {
  i: number; cx: number; cz: number; h: number; u: number; type: string; hood: string | null;
  x: number; z: number; fx: number; fz: number; W: number; D: number; fill: number;
};

type RGB = [number, number, number];
const hex = (h: string): RGB => { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const P = (...hs: string[]) => hs.map(hex);

// ----------------------------------------------------------------- palette: LA at blue hour
// LA stucco: bone and sand for the quiet streets, then the colours LA actually paints things —
// flamingo, mint, butter, sky, adobe, turquoise, marigold
const STUCCO = P("#efe0c6", "#f0c9a4", "#e3b98c", "#cfe0bf", "#b9d6e6", "#f2d67e", "#ec9f86", "#f3ece0", "#e7b3c8", "#eaa86c", "#9fd6c8", "#d98f6a", "#f6c75e", "#c7b7e0");
const CRAFT = P("#8d9c79", "#6f7f6b", "#a08160", "#bfa274", "#657582", "#8a6f5a", "#9aa58f");
const TILE_RED = P("#b85f3e", "#a9543a", "#c66f48", "#b4683f");
const SHINGLE = P("#4a4e56", "#5b5650", "#3f4a4f", "#5c4b44");
// flat roofs from above: white cool-roof coating, tan gravel, dark tar
const GRAVEL = P("#e4e0d6", "#dcd7cc", "#b3aa9b", "#a39b8e", "#7d7872", "#6c6864", "#c9c2b4");
const BRICK = P("#8e4f3d", "#9a5a44", "#7f4636");
const STONE = P("#a39b8f", "#b3aa9b", "#958c80");
const TOWER_STONE = P("#d9d2c4", "#c9c1b2", "#e3ddd2", "#bfb7ab");
const ACCENT = P("#e0782f", "#2f8f8a", "#f2c14e", "#d9534f", "#3b6ea8", "#7a4f9a");
const NEON = P("#ff4fa3", "#36e0ff", "#b6ff3b", "#ffb03b", "#ff5a3c", "#b77bff");
const AWNINGS = P("#d9534f", "#2f8f8a", "#3b6ea8", "#e0a22f", "#3d7a4f", "#2b2f36");
const CARS = P("#e8e4dc", "#2b2f36", "#b8bec6", "#9e2f2f", "#2f4f7a", "#d8c9a3", "#5a6b5a");
const WOOD = hex("#6b4a33"), CREAM = hex("#efe7d2"), WHITE = hex("#f4f2ec"), ALU = hex("#c9ced3"), CONCRETE = hex("#bdb8ae");
const GOLD_TRIM = hex("#d8b35a"), IRON = hex("#2e2b29"), WATER = hex("#39c6d6"), LAWN = hex("#6f9a5c"), DOOR_DARK = hex("#3a3230");

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length) % a.length];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ----------------------------------------------------------------- choosing the archetype
const HOUSE_MIX: Record<string, [Arch, number][]> = {
  "Silver Lake": [["craftsman", 0.34], ["spanish", 0.33], ["ranch", 0.33]],
  "Los Feliz": [["spanish", 0.42], ["craftsman", 0.28], ["ranch", 0.3]],
  "East Hollywood": [["craftsman", 0.45], ["spanish", 0.4], ["ranch", 0.15]],
  Hollywood: [["spanish", 0.46], ["craftsman", 0.3], ["ranch", 0.24]],
  "West Hollywood": [["spanish", 0.55], ["ranch", 0.25], ["craftsman", 0.2]],
  "Beverly Hills": [["spanish", 0.42], ["ranch", 0.4], ["craftsman", 0.18]],
  "Century City": [["ranch", 0.5], ["spanish", 0.4], ["craftsman", 0.1]],
  Koreatown: [["craftsman", 0.52], ["spanish", 0.34], ["ranch", 0.14]],
  "Mid-Wilshire": [["spanish", 0.45], ["craftsman", 0.4], ["ranch", 0.15]],
  "Hancock Park": [["spanish", 0.45], ["craftsman", 0.35], ["ranch", 0.2]],
  "Windsor Square": [["spanish", 0.4], ["craftsman", 0.4], ["ranch", 0.2]],
  Larchmont: [["craftsman", 0.45], ["spanish", 0.4], ["ranch", 0.15]],
  Fairfax: [["spanish", 0.6], ["craftsman", 0.2], ["ranch", 0.2]],
  "Beverly Grove": [["spanish", 0.58], ["ranch", 0.24], ["craftsman", 0.18]],
  Carthay: [["spanish", 0.62], ["craftsman", 0.2], ["ranch", 0.18]],
};
const ESTATE_HOODS = new Set(["Beverly Hills", "Hancock Park", "Windsor Square", "Los Feliz"]);
const POOL_ODDS: Record<string, number> = {
  "Beverly Hills": 0.72, "Hancock Park": 0.55, "Windsor Square": 0.5, "Los Feliz": 0.42, "Silver Lake": 0.34,
  Hollywood: 0.3, "Century City": 0.4, "West Hollywood": 0.22, Carthay: 0.2, "Beverly Grove": 0.18,
};
const COURTYARD_HOODS = new Set(["West Hollywood", "Hollywood", "Los Feliz", "Beverly Grove", "Fairfax", "Carthay", "Silver Lake"]);
const BRICK_HOODS = new Set(["Koreatown", "Mid-Wilshire", "Hollywood", "East Hollywood"]);

function houseArch(r: () => number, hood: string | null, area: number, floors: number): Arch {
  if ((area > 260 || floors >= 2) && ESTATE_HOODS.has(hood ?? "") && r() < 0.75) return "estate";
  if (area > 330 && r() < 0.5) return "estate";
  const mix = HOUSE_MIX[hood ?? ""] ?? [["craftsman", 0.34], ["spanish", 0.33], ["ranch", 0.33]];
  let x = r();
  for (const [a, w] of mix) { if ((x -= w) <= 0) return a; }
  return mix[0][0];
}

/**
 * Decide what a footprint is. `blocked` says whether a world point is inside another footprint,
 * so backyard pools never land on the neighbours.
 */
export function planLA(b: PlanInput, blocked: (x: number, z: number) => boolean): Plan {
  const r = rng(b.i * 7 + 3);
  // OSM footprints are rarely rectangles: shrink the box toward the real area so neighbours don't collide
  const shrink = Math.sqrt(clamp(b.fill / 0.82, 0.55, 1));
  const W = Math.max(3, b.W * 0.94 * shrink), D = Math.max(3, b.D * 0.94 * shrink);
  const area = W * D;
  const hm = b.h > 0.5 ? b.h : b.type === "house" ? 4.5 : 7;
  const floors = Math.max(1, Math.round(hm / 3.2));
  const t = b.type;
  let arch: Arch;
  if (hm >= 34) arch = "tower";
  else if (t === "garage" || (area < 40 && hm < 5)) arch = "garage";
  else if (t === "industrial" || ((t === "yes" || t === "other" || t === "commercial") && area > 1400 && hm < 12)) arch = "warehouse";
  else if (t === "house" || ((t === "yes" || t === "other") && area < 260 && hm < 9)) arch = houseArch(r, b.hood, area, floors);
  else if (t === "apartments" || t === "residential" || t === "yes" || t === "other") {
    if (floors >= 4 || hm > 12.5) arch = "walkup";
    else if (area > 430 && Math.min(W, D) > 15 && (COURTYARD_HOODS.has(b.hood ?? "") ? r() < 0.62 : r() < 0.3)) arch = "courtyard";
    else if (area < 110) arch = houseArch(r, b.hood, area, floors);
    else arch = r() < 0.74 ? "dingbat" : "walkup";
  } else if (t === "retail" || t === "commercial") arch = hm > 12.5 ? "office" : "storefront";
  else if (t === "church") arch = "spanish";
  else arch = hm > 9 ? "office" : r() < 0.6 ? "storefront" : "office";

  let H: number;
  switch (arch) {
    case "craftsman": case "ranch": H = FLOOR * (hm > 7.5 && arch === "craftsman" ? 1.5 : 1); break;
    case "spanish": H = FLOOR * (hm > 7.5 ? 2 : 1); break;
    case "estate": H = FLOOR * 2; break;
    case "dingbat": H = FLOOR * clamp(floors, 2, 3); break;
    case "courtyard": H = FLOOR * clamp(floors, 2, 3); break;
    case "storefront": H = FLOOR * (hm > 7.5 ? 2 : 1) * 1.1; break;
    case "garage": H = FLOOR * 0.85; break;
    case "warehouse": H = clamp(hm * VS, FLOOR * 1.6, FLOOR * 3); break;
    default: H = Math.max(FLOOR * 3, hm * VS);
  }
  const roofRise: Partial<Record<Arch, number>> = {
    craftsman: Math.min(W, D) * 0.26, spanish: Math.min(W, D) * 0.2, estate: Math.min(W, D) * 0.22,
    courtyard: 3, warehouse: W * 0.12, tower: FLOOR * 1.2, walkup: FLOOR, office: FLOOR,
  };
  const top = H + (roofRise[arch] ?? 1.2);

  let pool: Plan["pool"] = null;
  const houseLike = arch === "craftsman" || arch === "spanish" || arch === "ranch" || arch === "estate";
  if (houseLike && r() < (POOL_ODDS[b.hood ?? ""] ?? 0.12) + (arch === "estate" ? 0.25 : 0)) {
    // try the backyard first, then either side yard; the first spot clear of every footprint wins
    const toW = (x: number, z: number) => [b.x + x * b.fz + z * b.fx, b.z - x * b.fx + z * b.fz] as const;
    const clear = (cx: number, cz: number, w: number, d: number) => [[cx, cz], [cx - w / 2 - 0.4, cz - d / 2 - 0.4], [cx + w / 2 + 0.4, cz - d / 2 - 0.4], [cx - w / 2 - 0.4, cz + d / 2 + 0.4], [cx + w / 2 + 0.4, cz + d / 2 + 0.4]]
      .every(([x, z]) => { const [wx, wz] = toW(x, z); return !blocked(wx, wz); });
    const w = clamp(W * 0.42, 3.0, 6.5), d = clamp(w * 0.5, 2.0, 3.8), ox = (r() - 0.5) * Math.max(0, W - w) * 0.6;
    const spots: [number, number, number, number][] = [
      [ox, -D / 2 - 1.4 - d / 2, w, d], [ox, -D / 2 - 3.2 - d / 2, w, d], [-ox, -D / 2 - 5.5 - d / 2, w * 0.85, d * 0.85],
      [W / 2 + 1.4 + d / 2, -D * 0.15, d, w], [-W / 2 - 1.4 - d / 2, -D * 0.15, d, w],
    ];
    for (const [x, z, pw, pd] of spots) if (clear(x, z, pw, pd)) { pool = { x, z, w: pw, d: pd }; break; }
  }
  return { i: b.i, arch, x: b.x, z: b.z, fx: b.fx, fz: b.fz, W, D, H, top, cx: b.cx, cz: b.cz, seed: r(), pool };
}

/** the building's rectangle in world space, for its evening shadow */
export function planCorners(p: Plan): [number, number][] {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const x = (sx * p.W) / 2, z = (sz * p.D) / 2;
    return [p.x + x * p.fz + z * p.fx, p.z - x * p.fx + z * p.fz];
  });
}

// ----------------------------------------------------------------- geometry
type V3 = [number, number, number];

class Mesher {
  P: number[] = []; N: number[] = []; C: number[] = []; Kd: number[] = []; A: number[] = []; I: number[] = [];
  private ox = 0; private oy = 0; private oz = 0; private fx = 0; private fz = 1;
  private a: [number, number, number, number] = [0, 0, 0, 0];
  begin(p: Plan, y0: number) {
    this.ox = p.x; this.oy = y0; this.oz = p.z; this.fx = p.fx; this.fz = p.fz;
    this.a = [p.cx, p.cz, y0, p.seed];
  }
  /** a flat convex polygon; `hint` is roughly the outward direction (winding is fixed to match) */
  poly(pts: V3[], c: RGB, k: number, hint: V3) {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { pts = pts.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    const wnx = nx * this.fz + nz * this.fx, wnz = -nx * this.fx + nz * this.fz;
    const base = this.P.length / 3;
    for (const [x, y, z] of pts) {
      this.P.push(this.ox + x * this.fz + z * this.fx, this.oy + y, this.oz - x * this.fx + z * this.fz);
      this.N.push(wnx, ny, wnz);
      this.C.push(c[0], c[1], c[2]);
      this.Kd.push(k);
      this.A.push(this.a[0], this.a[1], this.a[2], this.a[3]);
    }
    for (let i = 1; i < pts.length - 1; i++) this.I.push(base, base + i, base + i + 1);
  }
  /** rectangle on a wall plane: outward normal (nx,nz), plane at distance d, spanning a0..a1 along it */
  wall(nx: number, nz: number, d: number, a0: number, a1: number, y0: number, y1: number, off: number, c: RGB, k: number) {
    const ux = nz, uz = -nx, px = nx * (d + off), pz = nz * (d + off);
    this.poly([[px + ux * a0, y0, pz + uz * a0], [px + ux * a1, y0, pz + uz * a1], [px + ux * a1, y1, pz + uz * a1], [px + ux * a0, y1, pz + uz * a0]], c, k, [nx, 0, nz]);
  }
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: RGB, k: number, o: { top?: RGB | null; topK?: number; skip?: string; bottom?: RGB; sideK?: number } = {}) {
    const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const sk = o.skip ?? "", k2 = o.sideK ?? k;
    const face = (nx: number, nz: number, d: number, half: number, kk: number, tag: string) => {
      if (sk.includes(tag)) return;
      const ux = nz, uz = -nx, px = mx + nx * d, pz = mz + nz * d;
      this.poly([[px - ux * half, y0, pz - uz * half], [px + ux * half, y0, pz + uz * half], [px + ux * half, y1, pz + uz * half], [px - ux * half, y1, pz - uz * half]], c, kk, [nx, 0, nz]);
    };
    face(0, 1, hz, hx, k, "f"); face(0, -1, hz, hx, k2, "b"); face(-1, 0, hx, hz, k2, "l"); face(1, 0, hx, hz, k2, "r");
    if (o.top !== null) this.poly([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], o.top ?? c, o.topK ?? k, [0, 1, 0]);
    if (o.bottom) this.poly([[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]], o.bottom, K.DARK, [0, -1, 0]);
  }
  /** gable roof over x0..x1 × z0..z1 from height y, ridge along x ("x") or z ("z") */
  gable(x0: number, x1: number, z0: number, z1: number, y: number, h: number, along: "x" | "z", oh: number, c: RGB, k: number, gableC: RGB) {
    if (along === "x") {
      const zm = (z0 + z1) / 2;
      this.poly([[x0 - oh, y - oh * 0.3, z1 + oh], [x1 + oh, y - oh * 0.3, z1 + oh], [x1 + oh, y + h, zm], [x0 - oh, y + h, zm]], c, k, [0, 1, 1]);
      this.poly([[x1 + oh, y - oh * 0.3, z0 - oh], [x0 - oh, y - oh * 0.3, z0 - oh], [x0 - oh, y + h, zm], [x1 + oh, y + h, zm]], c, k, [0, 1, -1]);
      this.poly([[x0, y, z0], [x0, y, z1], [x0, y + h * 0.97, zm]], gableC, K.WALL, [-1, 0, 0]);
      this.poly([[x1, y, z1], [x1, y, z0], [x1, y + h * 0.97, zm]], gableC, K.WALL, [1, 0, 0]);
    } else {
      const xm = (x0 + x1) / 2;
      this.poly([[x1 + oh, y - oh * 0.3, z0 - oh], [x1 + oh, y - oh * 0.3, z1 + oh], [xm, y + h, z1 + oh], [xm, y + h, z0 - oh]], c, k, [1, 1, 0]);
      this.poly([[x0 - oh, y - oh * 0.3, z1 + oh], [x0 - oh, y - oh * 0.3, z0 - oh], [xm, y + h, z0 - oh], [xm, y + h, z1 + oh]], c, k, [-1, 1, 0]);
      this.poly([[x0, y, z1], [x1, y, z1], [xm, y + h * 0.97, z1]], gableC, K.WALL, [0, 0, 1]);
      this.poly([[x1, y, z0], [x0, y, z0], [xm, y + h * 0.97, z0]], gableC, K.WALL, [0, 0, -1]);
    }
  }
  hip(x0: number, x1: number, z0: number, z1: number, y: number, h: number, oh: number, c: RGB, k: number) {
    x0 -= oh; x1 += oh; z0 -= oh; z1 += oh; y -= oh * 0.3;
    const w = x1 - x0, d = z1 - z0;
    if (w >= d) {
      const zm = (z0 + z1) / 2, r0 = x0 + d / 2, r1 = x1 - d / 2;
      this.poly([[x0, y, z1], [x1, y, z1], [r1, y + h, zm], [r0, y + h, zm]], c, k, [0, 1, 1]);
      this.poly([[x1, y, z0], [x0, y, z0], [r0, y + h, zm], [r1, y + h, zm]], c, k, [0, 1, -1]);
      this.poly([[x0, y, z0], [x0, y, z1], [r0, y + h, zm]], c, k, [-1, 1, 0]);
      this.poly([[x1, y, z1], [x1, y, z0], [r1, y + h, zm]], c, k, [1, 1, 0]);
    } else {
      const xm = (x0 + x1) / 2, r0 = z0 + w / 2, r1 = z1 - w / 2;
      this.poly([[x1, y, z0], [x1, y, z1], [xm, y + h, r1], [xm, y + h, r0]], c, k, [1, 1, 0]);
      this.poly([[x0, y, z1], [x0, y, z0], [xm, y + h, r0], [xm, y + h, r1]], c, k, [-1, 1, 0]);
      this.poly([[x0, y, z1], [x1, y, z1], [xm, y + h, r1]], c, k, [0, 1, 1]);
      this.poly([[x1, y, z0], [x0, y, z0], [xm, y + h, r0]], c, k, [0, 1, -1]);
    }
  }
  /** a flat roof with a parapet: roof surface, the parapet's inner faces and a coping */
  flatRoof(x0: number, x1: number, z0: number, z1: number, y: number, par: number, roof: RGB, coping: RGB, copingK: number = K.TRIM) {
    const t = 0.35;
    this.poly([[x0 + t, y, z0 + t], [x0 + t, y, z1 - t], [x1 - t, y, z1 - t], [x1 - t, y, z0 + t]], roof, K.ROOF, [0, 1, 0]);
    if (par <= 0) return;
    const yt = y + par;
    this.poly([[x0 + t, y, z1 - t], [x1 - t, y, z1 - t], [x1 - t, yt, z1 - t], [x0 + t, yt, z1 - t]], roof, K.WALL, [0, 0, -1]);
    this.poly([[x0 + t, y, z0 + t], [x1 - t, y, z0 + t], [x1 - t, yt, z0 + t], [x0 + t, yt, z0 + t]], roof, K.WALL, [0, 0, 1]);
    this.poly([[x0 + t, y, z0 + t], [x0 + t, y, z1 - t], [x0 + t, yt, z1 - t], [x0 + t, yt, z0 + t]], roof, K.WALL, [1, 0, 0]);
    this.poly([[x1 - t, y, z0 + t], [x1 - t, y, z1 - t], [x1 - t, yt, z1 - t], [x1 - t, yt, z0 + t]], roof, K.WALL, [-1, 0, 0]);
    // coping: a thin cap along the top of the parapet, not across the roof
    this.poly([[x0, yt, z1 - t], [x0, yt, z1], [x1, yt, z1], [x1, yt, z1 - t]], coping, copingK, [0, 1, 0]);
    this.poly([[x0, yt, z0], [x0, yt, z0 + t], [x1, yt, z0 + t], [x1, yt, z0]], coping, copingK, [0, 1, 0]);
    this.poly([[x0, yt, z0 + t], [x0, yt, z1 - t], [x0 + t, yt, z1 - t], [x0 + t, yt, z0 + t]], coping, copingK, [0, 1, 0]);
    this.poly([[x1 - t, yt, z0 + t], [x1 - t, yt, z1 - t], [x1, yt, z1 - t], [x1, yt, z0 + t]], coping, copingK, [0, 1, 0]);
  }
  /** a framed window (or door) on a wall plane */
  win(nx: number, nz: number, d: number, a: number, yb: number, w: number, h: number, frame: RGB, k: number = K.GLASS, glass: RGB = hex("#2a3444")) {
    this.wall(nx, nz, d, a - w / 2 - 0.16, a + w / 2 + 0.16, yb - 0.16, yb + h + 0.16, 0.05, frame, K.TRIM);
    this.wall(nx, nz, d, a - w / 2, a + w / 2, yb, yb + h, 0.09, glass, k);
  }
  /** a window whose top is a half circle */
  arched(nx: number, nz: number, d: number, a: number, yb: number, w: number, h: number, frame: RGB) {
    this.win(nx, nz, d, a, yb, w, h, frame);
    const ux = nz, uz = -nx, r = w / 2, cy = yb + h;
    for (const [off, rr, cc, kk] of [[0.05, r + 0.16, frame, K.TRIM], [0.09, r, hex("#2a3444"), K.GLASS]] as const) {
      const px = nx * (d + off), pz = nz * (d + off), pts: V3[] = [[px + ux * a, cy, pz + uz * a]];
      for (let s = 0; s <= 6; s++) { const t = Math.PI * (s / 6); pts.push([px + ux * (a + Math.cos(t) * rr), cy + Math.sin(t) * rr, pz + uz * (a + Math.cos(t) * rr)]); }
      for (let s = 1; s < pts.length - 1; s++) this.poly([pts[0], pts[s], pts[s + 1]], cc, kk, [nx, 0, nz]);
    }
  }
  /** evenly spaced windows along a wall, on every storey from y0 */
  row(nx: number, nz: number, d: number, len: number, y0: number, floors: number, fh: number, w: number, h: number, frame: RGB, sill = 0.32, mid = 0) {
    const n = Math.max(1, Math.floor((len - 1) / (w + 1.4)));
    for (let f = 0; f < floors; f++) for (let q = 0; q < n; q++) {
      const a = mid - len / 2 + (len / n) * (q + 0.5);
      this.win(nx, nz, d, a, y0 + f * fh + fh * sill, w, h, frame);
    }
  }
  car(x: number, z: number, along: "x" | "z", c: RGB) {
    const [l, w] = along === "x" ? [4.4, 1.9] : [1.9, 4.4];
    this.box(x - l / 2, x + l / 2, 0.3, 1.25, z - w / 2, z + w / 2, c, K.TRIM);
    const [l2, w2] = along === "x" ? [2.3, 1.7] : [1.7, 2.3];
    this.box(x - l2 / 2, x + l2 / 2, 1.25, 1.95, z - w2 / 2, z + w2 / 2, hex("#26303c"), K.GLASS, { top: c, topK: K.TRIM });
  }
  ac(x: number, z: number, y: number) {
    this.box(x - 0.8, x + 0.8, y, y + 1.1, z - 0.7, z + 0.7, ALU, K.TRIM);
  }
  /** the things that live on an LA flat roof: skylights, vents, a hatch, AC units */
  clutter(x0: number, x1: number, z0: number, z1: number, y: number, r: () => number, n: number) {
    const w = x1 - x0, d = z1 - z0;
    for (let q = 0; q < n; q++) {
      const x = x0 + 1.2 + r() * Math.max(0.1, w - 2.4), z = z0 + 1.2 + r() * Math.max(0.1, d - 2.4), kind = r();
      if (kind < 0.35) this.ac(x, z, y);
      else if (kind < 0.6) this.box(x - 0.9, x + 0.9, y, y + 0.35, z - 0.6, z + 0.6, hex("#9fb4c4"), K.GLASS, { top: hex("#a9c3d6"), topK: K.GLASS });
      else if (kind < 0.8) this.box(x - 0.2, x + 0.2, y, y + 0.9, z - 0.2, z + 0.2, hex("#8a8c8f"), K.TRIM);
      else this.box(x - 0.6, x + 0.6, y, y + 0.5, z - 0.6, z + 0.6, hex("#6f6a64"), K.TRIM);
    }
  }
  /** ground around the building: a lawn out front for houses, a concrete apron for everything else */
  lot(W: number, D: number, lawn: boolean, r: () => number) {
    const y = 0.14, front = lawn ? 3.6 : 2.2;
    const c = lawn ? pick(r, [hex("#7f9a5e"), hex("#8fa266"), hex("#9a9b62")]) : pick(r, [hex("#b9b3a7"), hex("#c4bdb0"), hex("#a9a398")]);
    this.poly([[-W / 2 - 1.2, y, -D / 2 - 1.2], [-W / 2 - 1.2, y, D / 2 + front], [W / 2 + 1.2, y, D / 2 + front], [W / 2 + 1.2, y, -D / 2 - 1.2]], c, lawn ? K.LAWN : K.ROOF, [0, 1, 0]);
    if (lawn) this.poly([[-0.7, y + 0.04, D / 2], [-0.7, y + 0.04, D / 2 + front], [0.7, y + 0.04, D / 2 + front], [0.7, y + 0.04, D / 2]], hex("#cfc6b6"), K.TRIM, [0, 1, 0]);
  }
  pool(p: NonNullable<Plan["pool"]>, y: number) {
    const { x, z, w, d } = p, c = 0.5;
    this.box(x - w / 2 - c, x + w / 2 + c, y - 0.2, y + 0.35, z + d / 2, z + d / 2 + c, WHITE, K.TRIM, { skip: "" });
    this.box(x - w / 2 - c, x + w / 2 + c, y - 0.2, y + 0.35, z - d / 2 - c, z - d / 2, WHITE, K.TRIM);
    this.box(x - w / 2 - c, x - w / 2, y - 0.2, y + 0.35, z - d / 2, z + d / 2, WHITE, K.TRIM);
    this.box(x + w / 2, x + w / 2 + c, y - 0.2, y + 0.35, z - d / 2, z + d / 2, WHITE, K.TRIM);
    this.poly([[x - w / 2, y + 0.18, z - d / 2], [x - w / 2, y + 0.18, z + d / 2], [x + w / 2, y + 0.18, z + d / 2], [x + w / 2, y + 0.18, z - d / 2]], WATER, K.POOL, [0, 1, 0]);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(Int8Array.from(this.N, v => Math.round(v * 127)), 3, true));
    g.setAttribute("aCol", new THREE.BufferAttribute(Uint8Array.from(this.C, v => Math.round(clamp(v, 0, 1) * 255)), 3, true));
    g.setAttribute("aK", new THREE.BufferAttribute(Uint8Array.from(this.Kd), 1, false));
    g.setAttribute("aC", new THREE.Float32BufferAttribute(this.A, 4));
    const n = this.P.length / 3;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// ----------------------------------------------------------------- the archetypes (local frame: +z is the street side)
const BASE = -2.4;   // walls run below grade so hillside lots never float

function craftsman(m: Mesher, p: Plan, r: () => number) {
  const { W, D, H } = p;
  const body = pick(r, CRAFT), trim = r() < 0.7 ? CREAM : WHITE, roof = pick(r, SHINGLE), stone = pick(r, STONE);
  const pd = clamp(D * 0.2, 1.6, 2.6), zf = D / 2 - pd, zb = -D / 2;
  const wh = Math.min(H, FLOOR);
  m.box(-W / 2, W / 2, BASE, wh, zb, zf, body, K.WALL, { top: null });
  const rise = Math.min(W, D) * 0.26;
  m.gable(-W / 2, W / 2, zb, zf, wh, rise, "z", 0.75, roof, K.ROOF, body);
  if (H > FLOOR * 1.2) {   // a dormer on the roof
    const dw = Math.min(3.2, W * 0.35);
    m.box(-dw / 2, dw / 2, wh + rise * 0.2, wh + rise * 0.75, zf - 3.2, zf - 1.2, body, K.WALL, { top: null });
    m.gable(-dw / 2, dw / 2, zf - 3.2, zf - 1.2, wh + rise * 0.75, 0.9, "z", 0.25, roof, K.ROOF, body);
    m.win(0, 1, zf - 1.2, 0, wh + rise * 0.3, 1.4, 0.9, trim);
  }
  // porch: slab, stone piers with tapered posts, its own low gable
  m.box(-W / 2 + 0.3, W / 2 - 0.3, BASE, 0.5, zf, D / 2, stone, K.TRIM);
  const cols = W > 11 ? [-W / 2 + 0.9, -W / 6, W / 6, W / 2 - 0.9] : [-W / 2 + 0.9, W / 2 - 0.9];
  for (const x of cols) {
    m.box(x - 0.45, x + 0.45, 0.5, 1.9, D / 2 - 0.95, D / 2 - 0.05, stone, K.TRIM);
    m.box(x - 0.24, x + 0.24, 1.9, wh - 0.3, D / 2 - 0.74, D / 2 - 0.26, trim, K.TRIM);
  }
  m.gable(-W / 2 + 0.2, W / 2 - 0.2, zf - 0.4, D / 2 + 0.1, wh - 0.35, pd * 0.42, "x", 0.35, roof, K.ROOF, body);
  // front: door, paired windows either side, a porch light
  m.win(0, 1, zf, 0, 0.5, 1.05, 2.5, trim, K.DARK, WOOD);
  m.box(1.0, 1.25, 2.9, 3.3, zf, zf + 0.2, hex("#ffd28a"), K.LAMP);
  for (const s of [-1, 1]) { const a = s * Math.min(W * 0.3, 3.3); m.win(0, 1, zf, a - 0.62, 1.2, 1.0, 1.7, trim); m.win(0, 1, zf, a + 0.62, 1.2, 1.0, 1.7, trim); }
  m.row(-1, 0, W / 2, D - pd, 0.1, 1, FLOOR, 1.0, 1.6, trim, 0.3, -pd / 2);
  m.row(1, 0, W / 2, D - pd, 0.1, 1, FLOOR, 1.0, 1.6, trim, 0.3, pd / 2);
  m.row(0, -1, -zb, W, 0.1, 1, FLOOR, 1.0, 1.5, trim, 0.3);
  // brick chimney up the side wall
  const cz = zb + (zf - zb) * 0.4;
  m.box(-W / 2 - 1.0, -W / 2 + 0.1, BASE, wh + rise * 0.85 + 1.2, cz - 0.6, cz + 0.6, pick(r, BRICK), K.TRIM);
}

function spanish(m: Mesher, p: Plan, r: () => number) {
  const { W, D, H } = p;
  const body = pick(r, STUCCO), tile = pick(r, TILE_RED), trim = r() < 0.5 ? hex("#3f4a3c") : hex("#5b3a2a");
  const floors = H > FLOOR * 1.4 ? 2 : 1, wh = floors * FLOOR;
  m.box(-W / 2, W / 2, BASE, wh, -D / 2, D / 2, body, K.WALL, { top: null });
  if (r() < 0.62 || floors === 2) m.hip(-W / 2, W / 2, -D / 2, D / 2, wh, Math.min(W, D) * 0.2, 0.4, tile, K.TILE);
  else {
    m.flatRoof(-W / 2, W / 2, -D / 2, D / 2, wh, 0.9, pick(r, GRAVEL), tile, K.TILE);
    // a tiled shed roof over the front rooms
    m.poly([[-W / 2 - 0.3, wh - 0.2, D / 2 + 0.5], [W / 2 + 0.3, wh - 0.2, D / 2 + 0.5], [W / 2 + 0.3, wh + 1.4, D / 2 - 2.6], [-W / 2 - 0.3, wh + 1.4, D / 2 - 2.6]], tile, K.TILE, [0, 1, 1]);
  }
  // the arched picture window, and an entry vestibule with its own little tiled gable
  const side = r() < 0.5 ? -1 : 1, ea = -side * Math.min(W * 0.26, 2.6);
  m.arched(0, 1, D / 2, side * Math.min(W * 0.22, 2.4), 1.0, 2.3, 1.7, trim);
  m.box(ea - 1.0, ea + 1.0, BASE, FLOOR * 0.82, D / 2, D / 2 + 1.1, body, K.WALL, { top: null });
  m.gable(ea - 1.0, ea + 1.0, D / 2, D / 2 + 1.1, FLOOR * 0.82, 0.9, "z", 0.2, tile, K.TILE, body);
  m.win(0, 1, D / 2 + 1.1, ea, 0.3, 0.95, 2.4, trim, K.DARK, WOOD);
  m.box(ea + 0.75, ea + 0.95, 2.7, 3.1, D / 2 + 1.1, D / 2 + 1.3, hex("#ffd28a"), K.LAMP);
  if (floors === 2) m.row(0, 1, D / 2, W, FLOOR, 1, FLOOR, 1.0, 1.5, trim, 0.3);
  m.row(-1, 0, W / 2, D, 0, floors, FLOOR, 0.95, 1.5, trim, 0.32);
  m.row(1, 0, W / 2, D, 0, floors, FLOOR, 0.95, 1.5, trim, 0.32);
  m.row(0, -1, D / 2, W, 0, floors, FLOOR, 0.95, 1.4, trim, 0.32);
  // stucco chimney with a tiled cap
  const cx = (side > 0 ? -1 : 1) * (W / 2 - 0.7);
  m.box(cx - 0.6, cx + 0.6, wh - 1, wh + Math.min(W, D) * 0.2 + 1.6, -D * 0.15 - 0.5, -D * 0.15 + 0.5, body, K.WALL);
  m.gable(cx - 0.7, cx + 0.7, -D * 0.15 - 0.6, -D * 0.15 + 0.6, wh + Math.min(W, D) * 0.2 + 1.6, 0.4, "x", 0.1, tile, K.TILE, body);
}

function ranch(m: Mesher, p: Plan, r: () => number) {
  const { W, D } = p;
  const body = r() < 0.6 ? pick(r, [WHITE, hex("#efe9dd"), hex("#e6e1d6")]) : pick(r, STUCCO);
  const accent = pick(r, ACCENT), stone = pick(r, STONE), wh = FLOOR * 0.95;
  m.box(-W / 2, W / 2, BASE, wh, -D / 2, D / 2, body, K.WALL, { top: null });
  // the flat roof slab floats past the walls
  const oh = 1.3, carport = W > 11 || r() < 0.45, cw = carport ? 5.4 : 0, cs = r() < 0.5 ? -1 : 1;
  const x0 = -W / 2 - oh - (cs < 0 ? cw : 0), x1 = W / 2 + oh + (cs > 0 ? cw : 0);
  m.box(x0, x1, wh, wh + 0.5, -D / 2 - oh * 0.6, D / 2 + oh, WHITE, K.TRIM, { top: pick(r, GRAVEL), topK: K.ROOF, bottom: hex("#b9b2a6") });
  // clerestory band and a full-height glass corner
  m.wall(0, 1, D / 2, -W / 2 + 0.6, W / 2 - 0.6, wh - 0.9, wh - 0.15, 0.07, hex("#2a3444"), K.GLASS);
  const gs = -cs;
  m.wall(0, 1, D / 2, gs < 0 ? -W / 2 + 0.4 : W * 0.1, gs < 0 ? -W * 0.1 : W / 2 - 0.4, 0.3, wh - 1.2, 0.08, hex("#2a3444"), K.GLASS);
  // stone veneer and a breeze-block screen by the door
  m.wall(0, 1, D / 2, gs < 0 ? W * 0.1 : -W / 2, gs < 0 ? W / 2 : -W * 0.1, BASE, wh - 1.0, 0.04, stone, K.WALL);
  const da = gs < 0 ? W * 0.02 : -W * 0.02;
  m.win(0, 1, D / 2, da, 0.2, 1.1, 2.5, WHITE, K.DARK, accent);
  m.box(da - 3.6 * gs - 1.2, da - 3.6 * gs + 1.2, 0, wh - 0.2, D / 2 + 0.9, D / 2 + 1.25, hex("#f0ece4"), K.BREEZE);
  m.box(da + 0.8, da + 1.0, 2.6, 3.0, D / 2, D / 2 + 0.2, hex("#ffd28a"), K.LAMP);
  m.row(-1, 0, W / 2, D, 0, 1, FLOOR, 1.8, 1.4, WHITE, 0.35);
  m.row(1, 0, W / 2, D, 0, 1, FLOOR, 1.8, 1.4, WHITE, 0.35);
  m.wall(0, -1, D / 2, -W / 2 + 1, W / 2 - 1, 0.3, wh - 0.5, 0.08, hex("#2a3444"), K.GLASS);
  if (carport) {
    const px = cs * (W / 2 + oh + cw - 0.5);
    for (const z of [D / 2 - 0.2, -D / 2 + 1.2]) m.box(px - 0.15, px + 0.15, 0, wh, z - 0.15, z + 0.15, WHITE, K.TRIM);
    m.car(cs * (W / 2 + 0.6 + cw / 2), 0, "z", pick(r, CARS));
  }
  if (r() < 0.35) m.box(-W * 0.3, W * 0.1, wh + 0.5, wh + 0.65, -D * 0.35, D * 0.05, hex("#1f2d4a"), K.SOLAR);
}

function estate(m: Mesher, p: Plan, r: () => number) {
  const { W, D } = p;
  const body = pick(r, STUCCO), tile = r() < 0.6, roofC = tile ? pick(r, TILE_RED) : hex("#4b5058");
  const trim = WHITE, shutter = pick(r, [hex("#2f4a3a"), hex("#233447"), hex("#3a3a3a")]), wh = FLOOR * 2;
  m.box(-W / 2, W / 2, BASE, wh, -D / 2, D / 2, body, K.WALL, { top: null });
  m.box(-W / 2 - 0.15, W / 2 + 0.15, wh - 0.5, wh, -D / 2 - 0.15, D / 2 + 0.15, trim, K.TRIM, { top: null });
  m.hip(-W / 2, W / 2, -D / 2, D / 2, wh, Math.min(W, D) * 0.22, 0.55, roofC, tile ? K.TILE : K.ROOF);
  // symmetric windows with shutters
  const n = Math.max(2, Math.floor(W / 3.3) | 0);
  for (let f = 0; f < 2; f++) for (let q = 0; q < n; q++) {
    const a = -W / 2 + (W / n) * (q + 0.5);
    if (f === 0 && Math.abs(a) < 1.9) continue;
    m.win(0, 1, D / 2, a, f * FLOOR + 1.0, 1.1, 1.9, trim);
    if (!tile) for (const s of [-1, 1]) m.wall(0, 1, D / 2, a + s * 0.95 - 0.35, a + s * 0.95 + 0.35, f * FLOOR + 0.9, f * FLOOR + 3.0, 0.1, shutter, K.TRIM);
  }
  // portico: columns, a flat roof and a balcony rail
  m.box(-1.9, 1.9, BASE, 0.6, D / 2, D / 2 + 2.2, hex("#d8d2c6"), K.TRIM);
  for (const x of [-1.6, 1.6]) m.box(x - 0.28, x + 0.28, 0.6, FLOOR, D / 2 + 1.6, D / 2 + 2.1, trim, K.TRIM);
  m.box(-2.1, 2.1, FLOOR, FLOOR + 0.5, D / 2, D / 2 + 2.4, trim, K.TRIM);
  m.box(-2.0, 2.0, FLOOR + 0.5, FLOOR + 1.4, D / 2 + 2.2, D / 2 + 2.35, IRON, K.TRIM, { top: null });
  m.win(0, 1, D / 2, 0, 0.6, 1.6, 2.7, trim, K.DARK, WOOD);
  m.box(-0.2, 0.2, 3.3, 3.8, D / 2 + 1.9, D / 2 + 2.2, hex("#ffd28a"), K.LAMP);
  m.row(-1, 0, W / 2, D, 0, 2, FLOOR, 1.1, 1.8, trim, 0.3);
  m.row(1, 0, W / 2, D, 0, 2, FLOOR, 1.1, 1.8, trim, 0.3);
  m.row(0, -1, D / 2, W, 0, 2, FLOOR, 1.3, 1.9, trim, 0.3);
  for (const s of [-1, 1]) m.box(s * (W / 2 - 0.9) - 0.6, s * (W / 2 - 0.9) + 0.6, wh, wh + Math.min(W, D) * 0.22 + 1.8, -0.6, 0.6, tile ? body : pick(r, BRICK), K.WALL);
}

function dingbat(m: Mesher, p: Plan, r: () => number) {
  const { W, D, H } = p;
  const body = pick(r, STUCCO), accent = pick(r, ACCENT);
  const floors = Math.max(2, Math.round(H / FLOOR)), h0 = FLOOR * 0.82, top = h0 + (floors - 1) * FLOOR;
  const back = -D / 2 + D * 0.32;
  // tuck-under carport: enclosed back, open front on thin posts, cars parked beneath
  m.box(-W / 2, W / 2, BASE, h0, -D / 2, back, body, K.WALL, { top: null });
  m.wall(0, 1, back, -W / 2, W / 2, 0, h0, 0.01, hex("#4a4540"), K.DARK);
  m.poly([[-W / 2, 0.08, back], [-W / 2, 0.08, D / 2], [W / 2, 0.08, D / 2], [W / 2, 0.08, back]], hex("#6b6760"), K.DARK, [0, 1, 0]);
  const bays = Math.max(1, Math.floor(W / 3.2));
  for (let q = 0; q <= bays; q++) { const x = -W / 2 + 0.25 + (W - 0.5) * (q / bays); m.box(x - 0.18, x + 0.18, 0, h0, D / 2 - 0.5, D / 2 - 0.14, WHITE, K.TRIM); }
  for (let q = 0; q < bays; q++) if (r() < 0.62) m.car(-W / 2 + (W / bays) * (q + 0.5), (back + D / 2) / 2, "z", pick(r, CARS));
  // the box on stilts
  m.box(-W / 2, W / 2, h0, top, -D / 2, D / 2, body, K.WALL, { top: null, bottom: hex("#e8e2d6") });
  m.flatRoof(-W / 2, W / 2, -D / 2, D / 2, top, 0.55, pick(r, GRAVEL), WHITE);
  m.clutter(-W / 2, W / 2, -D / 2, D / 2, top, r, 1 + Math.floor(r() * 3));
  for (let f = 0; f < floors - 1; f++) {
    const y = h0 + f * FLOOR + FLOOR * 0.3;
    m.win(0, 1, D / 2, -W * 0.27, y, Math.min(3.0, W * 0.3), 1.35, ALU);
    m.win(0, 1, D / 2, W * 0.27, y, Math.min(3.0, W * 0.3), 1.35, ALU);
  }
  // the starburst, dead centre between the windows, and a script nameplate under it
  const sy = h0 + (floors - 1) * FLOOR * 0.55, sc = r() < 0.5 ? GOLD_TRIM : ALU;
  for (let s = 0; s < 8; s++) {
    const a = (s / 8) * Math.PI, L = s % 2 ? 0.65 : 1.05, ca = Math.cos(a), sa = Math.sin(a);
    m.poly([[-ca * L - sa * 0.06, sy - sa * L + ca * 0.06, D / 2 + 0.12], [ca * L - sa * 0.06, sy + sa * L + ca * 0.06, D / 2 + 0.12], [ca * L + sa * 0.06, sy + sa * L - ca * 0.06, D / 2 + 0.12], [-ca * L + sa * 0.06, sy - sa * L - ca * 0.06, D / 2 + 0.12]], sc, K.TRIM, [0, 0, 1]);
  }
  m.wall(0, 1, D / 2, -1.2, 1.2, h0 + 0.35, h0 + 0.8, 0.1, accent, K.TRIM);
  // side stair up to the landing
  const sx = r() < 0.5 ? W / 2 : -W / 2, sgn = Math.sign(sx);
  m.poly([[sx, 0.2, D / 2 - 0.6], [sx + sgn * 1.1, 0.2, D / 2 - 0.6], [sx + sgn * 1.1, h0, D / 2 - 0.6 - h0 * 1.2], [sx, h0, D / 2 - 0.6 - h0 * 1.2]], CONCRETE, K.TRIM, [0, 1, 1]);
  m.poly([[sx + sgn * 1.1, 0.2, D / 2 - 0.6], [sx + sgn * 1.1, 1.2, D / 2 - 0.6], [sx + sgn * 1.1, h0 + 1.0, D / 2 - 0.6 - h0 * 1.2], [sx + sgn * 1.1, h0, D / 2 - 0.6 - h0 * 1.2]], IRON, K.TRIM, [sgn, 0, 0]);
  m.row(sgn, 0, W / 2, D, h0, floors - 1, FLOOR, 1.2, 1.2, ALU, 0.32);
  m.row(-sgn, 0, W / 2, D, h0, floors - 1, FLOOR, 1.2, 1.2, ALU, 0.32);
  m.ac(W * 0.2, -D * 0.2, top);
}

function courtyard(m: Mesher, p: Plan, r: () => number) {
  const { W, D, H } = p;
  const body = pick(r, STUCCO), tile = pick(r, TILE_RED), trim = r() < 0.5 ? hex("#3f4a3c") : hex("#5b3a2a");
  const floors = Math.max(1, Math.min(3, Math.round(H / FLOOR))), wh = floors * FLOOR, t = clamp(Math.min(W, D) * 0.3, 6, 9);
  const wings: [number, number, number, number, "x" | "z"][] = [
    [-W / 2, -W / 2 + t, -D / 2, D / 2, "z"], [W / 2 - t, W / 2, -D / 2, D / 2, "z"], [-W / 2 + t, W / 2 - t, -D / 2, -D / 2 + t, "x"],
  ];
  for (const [x0, x1, z0, z1] of wings) m.box(x0, x1, BASE, wh, z0, z1, body, K.GRID, { top: null });
  for (const [x0, x1, z0, z1] of wings) m.hip(x0, x1, z0, z1, wh, 2.4, 0.35, tile, K.TILE);
  // the garden: lawn, a path, a tiled fountain
  const gz0 = -D / 2 + t, gx = W / 2 - t;
  m.poly([[-gx, 0.25, gz0], [-gx, 0.25, D / 2], [gx, 0.25, D / 2], [gx, 0.25, gz0]], LAWN, K.LAWN, [0, 1, 0]);
  m.poly([[-0.9, 0.3, gz0], [-0.9, 0.3, D / 2], [0.9, 0.3, D / 2], [0.9, 0.3, gz0]], hex("#d9cfbf"), K.TRIM, [0, 1, 0]);
  const fz = (gz0 + D / 2) / 2;
  const oct: V3[] = [], octIn: V3[] = [];
  for (let s = 0; s < 8; s++) { const a = (s / 8) * Math.PI * 2; oct.push([Math.cos(a) * 1.7, 0.95, fz + Math.sin(a) * 1.7]); octIn.push([Math.cos(a) * 1.4, 0.8, fz + Math.sin(a) * 1.4]); }
  for (let s = 0; s < 8; s++) { const a = oct[s], b = oct[(s + 1) % 8]; m.poly([[a[0], 0.2, a[2]], [b[0], 0.2, b[2]], b, a], pick(r, TILE_RED), K.TRIM, [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2 - fz]); }
  m.poly(octIn, WATER, K.POOL, [0, 1, 0]);
  // courtyard-facing windows and doors on each floor, arched on the ground floor
  for (const s of [-1, 1]) {
    const len = D - t, n = Math.max(1, Math.floor(len / 3.4)), zc = (gz0 + D / 2) / 2;
    for (let f = 0; f < floors; f++) for (let q = 0; q < n; q++) {
      const a = s * (zc - len / 2 + (len / n) * (q + 0.5));
      if (f === 0) m.arched(-s, 0, -gx, a, 0.4, 1.1, 1.9, trim); else m.win(-s, 0, -gx, a, f * FLOOR + 1.0, 1.0, 1.5, trim);
    }
    m.win(0, 1, D / 2, s * (W / 2 - t / 2), FLOOR * 0.3, 1.2, 1.6, trim);
  }
  m.row(0, 1, gz0, W - 2 * t, 0, floors, FLOOR, 1.0, 1.6, trim, 0.3);
  // a low garden wall and gate across the front
  for (const s of [-1, 1]) m.box(s * 1.6, s * gx, 0, 1.3, D / 2 - 0.3, D / 2, body, K.WALL, { top: tile, topK: K.TILE });
  m.box(-1.6, 1.6, 0, 1.2, D / 2 - 0.2, D / 2 - 0.1, IRON, K.TRIM, { top: null });
}

function walkup(m: Mesher, p: Plan, r: () => number, hood: string | null) {
  const { W, D, H } = p;
  const brick = BRICK_HOODS.has(hood ?? "") && r() < 0.45;
  const body = brick ? pick(r, BRICK) : pick(r, STUCCO), trim = WHITE;
  const floors = Math.max(3, Math.round(H / FLOOR)), top = floors * FLOOR;
  m.box(-W / 2, W / 2, BASE, top, -D / 2, D / 2, body, K.GRID, { top: null });
  m.box(-W / 2 - 0.25, W / 2 + 0.25, top - 0.7, top, -D / 2 - 0.25, D / 2 + 0.25, brick ? trim : hex("#e9e3d6"), K.TRIM, { top: null });
  m.flatRoof(-W / 2, W / 2, -D / 2, D / 2, top, 0.8, pick(r, GRAVEL), trim);
  // stacked balconies on the street face
  const nb = Math.max(1, Math.min(4, Math.floor(W / 6)));
  for (let f = 1; f < floors; f++) for (let q = 0; q < nb; q++) {
    const x = -W / 2 + (W / nb) * (q + 0.5), y = f * FLOOR;
    m.box(x - 1.4, x + 1.4, y, y + 0.25, D / 2, D / 2 + 1.2, hex("#e3ddd2"), K.TRIM);
    m.box(x - 1.4, x + 1.4, y + 0.25, y + 1.3, D / 2 + 1.1, D / 2 + 1.2, brick ? IRON : ALU, K.TRIM, { top: null });
  }
  // entry canopy, door, lamp; a stair penthouse and AC units on the roof
  m.box(-1.8, 1.8, FLOOR * 0.75, FLOOR * 0.75 + 0.3, D / 2, D / 2 + 1.6, trim, K.TRIM);
  m.win(0, 1, D / 2, 0, 0.2, 1.6, 2.6, trim, K.DARK, hex("#2a2622"));
  m.box(-0.3, 0.3, FLOOR * 0.75 - 0.25, FLOOR * 0.75, D / 2 + 0.6, D / 2 + 1.2, hex("#ffd28a"), K.LAMP);
  m.box(-W / 2 + 1, -W / 2 + 4, top, top + FLOOR * 0.8, -D / 2 + 1, -D / 2 + 4, body, K.WALL, { top: pick(r, GRAVEL), topK: K.ROOF });
  m.clutter(-W / 2, W / 2, -D / 2, D / 2, top, r, 3 + Math.floor(r() * 4));
}

function storefront(m: Mesher, p: Plan, r: () => number) {
  const { W, D, H } = p;
  const body = r() < 0.6 ? pick(r, STUCCO) : pick(r, [hex("#2b2f36"), hex("#8e4f3d"), hex("#e9e3d6"), hex("#3d5a73")]);
  const floors = H > FLOOR * 1.5 ? 2 : 1, wh = H, par = 1.7;
  m.box(-W / 2, W / 2, BASE, wh, -D / 2, D / 2, body, K.WALL, { top: null });
  m.flatRoof(-W / 2, W / 2, -D / 2, D / 2, wh, 0.5, pick(r, GRAVEL), body);
  // a tall parapet on the street face carrying the sign
  m.box(-W / 2, W / 2, wh, wh + par, D / 2 - 0.35, D / 2, body, K.WALL, { top: WHITE, topK: K.TRIM });
  const neon = r() < 0.5;
  m.wall(0, 1, D / 2, -W * 0.36, W * 0.36, wh + 0.35, wh + par - 0.3, 0.08, neon ? pick(r, NEON) : pick(r, [WHITE, hex("#f2c14e"), hex("#2b2f36")]), neon ? K.NEON : K.TRIM);
  // shopfront glass with mullions and a door
  const gy1 = Math.min(FLOOR * 0.95, wh - 0.6);
  m.wall(0, 1, D / 2, -W * 0.44, W * 0.44, 0.5, gy1, 0.06, hex("#2a3444"), K.GLASS);
  const mc = hex("#1f2226");
  for (let x = -W * 0.44; x <= W * 0.44 + 0.01; x += Math.max(1.8, W * 0.88 / Math.max(1, Math.round(W * 0.88 / 2.2)))) m.wall(0, 1, D / 2, x - 0.09, x + 0.09, 0.5, gy1, 0.1, mc, K.TRIM);
  m.wall(0, 1, D / 2, -W * 0.44, W * 0.44, 0.2, 0.5, 0.1, mc, K.TRIM);
  // striped awning on a valance
  if (r() < 0.72) {
    const ac = pick(r, AWNINGS);
    m.poly([[-W * 0.45, gy1 + 0.6, D / 2], [W * 0.45, gy1 + 0.6, D / 2], [W * 0.45, gy1 - 0.4, D / 2 + 1.6], [-W * 0.45, gy1 - 0.4, D / 2 + 1.6]], ac, K.AWNING, [0, 1, 1]);
    m.wall(0, 1, D / 2 + 1.6, -W * 0.45, W * 0.45, gy1 - 0.9, gy1 - 0.4, 0, ac, K.AWNING);
  }
  if (floors === 2) m.row(0, 1, D / 2, W, FLOOR, 1, FLOOR, 1.3, 1.6, WHITE, 0.3);
  m.clutter(-W / 2, W / 2, -D / 2, D / 2, wh, r, 2 + Math.floor(r() * 4));
}

function office(m: Mesher, p: Plan, r: () => number) {
  const { W, D, H } = p;
  const body = pick(r, TOWER_STONE), floors = Math.max(2, Math.round(H / FLOOR)), top = floors * FLOOR;
  // recessed glass ground floor on columns, ribbon windows above
  m.box(-W / 2 + 1.2, W / 2 - 1.2, BASE, FLOOR, -D / 2 + 1.2, D / 2 - 1.2, hex("#2a3444"), K.GLASS, { top: null });
  const nc = Math.max(2, Math.floor(W / 5));
  for (let q = 0; q <= nc; q++) { const x = -W / 2 + 0.4 + (W - 0.8) * (q / nc); m.box(x - 0.35, x + 0.35, 0, FLOOR, D / 2 - 0.9, D / 2 - 0.2, body, K.TRIM); }
  m.box(-W / 2, W / 2, FLOOR, top, -D / 2, D / 2, body, K.RIBBON, { top: null, bottom: hex("#d8d2c6") });
  m.flatRoof(-W / 2, W / 2, -D / 2, D / 2, top, 0.7, pick(r, GRAVEL), body);
  // brise-soleil fins down the street face
  if (r() < 0.7) {
    const nf = Math.max(3, Math.floor(W / 2.4));
    for (let q = 0; q <= nf; q++) { const x = -W / 2 + 0.2 + (W - 0.4) * (q / nf); m.box(x - 0.12, x + 0.12, FLOOR, top, D / 2, D / 2 + 1.0, WHITE, K.TRIM); }
  }
  m.box(-W * 0.2, W * 0.2, top, top + FLOOR * 0.9, -D * 0.2, D * 0.2, body, K.WALL, { top: pick(r, GRAVEL), topK: K.ROOF });
  m.clutter(-W / 2, W / 2, -D / 2, D / 2, top, r, 4 + Math.floor(r() * 4));
}

function tower(m: Mesher, p: Plan, r: () => number) {
  const { W, D, H } = p;
  const stone = pick(r, TOWER_STONE), glassy = r() < 0.7, pod = FLOOR * 2;
  // podium with a glass ground floor
  m.box(-W / 2, W / 2, BASE, pod, -D / 2, D / 2, stone, K.WALL, { top: pick(r, GRAVEL), topK: K.ROOF });
  m.wall(0, 1, D / 2, -W * 0.42, W * 0.42, 0.4, FLOOR * 0.92, 0.07, hex("#2a3444"), K.GLASS);
  m.box(-W * 0.3, W * 0.3, FLOOR * 0.92, FLOOR * 0.92 + 0.35, D / 2, D / 2 + 2.2, WHITE, K.TRIM);
  // shaft, then a setback crown
  const i1 = 0.1, i2 = 0.2, hs = pod + (H - pod) * 0.84;
  m.box(-W / 2 + W * i1, W / 2 - W * i1, pod, hs, -D / 2 + D * i1, D / 2 - D * i1, glassy ? hex("#6f8fa8") : stone, glassy ? K.CURTAIN : K.GRID, { top: stone, topK: K.ROOF });
  const cx0 = -W / 2 + W * i2, cx1 = W / 2 - W * i2, cz0 = -D / 2 + D * i2, cz1 = D / 2 - D * i2;
  m.box(cx0, cx1, hs, H, cz0, cz1, glassy ? hex("#6f8fa8") : stone, glassy ? K.CURTAIN : K.GRID, { top: null });
  // a light band around the crown
  m.box(cx0 - 0.15, cx1 + 0.15, H - 0.9, H - 0.4, cz0 - 0.15, cz1 + 0.15, hex("#fff1d0"), K.LAMP, { top: null });
  m.flatRoof(cx0, cx1, cz0, cz1, H, 0.9, hex("#6b6f75"), stone);
  // the LA helipad: a dark pad, a white ring and the H; red beacons on the corners
  const pr = Math.min(cx1 - cx0, cz1 - cz0) * 0.38, y = H + 0.12;
  if (pr > 3) {
    for (let s = 0; s < 16; s++) {
      const a0 = (s / 16) * Math.PI * 2, a1 = ((s + 1) / 16) * Math.PI * 2, r0 = pr * 0.8, r1 = pr * 0.9;
      m.poly([[Math.cos(a0) * r0, y, Math.sin(a0) * r0], [Math.cos(a0) * r1, y, Math.sin(a0) * r1], [Math.cos(a1) * r1, y, Math.sin(a1) * r1], [Math.cos(a1) * r0, y, Math.sin(a1) * r0]], WHITE, K.TRIM, [0, 1, 0]);
    }
    const hw = pr * 0.3, hh = pr * 0.42, bar = pr * 0.08;
    for (const [x0, x1, z0, z1] of [[-hw - bar, -hw + bar, -hh, hh], [hw - bar, hw + bar, -hh, hh], [-hw, hw, -bar, bar]]) m.poly([[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], hex("#f2c14e"), K.TRIM, [0, 1, 0]);
  }
  for (const [x, z] of [[cx0, cz0], [cx1, cz0], [cx0, cz1], [cx1, cz1]]) m.box(x - 0.4, x + 0.4, H + 0.9, H + 1.7, z - 0.4, z + 0.4, hex("#ff2a1a"), K.BEACON);
}

function warehouse(m: Mesher, p: Plan, r: () => number) {
  const { W, D, H } = p;
  const wall = pick(r, [CONCRETE, hex("#c9c2b4"), hex("#a9b0b5"), hex("#d8cdb8")]), roofC = hex("#aeb4b9"), rise = W * 0.12;
  m.box(-W / 2, W / 2, BASE, H, -D / 2, D / 2, wall, K.WALL, { top: null, sideK: K.CORRUGATED });
  // bow-truss roof: an arc across the width, run the full depth, with filled ends
  const seg = 8, arc = (s: number): [number, number] => { const t = s / seg; return [-W / 2 + W * t, H + rise * Math.sin(Math.PI * t)]; };
  for (let s = 0; s < seg; s++) {
    const [x0, y0] = arc(s), [x1, y1] = arc(s + 1);
    m.poly([[x0, y0, D / 2 + 0.3], [x1, y1, D / 2 + 0.3], [x1, y1, -D / 2 - 0.3], [x0, y0, -D / 2 - 0.3]], roofC, K.ROOF, [(x0 + x1) / 2 / W, 1, 0]);
    m.poly([[x0, H, D / 2], [x1, H, D / 2], [x1, y1, D / 2], [x0, y0, D / 2]], wall, K.WALL, [0, 0, 1]);
    m.poly([[x0, H, -D / 2], [x1, H, -D / 2], [x1, y1, -D / 2], [x0, y0, -D / 2]], wall, K.WALL, [0, 0, -1]);
  }
  const nd = Math.max(1, Math.min(3, Math.floor(W / 9)));
  for (let q = 0; q < nd; q++) m.win(0, 1, D / 2, -W / 2 + (W / nd) * (q + 0.5), 0, Math.min(4.4, W / nd - 1.5), Math.min(H - 1.2, 4.6), hex("#8a8f94"), K.SHUTTER, hex("#b8bec4"));
  m.wall(0, 1, D / 2, -W * 0.45, W * 0.45, H - 1.4, H - 0.6, 0.07, hex("#2a3444"), K.GLASS);
  m.box(-W / 2 + 0.6, -W / 2 + 1.0, 3.0, 3.4, D / 2, D / 2 + 0.3, hex("#ffd28a"), K.LAMP);
}

function garage(m: Mesher, p: Plan, r: () => number) {
  const { W, D, H } = p;
  const body = pick(r, STUCCO);
  m.box(-W / 2, W / 2, BASE, H, -D / 2, D / 2, body, K.WALL, { top: pick(r, GRAVEL), topK: K.ROOF });
  m.win(0, 1, D / 2, 0, 0, Math.min(W - 0.8, 5), Math.min(H - 0.6, 2.8), WHITE, K.SHUTTER, hex("#e8e4dc"));
}

const BUILD: Record<Arch, (m: Mesher, p: Plan, r: () => number, hood: string | null) => void> = {
  craftsman, spanish, ranch, estate, dingbat, courtyard, walkup, storefront, office, tower, warehouse, garage,
};

/** builds one merged mesh a few buildings at a time, so a new tile never stalls a frame */
export class LABuilder {
  private m = new Mesher();
  private next = 0;
  constructor(private plans: Plan[], private ground: (x: number, z: number) => number, private hoodOf: (p: Plan) => string | null) {}
  get done() { return this.next >= this.plans.length; }
  /** add buildings until the time budget runs out; true once every plan is in */
  step(budgetMs: number) {
    const t0 = performance.now();
    while (!this.done) {
      addPlan(this.m, this.plans[this.next++], this.ground, this.hoodOf);
      if ((this.next & 15) === 0 && performance.now() - t0 > budgetMs) break;
    }
    return this.done;
  }
  geometry() { return this.m.geometry(); }
}

function addPlan(m: Mesher, p: Plan, ground: (x: number, z: number) => number, hoodOf: (p: Plan) => string | null) {
  {
    const y0 = ground(p.x, p.z) - 0.2;
    m.begin(p, y0);
    const r = rng(p.i * 13 + 5);
    const house = p.arch === "craftsman" || p.arch === "spanish" || p.arch === "ranch" || p.arch === "estate";
    if (p.arch !== "tower" && p.arch !== "warehouse") m.lot(p.W, p.D, house || p.arch === "courtyard", rng(p.i * 5 + 1));
    BUILD[p.arch](m, p, r, hoodOf(p));
    if (p.pool) {
      const [wx, wz] = [p.x + p.pool.x * p.fz + p.pool.z * p.fx, p.z - p.pool.x * p.fx + p.pool.z * p.fz];
      m.pool(p.pool, ground(wx, wz) - y0 - 0.1);
    }
  }
}

/** one merged mesh's worth of geometry for a set of plans, all at once */
export function buildLA(plans: Plan[], ground: (x: number, z: number) => number, hoodOf: (p: Plan) => string | null) {
  const b = new LABuilder(plans, ground, hoodOf);
  b.step(Infinity);
  return b.geometry();
}
