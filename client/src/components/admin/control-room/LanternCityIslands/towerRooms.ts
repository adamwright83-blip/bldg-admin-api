/**
 * The tower cutaway, in rooms: each tower opened like a dollhouse and shot straight on, every
 * unit a real little room (back wall, floor, furniture, lamps). The furniture is authored scenery.
 * What is data: a unit whose customer we know has its lights on, warm; every other unit is dark
 * behind glass at dusk. No figures are drawn: a lit room says a customer lives here, never that
 * someone is home. Floors with no customer are counted so the dark ones read at a glance.
 *
 * Three.js with an oblique projection (every floor shows the same sliver of floor and ceiling,
 * like a cutaway drawing), so the view is identical at the top and bottom of a 22-storey tower.
 * Rooms are built from a small procedural furniture kit; a model pack can replace it later.
 * Data comes from towerStack.ts.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { darkFloors, type BuildingModel, type Resident, type TowerModel } from "./towerStack";

export type RoomHover = { residents: Resident[]; label: string; x: number; y: number } | null;

// one unit, metres
const UW = 3.6, UH = 3.0, UD = 4.0, SLAB = 0.5, FR = 0.9, GAP = 14, LOBBY = 5;
type RGB = [number, number, number];
// palette colours are sRGB; the shaders work in linear light
const hex = (h: string): RGB => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
function rng(seed: number) { let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// the palettes the rooms are dressed from
const WALLS = ["#c8674e", "#8fa68a", "#e9dcc3", "#4f7b86", "#d9a55b", "#b9c6cf", "#7d5a78", "#e7c7b8", "#5f6f52", "#f0e6d6"].map(hex);
const FLOORS = ["#9a6a44", "#b98458", "#7a5236", "#c9a27a", "#d8cbb8", "#8e7f72"].map(hex);
const FABRIC = ["#e8d9b8", "#3f5f7a", "#c9a14a", "#8a4e3b", "#6f8f76", "#d7cfc4", "#2f3b4a", "#b56a5a"].map(hex);
const ART = ["#e4b04a", "#3b6ea8", "#d9534f", "#2f8f8a", "#f2efe6", "#1f2a3a"].map(hex);
const BOOKS = ["#b8453a", "#3b6ea8", "#e0a22f", "#2f8f8a", "#efe7d2", "#5b3f6b", "#2b2f36"].map(hex);
const WOOD = hex("#8a5a3a"), DARKWOOD = hex("#5a3a28"), WHITE = hex("#f4f1ea"), METAL = hex("#3a3d42"), CEIL = hex("#efe9df");
const LEAF = [hex("#4f8a3c"), hex("#3c6f34"), hex("#6aa04a")];

/** geometry accumulator: positions, normals, colours, lit flag, glow */
class Kit {
  P: number[] = []; N: number[] = []; C: number[] = []; L: number[] = []; E: number[] = []; I: number[] = [];
  lit = 0; ox = 0; oy = 0;
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: RGB, glow = 0, skipFront = false) {
    const faces: [number[], number[][]][] = [
      [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
      [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
      [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
      [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    ];
    for (const [n, q] of faces) {
      if (skipFront && n[2] === 1) continue;
      const b = this.P.length / 3;
      for (const v of q) {
        this.P.push(this.ox + v[0], this.oy + v[1], v[2]); this.N.push(n[0], n[1], n[2]);
        this.C.push(c[0], c[1], c[2]); this.L.push(this.lit); this.E.push(glow);
      }
      this.I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  /** a rounded-ish blob (foliage, a head): an octahedron */
  blob(x: number, y: number, z: number, rx: number, ry: number, rz: number, c: RGB, glow = 0) {
    const v: [number, number, number][] = [[rx, 0, 0], [-rx, 0, 0], [0, ry, 0], [0, -ry, 0], [0, 0, rz], [0, 0, -rz]];
    const f = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
    for (const [a, b2, c2] of f) {
      const A = v[a], B = v[b2], Cc = v[c2];
      const n = new THREE.Vector3(...B).sub(new THREE.Vector3(...A)).cross(new THREE.Vector3(...Cc).sub(new THREE.Vector3(...A))).normalize();
      const base = this.P.length / 3;
      for (const p of [A, B, Cc]) { this.P.push(this.ox + x + p[0], this.oy + y + p[1], z + p[2]); this.N.push(n.x, n.y, n.z); this.C.push(c[0], c[1], c[2]); this.L.push(this.lit); this.E.push(glow); }
      this.I.push(base, base + 1, base + 2);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute("aLit", new THREE.Float32BufferAttribute(this.L, 1));
    g.setAttribute("aGlow", new THREE.Float32BufferAttribute(this.E, 1));
    g.setIndex(this.I);
    return g;
  }
}

// ----------------------------------------------------------------- the furniture kit
function plant(k: Kit, x: number, z: number, s: number, r: () => number) {
  k.box(x - 0.18 * s, x + 0.18 * s, 0, 0.36 * s, z - 0.18 * s, z + 0.18 * s, hex(r() < 0.5 ? "#c9c1b2" : "#b8674a"));
  k.box(x - 0.02, x + 0.02, 0.36 * s, 0.9 * s, z - 0.02, z + 0.02, hex("#4a6a34"));
  k.blob(x, 1.0 * s, z, 0.32 * s, 0.45 * s, 0.32 * s, LEAF[Math.floor(r() * 3)]);
  k.blob(x + 0.12 * s, 0.8 * s, z + 0.05, 0.22 * s, 0.3 * s, 0.22 * s, LEAF[Math.floor(r() * 3)]);
}
function pendant(k: Kit, x: number, z: number, on: boolean) {
  k.box(x - 0.01, x + 0.01, UH - 0.7, UH, z - 0.01, z + 0.01, METAL);
  k.blob(x, UH - 0.78, z, 0.17, 0.12, 0.17, hex("#fff1c9"), on ? 2.4 : 0);
}
function art(k: Kit, x: number, y: number, w: number, h: number, r: () => number) {
  k.box(x - w / 2 - 0.04, x + w / 2 + 0.04, y - h / 2 - 0.04, y + h / 2 + 0.04, -UD + 0.05, -UD + 0.09, DARKWOOD);
  k.box(x - w / 2, x + w / 2, y - h / 2, y + h / 2, -UD + 0.09, -UD + 0.11, ART[Math.floor(r() * ART.length)]);
  if (r() < 0.6) k.box(x - w / 4, x + w / 5, y - h / 4, y + h / 5, -UD + 0.11, -UD + 0.12, ART[Math.floor(r() * ART.length)]);
}
function living(k: Kit, r: () => number, on: boolean) {
  const fab = FABRIC[Math.floor(r() * FABRIC.length)], rug = FABRIC[Math.floor(r() * FABRIC.length)];
  k.box(0.5, UW - 0.6, 0.01, 0.03, -UD + 0.8, -0.6, rug);
  // sofa against the back wall
  const sx = 0.5 + r() * 0.4;
  k.box(sx, sx + 2.1, 0.12, 0.45, -UD + 0.2, -UD + 1.05, fab);
  k.box(sx, sx + 2.1, 0.45, 0.95, -UD + 0.15, -UD + 0.42, fab);
  k.box(sx - 0.18, sx, 0.12, 0.66, -UD + 0.2, -UD + 1.05, fab); k.box(sx + 2.1, sx + 2.28, 0.12, 0.66, -UD + 0.2, -UD + 1.05, fab);
  k.box(sx + 0.3, sx + 0.8, 0.45, 0.72, -UD + 0.45, -UD + 0.6, WHITE); k.box(sx + 1.3, sx + 1.8, 0.45, 0.72, -UD + 0.45, -UD + 0.6, hex("#e0a22f"));
  k.box(sx + 0.5, sx + 1.6, 0.3, 0.38, -UD + 1.6, -UD + 2.2, WOOD);
  k.box(sx + 0.55, sx + 0.6, 0, 0.3, -UD + 1.65, -UD + 1.7, WOOD); k.box(sx + 1.5, sx + 1.55, 0, 0.3, -UD + 2.1, -UD + 2.15, WOOD);
  // floor lamp and a plant
  const lx = UW - 0.45;
  k.box(lx - 0.02, lx + 0.02, 0, 1.55, -UD + 0.5, -UD + 0.54, METAL);
  k.box(lx - 0.2, lx + 0.2, 1.5, 1.8, -UD + 0.32, -UD + 0.72, hex("#f6e7c4"), on ? 1.6 : 0);
  plant(k, 0.35, -1.0, 1, r);
  art(k, sx + 1.05, 1.9, 1.1, 0.7, r);
}
function bedroom(k: Kit, r: () => number, on: boolean) {
  const blanket = FABRIC[Math.floor(r() * FABRIC.length)];
  const bx = 0.6 + r() * 0.5;
  k.box(bx, bx + 2.0, 0, 0.35, -UD + 0.15, -UD + 2.3, WOOD);
  k.box(bx - 0.05, bx + 2.05, 0.35, 1.25, -UD + 0.1, -UD + 0.2, DARKWOOD);
  k.box(bx + 0.05, bx + 1.95, 0.35, 0.55, -UD + 0.2, -UD + 2.25, WHITE);
  k.box(bx + 0.03, bx + 1.97, 0.5, 0.6, -UD + 0.9, -UD + 2.3, blanket);
  k.box(bx + 0.2, bx + 0.9, 0.55, 0.75, -UD + 0.25, -UD + 0.6, WHITE); k.box(bx + 1.1, bx + 1.8, 0.55, 0.75, -UD + 0.25, -UD + 0.6, WHITE);
  for (const nx of [bx - 0.55, bx + 2.1]) {
    k.box(nx, nx + 0.45, 0, 0.5, -UD + 0.15, -UD + 0.6, WOOD);
    k.box(nx + 0.15, nx + 0.3, 0.5, 0.75, -UD + 0.3, -UD + 0.45, hex("#f6e7c4"), on ? 1.4 : 0);
  }
  art(k, bx + 1.0, 1.85, 1.3, 0.55, r);
  if (r() < 0.6) plant(k, UW - 0.35, -0.9, 0.9, r);
}
function kitchen(k: Kit, r: () => number, on: boolean) {
  const cab = [hex("#2f4f5f"), hex("#e9e4da"), hex("#6f7f6b"), hex("#c9a27a")][Math.floor(r() * 4)];
  k.box(0.1, UW - 1.0, 0, 0.9, -UD + 0.1, -UD + 0.72, cab);
  k.box(0.08, UW - 0.98, 0.9, 0.96, -UD + 0.08, -UD + 0.76, WHITE);
  k.box(0.1, UW - 1.0, 1.7, 2.4, -UD + 0.1, -UD + 0.45, cab);
  k.box(0.1, UW - 1.0, 0.96, 1.7, -UD + 0.08, -UD + 0.1, hex("#dfe6e8"));
  k.box(UW - 0.95, UW - 0.15, 0, 2.1, -UD + 0.1, -UD + 0.8, hex("#cfd4d8"));
  // table and chairs
  const tx = 1.1 + r() * 0.6;
  k.box(tx, tx + 1.3, 0.72, 0.78, -2.0, -1.2, WOOD);
  for (const lx of [tx + 0.05, tx + 1.2]) for (const lz of [-1.95, -1.3]) k.box(lx, lx + 0.05, 0, 0.72, lz, lz + 0.05, DARKWOOD);
  for (const cx of [tx - 0.35, tx + 1.35]) { k.box(cx, cx + 0.35, 0.42, 0.47, -1.8, -1.4, DARKWOOD); k.box(cx + (cx < tx ? 0 : 0.3), cx + (cx < tx ? 0.05 : 0.35), 0.47, 0.95, -1.8, -1.4, DARKWOOD); }
  pendant(k, tx + 0.35, -1.6, on); pendant(k, tx + 0.95, -1.6, on);
}
function study(k: Kit, r: () => number, on: boolean) {
  const dx = 0.3 + r() * 0.3;
  k.box(dx, dx + 1.6, 0.72, 0.77, -UD + 0.15, -UD + 0.85, WHITE);
  k.box(dx, dx + 0.05, 0, 0.72, -UD + 0.15, -UD + 0.85, METAL); k.box(dx + 1.55, dx + 1.6, 0, 0.72, -UD + 0.15, -UD + 0.85, METAL);
  k.box(dx + 0.5, dx + 1.1, 0.8, 1.2, -UD + 0.25, -UD + 0.3, hex("#1b2230"));
  k.box(dx + 0.54, dx + 1.06, 0.84, 1.16, -UD + 0.3, -UD + 0.31, hex("#9fc6ff"), on ? 1.3 : 0);
  k.box(dx + 0.55, dx + 1.05, 0.42, 0.5, -UD + 1.1, -UD + 1.55, hex("#2b2f36"));
  k.box(dx + 0.55, dx + 1.05, 0.5, 1.05, -UD + 1.5, -UD + 1.58, hex("#2b2f36"));
  // bookshelf, full
  const bx = UW - 1.3;
  k.box(bx, bx + 1.1, 0, 2.2, -UD + 0.1, -UD + 0.45, WOOD);
  for (let s = 0; s < 4; s++) {
    let x = bx + 0.06;
    while (x < bx + 1.0) { const w = 0.05 + r() * 0.07, h = 0.3 + r() * 0.15; k.box(x, x + w, 0.1 + s * 0.52, 0.1 + s * 0.52 + h, -UD + 0.12, -UD + 0.42, BOOKS[Math.floor(r() * BOOKS.length)]); x += w + 0.01; }
  }
  plant(k, dx + 1.9, -1.1, 0.8, r);
}
const ROOMS = [living, bedroom, kitchen, study];

function buildRoom(k: Kit, seed: number, on: boolean) {
  const r = rng(seed * 97 + 11);
  const wall = WALLS[Math.floor(r() * WALLS.length)], floor = FLOORS[Math.floor(r() * FLOORS.length)];
  k.box(0, UW, -0.05, 0, -UD, 0, floor);
  k.box(0, UW, 0, UH, -UD - 0.1, -UD, wall);
  // a wood-slat feature wall in some rooms
  if (r() < 0.22) for (let x = 0.1; x < UW * 0.45; x += 0.16) k.box(x, x + 0.1, 0, UH, -UD, -UD + 0.04, WOOD);
  k.box(0, UW, UH, UH + 0.05, -UD, 0, CEIL);
  k.box(0, 0.08, 0, UH, -UD, 0, hex("#d8d0c4"));
  // skirting
  k.box(0, UW, 0, 0.1, -UD + 0.0, -UD + 0.03, WHITE);
  ROOMS[Math.floor(r() * ROOMS.length)](k, r, on);
  if (r() < 0.5) pendant(k, UW * 0.5, -UD * 0.45, on);
}

// ----------------------------------------------------------------- the view
export function createTowerRooms(host: HTMLElement, events: { onHover?: (h: RoomHover) => void } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: new URLSearchParams(location.search).has("capture") });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  host.style.position ||= "relative";
  host.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  const labels = document.createElement("canvas");
  Object.assign(labels.style, { position: "absolute", inset: "0", pointerEvents: "none", width: "100%", height: "100%" });
  host.appendChild(labels);
  const lg = labels.getContext("2d")!;

  const scene = new THREE.Scene();
  scene.background = (() => {
    const c = document.createElement("canvas"); c.width = 4; c.height = 256;
    const g = c.getContext("2d")!, gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, "#1b2244"); gr.addColorStop(0.5, "#4a3a6a"); gr.addColorStop(0.82, "#c4717a"); gr.addColorStop(1, "#f3ae6e");
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  camera.position.set(0, 0, 200);
  // oblique: every room shows the same sliver of floor, like a cutaway drawing
  const SHEAR = 0.42, SHEAR_X = 0.16;
  function project() {
    camera.updateProjectionMatrix();
    // deeper points rise and drift left: floors and the left-hand walls of every room show
    const sh = new THREE.Matrix4().set(1, 0, SHEAR_X, SHEAR_X * 200, 0, 1, -SHEAR, -SHEAR * 200, 0, 0, 1, 0, 0, 0, 0, 1);
    camera.projectionMatrix.multiply(sh);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.42, 0.35, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const roomMat = new THREE.ShaderMaterial({
    vertexColors: true,
    vertexShader: /* glsl */ `
      attribute float aLit; attribute float aGlow; varying vec3 vCol; varying vec3 vN; varying float vLit; varying float vGlow; varying vec3 vW;
      void main() { vCol = color; vN = normal; vLit = aLit; vGlow = aGlow; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying vec3 vN; varying float vLit; varying float vGlow; varying vec3 vW;
      uniform float uUH; uniform float uStep;
      void main() {
        vec3 n = normalize(vN);
        // height inside the storey: ceilings and upper walls catch the room light
        float hy = mod(vW.y, uStep) / uUH;
        float key = max(dot(n, normalize(vec3(.35, .75, .6))), 0.);
        vec3 on = vCol * (vec3(1., .86, .66) * (.5 + .55 * key) + vec3(.35, .22, .1) * smoothstep(.2, 1., hy));
        // lights out: dusk through the glass, cool and dim
        vec3 off = vCol * (vec3(.16, .19, .32) + vec3(.12, .13, .22) * key) + vec3(.008, .01, .025);
        vec3 c = mix(off, on * 1.05, vLit);
        c += vCol * vGlow * mix(.02, .55, vLit);
        gl_FragColor = vec4(c, 1.);
      }`,
    uniforms: { uUH: { value: UH }, uStep: { value: UH + SLAB } },
  });
  const shellMat = new THREE.ShaderMaterial({
    vertexColors: true,
    vertexShader: `varying vec3 vCol; varying vec3 vN; void main(){ vCol = color; vN = normal; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.); }`,
    fragmentShader: `varying vec3 vCol; varying vec3 vN; void main(){ float k = max(dot(normalize(vN), normalize(vec3(-.5,.4,.75))),0.); gl_FragColor = vec4(vCol * (.45 + .55 * k), 1.); }`,
  });
  const glassMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, vertexColors: true,
    vertexShader: `attribute float aLit; varying float vLit; varying vec2 vP; void main(){ vLit = aLit; vP = position.xy; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.); }`,
    fragmentShader: `varying float vLit; varying vec2 vP;
      void main(){
        // dark units: dusk sky reflected in the glass, a diagonal sheen; lit units: nearly clear
        float f = fract((vP.x * .6 + vP.y) * .05);
        float sheen = smoothstep(.0, .04, f) * (1. - smoothstep(.04, .1, f));
        vec3 c = mix(vec3(.04, .05, .11), vec3(.4, .38, .58), sheen * .35);
        gl_FragColor = vec4(c, mix(.5, 0., vLit));
      }`,
  });

  let group: THREE.Group | null = null;
  let towers: { t: TowerModel; x: number; w: number; h: number }[] = [];
  let bounds = { x0: 0, x1: 1, y0: 0, y1: 1 };
  const view = { cx: 0, cy: 0, zoom: 1, fit: 1 };
  let target: typeof view | null = null;

  function show(m: BuildingModel) {
    if (group) { scene.remove(group); group.traverse(o => (o as THREE.Mesh).geometry?.dispose()); }
    group = new THREE.Group();
    scene.add(group);
    const rooms = new Kit(), shell = new Kit(), glass = new Kit();
    towers = [];
    let x = 0;
    const tallest = Math.max(...m.towers.map(t => t.spec.floors));
    for (const t of m.towers) {
      const s = t.spec, w = s.unitsPerFloor * UW + FR * 2, h = s.floors * (UH + SLAB);
      towers.push({ t, x, w, h });
      const stone = hex("#4b4258"), band = hex("#3a3346"), trim = hex("#6c6280");
      // lobby, lit
      shell.ox = x; shell.oy = 0;
      shell.box(0, w, 0, LOBBY, -UD - 0.4, -UD, band);
      rooms.ox = x; rooms.oy = 0; rooms.lit = 1;
      rooms.box(FR, w - FR, 0, 0.05, -UD, 0, hex("#d8cbb8"));
      rooms.box(FR, w - FR, 0, LOBBY - 0.4, -UD, -UD + 0.05, hex("#b89a74"));
      for (let lx = FR + 3; lx < w - FR - 2; lx += 7) { plant(rooms, lx, -1.4, 1.3, rng(lx)); pendant(rooms, lx + 2, -2, true); }
      rooms.box(w / 2 - 2.4, w / 2 + 2.4, 0, 1.05, -UD + 0.6, -UD + 1.4, hex("#2b2f36"));
      for (let f = 1; f <= s.floors; f++) {
        const y0 = LOBBY + (f - 1) * (UH + SLAB);
        // slab and the frame down each side
        shell.ox = x; shell.oy = 0;
        shell.box(-0.2, w + 0.2, y0, y0 + SLAB, -UD - 0.2, 0.25, band);
        shell.box(0, FR, y0 + SLAB, y0 + SLAB + UH, -UD - 0.2, 0.2, stone);
        shell.box(w - FR, w, y0 + SLAB, y0 + SLAB + UH, -UD - 0.2, 0.2, stone);
        for (let u = 0; u < s.unitsPerFloor; u++) {
          const who = t.floors[f - 1][u];
          const on = who.length > 0;
          rooms.ox = x + FR + u * UW; rooms.oy = y0 + SLAB; rooms.lit = on ? 1 : 0;
          buildRoom(rooms, f * 131 + u * 17 + s.floors * 7 + x, on);
          glass.ox = x + FR + u * UW; glass.oy = y0 + SLAB; glass.lit = on ? 1 : 0;
          glass.box(0.04, UW - 0.04, 0.02, UH - 0.02, 0.1, 0.12, [0, 0, 0]);
          // mullion
          shell.ox = x + FR + u * UW; shell.oy = y0 + SLAB;
          shell.box(-0.06, 0.06, 0, UH, 0.1, 0.2, trim);
        }
      }
      // roof: parapet, plant boxes, a mast with its beacon
      const top = LOBBY + s.floors * (UH + SLAB);
      shell.ox = x; shell.oy = 0;
      shell.box(-0.2, w + 0.2, top, top + SLAB, -UD - 0.2, 0.25, band);
      shell.box(0, w, top + SLAB, top + SLAB + 1.1, -0.4, 0.1, stone);
      shell.box(w * 0.2, w * 0.2 + 6, top + SLAB, top + SLAB + 3.5, -UD, -1, trim);
      shell.box(w * 0.5 - 0.15, w * 0.5 + 0.15, top + SLAB, top + SLAB + 9, -2, -1.7, trim);
      rooms.ox = x; rooms.oy = top + SLAB; rooms.lit = 1;
      rooms.blob(w * 0.5, 9.2, -1.85, 0.35, 0.35, 0.35, hex("#ff4a3a"), 2.5);
      for (let px = 3; px < w - 3; px += 5) plant(rooms, px, -0.9, 1.4, rng(px * 3 + x));
      x += w + GAP;
    }
    void tallest;
    // street
    shell.ox = 0; shell.oy = 0;
    shell.box(-80, x + 80 - GAP, -40, 0, -UD - 6, 4, hex("#2a2433"));
    for (let sx = -30; sx < x + 20; sx += 6) shell.box(sx, sx + 3, 0, 0.02, 1.6, 1.9, hex("#e9c27a"));
    // a skyline behind
    const bg = new Kit(); const rb = rng(9);
    for (let bx = -60; bx < x + 50; bx += 7 + rb() * 9) {
      const bh = 20 + rb() * 70, bw = 6 + rb() * 10;
      bg.box(bx, bx + bw, -30, bh, -60, -50, hex(rb() < 0.5 ? "#231d36" : "#2a2240"));
      for (let wy = 3; wy < bh - 2; wy += 3.4) for (let wx = bx + 1; wx < bx + bw - 1; wx += 1.8) if (rb() < 0.12) bg.box(wx, wx + 0.5, wy, wy + 0.9, -49.9, -49.8, hex("#a8844e"));
    }
    const bgMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    group.add(new THREE.Mesh(bg.geometry(), bgMat));
    group.add(new THREE.Mesh(shell.geometry(), shellMat));
    group.add(new THREE.Mesh(rooms.geometry(), roomMat));
    group.add(new THREE.Mesh(glass.geometry(), glassMat));
    bounds = { x0: -4, x1: x - GAP + 4, y0: -2, y1: LOBBY + tallest * (UH + SLAB) + 16 };
    fit();
    render();
  }

  function fit() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    // leave room at the sides for floor numbers and counts
    const bw = bounds.x1 - bounds.x0 + 16, bh = bounds.y1 - bounds.y0 + 12;
    view.fit = Math.min(w / bw, h / bh);
    view.zoom = 1; view.cx = (bounds.x0 + bounds.x1) / 2; view.cy = (bounds.y0 + bounds.y1) / 2 - 2;
  }
  function applyView() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1, s = view.fit * view.zoom;
    camera.left = -w / 2 / s; camera.right = w / 2 / s; camera.top = h / 2 / s; camera.bottom = -h / 2 / s;
    camera.position.set(view.cx, view.cy, 200);
    project();
  }
  function toScreen(x: number, y: number) {
    const w = host.clientWidth || 1, h = host.clientHeight || 1, s = view.fit * view.zoom;
    return [w / 2 + (x - view.cx) * s, h / 2 - (y - view.cy) * s] as const;
  }
  function drawLabels() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1, dpr = Math.min(window.devicePixelRatio, 2);
    labels.width = w * dpr; labels.height = h * dpr;
    lg.setTransform(dpr, 0, 0, dpr, 0, 0);
    lg.clearRect(0, 0, w, h);
    const s = view.fit * view.zoom;
    const fs = Math.max(9, Math.min(15, s * 2.4));
    for (const { t, x, w: tw } of towers) {
      const dark = new Set(darkFloors(t));
      const [hx, hy] = toScreen(x, LOBBY + t.spec.floors * (UH + SLAB) + 12);
      lg.textAlign = "left"; lg.textBaseline = "alphabetic";
      lg.font = `700 ${Math.round(fs * 1.2)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      lg.fillStyle = "#fff4dc"; lg.fillText(t.spec.label.toUpperCase(), hx, hy);
      lg.font = `600 ${Math.round(fs * 0.9)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      lg.fillStyle = "#ffc84d";
      lg.fillText(`${t.lit} LIT OF ${t.spec.floors * t.spec.unitsPerFloor} · ${dark.size} OF ${t.spec.floors} FLOORS DARK${t.spec.unitsAssumed ? " · UNITS/FLOOR ASSUMED" : ""}`, hx, hy + fs * 1.15);
      for (let f = 1; f <= t.spec.floors; f++) {
        const yc = LOBBY + (f - 1) * (UH + SLAB) + SLAB + UH / 2;
        const [lx, ly] = toScreen(x - 1.2, yc);
        lg.textAlign = "right"; lg.textBaseline = "middle";
        lg.font = `600 ${Math.round(fs * 0.85)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
        lg.fillStyle = dark.has(f) ? "rgba(255,244,220,.4)" : "#fff4dc";
        lg.fillText(String(f), lx, ly);
        const n = t.floors[f - 1].filter(u => u.length).length + (t.floorOnly[f - 1].length ? 1 : 0);
        const [rx, ry] = toScreen(x + tw + 1.2, yc);
        const pw = fs * 1.9, ph = fs * 1.15;
        lg.textAlign = "center";
        if (n) { lg.fillStyle = "#ffc84d"; lg.beginPath(); lg.roundRect(rx, ry - ph / 2, pw, ph, ph / 2); lg.fill(); lg.fillStyle = "#3a2600"; }
        else { lg.strokeStyle = "rgba(255,244,220,.35)"; lg.lineWidth = 1; lg.beginPath(); lg.roundRect(rx + 0.5, ry - ph / 2 + 0.5, pw - 1, ph - 1, ph / 2); lg.stroke(); lg.fillStyle = "rgba(255,244,220,.5)"; }
        lg.fillText(String(n), rx + pw / 2, ry + 1);
      }
      if (t.unplaced.length) {
        const [ux, uy] = toScreen(x, -3.5);
        lg.textAlign = "left"; lg.fillStyle = "rgba(255,244,220,.75)"; lg.font = `600 ${Math.round(fs * 0.85)}px "Barlow Condensed", sans-serif`;
        lg.fillText(`+${t.unplaced.length} here, unit not readable`, ux, uy);
      }
    }
  }
  function render() {
    applyView();
    composer.render();
    drawLabels();
  }
  function resize() {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
    composer.setSize(w, h); bloom.setSize(w, h);
    if (group) render();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // ---- interaction: hover a lit unit for who lives there; wheel to zoom; drag to pan; click to go in
  function unitAt(cx: number, cy: number) {
    const r = renderer.domElement.getBoundingClientRect(), s = view.fit * view.zoom;
    const wx = view.cx + (cx - r.left - r.width / 2) / s, wy = view.cy - (cy - r.top - r.height / 2) / s;
    for (const tw of towers) {
      const u = Math.floor((wx - tw.x - FR) / UW), fi = Math.floor((wy - LOBBY) / (UH + SLAB));
      if (u < 0 || u >= tw.t.spec.unitsPerFloor || fi < 0 || fi >= tw.t.spec.floors) continue;
      return { tw, f: fi + 1, u, wx: tw.x + FR + (u + 0.5) * UW, wy: LOBBY + fi * (UH + SLAB) + SLAB + UH / 2 };
    }
    return null;
  }
  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  let hoverKey = "";
  const el = renderer.domElement;
  const onDown = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false }; el.setPointerCapture(e.pointerId); };
  const onMove = (e: PointerEvent) => {
    if (drag) {
      const s = view.fit * view.zoom, dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (drag.moved) { view.cx = drag.cx - dx / s; view.cy = drag.cy + dy / s; target = null; render(); return; }
    }
    const hit = unitAt(e.clientX, e.clientY);
    const who = hit ? hit.tw.t.floors[hit.f - 1][hit.u] : [];
    const label = hit ? `${hit.tw.t.spec.label} · floor ${hit.f} · unit ${[...new Set(who.map(r => r.unit))].join(", ")}` : "";
    const key = who.length ? label : "";
    if (key !== hoverKey || who.length) events.onHover?.(who.length ? { residents: who, label, x: e.clientX, y: e.clientY } : null);
    hoverKey = key;
    el.style.cursor = who.length ? "pointer" : drag ? "grabbing" : "grab";
  };
  const onUp = (e: PointerEvent) => {
    const wasDrag = drag?.moved;
    drag = null;
    if (wasDrag) return;
    const hit = unitAt(e.clientX, e.clientY);
    if (!hit) return;
    // click a window: fly in until the room fills a third of the screen
    const h = host.clientHeight || 1;
    target = { cx: hit.wx, cy: hit.wy, zoom: Math.max(view.zoom, (h / 3) / (UH * view.fit)), fit: view.fit };
    animate();
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = el.getBoundingClientRect(), s0 = view.fit * view.zoom;
    const wx = view.cx + (e.clientX - r.left - r.width / 2) / s0, wy = view.cy - (e.clientY - r.top - r.height / 2) / s0;
    view.zoom = Math.min(14, Math.max(0.8, view.zoom * Math.exp(-e.deltaY * 0.0015)));
    const s1 = view.fit * view.zoom;
    view.cx = wx - (e.clientX - r.left - r.width / 2) / s1; view.cy = wy + (e.clientY - r.top - r.height / 2) / s1;
    target = null;
    render();
  };
  let raf = 0;
  function animate() {
    cancelAnimationFrame(raf);
    const step = () => {
      if (!target) return;
      const k = 0.14;
      view.cx += (target.cx - view.cx) * k; view.cy += (target.cy - view.cy) * k; view.zoom += (target.zoom - view.zoom) * k;
      render();
      if (Math.abs(target.zoom - view.zoom) < 0.01 && Math.hypot(target.cx - view.cx, target.cy - view.cy) < 0.05) { target = null; return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("pointerleave", () => { hoverKey = ""; events.onHover?.(null); });
  document.fonts?.ready.then(() => group && drawLabels());

  return {
    show,
    /** back to the whole building */
    reset() { target = null; fit(); render(); },
    /** capture: frame a point at a zoom */
    look(x: number, y: number, zoom: number) { view.cx = x; view.cy = y; view.zoom = zoom; render(); },
    render,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener("pointerdown", onDown); el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp); el.removeEventListener("wheel", onWheel);
      scene.traverse(o => (o as THREE.Mesh).geometry?.dispose());
      composer.dispose(); renderer.dispose();
      el.remove(); labels.remove();
    },
  };
}
