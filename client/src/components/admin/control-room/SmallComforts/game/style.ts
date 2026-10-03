// Islands-board look from primitives: chunky, rounded, banded toon shading, ink outlines, puffy clouds.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const PAL = {
  sky: "#8EC5FF", skyNight: "#1d2a4a", cloud: "#FFFFFF", cloudUnder: "#DCE8F5", desk: "#B9824F", deskDark: "#8a5d36",
  station: "#3E5C76", train: "#C8323C", warm: "#FFC879", cool: "#7FA6D6",
  shell: "#2f5f7a", shellDark: "#244b61", honey: "#D79A4E", mustard: "#E0A93B", burgundy: "#8E2F3F", cream: "#F6EBD3",
  leaf: "#5E9A5A", brass: "#D8A93D", wall: "#EFDDBA", ink: "#2a1d2e",
};

let gradient: THREE.DataTexture | null = null;
/** 4-band gradient map for MeshToonMaterial (the "cel bands") */
export function bands(): THREE.DataTexture {
  if (gradient) return gradient;
  const d = new Uint8Array([90, 90, 90, 255, 150, 150, 150, 255, 215, 215, 215, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(d, 4, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

const matCache = new Map<string, THREE.MeshToonMaterial>();
export function toon(color: string, opts: { emissive?: string; emissiveIntensity?: number; transparent?: boolean; opacity?: number } = {}): THREE.MeshToonMaterial {
  const k = color + JSON.stringify(opts);
  let m = matCache.get(k);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: bands(), ...opts });
    if (!opts.emissive) matCache.set(k, m);
  }
  return m;
}

const inkMat = new THREE.MeshBasicMaterial({ color: PAL.ink, side: THREE.BackSide });
/** inverted-hull ink outline as a child mesh */
export function inked<T extends THREE.Mesh>(m: T, w = 0.03): T {
  const o = new THREE.Mesh(m.geometry, inkMat);
  o.scale.setScalar(1 + w);
  o.userData.outline = true;
  o.castShadow = false;
  m.add(o);
  return m;
}

export function rbox(w: number, h: number, d: number, color: string, r = 0.08, outline = true): THREE.Mesh {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.01, h / 2.01, d / 2.01)), toon(color));
  m.castShadow = m.receiveShadow = true;
  return outline ? inked(m, 0.025 / Math.max(0.5, Math.min(w, h, d) + 0.5)) : m;
}
export function cyl(rt: number, rb: number, h: number, color: string, seg = 20, outline = true): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), toon(color));
  m.castShadow = m.receiveShadow = true;
  return outline ? inked(m, 0.05) : m;
}
export function ball(r: number, color: string, outline = true): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), toon(color));
  m.castShadow = true;
  return outline ? inked(m, 0.07) : m;
}

// ---- clouds: 4 overlapping lobes, flattened bottom, white top / blue-grey belly (Islands buildClouds)
let cloudGeo: THREE.BufferGeometry | null = null;
function getCloudGeo() {
  if (cloudGeo) return cloudGeo;
  const lobe = (r: number, x: number, y: number, z: number) =>
    mergeVertices(new THREE.IcosahedronGeometry(r, 2).deleteAttribute("uv").deleteAttribute("normal")).translate(x, y, z);
  const g = mergeVertices(mergeGeometries([lobe(1, 0, 0.05, 0), lobe(0.72, 0.8, -0.08, 0.1), lobe(0.68, -0.76, -0.1, -0.08), lobe(0.56, 0.16, 0.54, -0.06)])!);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const top = new THREE.Color(PAL.cloud), under = new THREE.Color(PAL.cloudUnder);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < -0.18) p.setY(i, -0.18 + (y + 0.18) * 0.22);
    const t = THREE.MathUtils.smoothstep(p.getY(i), -0.2, 0.25);
    const c = under.clone().lerp(top, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  cloudGeo = g;
  return g;
}
const cloudMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: bands(), color: "#ffffff", emissive: "#cfe0ff", emissiveIntensity: 0.5 });
export function makeCloud(scale = 1): THREE.Mesh {
  const m = new THREE.Mesh(getCloudGeo(), cloudMat);
  m.scale.setScalar(scale);
  return m;
}

/** squash-and-overshoot, 0..1 -> value with overshoot (for pop-ins) */
export const easeOutBack = (t: number) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
