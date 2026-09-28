/**
 * The island board, as data: every neighbourhood becomes an island in its real place, pulled apart
 * from its neighbours by water, and each island gets its own miniature street plan.
 *
 * Pure functions, no three.js: the renderer (islandBoard.ts) turns this into geometry and tests
 * pin the layout down.
 *
 * Two spaces:
 * - board space: the manifest's metres (x east, z south). Islands, water, clouds and cameras live here.
 * - mini space: board / S. Buildings and trees are laid out here at their real size, then drawn
 *   S times larger, so a house reads from across the whole board like a game piece.
 */
import type { PlanInput } from "../LanternCityV7/laBuildings";

export type Outline = { n: string; served: boolean; p: [number, number][] };
export type WorldManifest = {
  origin: [number, number];
  kx: number;
  kz: number;
  bounds: [number, number, number, number];
  outline: Outline[];
  terrain: { cell: number; nx: number; nz: number; h: number[] };
  water: [number, number][][];
  parks: [number, number][][];
  major: Record<string, [number, number][]>;
};

/** building and tree scale on the board: a real house drawn this many times larger */
export const S = 5;
/** metres of water pulled in from every neighbourhood border (so the channel between two is twice this) */
export const ERODE = 115;
/** island top above the water, before real hills are added */
export const TOP = 80;
/** real relief carried onto the islands */
export const RELIEF = 0.85;

// ----------------------------------------------------------------- geometry helpers
export function pointInRing(x: number, z: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function segDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  const ex = ax + dx * t - px, ez = az + dz * t - pz;
  return ex * ex + ez * ez;
}
function ringDist(x: number, z: number, ring: [number, number][]) {
  let m = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) m = Math.min(m, segDist2(x, z, ring[j][0], ring[j][1], ring[i][0], ring[i][1]));
  return Math.sqrt(m);
}
export function ringArea(ring: [number, number][]) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
}
export function rng(seed: number) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
function hash2(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, z: number, oct = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x, z); n += a; x = x * 2.03 + 17.1; z = z * 2.03 - 9.7; a *= 0.5; }
  return s / n;
}

/**
 * The manifest's Hancock Park, Larchmont and Windsor Square outlines are slivers (Hancock Park has no
 * area at all), leaving a hole in the middle of the board. Redraw them from the streets that bound
 * them: Melrose, Beverly and Wilshire north to south; La Brea, Rossmore, Wilton and Western west to east.
 */
export function repairOutlines(outlines: Outline[]): Outline[] {
  const fixed: Record<string, [number, number][]> = {
    "Hancock Park": [[-487, -66], [1154, -60], [1190, 2321], [-487, 2310]],
    Larchmont: [[1154, -60], [2417, -66], [2721, 730], [2315, 740], [1190, 740]],
    "Windsor Square": [[1190, 740], [2315, 740], [2325, 1238], [2280, 2282], [1190, 2321]],
  };
  return outlines.map(o => (fixed[o.n] ? { ...o, p: fixed[o.n] } : o));
}

// ----------------------------------------------------------------- the coast field
/**
 * Signed distance to the coast on a grid of nodes (board metres; positive on land). Each node
 * belongs to at most one island. Borders are eroded by ERODE, roughened by noise and softened so
 * corners round off like worn rock.
 */
export type Field = {
  x0: number; z0: number; cell: number; nx: number; nz: number;
  c: Float32Array;      // coast distance at each node (>0 land)
  own: Int8Array;       // island index at each node, -1 for open sea
};

export function buildField(outlines: Outline[], bounds: [number, number, number, number], cell = 20, margin = 1600): Field {
  const x0 = bounds[0] - margin, z0 = bounds[1] - margin;
  const nx = Math.ceil((bounds[2] - bounds[0] + 2 * margin) / cell) + 1;
  const nz = Math.ceil((bounds[3] - bounds[1] + 2 * margin) / cell) + 1;
  const D = new Float32Array(nx * nz), own = new Int8Array(nx * nz).fill(-1);
  const boxes = outlines.map(o => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const [x, z] of o.p) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); }
    return [a, b, c, d];
  });
  const FAR = 900;
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell, k = j * nx + i;
      let best = -FAR, who = -1;
      for (let o = 0; o < outlines.length; o++) {
        const bb = boxes[o];
        if (x < bb[0] - FAR || x > bb[2] + FAR || z < bb[1] - FAR || z > bb[3] + FAR) continue;
        const inside = x >= bb[0] && x <= bb[2] && z >= bb[1] && z <= bb[3] && pointInRing(x, z, outlines[o].p);
        // outside every ring, the nearest ring's distance only matters up to FAR
        const d = ringDist(x, z, outlines[o].p) * (inside ? 1 : -1);
        if (d > best) { best = d; who = inside ? o : who; }
      }
      D[k] = best;
      own[k] = best > 0 ? who : -1;
    }
  }
  // worn coastline: wobble, then soften (a separable blur rounds every corner)
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * cell, z = z0 + j * cell;
    D[j * nx + i] += (fbm(x / 420, z / 420, 3) - 0.5) * 70 + (fbm(x / 90, z / 90, 2) - 0.5) * 18;
  }
  const blur = (src: Float32Array, r: number) => {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    const w = Array.from({ length: 2 * r + 1 }, (_, t) => Math.exp(-((t - r) ** 2) / (2 * (r / 2) ** 2)));
    const ws = w.reduce((a, b) => a + b, 0);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let t = -r; t <= r; t++) s += src[j * nx + Math.min(nx - 1, Math.max(0, i + t))] * w[t + r];
      tmp[j * nx + i] = s / ws;
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let t = -r; t <= r; t++) s += tmp[Math.min(nz - 1, Math.max(0, j + t)) * nx + i] * w[t + r];
      out[j * nx + i] = s / ws;
    }
    return out;
  };
  const soft = blur(D, 4);
  // small neighbourhoods lose less to the water, so Century City stays an island and not a rock
  const erode = outlines.map(o => ERODE * Math.min(1, Math.max(0.5, Math.sqrt(ringArea(o.p)) / 2600)));
  const c = new Float32Array(nx * nz);
  for (let k = 0; k < c.length; k++) c[k] = soft[k] - (own[k] >= 0 ? erode[own[k]] : ERODE);
  // ownership follows the softened coast: grow each island's label into land it gained
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      if (c[k] <= 0 || own[k] >= 0) continue;
      const n = [own[k - 1], own[k + 1], own[k - nx], own[k + nx]].find(v => v >= 0);
      if (n !== undefined) { own[k] = n; changed = true; }
    }
    if (!changed) break;
  }
  for (let k = 0; k < c.length; k++) if (c[k] <= 0) own[k] = -1;
  return { x0, z0, cell, nx, nz, c, own };
}

export function coastAt(f: Field, x: number, z: number) {
  const fx = Math.min(Math.max((x - f.x0) / f.cell, 0), f.nx - 1.001), fz = Math.min(Math.max((z - f.z0) / f.cell, 0), f.nz - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * f.nx + i;
  return (f.c[k] * (1 - tx) + f.c[k + 1] * tx) * (1 - tz) + (f.c[k + f.nx] * (1 - tx) + f.c[k + f.nx + 1] * tx) * tz;
}
export function ownerAt(f: Field, x: number, z: number) {
  const i = Math.round((x - f.x0) / f.cell), j = Math.round((z - f.z0) / f.cell);
  if (i < 0 || j < 0 || i >= f.nx || j >= f.nz) return -1;
  return f.own[j * f.nx + i];
}

// ----------------------------------------------------------------- heights
/** the real ground (metres) from the manifest's terrain grid */
export function terrainSampler(M: WorldManifest) {
  const T = M.terrain;
  return (x: number, z: number) => {
    const fx = Math.min(Math.max((x - M.bounds[0]) / T.cell, 0), T.nx - 1.001);
    const fz = Math.min(Math.max((z - M.bounds[1]) / T.cell, 0), T.nz - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const h = (i: number, j: number) => T.h[j * T.nx + i] / 10;
    return (h(ix, iz) * (1 - tx) + h(ix + 1, iz) * tx) * (1 - tz) + (h(ix, iz + 1) * (1 - tx) + h(ix + 1, iz + 1) * tx) * tz;
  };
}

/** island-top height (board metres above the water): a flat plinth plus the island's own hills */
export function heightSampler(M: WorldManifest, f: Field) {
  const terr = terrainSampler(M);
  // each island's flats sit on the plinth: its 15th-percentile ground is zero relief
  const base = M.outline.map((_, o) => {
    const hs: number[] = [];
    for (let k = 0; k < f.c.length; k += 7) if (f.own[k] === o) hs.push(terr(f.x0 + (k % f.nx) * f.cell, f.z0 + Math.floor(k / f.nx) * f.cell));
    hs.sort((a, b) => a - b);
    return hs.length ? hs[Math.floor(hs.length * 0.15)] : 0;
  });
  return (x: number, z: number, own = ownerAt(f, x, z)) => {
    const b = own >= 0 ? base[own] : 0;
    const r = Math.max(0, terr(x, z) - b);
    // hills keep their shape; the flats get a gentle rise so they never look like a table top
    return TOP + (r > 25 ? 25 + (r - 25) * RELIEF : r * 0.6);
  };
}

// ----------------------------------------------------------------- boulevards
/** each major road as short segments: its sampled points joined to their two nearest neighbours */
export function roadSegments(M: WorldManifest) {
  const segs: { n: string; a: [number, number]; b: [number, number] }[] = [];
  for (const [n, pts] of Object.entries(M.major)) {
    const seen = new Set<string>();
    for (let i = 0; i < pts.length; i++) {
      const near = pts.map((p, j) => [j, Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])] as const)
        .filter(([j, d]) => j !== i && d > 1 && d < 280).sort((a, b) => a[1] - b[1]).slice(0, 2);
      for (const [j] of near) {
        const key = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        segs.push({ n, a: pts[i], b: pts[j] });
      }
    }
  }
  return segs;
}

/** a coarse grid answering "how far to the nearest boulevard" quickly */
export function roadDistance(segs: { a: [number, number]; b: [number, number] }[], f: Field, cell = 40, reach = 400) {
  const nx = Math.ceil((f.nx * f.cell) / cell), nz = Math.ceil((f.nz * f.cell) / cell);
  const d = new Float32Array(nx * nz).fill(reach);
  for (const s of segs) {
    const i0 = Math.max(0, Math.floor((Math.min(s.a[0], s.b[0]) - reach - f.x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((Math.max(s.a[0], s.b[0]) + reach - f.x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(s.a[1], s.b[1]) - reach - f.z0) / cell)), j1 = Math.min(nz - 1, Math.ceil((Math.max(s.a[1], s.b[1]) + reach - f.z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const v = Math.sqrt(segDist2(f.x0 + i * cell, f.z0 + j * cell, s.a[0], s.a[1], s.b[0], s.b[1]));
      if (v < d[j * nx + i]) d[j * nx + i] = v;
    }
  }
  return (x: number, z: number) => {
    const fx = Math.min(Math.max((x - f.x0) / cell, 0), nx - 1.001), fz = Math.min(Math.max((z - f.z0) / cell, 0), nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * nx + i;
    return (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - tz) + (d[k + nx] * (1 - tx) + d[k + nx + 1] * tx) * tz;
  };
}

// ----------------------------------------------------------------- what each island is like
type Program = "houses" | "apartments" | "towers" | "park" | "estates";
export type HoodStyle = {
  rot: number;                              // street grid angle (radians)
  programs: [Program, number][];            // block programmes and their weights
  towerRoads?: string[];                    // towers cluster along these boulevards
  towerReach?: number;
  towerH?: [number, number];
  apartmentH?: [number, number];
  ground: string;                           // painted ground colour
  lawn: string;
  palms: number;                            // share of street trees that are palms
};
export const HOOD_STYLE: Record<string, HoodStyle> = {
  "Silver Lake": { rot: 0.05, programs: [["houses", 0.72], ["apartments", 0.18], ["park", 0.1]], ground: "#9cc36a", lawn: "#86b85a", palms: 0.12 },
  "Los Feliz": { rot: 0, programs: [["houses", 0.45], ["estates", 0.2], ["apartments", 0.25], ["park", 0.1]], ground: "#a3c46c", lawn: "#8dbb5d", palms: 0.18 },
  "East Hollywood": { rot: 0, programs: [["houses", 0.42], ["apartments", 0.52], ["park", 0.06]], ground: "#b8c27a", lawn: "#94b862", palms: 0.25 },
  Hollywood: { rot: 0, programs: [["apartments", 0.58], ["houses", 0.22], ["towers", 0.12], ["park", 0.08]], towerRoads: ["Hollywood Boulevard", "Vine Street", "West Sunset Boulevard", "Sunset Boulevard"], towerReach: 520, towerH: [36, 70], ground: "#c9c088", lawn: "#9dba66", palms: 0.45 },
  "West Hollywood": { rot: 0, programs: [["apartments", 0.62], ["houses", 0.26], ["park", 0.12]], towerRoads: ["Sunset Boulevard", "West Sunset Boulevard"], towerReach: 260, towerH: [34, 52], ground: "#bfc684", lawn: "#96bd62", palms: 0.55 },
  "Beverly Hills": { rot: -0.55, programs: [["estates", 0.62], ["houses", 0.22], ["park", 0.12], ["apartments", 0.04]], ground: "#8fc463", lawn: "#7fbf57", palms: 0.7 },
  "Century City": { rot: 0.62, programs: [["towers", 0.56], ["apartments", 0.24], ["park", 0.2]], towerRoads: ["Avenue of the Stars", "Century Park East", "Century Park West", "Constellation Boulevard", "Santa Monica Boulevard", "West Olympic Boulevard"], towerReach: 900, towerH: [48, 110], ground: "#cfc79a", lawn: "#8fbe5f", palms: 0.4 },
  Koreatown: { rot: 0, programs: [["apartments", 0.62], ["houses", 0.18], ["towers", 0.15], ["park", 0.05]], towerRoads: ["Wilshire Boulevard", "West 6th Street"], towerReach: 380, towerH: [40, 90], apartmentH: [10, 22], ground: "#cbbf8c", lawn: "#98b862", palms: 0.35 },
  "Mid-Wilshire": { rot: 0, programs: [["apartments", 0.5], ["houses", 0.4], ["park", 0.1]], towerRoads: ["Wilshire Boulevard"], towerReach: 260, towerH: [34, 60], ground: "#b9c47c", lawn: "#93ba60", palms: 0.3 },
  "Hancock Park": { rot: 0, programs: [["estates", 0.7], ["houses", 0.2], ["park", 0.1]], ground: "#8fc463", lawn: "#7bbb55", palms: 0.2 },
  "Windsor Square": { rot: 0, programs: [["estates", 0.55], ["houses", 0.35], ["park", 0.1]], ground: "#92c466", lawn: "#7fbb57", palms: 0.2 },
  Larchmont: { rot: 0, programs: [["houses", 0.7], ["apartments", 0.2], ["park", 0.1]], ground: "#a2c46c", lawn: "#8aba5c", palms: 0.25 },
  Fairfax: { rot: 0, programs: [["apartments", 0.55], ["houses", 0.35], ["park", 0.1]], ground: "#b6c47a", lawn: "#91ba60", palms: 0.35 },
  "Beverly Grove": { rot: 0, programs: [["apartments", 0.55], ["houses", 0.35], ["park", 0.1]], ground: "#b3c478", lawn: "#91ba60", palms: 0.35 },
  Carthay: { rot: 0, programs: [["houses", 0.7], ["apartments", 0.2], ["park", 0.1]], ground: "#a4c56e", lawn: "#8aba5c", palms: 0.3 },
};
const DEFAULT_STYLE: HoodStyle = { rot: 0, programs: [["houses", 0.6], ["apartments", 0.3], ["park", 0.1]], ground: "#a6c46e", lawn: "#8dba5c", palms: 0.25 };
export const styleFor = (hood: string) => HOOD_STYLE[hood] ?? DEFAULT_STYLE;

// ----------------------------------------------------------------- the street plan
/** mini-space block: two rows of lots back to back, streets all round */
const LOT_W = 15, LOT_D = 36, STREET = 12, LOTS = 6;
const PITCH_X = LOTS * LOT_W + STREET, PITCH_Z = 2 * LOT_D + STREET;

export type Block = { island: number; cx: number; cz: number; rot: number; program: Program };   // board space centre
export type TreeKind = 0 | 1 | 2;    // canopy, cypress, palm
export type Tree = { x: number; z: number; kind: TreeKind; s: number; tint: number };          // mini space
export type IslandLayout = {
  index: number; name: string; served: boolean;
  label: [number, number];                   // board: the island's most inland point
  area: number;                              // board m²
  plans: PlanInput[];                        // mini space
  blocks: Block[];
  trees: Tree[];
};

export type LayoutEnv = {
  field: Field;
  height: (x: number, z: number) => number;   // board
  road: (x: number, z: number) => number;     // board metres to the nearest boulevard
  roadNamed: (names: string[], x: number, z: number) => number;
  park: (x: number, z: number) => boolean;    // board
  lake?: (x: number, z: number) => boolean;   // board: reservoirs and ponds on the islands
};

/** Lay out every island's blocks, buildings and trees. Deterministic per island. */
export function layoutIslands(M: WorldManifest, env: LayoutEnv): IslandLayout[] {
  const { field: f } = env;
  const out: IslandLayout[] = [];
  let nextId = 0;
  M.outline.forEach((o, index) => {
    const st = styleFor(o.n);
    const r = rng(index * 7919 + 13);
    // label point and extent from the field
    let best = 0, lx = 0, lz = 0, cells = 0, sx = 0, sz = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let k = 0; k < f.c.length; k++) {
      if (f.own[k] !== index) continue;
      const x = f.x0 + (k % f.nx) * f.cell, z = f.z0 + Math.floor(k / f.nx) * f.cell;
      cells++; sx += x; sz += z;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      if (f.c[k] > best) { best = f.c[k]; lx = x; lz = z; }
    }
    const L: IslandLayout = { index, name: o.n, served: o.served, label: [lx, lz], area: cells * f.cell * f.cell, plans: [], blocks: [], trees: [] };
    out.push(L);
    if (!cells) return;
    const cx = sx / cells, cz = sz / cells;
    const cos = Math.cos(st.rot), sin = Math.sin(st.rot);
    // local grid coords (mini) -> board
    const toBoard = (u: number, v: number): [number, number] => [cx + (u * cos - v * sin) * S, cz + (u * sin + v * cos) * S];
    const land = (x: number, z: number, m: number) => ownerAt(f, x, z) === index && coastAt(f, x, z) > m && !env.lake?.(x, z);
    const ground = (x: number, z: number) => env.height(x, z) / S;
    const rad = Math.hypot(maxX - minX, maxZ - minZ) / 2 / S + PITCH_X;
    const nu = Math.ceil(rad / PITCH_X), nv = Math.ceil(rad / PITCH_Z);
    const pickProgram = (): Program => {
      let x = r();
      for (const [p, w] of st.programs) if ((x -= w) <= 0) return p;
      return st.programs[0][0];
    };
    const addTree = (u: number, v: number, kind: TreeKind, s: number) => {
      const [bx, bz] = toBoard(u, v);
      if (!land(bx, bz, 18) || env.road(bx, bz) < 42) return;
      L.trees.push({ x: bx / S, z: bz / S, kind, s, tint: r() });
    };
    for (let bj = -nv; bj <= nv; bj++) for (let bi = -nu; bi <= nu; bi++) {
      const u0 = bi * PITCH_X + (bj % 2 ? PITCH_X * 0.18 : 0), v0 = bj * PITCH_Z;
      const [bcx, bcz] = toBoard(u0, v0);
      // a block exists if most of it stands on the island
      const probes = [[0, 0], [-0.45, -0.4], [0.45, -0.4], [-0.45, 0.4], [0.45, 0.4]].filter(([a, b]) => {
        const [x, z] = toBoard(u0 + a * PITCH_X, v0 + b * PITCH_Z);
        return land(x, z, 25);
      }).length;
      if (probes < 3) {
        // scraps of land at the edges still get trees
        if (probes > 0) for (let t = 0; t < 10; t++) addTree(u0 + (r() - 0.5) * PITCH_X, v0 + (r() - 0.5) * PITCH_Z, r() < st.palms * 0.6 ? 2 : 0, 0.8 + r() * 0.5);
        continue;
      }
      // steep hillside: leave it to the chaparral
      const hs = [[-0.4, 0], [0.4, 0], [0, -0.4], [0, 0.4]].map(([a, b]) => { const [x, z] = toBoard(u0 + a * PITCH_X, v0 + b * PITCH_Z); return env.height(x, z); });
      const slope = (Math.max(...hs) - Math.min(...hs)) / (PITCH_X * S * 0.8);
      let program: Program = env.park(bcx, bcz) ? "park" : pickProgram();
      if (program === "towers" && st.towerRoads && env.roadNamed(st.towerRoads, bcx, bcz) > (st.towerReach ?? 400)) program = "apartments";
      if (program === "towers" && !st.towerRoads) program = "apartments";
      if (slope > 0.2) program = r() < 0.55 ? "park" : "estates";
      L.blocks.push({ island: index, cx: bcx, cz: bcz, rot: st.rot, program });
      if (program === "park") {
        for (let t = 0; t < 34; t++) addTree(u0 + (r() - 0.5) * PITCH_X * 0.95, v0 + (r() - 0.5) * PITCH_Z * 0.95, r() < 0.15 ? 1 : r() < st.palms * 0.4 ? 2 : 0, 0.9 + r() * 0.8);
        continue;
      }
      // parcels along the block: each spans one or more lots, in one row or both
      const parcels: { a: number; n: number; row: -1 | 0 | 1 }[] = [];
      if (program === "towers") {
        let a = 0;
        while (a < LOTS) { const n = Math.min(LOTS - a, 2 + (r() < 0.4 ? 1 : 0)); parcels.push({ a, n, row: 0 }); a += n; }
      } else {
        for (const row of [-1, 1] as const) {
          let a = 0;
          while (a < LOTS) {
            const n = program === "estates" ? Math.min(LOTS - a, 2) : program === "apartments" && r() < 0.3 ? Math.min(LOTS - a, 2) : 1;
            parcels.push({ a, n, row }); a += n;
          }
        }
      }
      for (const p of parcels) {
        const u = u0 - (LOTS * LOT_W) / 2 + (p.a + p.n / 2) * LOT_W;
        const v = p.row === 0 ? v0 : v0 + p.row * (LOT_D / 2);
        const [bx, bz] = toBoard(u, v);
        const rd = env.road(bx, bz);
        const tower = program === "towers";
        if (rd < (tower ? 34 : 55)) continue;           // the boulevard itself
        const lotW = p.n * LOT_W, lotD = p.row === 0 ? 2 * LOT_D : LOT_D;
        // the lot's corners must stand on the island
        const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([a, b]) => toBoard(u + a * lotW, v + b * lotD));
        if (!corners.every(([x, z]) => land(x, z, tower ? 4 : 12))) { addTree(u, v, 0, 1); continue; }
        const front = rd < 150;                         // facing a boulevard: shops and offices
        // faces its street: row -1 faces north (-v), row +1 south; tower parcels face the nearer end
        const fu = 0, fv = p.row === 0 ? (r() < 0.5 ? -1 : 1) : p.row;
        const fx = fu * cos - fv * sin, fz = fu * sin + fv * cos;
        let type = "house", h = 5, W = 11, D = 15, fill = 0.9;
        const id = nextId++;
        switch (program) {
          case "towers": {
            const [a, b] = st.towerH ?? [40, 80];
            type = "office"; h = a + (b - a) * r() ** 1.6; W = Math.min(lotW - 5, 22 + r() * 12); D = Math.min(lotD - 12, 26 + r() * 14); fill = 1;
            break;
          }
          case "apartments": {
            const [a, b] = st.apartmentH ?? [8, 16];
            type = front ? (r() < 0.6 ? "retail" : "commercial") : "apartments";
            h = front ? 5 + r() * 9 : a + (b - a) * r();
            W = lotW - 2; D = Math.min(lotD - 8, front ? 20 : 26 + (p.n > 1 ? 6 : 0)); fill = 0.95;
            break;
          }
          case "estates":
            type = "house"; h = 7 + r() * 3; W = Math.min(lotW - 4, 20); D = 18; fill = 1;
            break;
          default:
            type = front ? (r() < 0.7 ? "retail" : "apartments") : r() < 0.12 ? "apartments" : "house";
            h = type === "house" ? 4.5 + r() * 3.5 : 5 + r() * 6;
            W = type === "house" ? 12.5 : 13; D = type === "house" ? 17 : 20;
        }
        // set the building toward its street; backyards get the trees
        const setback = program === "towers" ? 0 : (lotD - D) / 2 - (type === "house" ? 5 : 2);
        const bu = u + fu * setback, bv = v + fv * setback;
        const [px, pz] = toBoard(bu, bv);
        L.plans.push({ i: id, cx: id, cz: 0, h, u: 0, type, hood: o.n, x: px / S, z: pz / S, fx, fz, W, D, fill });
        // trees: yards behind houses, street trees out front
        if (program !== "towers") {
          const back = -(lotD / 2 - 5);
          if (r() < (type === "house" ? 0.85 : 0.35)) addTree(u + (r() - 0.5) * lotW * 0.6, v + fv * back, r() < 0.12 ? 1 : 0, 0.8 + r() * 0.5);
          const kind: TreeKind = front || r() < st.palms ? 2 : r() < 0.1 ? 1 : 0;
          if (r() < 0.8) addTree(u + (r() - 0.5) * 4, v + fv * (lotD / 2 + 1.5), kind, kind === 2 ? 1 + r() * 0.3 : 0.75 + r() * 0.3);
        } else if (r() < 0.6) addTree(u + (r() - 0.5) * lotW, v + fv * (lotD / 2 + 1.5), 2, 1.1);
      }
    }
    // a ring of palms along the cliff top
    const ringN = Math.round(Math.sqrt(L.area) / 25);
    for (let t = 0; t < ringN * 3; t++) {
      const a = r() * Math.PI * 2, d = r() * rad * S;
      const x = lx + Math.cos(a) * d, z = lz + Math.sin(a) * d;
      const c = coastAt(f, x, z);
      if (ownerAt(f, x, z) === index && c > 14 && c < 40 && env.road(x, z) > 42) L.trees.push({ x: x / S, z: z / S, kind: r() < st.palms ? 2 : 0, s: 0.9 + r() * 0.4, tint: r() });
    }
    void ground;
  });
  return out;
}

// ----------------------------------------------------------------- customers
export function lonLatToBoard(M: WorldManifest, lat: number, lon: number) {
  return { x: (lon - M.origin[1]) * M.kx, z: -(lat - M.origin[0]) * M.kz };
}

/** step a point out of the water onto the nearest island (walking up the coast field) */
export function ontoLand(f: Field, x: number, z: number, margin = 30) {
  for (let it = 0; it < 80; it++) {
    const c = coastAt(f, x, z);
    if (c > margin) return { x, z, ok: true };
    const e = f.cell;
    const gx = coastAt(f, x + e, z) - coastAt(f, x - e, z), gz = coastAt(f, x, z + e) - coastAt(f, x, z - e);
    const g = Math.hypot(gx, gz) || 1;
    const step = Math.max(10, Math.min(120, margin - c + 10));
    x += (gx / g) * step; z += (gz / g) * step;
  }
  return { x, z, ok: coastAt(f, x, z) > 0 };
}
