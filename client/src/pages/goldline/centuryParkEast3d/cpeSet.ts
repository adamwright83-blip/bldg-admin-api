/**
 * The Century Park East set: the cut-open tower, its rooms dressed one by one, the street below and the city behind.
 * Everything static is merged into one mesh per material (a `Kit` bucket), so a fully furnished floor costs a few
 * dozen draw calls, not a few hundred. Lamps, windows and the water keep their own materials because the runtime
 * animates them (flicker on zombie night, the party, the dusk through the glass).
 *
 * The runtime owns collisions and gameplay; this file only decides what the building looks like. Every prop that
 * blocks movement sits exactly on a collider the runtime already declares, so dressing can change without the game.
 */
import * as THREE from "three";
import { DEPTH, DOOR_Z0, DOOR_Z1, ELEV_X0, ELEV_X1, FLOORS, FLOOR_H, ROOF_POOL, SLAB, WIDTH, fy, type Room } from "./cpeLayout";
import * as T from "./cpeTextures";
import { activeTrade } from "./cpeTrade";

type Face = "px" | "nx" | "py" | "ny" | "pz" | "nz";
type Faces = Partial<Record<Face, string | null>>;

// ------------------------------------------------------------------ materials
const matCache = new Map<string, THREE.Material>();
/** how many metres one repeat of a texture covers, by material family */
function tileOf(key: string): number {
  const fam = key.split("|")[0];
  switch (fam) {
    case "wall": return 1.6;
    case "floor": return key.includes("|carpet|") ? 0.9 : key.includes("|rubber|") ? 0.7 : key.includes("|deck|") ? 1.0 : 1.2;
    case "brick": return 1.1;
    case "plaster": return 1.6;
    case "asphalt": return 3;
    case "sidewalk": return 2;
    case "water": return 2.2;
    default: return 1;
  }
}
const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, ...p });
export function materialFor(key: string): THREE.Material {
  let m = matCache.get(key);
  if (m) return m;
  const [fam, a, b] = key.split("|");
  if (fam === "ao") {
    m = new THREE.MeshBasicMaterial({ map: a === "blob" ? T.aoBlob() : T.aoEdge(), color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    matCache.set(key, m);
    return m;
  }
  switch (fam) {
    case "wall": m = std({ map: T.wallpaper(a, (b as T.WallPattern) || "plain"), roughness: 0.92 }); break;
    case "floor": m = std({ map: T.floorTex(a as T.FloorKind, b), roughness: a === "marble" ? 0.3 : a === "tiles" ? 0.45 : 0.8, metalness: a === "marble" ? 0.05 : 0 }); break;
    case "solid": m = std({ color: a, roughness: b ? Number(b) : 0.85 }); break;
    case "glow": m = std({ color: a, emissive: a, emissiveIntensity: b ? Number(b) : 1.2, roughness: 0.6 }); break;
    case "cut": m = std({ map: T.plaster("#f3e9d8"), roughness: 0.95 }); break;
    case "ceiling": m = std({ map: T.plaster("#f0eae0"), roughness: 0.95 }); break;
    case "plaster": m = std({ map: T.plaster(a || "#d9cfc0"), roughness: 0.92 }); break;
    case "brick": m = std({ map: T.brick(), roughness: 0.95 }); break;
    case "white": m = std({ color: "#f6f2ea", roughness: 0.7 }); break;
    case "wood": m = std({ map: T.floorTex("planks", a || "#9a6a44"), roughness: 0.6 }); break;
    case "darkwood": m = std({ map: T.floorTex("planks", "#5a3a28"), roughness: 0.55 }); break;
    case "metal": m = std({ color: "#3a3d42", roughness: 0.45, metalness: 0.6 }); break;
    case "brass": m = std({ color: "#d9a548", roughness: 0.35, metalness: 0.85 }); break;
    case "chrome": m = std({ color: "#cfd3d8", roughness: 0.18, metalness: 0.9 }); break;
    case "glass": m = std({ color: "#dff2ff", roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.22, depthWrite: false }); break;
    case "leaf": m = std({ color: a || "#4f8a3c", roughness: 0.9 }); break;
    case "pot": m = std({ color: a || "#b8674a", roughness: 0.8 }); break;
    case "fabric": m = std({ color: a, roughness: 1 }); break;
    case "mailbox": m = std({ map: T.mailboxes(), roughness: 0.4, metalness: 0.5 }); break;
    case "notice": m = std({ map: T.noticeBoard(), roughness: 1 }); break;
    case "washer": m = std({ map: T.washerFront(), roughness: 0.4 }); break;
    case "parcel": m = std({ map: T.parcel(Number(a) || 0), roughness: 0.95 }); break;
    case "painting": m = std({ map: T.painting(Number(a) || 0), roughness: 0.7 }); break;
    case "rug": m = std({ map: T.rug(Number(a) || 0), roughness: 1 }); break;
    case "water": m = std({ map: T.water(), color: "#6fc4e4", emissive: "#0f5f88", emissiveIntensity: 0.22, roughness: 0.22, metalness: 0.05 }); break;
    case "asphalt": m = std({ map: T.asphalt(), roughness: 0.95 }); break;
    case "sidewalk": m = std({ map: T.sidewalk(), roughness: 0.9 }); break;
    case "neon": m = std({ map: T.neon(a, b), emissive: "#ffffff", emissiveMap: T.neon(a, b), emissiveIntensity: 0.85, transparent: true, roughness: 0.8, side: THREE.DoubleSide }); break;
    case "label": m = std({ map: T.label(a, b, key.split("|")[3] ?? "#fff"), roughness: 0.7 }); break;
    default: m = std({ color: "#ff00ff" });
  }
  matCache.set(key, m);
  return m;
}

// ------------------------------------------------------------------ the kit
type Bucket = { P: number[]; N: number[]; U: number[]; I: number[] };
export class Kit {
  private buckets = new Map<string, Bucket>();
  private bucket(key: string): Bucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = { P: [], N: [], U: [], I: [] };
      this.buckets.set(key, b);
    }
    return b;
  }
  /** an axis-aligned box; UVs come from world position so a texture tiles across neighbouring boxes */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, key: string, opt: { faces?: Faces; tile?: number; fit?: boolean } = {}) {
    const faces: [Face, number[], number[][]][] = [
      ["pz", [0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      ["nz", [0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
      ["nx", [-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      ["px", [1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
      ["py", [0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
      ["ny", [0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    ];
    for (const [face, n, q] of faces) {
      const over = opt.faces?.[face];
      if (over === null) continue;
      const k = over ?? key;
      const tile = opt.tile ?? tileOf(k);
      const b = this.bucket(k);
      const base = b.P.length / 3;
      const fitU = n[2] !== 0 ? [x0, x1] : n[0] !== 0 ? [z0, z1] : [x0, x1];
      const fitV = n[1] !== 0 ? [z0, z1] : [y0, y1];
      for (const v of q) {
        b.P.push(v[0], v[1], v[2]);
        b.N.push(n[0], n[1], n[2]);
        const [u, w] = n[2] !== 0 ? [v[0], v[1]] : n[0] !== 0 ? [v[2], v[1]] : [v[0], v[2]];
        if (opt.fit) b.U.push((u - fitU[0]) / (fitU[1] - fitU[0] || 1), (w - fitV[0]) / (fitV[1] - fitV[0] || 1));
        else b.U.push(u / tile, w / tile);
      }
      b.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  /** a textured quad on a wall (facing +z), the whole texture once */
  plaque(cx: number, cy: number, w: number, h: number, z: number, key: string, facing: "pz" | "nz" | "px" | "nx" = "pz", flipV = false) {
    const b = this.bucket(key);
    const base = b.P.length / 3;
    const n = facing === "pz" ? [0, 0, 1] : facing === "nz" ? [0, 0, -1] : facing === "px" ? [1, 0, 0] : [-1, 0, 0];
    const q =
      facing === "pz" ? [[cx - w / 2, cy - h / 2, z], [cx + w / 2, cy - h / 2, z], [cx + w / 2, cy + h / 2, z], [cx - w / 2, cy + h / 2, z]]
      : facing === "nz" ? [[cx + w / 2, cy - h / 2, z], [cx - w / 2, cy - h / 2, z], [cx - w / 2, cy + h / 2, z], [cx + w / 2, cy + h / 2, z]]
      : facing === "px" ? [[z, cy - h / 2, cx + w / 2], [z, cy - h / 2, cx - w / 2], [z, cy + h / 2, cx - w / 2], [z, cy + h / 2, cx + w / 2]]
      : [[z, cy - h / 2, cx - w / 2], [z, cy - h / 2, cx + w / 2], [z, cy + h / 2, cx + w / 2], [z, cy + h / 2, cx - w / 2]];
    const uv = flipV ? [[0, 1], [1, 1], [1, 0], [0, 0]] : [[0, 0], [1, 0], [1, 1], [0, 1]];
    q.forEach((v, i) => {
      b.P.push(v[0], v[1], v[2]);
      b.N.push(n[0], n[1], n[2]);
      b.U.push(uv[i][0], uv[i][1]);
    });
    b.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** a textured quad lying flat on the floor (facing +y); v runs front (z1) to back (z0) unless flipped */
  mat(x0: number, x1: number, z0: number, z1: number, y: number, key: string, flipV = false) {
    const b = this.bucket(key);
    const base = b.P.length / 3;
    const q = [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]];
    const uv = flipV ? [[0, 1], [1, 1], [1, 0], [0, 0]] : [[0, 0], [1, 0], [1, 1], [0, 1]];
    q.forEach((v, i) => {
      b.P.push(v[0], v[1], v[2]);
      b.N.push(0, 1, 0);
      b.U.push(uv[i][0], uv[i][1]);
    });
    b.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** any three.js geometry, placed */
  add(geo: THREE.BufferGeometry, key: string, x: number, y: number, z: number, opt: { rx?: number; ry?: number; rz?: number; s?: number | [number, number, number] } = {}) {
    const m = new THREE.Matrix4();
    const s = opt.s === undefined ? [1, 1, 1] : typeof opt.s === "number" ? [opt.s, opt.s, opt.s] : opt.s;
    m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(opt.rx ?? 0, opt.ry ?? 0, opt.rz ?? 0)), new THREE.Vector3(s[0], s[1], s[2]));
    const g = geo.clone().applyMatrix4(m);
    const b = this.bucket(key);
    const base = b.P.length / 3;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
    for (let i = 0; i < pos.count; i++) {
      b.P.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      b.N.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      b.U.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) b.I.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) b.I.push(base + i);
    g.dispose();
  }
  cyl(x: number, y: number, z: number, rTop: number, rBot: number, h: number, key: string, segs = 14, opt: { rx?: number; ry?: number; rz?: number } = {}) {
    this.add(new THREE.CylinderGeometry(rTop, rBot, h, segs), key, x, y, z, opt);
  }
  sphere(x: number, y: number, z: number, r: number, key: string, s: [number, number, number] = [1, 1, 1]) {
    this.add(new THREE.SphereGeometry(r, 14, 10), key, x, y, z, { s });
  }
  build(parent: THREE.Object3D, shadows: boolean): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [key, b] of this.buckets) {
      if (!b.I.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.P, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.N, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(b.U, 2));
      g.setIndex(b.I);
      const mesh = new THREE.Mesh(g, materialFor(key));
      const translucent = key.startsWith("glass") || key.startsWith("neon") || key.startsWith("ao");
      mesh.castShadow = shadows && !translucent && !key.startsWith("glow");
      mesh.receiveShadow = shadows && !translucent;
      if (translucent) mesh.renderOrder = key.startsWith("ao") ? 1 : 2;
      parent.add(mesh);
      out.push(mesh);
    }
    this.buckets.clear();
    return out;
  }
}

// ------------------------------------------------------------------ small furniture (y is the floor's height)
const BACK = -DEPTH;
function plant(k: Kit, y: number, x: number, z: number, s = 1, leaf = "#4f8a3c") {
  under(k, y, x - 0.2 * s, x + 0.2 * s, z - 0.2 * s, z + 0.2 * s, 0.25);
  k.cyl(x, y + 0.2 * s, z, 0.2 * s, 0.16 * s, 0.4 * s, "pot|#b8674a", 12);
  k.cyl(x, y + 0.62 * s, z, 0.025, 0.03, 0.5 * s, "solid|#4a6a34", 6);
  k.sphere(x, y + 1.02 * s, z, 0.36 * s, `leaf|${leaf}`, [1, 1.25, 1]);
  k.sphere(x + 0.16 * s, y + 0.82 * s, z + 0.08 * s, 0.24 * s, `leaf|${leaf}`, [1, 1.1, 1]);
  k.sphere(x - 0.18 * s, y + 0.86 * s, z - 0.05 * s, 0.22 * s, "leaf|#3c6f34", [1, 1.2, 1]);
}
function frame(k: Kit, cx: number, cy: number, w: number, h: number, i: number, z = BACK + 0.04) {
  k.box(cx - w / 2 - 0.05, cx + w / 2 + 0.05, cy - h / 2 - 0.05, cy + h / 2 + 0.05, z - 0.02, z + 0.02, "darkwood");
  k.plaque(cx, cy, w, h, z + 0.025, `painting|${i}`);
}
function sconce(k: Kit, x: number, y: number, z = BACK + 0.02) {
  k.box(x - 0.05, x + 0.05, y - 0.08, y + 0.08, z, z + 0.06, "brass");
  k.add(new THREE.CylinderGeometry(0.14, 0.09, 0.22, 10, 1, true), "glow|#ffe3b0|1.1", x, y + 0.12, z + 0.12);
}
function pendant(k: Kit, x: number, z: number, ceiling: number) {
  k.box(x - 0.01, x + 0.01, ceiling - 0.62, ceiling, z - 0.01, z + 0.01, "metal");
  k.add(new THREE.CylinderGeometry(0.1, 0.4, 0.3, 16, 1, true), "glow|#f6e7c4|0.25", x, ceiling - 0.7, z);
}
function sofa(k: Kit, y: number, x0: number, x1: number, z0: number, z1: number, fab: string, cushion = "#f4efe6") {
  const d = z1 - z0;
  under(k, y, x0 - 0.16, x1 + 0.16, z0, z1);
  k.box(x0, x1, y + 0.08, y + 0.42, z0, z1, `fabric|${fab}`);
  k.box(x0, x1, y + 0.42, y + 0.95, z0, z0 + d * 0.3, `fabric|${fab}`);
  k.box(x0 - 0.16, x0, y + 0.08, y + 0.66, z0, z1, `fabric|${fab}`);
  k.box(x1, x1 + 0.16, y + 0.08, y + 0.66, z0, z1, `fabric|${fab}`);
  const n = Math.max(1, Math.round((x1 - x0) / 0.9));
  for (let i = 0; i < n; i++) {
    const cx = x0 + ((i + 0.5) * (x1 - x0)) / n;
    k.box(cx - 0.36, cx + 0.36, y + 0.42, y + 0.52, z0 + d * 0.3, z1 - 0.04, `fabric|${cushion}`);
  }
  k.box(x0 + 0.25, x0 + 0.7, y + 0.52, y + 0.86, z0 + d * 0.3, z0 + d * 0.5, "fabric|#e0a22f");
  for (const lx of [x0 + 0.1, x1 - 0.1]) for (const lz of [z0 + 0.1, z1 - 0.1]) k.cyl(lx, y + 0.04, lz, 0.03, 0.03, 0.08, "darkwood", 6);
}
function armchair(k: Kit, y: number, x0: number, x1: number, z0: number, z1: number, fab: string) {
  under(k, y, x0 - 0.14, x1 + 0.14, z0, z1);
  k.box(x0, x1, y + 0.1, y + 0.45, z0, z1, `fabric|${fab}`);
  k.box(x0, x1, y + 0.45, y + 0.98, z0, z0 + 0.28, `fabric|${fab}`);
  k.box(x0 - 0.14, x0, y + 0.1, y + 0.68, z0, z1, `fabric|${fab}`);
  k.box(x1, x1 + 0.14, y + 0.1, y + 0.68, z0, z1, `fabric|${fab}`);
  k.box(x0 + 0.05, x1 - 0.05, y + 0.45, y + 0.55, z0 + 0.28, z1 - 0.05, "fabric|#f4efe6");
}
function lounger(k: Kit, y: number, x: number, z0: number, z1: number, stripe: string) {
  k.box(x, x + 0.8, y + 0.3, y + 0.42, z0 + 0.5, z1, "fabric|#f4efe6", { faces: { py: `fabric|${stripe}` } });
  k.add(new THREE.BoxGeometry(0.8, 0.08, 0.9), `fabric|${stripe}`, x + 0.4, y + 0.62, z0 + 0.32, { rx: -0.9 });
  for (const lx of [x + 0.08, x + 0.72]) for (const lz of [z0 + 0.6, z1 - 0.1]) k.cyl(lx, y + 0.15, lz, 0.025, 0.025, 0.3, "white", 6);
}
function umbrella(k: Kit, y: number, x: number, z: number, color: string) {
  k.cyl(x, y + 1.1, z, 0.03, 0.04, 2.2, "white", 8);
  k.add(new THREE.ConeGeometry(1.25, 0.5, 10, 1, true), `fabric|${color}`, x, y + 2.2, z);
  k.add(new THREE.ConeGeometry(1.26, 0.5, 10, 1, true), "fabric|#f4efe6", x, y + 2.2, z, { s: [1, 0.98, 1] });
}
function table(k: Kit, y: number, x0: number, x1: number, h: number, z0: number, z1: number, top: string, legs = "darkwood") {
  under(k, y, x0, x1, z0, z1, 0.2);
  k.box(x0, x1, y + h - 0.05, y + h, z0, z1, top);
  for (const lx of [x0 + 0.08, x1 - 0.08]) for (const lz of [z0 + 0.08, z1 - 0.08]) k.box(lx - 0.03, lx + 0.03, y, y + h - 0.05, lz - 0.03, lz + 0.03, legs);
}
function parcelPile(k: Kit, y: number, x: number, z: number, n: number, seed: number) {
  let top = y;
  for (let i = 0; i < n; i++) {
    const w = 0.5 + ((seed * 7 + i * 3) % 4) * 0.08, h = 0.28 + ((seed + i) % 3) * 0.08, d = 0.42 + ((seed * 3 + i) % 3) * 0.07;
    const ox = ((seed + i * 5) % 5) * 0.04 - 0.08;
    k.box(x - w / 2 + ox, x + w / 2 + ox, top, top + h, z - d / 2, z + d / 2, `parcel|${(seed + i) % 3}`, { tile: 0.6 });
    top += h;
  }
}
/** the painted shadow a piece of furniture leaves on the floor around its footprint */
function under(k: Kit, y: number, x0: number, x1: number, z0: number, z1: number, spread = 0.35) {
  k.mat(x0 - spread, x1 + spread, z0 - spread, z1 + spread, y + 0.046, "ao|blob");
}
function lockerDoorPlate(k: Kit, x: number, y: number, text: string) {
  k.plaque(x, y, 0.5, 0.16, DOOR_Z0 - 0.02 + 0.001, `label|${text}|#efe4d2|#3a3346`);
}

// ------------------------------------------------------------------ rooms
const WALL_PATTERN: Record<Room["kind"], T.WallPattern> = {
  package: "plain",
  mail: "panel",
  lobby: "panel",
  elevator: "plain",
  leasing: "stripe",
  laundry: "tile",
  gym: "plain",
  closets: "stripe",
  spa: "dots",
  pool: "plain",
  lounge: "lattice",
};
function roomFloor(k: Kit, r: Room, y: number) {
  const kind: Record<Room["kind"], [T.FloorKind, string]> = {
    package: ["concrete", r.floor],
    mail: ["checker", "#cfc6b4"],
    lobby: ["marble", "#e8dfd0"],
    elevator: ["carpet", "#3a3346"],
    leasing: ["planks", r.floor],
    laundry: ["tiles", "#b9c6cf"],
    gym: ["rubber", r.floor],
    closets: ["carpet", r.floor],
    spa: ["tiles", "#d9c8bf"],
    pool: ["deck", "#b89b78"],
    lounge: ["planks", "#6a4a3a"],
  };
  const [fk, col] = kind[r.kind];
  k.box(r.x0, r.x1, y, y + 0.04, BACK, 0.3, `floor|${fk}|${col}`);
}

function backWall(k: Kit, r: Room, y: number, pattern: T.WallPattern, windows: { cx: number; w: number }[]) {
  const top = y + FLOOR_H - SLAB;
  const key = `wall|${r.wall}|${pattern}`;
  const z0 = BACK - 0.25, z1 = BACK;
  if (!windows.length) {
    k.box(r.x0, r.x1, y, top, z0, z1, key);
  } else {
    const wy0 = y + 1.1, wy1 = y + 2.8;
    k.box(r.x0, r.x1, y, wy0, z0, z1, key);
    k.box(r.x0, r.x1, wy1, top, z0, z1, key);
    let x = r.x0;
    for (const w of windows) {
      k.box(x, w.cx - w.w / 2, wy0, wy1, z0, z1, key);
      x = w.cx + w.w / 2;
      // the frame, a sill and a cross mullion; the glass and the view are the runtime's (they change with the night)
      const f = 0.07;
      k.box(w.cx - w.w / 2 - f, w.cx - w.w / 2, wy0 - f, wy1 + f, z0 + 0.03, z1 + 0.02, "white");
      k.box(w.cx + w.w / 2, w.cx + w.w / 2 + f, wy0 - f, wy1 + f, z0 + 0.03, z1 + 0.02, "white");
      k.box(w.cx - w.w / 2 - f, w.cx + w.w / 2 + f, wy1, wy1 + f, z0 + 0.03, z1 + 0.02, "white");
      k.box(w.cx - w.w / 2 - 0.12, w.cx + w.w / 2 + 0.12, wy0 - 0.06, wy0, z0 + 0.03, z1 + 0.16, "white");
      k.box(w.cx - 0.025, w.cx + 0.025, wy0, wy1, z0 + 0.1, z0 + 0.14, "white");
      k.box(w.cx - w.w / 2, w.cx + w.w / 2, wy0 + (wy1 - wy0) * 0.62, wy0 + (wy1 - wy0) * 0.62 + 0.05, z0 + 0.1, z0 + 0.14, "white");
    }
    k.box(x, r.x1, wy0, wy1, z0, z1, key);
  }
  // skirting and crown
  k.box(r.x0, r.x1, y, y + 0.14, z1, z1 + 0.05, "white");
  k.box(r.x0, r.x1, top - 0.12, top, z1, z1 + 0.07, "white");
  // painted occlusion: the wall darkens toward the floor and the ceiling, the floor darkens toward the wall
  k.plaque((r.x0 + r.x1) / 2, y + 0.45, r.x1 - r.x0, 0.9, z1 + 0.06, "ao|edge");
  k.plaque((r.x0 + r.x1) / 2, top - 0.5, r.x1 - r.x0, 1.0, z1 + 0.08, "ao|edge", "pz", true);
  k.mat(r.x0, r.x1, z1, z1 + 1.1, y + 0.05, "ao|edge", true);
}

function partition(k: Kit, r: Room, y: number) {
  if (r.x1 >= WIDTH) return;
  const top = y + FLOOR_H - SLAB;
  const key = `wall|${r.wall}|plain`;
  const x = r.x1;
  k.box(x - 0.12, x + 0.12, y, top, BACK, DOOR_Z0, key);
  k.box(x - 0.12, x + 0.12, y, top, DOOR_Z1, -0.2, key);
  k.box(x - 0.12, x + 0.12, y + 2.6, top, DOOR_Z0, DOOR_Z1, key);
  // the cut edge of the partition, and a door frame around the opening
  k.box(x - 0.12, x + 0.12, y, top, -0.2, -0.14, "cut");
  k.box(x - 0.16, x + 0.16, y, y + 2.66, DOOR_Z0 - 0.08, DOOR_Z0, "darkwood");
  k.box(x - 0.16, x + 0.16, y, y + 2.66, DOOR_Z1, DOOR_Z1 + 0.08, "darkwood");
  k.box(x - 0.16, x + 0.16, y + 2.6, y + 2.68, DOOR_Z0 - 0.08, DOOR_Z1 + 0.08, "darkwood");
  k.box(x - 0.12, x + 0.12, y, y + 0.14, -0.14, -0.2, "white");
}

function dress(k: Kit, r: Room, f: number, y: number, ceiling: number) {
  const c = (r.x0 + r.x1) / 2;
  switch (r.kind) {
    case "package": {
      // steel shelving stacked with parcels, a pile on the floor, a hand truck, a wall clock
      under(k, y, 2.4, 7.2, BACK + 0.1, BACK + 0.8, 0.25);
      for (const sx of [2.5, 7.1]) k.box(sx - 0.04, sx + 0.04, y, y + 2.6, BACK + 0.1, BACK + 0.8, "metal");
      for (const sy of [0.9, 1.7, 2.5]) k.box(2.4, 7.2, y + sy - 0.04, y + sy, BACK + 0.1, BACK + 0.8, "metal");
      let i = 0;
      for (const sy of [0, 0.9, 1.7]) for (let px = 2.75; px < 7; px += 0.62 + (i % 3) * 0.1) parcelPile(k, y + sy, px, BACK + 0.45, 1 + ((i++ + (sy * 10) | 0) % 2), i + sy * 7 | 0);
      for (let i2 = 0; i2 < 5; i2++) parcelPile(k, y, 1.05 + i2 * 1.2, BACK + 0.5, 2 + (i2 % 3), i2 * 11);
      k.box(0.3, 0.9, y, y + 0.03, BACK + 1.4, BACK + 2.0, "metal");
      k.box(0.3, 0.36, y, y + 1.25, BACK + 1.95, BACK + 2.0, "metal");
      k.box(0.84, 0.9, y, y + 1.25, BACK + 1.95, BACK + 2.0, "metal");
      k.cyl(0.33, y + 0.12, BACK + 1.9, 0.12, 0.12, 0.06, "solid|#2b2f36", 12, { rz: Math.PI / 2 });
      k.cyl(0.87, y + 0.12, BACK + 1.9, 0.12, 0.12, 0.06, "solid|#2b2f36", 12, { rz: Math.PI / 2 });
      k.plaque(c, y + 3.3, 2.2, 0.5, BACK + 0.01, "label|PACKAGE ROOM|#c8674e|#fff2e0");
      k.cyl(1.2, y + 3.1, BACK + 0.02, 0.26, 0.26, 0.05, "white", 20, { rx: Math.PI / 2 });
      pendant(k, 6.3, -2.4, ceiling);
      break;
    }
    case "mail": {
      under(k, y, 8.4, 14.6, BACK + 0.1, BACK + 0.5);
      k.box(8.4, 14.6, y, y + 2.2, BACK + 0.1, BACK + 0.5, "metal", { faces: { pz: "mailbox" }, fit: true });
      k.box(8.3, 14.7, y + 2.2, y + 2.3, BACK + 0.05, BACK + 0.55, "darkwood");
      k.plaque(10.6, y + 3.0, 2.4, 1.3, BACK + 0.03, "notice");
      k.plaque(13.3, y + 3.05, 1.8, 0.44, BACK + 0.02, "label|MAILROOM|#8fa68a|#1f2a1f");
      k.box(14.1, 14.7, y, y + 0.8, BACK + 0.6, BACK + 1.2, "solid|#3b6ea8");
      k.box(14.1, 14.7, y + 0.8, y + 0.84, BACK + 0.6, BACK + 1.2, "solid|#2b4f80");
      pendant(k, 9.8, -2.6, ceiling);
      pendant(k, 12.2, -2.6, ceiling);
      break;
    }
    case "lobby": {
      // the concierge desk: wood front with a brass rail, marble top, a bell and an orchid; the building's name behind
      under(k, y, 19.5, 24.5, -3.9, -3.0);
      k.box(19.5, 24.5, y, y + 1.0, -3.9, -3.0, "wood|#8a5a36");
      k.box(19.45, 24.55, y + 1.0, y + 1.08, -3.95, -2.95, "floor|marble|#e9e2d6", { tile: 1.5 });
      k.box(19.5, 24.5, y + 0.3, y + 0.34, -2.99, -2.95, "brass");
      k.box(19.5, 24.5, y + 0.7, y + 0.74, -2.99, -2.95, "brass");
      k.add(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), "brass", 23.6, y + 1.08, -3.3);
      k.cyl(20.3, y + 1.2, -3.5, 0.06, 0.08, 0.24, "white", 10);
      k.cyl(20.3, y + 1.5, -3.5, 0.01, 0.01, 0.4, "solid|#4a6a34", 4);
      k.sphere(20.36, y + 1.7, -3.5, 0.07, "fabric|#ff9ec4", [1, 0.7, 1]);
      frame(k, 22, y + 2.35, 1.9, 1.2, 0, BACK + 0.04);
      k.box(15.3, 15.9, y + 2.0, y + 2.6, BACK + 0.02, BACK + 0.08, "white");
      armchair(k, y, 17.4, 18.6, -4.6, -3.6, "#3f5f7a");
      k.mat(18, 24, -3.0, -1.0, y + 0.045, "rug|0");
      plant(k, y, 26, -4.5, 1.3, "#4f8a3c");
      plant(k, y, 15.5, -4.5, 0.9, "#6aa04a");
      // a tall clock by the elevator
      k.box(25.9, 26.5, y, y + 2.3, BACK + 0.1, BACK + 0.45, "darkwood");
      k.cyl(26.2, y + 1.9, BACK + 0.45, 0.22, 0.22, 0.04, "white", 20, { rx: Math.PI / 2 });
      k.box(26.1, 26.3, y + 0.4, y + 1.5, BACK + 0.3, BACK + 0.34, "brass");
      pendant(k, 18, -2.2, ceiling);
      pendant(k, 24, -2.2, ceiling);
      sconce(k, 16.6, y + 2.3);
      sconce(k, 25.2, y + 2.3);
      break;
    }
    case "elevator": {
      // brass doors with a seam, a lit lintel, the indicator, a call plate
      k.box(ELEV_X0 + 0.3, ELEV_X1 - 0.3, y, y + 2.7, BACK + 0.05, BACK + 0.3, "brass");
      k.box((ELEV_X0 + ELEV_X1) / 2 - 0.015, (ELEV_X0 + ELEV_X1) / 2 + 0.015, y, y + 2.7, BACK + 0.3, BACK + 0.32, "solid|#2b211c");
      k.box(ELEV_X0 + 0.15, ELEV_X1 - 0.15, y + 2.7, y + 2.85, BACK, BACK + 0.36, "darkwood");
      k.box(ELEV_X0 + 0.15, ELEV_X0 + 0.3, y, y + 2.7, BACK, BACK + 0.36, "darkwood");
      k.box(ELEV_X1 - 0.3, ELEV_X1 - 0.15, y, y + 2.7, BACK, BACK + 0.36, "darkwood");
      k.box(ELEV_X0 + 0.3, ELEV_X1 - 0.3, y + 2.86, y + 2.92, BACK + 0.2, BACK + 0.34, "glow|#ffe3b0|1.4");
      k.box(ELEV_X0 + 0.9, ELEV_X0 + 1.1, y + 1.0, y + 1.3, BACK + 0.36, BACK + 0.38, "chrome");
      k.cyl(ELEV_X0 + 1.0, y + 1.15, BACK + 0.39, 0.03, 0.03, 0.02, "glow|#ffb547|1.5", 10, { rx: Math.PI / 2 });
      k.mat(ELEV_X0 + 0.4, ELEV_X1 - 0.4, -4.6, -0.6, y + 0.045, "rug|1");
      break;
    }
    case "leasing": {
      sofa(k, y, 30.6, 33.2, -4.6, -3.4, "#d98f6b");
      sofa(k, y, 34.4, 37.4, -4.6, -3.4, "#d98f6b");
      k.box(32.6, 34.6, y + 0.4, y + 0.45, -2.6, -1.6, "glass", { faces: { ny: null } });
      k.box(32.65, 34.55, y + 0.38, y + 0.4, -2.55, -1.65, "darkwood");
      for (const lx of [32.7, 34.5]) for (const lz of [-2.5, -1.7]) k.cyl(lx, y + 0.2, lz, 0.025, 0.025, 0.4, "brass", 6);
      k.box(33.1, 33.7, y + 0.45, y + 0.5, -2.3, -1.9, "fabric|#3b6ea8");
      k.box(33.5, 34.1, y + 0.5, y + 0.54, -2.2, -1.8, "fabric|#e4b04a");
      k.mat(31.4, 36.4, -3.2, -1.1, y + 0.045, "rug|2");
      k.cyl(33.8, y + 0.8, -4.4, 0.02, 0.02, 1.6, "metal", 6);
      k.add(new THREE.CylinderGeometry(0.22, 0.3, 0.32, 14, 1, true), "glow|#f6e7c4|0.9", 33.8, y + 1.72, -4.4);
      frame(k, 31.9, y + 2.35, 1.4, 0.9, 1);
      frame(k, 35.9, y + 2.35, 1.4, 0.9, 2);
      plant(k, y, 37.7, -1.15, 1.1, "#3c6f34");
      k.plaque(34, y + 3.3, 2.6, 0.6, BACK + 0.02, "neon|Leasing|#7cc7ff");
      pendant(k, 32, -2.4, ceiling);
      pendant(k, 36, -2.4, ceiling);
      break;
    }
    case "laundry": {
      // the devices themselves (washers, or a plumber's toilets, an electrician's outlets) are the runtime's: it wrecks them
      for (const d of activeTrade().devices) under(k, y, d.x - d.w / 2, d.x + d.w / 2, d.z - d.d / 2, d.z + d.d / 2, 0.25);
      // detergent shelf
      k.box(0.5, 7.1, y + 1.75, y + 1.8, BACK + 0.08, BACK + 0.45, "white");
      const bottles = ["#3b6ea8", "#e0a22f", "#2f8f8a", "#d9534f", "#ff9ec4", "#8fe36a"];
      for (let i = 0; i < 9; i++) k.box(0.7 + i * 0.7, 1.0 + i * 0.7, y + 1.8, y + 2.18 + (i % 2) * 0.1, BACK + 0.12, BACK + 0.4, `fabric|${bottles[i % bottles.length]}`);
      // a basket on the floor where a dog hides; the folding table against the back wall with a basket of towels on it
      k.add(new THREE.CylinderGeometry(0.34, 0.28, 0.42, 14, 1, true), "wood|#c9a27a", 1.2, y + 0.21, -1.0);
      table(k, y, 7.0, 8.8, 0.9, BACK + 0.1, BACK + 1.0, "white", "metal");
      k.add(new THREE.CylinderGeometry(0.3, 0.25, 0.36, 14, 1, true), "wood|#c9a27a", 8.2, y + 1.08, BACK + 0.55);
      k.sphere(8.2, y + 1.26, BACK + 0.55, 0.24, "fabric|#f4efe6", [1, 0.5, 1]);
      k.sphere(8.1, y + 1.32, BACK + 0.5, 0.15, "fabric|#9ad3e8", [1, 0.5, 1]);
      for (let i = 0; i < 4; i++) k.box(7.15, 7.75, y + 0.9 + i * 0.08, y + 0.98 + i * 0.08, BACK + 0.3, BACK + 0.85, `fabric|${["#f4efe6", "#9ad3e8", "#ffd6e0", "#e7ffd8"][i]}`);
      k.plaque(4.5, y + 3.25, 2.2, 0.5, BACK + 0.02, `label|${activeTrade().room.sign}|#b9c6cf|#1f2a3a`);
      pendant(k, 2.5, -2.6, ceiling);
      pendant(k, 6.5, -2.6, ceiling);
      break;
    }
    case "gym": {
      for (const x0 of [10.2, 13.2]) {
        under(k, y, x0, x0 + 2.2, -4.6, -3.6, 0.25);
        k.box(x0, x0 + 2.2, y + 0.1, y + 0.2, -4.6, -3.6, "solid|#2b2f36");
        k.box(x0 + 0.1, x0 + 2.1, y + 0.2, y + 0.22, -4.5, -3.7, "solid|#1b1d22");
        k.box(x0 + 1.9, x0 + 2.1, y, y + 1.3, -4.5, -3.7, "metal");
        k.box(x0 + 1.75, x0 + 2.25, y + 1.3, y + 1.55, -4.45, -3.75, "solid|#1b1d22", { faces: { nx: "glow|#6fd0a0|0.8" } });
        k.box(x0 + 0.9, x0 + 2.0, y + 1.0, y + 1.05, -4.56, -4.5, "metal");
        k.box(x0 + 0.9, x0 + 2.0, y + 1.0, y + 1.05, -3.7, -3.64, "metal");
      }
      // the mat with the third treadmill belt a dog is loafing on
      k.box(11.0, 13.2, y + 0.04, y + 0.12, -1.5, -0.5, "solid|#2b2f36");
      // the weight rack
      k.box(16.2, 17.6, y, y + 0.08, BACK + 0.1, BACK + 0.7, "metal");
      for (const sy of [0.45, 0.95, 1.4]) k.box(16.2, 17.6, y + sy - 0.04, y + sy, BACK + 0.1, BACK + 0.7, "metal");
      const dumb = ["#d9534f", "#3b6ea8", "#e0a22f", "#2f8f8a", "#8fe36a", "#ff9ec4"];
      for (const [i, sy] of [0.08, 0.45, 0.95].entries()) for (let j = 0; j < 3; j++) {
        const dx = 16.45 + j * 0.42;
        k.cyl(dx, y + sy + 0.1, BACK + 0.4, 0.03, 0.03, 0.3, "chrome", 8, { rz: Math.PI / 2 });
        k.cyl(dx - 0.14, y + sy + 0.1, BACK + 0.4, 0.09, 0.09, 0.08, `fabric|${dumb[(i * 3 + j) % 6]}`, 12, { rz: Math.PI / 2 });
        k.cyl(dx + 0.14, y + sy + 0.1, BACK + 0.4, 0.09, 0.09, 0.08, `fabric|${dumb[(i * 3 + j) % 6]}`, 12, { rz: Math.PI / 2 });
      }
      k.sphere(15.6, y + 0.32, -1.3, 0.32, "fabric|#3b6ea8");
      k.plaque(c, y + 3.25, 2.6, 0.5, BACK + 0.02, "label|NO PAIN NO LAUNDRY|#d9a55b|#3a2410");
      frame(k, 10.2, y + 2.45, 1.0, 0.7, 3);
      pendant(k, 11.5, -2.4, ceiling);
      pendant(k, 15.5, -2.4, ceiling);
      break;
    }
    case "closets": {
      k.mat(18.4, 26.6, -3.0, -1.0, y + 0.045, "rug|3");
      for (const sx of [21.2, 24.4]) sconce(k, sx, y + 2.3);
      lockerDoorPlate(k, 19.6, y + 2.88, "STORAGE 1");
      lockerDoorPlate(k, 22.8, y + 2.88, "STORAGE 2");
      lockerDoorPlate(k, 26.0, y + 2.88, "STORAGE 3");
      pendant(k, c, -2.2, ceiling);
      break;
    }
    case "spa": {
      for (let x = 31; x < 37.5; x += 2.2) {
        k.box(x, x + 1.6, y, y + 0.35, -4.6, -3.6, "white", { faces: { py: "solid|#9ad3e8|0.3" } });
        k.box(x + 0.06, x + 1.54, y + 0.3, y + 0.35, -4.54, -3.66, "solid|#bfe8ff|0.2");
        k.cyl(x + 0.8, y + 0.62, -4.5, 0.03, 0.03, 0.55, "chrome", 8);
        k.cyl(x + 0.8, y + 0.9, -4.35, 0.03, 0.03, 0.3, "chrome", 8, { rx: Math.PI / 2 });
      }
      k.box(30.4, 33.6, y + 1.5, y + 1.55, BACK + 0.08, BACK + 0.5, "white");
      for (let i = 0; i < 5; i++) k.box(30.6 + i * 0.6, 31.1 + i * 0.6, y + 1.55, y + 1.85, BACK + 0.12, BACK + 0.46, `fabric|${["#ffd6e0", "#dff0ff", "#fff6e0", "#e7ffd8", "#ffe9a8"][i]}`);
      for (let i = 0; i < 12; i++) {
        const bx = 30.9 + (i % 6) * 1.15, bz = -1.0 - Math.floor(i / 6) * 0.9;
        k.add(new THREE.TorusGeometry(0.3, 0.1, 8, 16), `fabric|${["#d98f6b", "#3f5f7a", "#c9a14a", "#6f8f76"][i % 4]}`, bx, y + 0.1, bz, { rx: Math.PI / 2 });
        k.cyl(bx, y + 0.05, bz, 0.3, 0.3, 0.06, "fabric|#f4efe6", 16);
      }
      k.plaque(34, y + 3.3, 2.2, 0.6, BACK + 0.02, "neon|Dog Spa|#ff9ec4");
      k.mat(30.5, 37.5, -3.2, -0.4, y + 0.045, "rug|4");
      pendant(k, 32, -2.4, ceiling);
      pendant(k, 36, -2.4, ceiling);
      break;
    }
    case "pool": {
      // a raised plunge pool with tiled coping; the water is the runtime's (it moves)
      // the pool sits on its collider exactly; the laundry rope's hole and landing are west of it
      const P = ROOF_POOL;
      under(k, y, P.x0, P.x1, P.z0, P.z1, 0.3);
      k.box(P.x0, P.x1, y, y + 0.32, P.z0, P.z1, "floor|tiles|#cfc6b8", { faces: { py: null }, tile: 0.5 });
      // coping: a ring, so the water shows; the basin under the water is deep blue
      k.box(P.x0, P.x1, y + 0.32, y + 0.4, P.z0, P.z0 + 0.3, "floor|tiles|#e4ddd0", { tile: 0.5 });
      k.box(P.x0, P.x1, y + 0.32, y + 0.4, P.z1 - 0.3, P.z1, "floor|tiles|#e4ddd0", { tile: 0.5 });
      k.box(P.x0, P.x0 + 0.3, y + 0.32, y + 0.4, P.z0 + 0.3, P.z1 - 0.3, "floor|tiles|#e4ddd0", { tile: 0.5 });
      k.box(P.x1 - 0.3, P.x1, y + 0.32, y + 0.4, P.z0 + 0.3, P.z1 - 0.3, "floor|tiles|#e4ddd0", { tile: 0.5 });
      k.box(P.x0 + 0.3, P.x1 - 0.3, y + 0.2, y + 0.3, P.z0 + 0.3, P.z1 - 0.3, "solid|#0e5a84|0.6");
      // loungers, umbrellas, a side table
      lounger(k, y, 2, -4.6, -3.0, "#3f5f7a");
      lounger(k, y, 3.6, -4.6, -3.0, "#d9534f");
      lounger(k, y, 5.2, -4.6, -3.0, "#2f8f8a");
      umbrella(k, y, 2.9, -3.9, "#d9534f");
      umbrella(k, y, 4.9, -3.9, "#3f5f7a");
      k.cyl(1.2, y + 0.25, -3.7, 0.2, 0.2, 0.5, "white", 12);
      k.cyl(1.2, y + 0.58, -3.7, 0.08, 0.06, 0.16, "fabric|#e0a22f", 10);
      // planters with hedges along the back, a float at the pool's edge
      for (let x = 19; x < 26.5; x += 1.9) {
        k.box(x, x + 1.5, y, y + 0.5, BACK + 0.15, BACK + 0.75, "pot|#8a7a6a");
        k.sphere(x + 0.75, y + 0.85, BACK + 0.45, 0.55, "leaf|#4f8a3c", [1.3, 0.75, 1]);
      }
      k.add(new THREE.TorusGeometry(0.42, 0.14, 10, 20), "fabric|#ff9ec4", 10.5, y + 0.44, ROOF_POOL.z1 - 0.25, { rx: Math.PI / 2 });
      // a cabana by the lounge wall
      k.box(21.4, 24.6, y + 2.6, y + 2.7, -2.4, -0.6, "fabric|#f4efe6");
      for (const px of [21.5, 24.5]) for (const pz of [-2.3, -0.7]) k.cyl(px, y + 1.3, pz, 0.04, 0.04, 2.6, "white", 8);
      k.box(21.4, 24.6, y + 2.5, y + 2.6, -0.7, -0.6, "fabric|#d9534f");
      sofa(k, y, 21.9, 24.1, -2.2, -1.1, "#f4efe6", "#3f5f7a");
      break;
    }
    case "lounge": {
      sofa(k, y, 30.6, 33.6, -4.6, -3.4, "#7cc7a4", "#f4efe6");
      // the bar: dark front with a brass foot rail, a marble top, three stools, a lit bottle shelf behind
      under(k, y, 34.6, 37.4, -4.8, -4.0);
      k.box(34.6, 37.4, y, y + 1.0, -4.8, -4.0, "darkwood");
      k.box(34.55, 37.45, y + 1.0, y + 1.08, -4.85, -3.95, "floor|marble|#1f2a3a", { tile: 1.5 });
      k.box(34.6, 37.4, y + 0.12, y + 0.16, -3.98, -3.94, "brass");
      for (const sx of [35.1, 36.0, 36.9]) {
        k.cyl(sx, y + 0.35, -3.5, 0.03, 0.03, 0.7, "chrome", 8);
        k.cyl(sx, y + 0.73, -3.5, 0.18, 0.18, 0.08, "fabric|#d98f6b", 14);
      }
      k.box(34.4, 37.6, y + 1.7, y + 1.75, BACK + 0.06, BACK + 0.4, "glass");
      k.box(34.4, 37.6, y + 1.65, y + 1.7, BACK + 0.06, BACK + 0.4, "glow|#ffd98a|0.55");
      const bottles = ["#2f8f8a", "#e0a22f", "#d9534f", "#3b6ea8", "#8fe36a", "#ffd6e0", "#c9a14a"];
      for (let i = 0; i < 9; i++) k.cyl(34.6 + i * 0.35, y + 1.95, BACK + 0.22, 0.05, 0.06, 0.4 + (i % 3) * 0.08, `fabric|${bottles[i % bottles.length]}`, 8);
      k.plaque(34, y + 3.2, 2.0, 0.7, BACK + 0.02, "neon|Sky Lounge|#ffb547");
      k.mat(30.6, 34.0, -3.2, -1.2, y + 0.045, "rug|1");
      plant(k, y, 37.6, -1.1, 1.1, "#3c6f34");
      pendant(k, 32, -2.4, ceiling);
      pendant(k, 36, -2.2, ceiling);
      break;
    }
  }
}

// ------------------------------------------------------------------ the street and the city
function street(k: Kit) {
  k.box(-40, 80, -1.2, -0.3, 0.3, 30, "asphalt");
  k.box(-40, 80, -0.3, -0.12, 0.3, 3.2, "sidewalk");
  k.box(-40, 80, -0.3, -0.26, 3.2, 3.3, "solid|#6a6578");
  for (let x = -36; x < 78; x += 3.6) k.box(x, x + 1.8, -0.3, -0.29, 9.0, 9.2, "glow|#e0a22f|0.5");
  // tall lamp posts only beyond where the camera ever looks; low bollard lights along the kerb in between
  for (const x of [-9, 47]) {
    k.cyl(x, 1.6, 2.6, 0.06, 0.09, 5.6, "metal", 8);
    k.box(x - 0.42, x + 0.42, 4.3, 4.5, 2.3, 2.9, "metal");
    k.box(x - 0.36, x + 0.36, 4.2, 4.3, 2.36, 2.84, "glow|#ffe3b0|2.6");
  }
  for (let x = -4; x < 44; x += 7) {
    k.cyl(x, 0.12, 3.05, 0.07, 0.08, 0.48, "metal", 8);
    k.cyl(x, 0.4, 3.05, 0.08, 0.07, 0.08, "glow|#ffe3b0|1.4", 8);
  }
  // planters, a bench and a hydrant on the far pavement, across the street
  for (const x of [1, 15, 29, 43]) {
    k.box(x, x + 1.4, -0.3, 0.3, 10.2, 11.2, "pot|#5f5a6c");
    k.sphere(x + 0.7, 0.58, 10.7, 0.5, "leaf|#3c6f34", [1.2, 0.8, 1]);
  }
  k.cyl(-6, 0.05, 2.9, 0.1, 0.12, 0.6, "solid|#d9534f", 10);
  k.sphere(-6, 0.38, 2.9, 0.11, "solid|#d9534f");
  k.box(24.5, 26.3, 0.0, 0.08, 10.3, 10.8, "wood|#9a6a44");
  k.box(24.5, 26.3, 0.08, 0.55, 10.72, 10.8, "wood|#9a6a44");
  for (const bx of [24.6, 26.2]) k.box(bx - 0.04, bx + 0.04, -0.3, 0.0, 10.35, 10.75, "metal");
  k.box(-40, 80, -0.3, -0.12, 10.0, 12.0, "sidewalk");
  // parked cars, side-on: a low body, a set-back cabin with glass all round, wheels in the dark
  const car = (x: number, color: string) => {
    const body = `solid|${color}|0.45`;
    k.box(x, x + 4.3, 0.05, 0.6, 5.5, 7.4, body);
    k.box(x + 0.2, x + 4.1, 0.6, 0.68, 5.6, 7.3, body);
    k.box(x + 1.1, x + 3.5, 0.66, 1.18, 5.75, 7.15, "glass", { faces: { py: body, ny: null } });
    k.box(x + 1.05, x + 1.15, 0.66, 1.18, 5.72, 7.18, body);
    k.box(x + 3.45, x + 3.55, 0.66, 1.18, 5.72, 7.18, body);
    k.box(x + 0.02, x + 0.3, 0.32, 0.5, 5.6, 7.3, "glow|#ff3b3b|1.4");
    k.box(x + 4.0, x + 4.28, 0.32, 0.5, 5.6, 7.3, "glow|#ffe3b0|1.2");
    for (const wx of [x + 0.85, x + 3.45]) for (const wz of [5.62, 7.28]) k.cyl(wx, 0.05, wz, 0.34, 0.34, 0.24, "solid|#1b1d22|0.9", 14, { rx: Math.PI / 2 });
  };
  car(3, "#3f5f7a");
  car(27, "#8a4e3b");
  car(44, "#c9c4cf");
}

export type SetHandles = {
  lamps: { mesh: THREE.Mesh; floor: number; x: number; base: number; phase: number }[];
  emergency: THREE.Mesh[];
  windows: THREE.Mesh[];
  pools: THREE.Mesh[];
  waterMat: THREE.MeshStandardMaterial;
  /** keeps the skyline sliding a little slower than the camera, like it's far away */
  parallax(camX: number): void;
  dispose(): void;
};

export function buildSet(world: THREE.Group, scene: THREE.Scene, opts: { softwareGl: boolean; shadows: boolean }): SetHandles {
  const k = new Kit();
  const lamps: SetHandles["lamps"] = [];
  const emergency: THREE.Mesh[] = [];
  const windows: THREE.Mesh[] = [];
  const pools: THREE.Mesh[] = [];
  const own: THREE.Object3D[] = [];
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffc27a, emissiveIntensity: 2.4, roughness: 0.6 });
  const emergencyMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff2020, emissiveIntensity: 2.2 });
  const viewTex = T.windowView();
  const glassMat = materialFor("glass");
  const poolTex = T.glowPool();
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 });

  FLOORS.forEach((fl, f) => {
    const y = fy(f);
    const ceiling = y + FLOOR_H - SLAB;
    // the slab: cream where it's cut, plaster underneath (that's the floor below's ceiling)
    k.box(-0.6, WIDTH + 0.6, y - SLAB, y, BACK - 0.4, 0.35, "ceiling", { faces: { pz: "cut", py: null } });
    k.box(-0.6, WIDTH + 0.6, y - 0.02, y, BACK - 0.4, 0.35, "solid|#3a3346");
    // the facade either side of the cut: brick, lit windows, the cut edge in cream
    for (const [x0, x1] of [[-7.5, -0.9], [WIDTH + 0.9, WIDTH + 7.5]] as const) {
      k.box(x0, x1, y, ceiling, BACK - 0.4, 0.35, "brick", { faces: { pz: "brick" } });
      for (const wx of [x0 + 1.4, x0 + 4.2]) {
        k.box(wx, wx + 1.6, y + 1.1, y + 2.8, 0.2, 0.36, (f + wx) % 3 === 0 ? "solid|#2a2350" : "glow|#ffd9a0|0.9");
        k.box(wx - 0.08, wx + 1.68, y + 1.02, y + 1.1, 0.2, 0.42, "white");
      }
      k.box(x0, x1, y + 2.9, y + 3.0, 0.35, 0.42, "white");
    }
    for (const [x0, x1] of [[-0.9, 0], [WIDTH, WIDTH + 0.9]] as const) k.box(x0, x1, y, ceiling, BACK - 0.4, 0.35, "plaster|#d9cfc0", { faces: { pz: "cut" } });
    for (const r of fl.rooms) {
      roomFloor(k, r, y);
      const ww = r.x1 - r.x0;
      const n = r.open || r.kind === "elevator" ? 0 : Math.max(1, Math.floor(ww / 3.2));
      const wins = Array.from({ length: n }, (_, i) => ({ cx: r.x0 + (ww * (i + 0.5)) / n, w: Math.min(2.2, ww / n - 0.6) }));
      if (!r.open) {
        backWall(k, r, y, WALL_PATTERN[r.kind], wins);
        for (const w of wins) {
          // the dusk through the glass, then the glass itself
          const view = viewTex.clone();
          view.repeat.set(0.06, 0.5);
          view.offset.set(((w.cx + f * 9) / 70) % 0.94, 0.3);
          view.needsUpdate = true;
          const pane = new THREE.Mesh(new THREE.PlaneGeometry(w.w + 0.2, 1.9), new THREE.MeshBasicMaterial({ map: view, color: 0xffffff }));
          pane.position.set(w.cx, y + 1.95, BACK - 0.2);
          world.add(pane);
          windows.push(pane);
          own.push(pane);
          const glass = new THREE.Mesh(new THREE.PlaneGeometry(w.w, 1.7), glassMat);
          glass.position.set(w.cx, y + 1.95, BACK - 0.08);
          glass.renderOrder = 2;
          world.add(glass);
          own.push(glass);
        }
        // the lamp (its bulb is the runtime's: it flickers), and the strip that only shows on zombie night
        const cx = (r.x0 + r.x1) / 2;
        const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 14), lampMat.clone());
        bulb.position.set(cx, ceiling - 0.86, -2.4);
        world.add(bulb);
        own.push(bulb);
        lamps.push({ mesh: bulb, floor: f, x: cx, base: 2.4, phase: Math.random() * 10 });
        if (r.kind !== "elevator") {
          const pool = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(ww, 7), 4.6), poolMat);
          pool.rotation.x = -Math.PI / 2;
          pool.position.set(cx, y + 0.06, -2.5);
          world.add(pool);
          pools.push(pool);
          own.push(pool);
        }
        const strip = new THREE.Mesh(new THREE.BoxGeometry(ww - 0.4, 0.06, 0.06), emergencyMat);
        strip.position.set(cx, ceiling - 0.05, BACK + 0.1);
        world.add(strip);
        emergency.push(strip);
        own.push(strip);
      } else {
        // the roof: a glass balustrade at the back with brass posts, string lights
        for (let x = r.x0 + 0.2; x <= r.x1; x += 2.6) k.cyl(x, y + 0.55, BACK, 0.035, 0.035, 1.1, "brass", 8);
        k.box(r.x0, r.x1, y + 1.08, y + 1.14, BACK - 0.04, BACK + 0.04, "brass");
        const rail = new THREE.Mesh(new THREE.BoxGeometry(r.x1 - r.x0, 1.0, 0.03), glassMat);
        rail.position.set((r.x0 + r.x1) / 2, y + 0.56, BACK);
        rail.renderOrder = 2;
        world.add(rail);
        own.push(rail);
        for (let x = r.x0 + 0.8; x < r.x1; x += 1.4) {
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), lampMat.clone());
          bulb.position.set(x, y + 3.0 + Math.sin(x * 0.9) * 0.15, -3.8);
          world.add(bulb);
          own.push(bulb);
          lamps.push({ mesh: bulb, floor: f, x, base: 2.0, phase: Math.random() * 10 });
        }
        for (let x = r.x0 + 0.1; x < r.x1; x += 1.4) k.box(x, x + 1.4, y + 3.0 + Math.sin((x + 0.7) * 0.9) * 0.15 - 0.01, y + 3.0 + Math.sin((x + 0.7) * 0.9) * 0.15 + 0.01, -3.81, -3.79, "solid|#2b211c");
        for (const px of [r.x0 + 0.5, r.x1 - 0.5]) k.cyl(px, y + 1.6, -3.8, 0.03, 0.04, 3.2, "metal", 8);
      }
      partition(k, r, y);
      dress(k, r, f, y, ceiling);
    }
  });
  // the roof over the enclosed rooms, the machine room, the sign that names the building
  const top = fy(3);
  k.box(ELEV_X0 - 0.3, WIDTH + 0.6, top - SLAB, top, BACK - 0.4, 0.35, "ceiling", { faces: { pz: "cut" } });
  k.box(ELEV_X0 - 0.3, WIDTH + 0.6, top, top + 0.5, BACK - 0.4, 0.35, "plaster|#d9cfc0", { faces: { pz: "cut" } });
  k.box(ELEV_X0 - 0.2, ELEV_X1 + 0.2, top, top + 1.8, BACK - 0.3, -2.2, "plaster|#cfc5b6");
  k.box(31, 37.6, top + 0.5, top + 1.9, -3.4, -3.1, "darkwood");
  k.plaque(34.3, top + 1.2, 6.2, 1.1, -3.09, "label|CENTURY PARK EAST|#2b2238|#ffcf7a");
  k.box(31, 37.6, top + 1.9, top + 2.0, -3.5, -3.0, "glow|#ffe3b0|1.6");
  for (const [x0, x1] of [[-7.5, -0.9], [WIDTH + 0.9, WIDTH + 7.5]] as const) k.box(x0, x1, top - SLAB, top + 0.6, BACK - 0.4, 0.35, "brick", { faces: { py: "plaster|#d9cfc0" } });
  // below the ground floor, a base course; then the street
  k.box(-7.5, WIDTH + 7.5, -1.3, -SLAB, BACK - 0.4, 0.35, "plaster|#9a9088");
  street(k);
  const built = k.build(world, opts.shadows);
  own.push(...built);

  // the water
  const waterMat = materialFor("water") as THREE.MeshStandardMaterial;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(ROOF_POOL.x1 - ROOF_POOL.x0 - 0.35, ROOF_POOL.z1 - ROOF_POOL.z0 - 0.35), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set((ROOF_POOL.x0 + ROOF_POOL.x1) / 2, fy(2) + 0.34, (ROOF_POOL.z0 + ROOF_POOL.z1) / 2);
  water.receiveShadow = opts.shadows;
  world.add(water);
  own.push(water);

  // the city: three painted layers that slide at different speeds
  const layer = (i: 0 | 1 | 2, w: number, h: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: T.skyline(i), transparent: i !== 0, fog: false, depthWrite: i === 0 }));
    m.position.set(WIDTH / 2, h / 2 - 1.5, z);
    m.renderOrder = -3 + i;
    scene.add(m);
    own.push(m);
    return m;
  };
  const far = layer(0, 620, 155, -150);
  const mid = layer(1, 330, 82, -88);
  const nearL = layer(2, 210, 52, -46);
  // the ground the city stands on, fading into the same haze
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 400), new THREE.MeshBasicMaterial({ color: 0x6a6480 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(WIDTH / 2, -1.31, -120);
  scene.add(ground);
  own.push(ground);

  return {
    lamps,
    emergency,
    windows,
    pools,
    waterMat,
    parallax(camX) {
      const d = camX - WIDTH / 2;
      far.position.x = WIDTH / 2 + d * 0.92;
      mid.position.x = WIDTH / 2 + d * 0.8;
      nearL.position.x = WIDTH / 2 + d * 0.62;
    },
    dispose() {
      for (const o of own) {
        o.removeFromParent();
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
      }
      for (const m of matCache.values()) m.dispose();
      matCache.clear();
    },
  };
}
