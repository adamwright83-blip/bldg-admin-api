import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

/** level.json, written by scripts/assets/coastal-proof/build_level.py (three coordinates). */
export type LevelData = {
  version: number;
  routeLength: number;
  routeKinds: string[];
  surfaceByKind: Record<string, "stone" | "wood">;
  /** x, y, z, width, kindIndex every ~0.5 m */
  route: [number, number, number, number, number][];
  sunDirection: [number, number, number];
  lanterns: [number, number, number][];
  banners: { top: [number, number, number]; pole?: boolean }[];
  waterfall: { top: [number, number, number]; bottom: [number, number, number]; width: number; out: [number, number, number]; along: [number, number, number] };
  lighthouse: { lamp: [number, number, number] };
  crane: { tip: [number, number, number] };
  shots: Record<string, number>;
  segments: { kind: string; s0: number; s1: number }[];
  baked: boolean;
  lightmaps: Record<string, string>;
  lightmapGroups: Record<string, string[]>;
  shore: { x0: number; y0: number; size: number; texture: string };
  plants: { t: string; p: [number, number, number]; s: number; r: number }[];
  boats: {
    type: string;
    p?: [number, number];
    yaw?: number;
    circle?: { c: [number, number]; r: number; speed: number };
    line?: { a: [number, number]; b: [number, number]; speed: number };
  }[];
  stacks: [number, number, number, number][];
  chimneys?: [number, number, number][];
  /** Phase 2 chase set, in chase metres (the runtime plays the route pier -> terrace) */
  rigs: ChaseRigs;
  rigParts: {
    crane_jib: { tip: V3; counterTip: V3 };
    boom: { tip: V3 };
    leaf: { tipLocal: V3 };
    cage: { lamp: V3; rook: V3; doorHinge: V3 };
  };
};

type V3 = [number, number, number];
export type GateRig = { cs: number; pos: V3; fwd: V3; width: number; height: number; block: [number, number] };
export type SwingRig = {
  pivot: V3; radius: number; yaw0: number; yaw1: number; hook0: V3; hook1: V3;
  csGrab: number; csLand: number; grabRadius: number; counterArm?: number; cleat?: V3;
};
export type ChaseRigs = {
  gate1: GateRig;
  gate3: GateRig;
  crane: SwingRig;
  boom: SwingRig;
  bridge: {
    leaves: { hinge: V3; dir: V3; length: number; width: number; raised: number; gantryTop: V3; gantryHalf: number }[];
    hole: [number, number];
    trigger: number;
  };
  ropeway: {
    heads: V3[]; land: V3[]; offset: number; sags: number[]; hanger: number; speed: number; spacing: number;
    csGrab: number; grabRadius: number; csLand: number; land_point: V3;
  };
  cage: { dock: V3; doorDir: V3; start: V3; size: V3 };
  obstacles: { cs: number; h: number; d: number }[];
  holes: [number, number][];
};

export type RouteSample = { p: THREE.Vector3; w: number; kind: string; s: number; dir: THREE.Vector3 };

export class Route {
  readonly samples: RouteSample[];
  readonly length: number;
  constructor(data: LevelData) {
    let s = 0;
    const pts = data.route.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.samples = data.route.map(([, , , w, k], i) => {
      if (i > 0) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
      return { p: pts[i], w, kind: data.routeKinds[k], s, dir };
    });
    this.length = s;
  }

  /** Nearest sample index to `p` (xz), searching around `hint` first. */
  nearest(p: THREE.Vector3, hint = -1): number {
    const n = this.samples.length;
    let best = 0;
    let bestD = Infinity;
    const lo = hint >= 0 ? Math.max(0, hint - 30) : 0;
    const hi = hint >= 0 ? Math.min(n - 1, hint + 30) : n - 1;
    for (let i = lo; i <= hi; i++) {
      const q = this.samples[i].p;
      const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2 + 0.25 * (q.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (hint >= 0 && bestD > 16) return this.nearest(p, -1);
    return best;
  }

  at(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const smp = this.samples;
    if (s <= 0) return out.copy(smp[0].p);
    if (s >= this.length) return out.copy(smp[smp.length - 1].p);
    let lo = 0;
    let hi = smp.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (smp[mid].s <= s) lo = mid;
      else hi = mid;
    }
    const a = smp[lo];
    const b = smp[hi];
    const t = (s - a.s) / Math.max(1e-6, b.s - a.s);
    return out.copy(a.p).lerp(b.p, t);
  }

  dirAt(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = this.at(Math.max(0, s - 1.5));
    const b = this.at(Math.min(this.length, s + 1.5));
    return out.set(b.x - a.x, 0, b.z - a.z).normalize();
  }

  sampleAt(s: number): RouteSample {
    let lo = 0;
    let hi = this.samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.samples[mid].s <= s) lo = mid;
      else hi = mid;
    }
    return this.samples[lo];
  }
}

export type Colliders = {
  walk: MeshBVH;
  wall: MeshBVH;
  cam: MeshBVH;
  walkMesh: THREE.Mesh;
  camMesh: THREE.Mesh;
};

function bvhFrom(mesh: THREE.Mesh): { bvh: MeshBVH; mesh: THREE.Mesh } {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry.clone();
  g.applyMatrix4(mesh.matrixWorld);
  for (const name of Object.keys(g.attributes)) {
    if (name !== "position") g.deleteAttribute(name);
  }
  const bvh = new MeshBVH(g);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ visible: false }));
  (g as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree = bvh;
  return { bvh, mesh: m };
}

export type LevelParts = {
  visual: THREE.Group;
  far: THREE.Group;
  colliders: Colliders;
  meshesByMaterial: Map<string, THREE.Mesh[]>;
};

/** Split the level glTF into render groups (VIS_* / FAR_*) and BVH colliders (COL_*). */
export function splitLevel(gltf: GLTF): LevelParts {
  const visual = new THREE.Group();
  visual.name = "level-visual";
  const far = new THREE.Group();
  far.name = "level-far";
  const meshesByMaterial = new Map<string, THREE.Mesh[]>();
  const col: Record<string, THREE.Mesh> = {};
  const meshes: THREE.Mesh[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(obj => {
    if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
  });
  for (const mesh of meshes) {
    const name = nodeName(mesh);
    if (name.startsWith("COL_")) {
      col[name] = mesh;
      continue;
    }
    const matName = name.replace(/^(VIS|FAR)_/, "");
    mesh.applyMatrix4(mesh.parent ? mesh.parent.matrixWorld : new THREE.Matrix4());
    const target = name.startsWith("FAR_") ? far : visual;
    target.add(mesh);
    mesh.userData.materialName = matName;
    mesh.userData.far = target === far;
    const list = meshesByMaterial.get(matName) ?? [];
    list.push(mesh);
    meshesByMaterial.set(matName, list);
  }
  const walk = bvhFrom(col.COL_walk);
  const wall = bvhFrom(col.COL_wall);
  const cam = bvhFrom(col.COL_cam);
  return {
    visual,
    far,
    meshesByMaterial,
    colliders: { walk: walk.bvh, wall: wall.bvh, cam: cam.bvh, walkMesh: walk.mesh, camMesh: cam.mesh },
  };
}

/** glTF primitives of one Blender object come in as a Mesh or a Group of Meshes named after the node. */
function nodeName(mesh: THREE.Object3D): string {
  let o: THREE.Object3D | null = mesh;
  while (o) {
    if (/^(VIS|FAR|COL)_/.test(o.name)) return o.name;
    o = o.parent;
  }
  return mesh.name;
}
