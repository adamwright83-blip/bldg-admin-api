/**
 * Lantern City v7: the real neighbourhoods we serve as a fog-of-war diorama.
 *
 * - The land is real (OpenStreetMap footprints, heights and unit counts, baked into static tiles by
 *   scripts/assets/lantern-city-fog/bake_service_area.py). OSM decides where things are; the
 *   buildings you see are CC0 kit buildings recoloured to the Lantern City palette.
 * - Every customer building is a lantern. Land around lanterns is charted (dusk-dim); everything
 *   else inside the service area is under white plaster fog with gold cracks at the frontier.
 * - Outside the served neighbourhoods there is no land at all: the page is the edge of the world.
 *
 * Imperative three.js; the React wrapper (LanternCityV7.tsx) owns the HUD.
 */
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { CANONICAL_BUILDING_GEOGRAPHY } from "@shared/canonicalGeography";

const DEFAULT_BASE = "/assets/goldline/lantern-city";

/** One customer: every customer is their own lantern. */
export type LanternInput = {
  key: string;
  latitude: number;
  longitude: number;
  label: string;           // address
  name?: string;
  spendCents?: number;
  lastOrderAt?: string;
  total: number;
  active: number;
  dimming: number;
  dark: number;
};
export type WorldStats = { lanterns: number; outside: number; chartedPct: number; doorsInLight: number };
export type Mission = { kind: "run" | "uncharted"; title: string; body: string; hood: string; where: string; doors: number; buildings: number; miles: number; x: number; z: number; radius: number };
export type WorldEvents = {
  onReady?: () => void;
  onStats?: (s: WorldStats) => void;
  onMission?: (m: Mission | null) => void;
  onSelect?: (keys: string[] | null) => void;
  onError?: (e: unknown) => void;
};

type Manifest = {
  origin: [number, number];
  kx: number;
  kz: number;
  bounds: [number, number, number, number];
  tile: number;
  tiles: [number, number, number][];
  outline: { n: string; served?: boolean; p: [number, number][] }[];
  mask: { cell: number; w: number; h: number };
  terrain: { cell: number; nx: number; nz: number; base: number; h: number[] };
  water: [number, number][][];
  parks: [number, number][][];
  doors: { cell: number; nx: number; nz: number; v: number[] };
  major: Record<string, [number, number][]>;
  attribution: string;
};
type Kit = {
  models: { name: string; cls: "house" | "mid" | "brick"; atlas: number; size: [number, number, number]; nv: number; ni: number; p: [number, string]; n: [number, string]; uv: [number, string]; i: [number, string] }[];
  atlases: string[];
  blob: string;
};
type Bldg = { i: number; p: [number, number][]; cx: number; cz: number; h: number; u: number; t: number; name?: string };
type TileData = { o: [number, number]; b: [number[], number, number, number, string?][]; r: [string, string, number[]][] };

const VEX = 1.35;
const DUSK_GROUND = new THREE.Color("#5b6680");
const DUSK_BLDG = new THREE.Color("#7a86a3");
const DUSK_ROOF = new THREE.Color("#8b95b0");
const PAPER = new THREE.Color("#e9ecf0");
const KIT_RADIUS = 1150;
const TYPES = ["house", "apartments", "residential", "retail", "commercial", "yes", "garage", "office", "school", "hotel", "industrial", "church", "other"];

function hash2(x: number, y: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
function fbm(x: number, y: number) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}
const ease = (t: number) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };
// a number as a GLSL float literal
const glf = (v: number) => (Number.isInteger(v) ? `${v}.` : `${v}`);
const hexv = (c: THREE.Color) => `${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)}`;

const COMMON = /* glsl */ `
  uniform sampler2D uMask; uniform sampler2D uServe; uniform sampler2D uCanal; uniform vec4 uRect; uniform vec4 uBounds; uniform vec3 uSun; uniform float uTime;
  #define NL 48
  uniform vec4 uLights[NL];
  // warm light thrown by the nearest customer lanterns onto everything around them
  vec3 lanternLight(vec3 p, vec3 n) {
    vec3 acc = vec3(0.);
    for (int i = 0; i < NL; i++) {
      vec4 L = uLights[i];
      if (L.w <= 0.) continue;
      vec3 d = L.xyz - p;
      float d2 = dot(d, d);
      if (d2 > 90000.) continue;
      float wrap = .3 + .7 * max(dot(n, d * inversesqrt(d2 + 1.)), 0.);
      acc += vec3(1., .6, .26) * L.w * wrap * 1600. / (d2 + 500.);
    }
    return acc;
  }
  float canalD(vec2 xz) { vec2 uv = (xz - uBounds.xy) / (uBounds.zw - uBounds.xy);
    if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return 255.;
    return texture2D(uCanal, uv).r * 255.; }
  float sdMask(vec2 xz) { return texture2D(uMask, (xz - uRect.xy) / (uRect.zw - uRect.xy)).r; }
  float terrMask(vec2 xz) { return texture2D(uMask, (xz - uRect.xy) / (uRect.zw - uRect.xy)).g; }
  float served(vec2 xz) { return texture2D(uServe, (xz - uRect.xy) / (uRect.zw - uRect.xy)).r; }
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
  float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
`;
const FOG_V = /* glsl */ `#include <fog_pars_vertex>`;
const FOG_F = /* glsl */ `#include <fog_pars_fragment>`;

export function createLanternWorld(container: HTMLElement, events: WorldEvents = {}, opts: { assetBase?: string } = {}) {
  // assetBase holds v7/ (world + kit) and v4/ (tower art); the app serves it from /assets/goldline/lantern-city
  const ASSETS = opts.assetBase ?? DEFAULT_BASE;
  const WORLD_BASE = `${ASSETS}/v7`;
  let disposed = false;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  const scene = new THREE.Scene();
  // a soft evening sky behind the board: warm at the horizon, the page colour overhead
  scene.background = (() => {
    const c = document.createElement("canvas");
    c.width = 4; c.height = 256;
    const g = c.getContext("2d")!;
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, "#dfe6f0"); gr.addColorStop(0.45, "#eceef2"); gr.addColorStop(0.75, "#f6e6d6"); gr.addColorStop(1, "#f3d9c2");
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  scene.fog = new THREE.Fog(PAPER, 5200, 13000);
  const camera = new THREE.PerspectiveCamera(26, 1, 20, 30000);
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 350;
  controls.maxDistance = 26000;
  controls.minPolarAngle = 0.3;
  controls.maxPolarAngle = 1.15;
  controls.screenSpacePanning = false;
  // north stays up: the map can tilt and zoom, never spin
  controls.minAzimuthAngle = 0;
  controls.maxAzimuthAngle = 0;
  const SUN = new THREE.Vector3(-0.55, 0.62, -0.56).normalize();

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.6, 0.3, 1.05);
  composer.addPass(bloom);
  const tilt = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(2, 2) }, uAmt: { value: 1.2 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uAmt; varying vec2 vUv;
      void main() {
        float b = smoothstep(.22, .6, abs(vUv.y - .5)) * uAmt;
        vec4 s = vec4(0.); float wsum = 0.;
        for (int i = -4; i <= 4; i++) for (int j = -4; j <= 4; j++) {
          vec2 o = vec2(float(i), float(j)) * b / uRes; float w = 1. - length(vec2(i, j)) / 6.;
          if (w > 0.) { s += texture2D(tDiffuse, vUv + o) * w; wsum += w; }
        }
        gl_FragColor = s / wsum;
      }`,
  });
  composer.addPass(tilt);
  composer.addPass(new OutputPass());

  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    composer.setSize(w, h);
    bloom.setSize(w, h);
    tilt.uniforms.uRes.value.set(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ----------------------------------------------------------------- state filled once data loads
  let M: Manifest;
  let KIT: Kit;
  let ground = (_x: number, _z: number) => 0;
  let sdField = (_x: number, _z: number) => 1e4;
  const terrField = (x: number, z: number) => {
    if (!maskData) return 1e4;
    const i = Math.max(0, Math.min(MW - 1, Math.round((x - rect.x0) / (rect.x1 - rect.x0) * (MW - 1))));
    const j = Math.max(0, Math.min(MH - 1, Math.round((z - rect.z0) / (rect.z1 - rect.z0) * (MH - 1))));
    return maskData[(j * MW + i) * 2 + 1];
  };
  const uniforms: Record<string, THREE.IUniform> = {
    uMask: { value: null }, uServe: { value: null }, uCanal: { value: null }, uRect: { value: new THREE.Vector4() }, uBounds: { value: new THREE.Vector4() },
    uSun: { value: SUN }, uTime: { value: 0 },
    uLights: { value: Array.from({ length: 48 }, () => new THREE.Vector4(0, -1e5, 0, 0)) },
  };
  const fogChunk = { fogColor: { value: PAPER }, fogNear: { value: 5200 }, fogFar: { value: 13000 } };
  let lanterns: LanternInput[] = [];
  let placedLanterns: { input: LanternInput; x: number; z: number; b: Bldg | null; mesh: THREE.Object3D | null; halo: THREE.Mesh }[] = [];
  const lanternGroup = new THREE.Group();
  scene.add(lanternGroup);
  let maskData: Float32Array;
  let maskTex: THREE.DataTexture;
  const MW = 2048;
  let MH = 512;
  let rect = { x0: 0, z0: 0, x1: 1, z1: 1 };
  let servedAt = (_x: number, _z: number) => false;
  let canalAt = (_x: number, _z: number) => 255;
  const CANAL = 34;     // half-width of the water, metres (lazy-river wide)
  const COPE = 3.0;     // width of the stone promenade along each bank
  const CLEARING = 55;  // one customer's lantern clears this far around it (about two houses)
  const RUN_DOORS = 180; // a door-hanger run: the gold line encloses the nearest this many doors
  let CANALS: [number, number][][] = [];
  let framed = false;

  const ll = (lat: number, lon: number) => ({ x: (lon - M.origin[1]) * M.kx, z: -(lat - M.origin[0]) * M.kz });

  async function load() {
    const [m, k, cn] = await Promise.all([
      fetch(`${WORLD_BASE}/world/manifest.json`).then(r => r.json()),
      fetch(`${WORLD_BASE}/kit.json`).then(r => r.json()),
      fetch(`${WORLD_BASE}/world/canals.json`).then(r => r.json()),
    ]);
    CANALS = (cn.canals as { p: [number, number][] }[]).map(c => c.p);
    M = m;
    KIT = k;
    const T = M.terrain;
    ground = (x, z) => {
      const fx = Math.min(Math.max((x - M.bounds[0]) / T.cell, 0), T.nx - 1.001);
      const fz = Math.min(Math.max((z - M.bounds[1]) / T.cell, 0), T.nz - 1.001);
      const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
      const h = (i: number, j: number) => T.h[j * T.nx + i] / 10;
      const a = h(ix, iz) * (1 - tx) + h(ix + 1, iz) * tx;
      const b = h(ix, iz + 1) * (1 - tx) + h(ix + 1, iz + 1) * tx;
      return (a * (1 - tz) + b * tz) * VEX;
    };
    const margin = 900;
    rect = { x0: M.bounds[0] - margin, z0: M.bounds[1] - margin, x1: M.bounds[2] + margin, z1: M.bounds[3] + margin };
    MH = Math.round(MW * (rect.z1 - rect.z0) / (rect.x1 - rect.x0));
    uniforms.uRect.value.set(rect.x0, rect.z0, rect.x1, rect.z1);
    // the service-area mask, re-projected onto the fog rectangle
    const serveImg = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = `${WORLD_BASE}/world/mask.png`; });
    const sc = document.createElement("canvas");
    sc.width = MW; sc.height = MH;
    const sctx = sc.getContext("2d")!;
    sctx.fillStyle = "#000"; sctx.fillRect(0, 0, MW, MH);
    const px = (x: number) => (x - rect.x0) / (rect.x1 - rect.x0) * MW;
    const pz = (z: number) => (z - rect.z0) / (rect.z1 - rect.z0) * MH;
    sctx.drawImage(serveImg, px(M.bounds[0]), pz(M.bounds[1]), px(M.bounds[2]) - px(M.bounds[0]), pz(M.bounds[3]) - pz(M.bounds[1]));
    const sdata = sctx.getImageData(0, 0, MW, MH).data;
    const serveTex = new THREE.CanvasTexture(sc);
    serveTex.flipY = false;
    serveTex.minFilter = serveTex.magFilter = THREE.LinearFilter;
    uniforms.uServe.value = serveTex;
    servedAt = (x, z) => {
      const i = Math.floor(px(x)), j = Math.floor(pz(z));
      return i >= 0 && j >= 0 && i < MW && j < MH && sdata[(j * MW + i) * 4] > 127;
    };
    // canals between neighbourhoods: a distance field (metres) on the world grid
    const canalImg = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = `${WORLD_BASE}/world/canal.png`; });
    const cc = document.createElement("canvas");
    cc.width = canalImg.width; cc.height = canalImg.height;
    const cctx = cc.getContext("2d")!;
    cctx.drawImage(canalImg, 0, 0);
    const cdata = cctx.getImageData(0, 0, cc.width, cc.height).data;
    const canalTex = new THREE.CanvasTexture(cc);
    canalTex.flipY = false;
    canalTex.minFilter = canalTex.magFilter = THREE.LinearFilter;
    uniforms.uCanal.value = canalTex;
    uniforms.uBounds.value.set(M.bounds[0], M.bounds[1], M.bounds[2], M.bounds[3]);
    canalAt = (x, z) => {
      // texel centres sit at (i + 0.5), as the GPU samples them
      const fx = (x - M.bounds[0]) / (M.bounds[2] - M.bounds[0]) * cc.width - 0.5, fz = (z - M.bounds[1]) / (M.bounds[3] - M.bounds[1]) * cc.height - 0.5;
      const i = Math.floor(fx), j = Math.floor(fz);
      if (i < 0 || j < 0 || i >= cc.width - 1 || j >= cc.height - 1) return 255;
      const tx = fx - i, tz = fz - j, v = (a: number, b: number) => cdata[(b * cc.width + a) * 4];
      return (v(i, j) * (1 - tx) + v(i + 1, j) * tx) * (1 - tz) + (v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx) * tz;
    };
    maskData = new Float32Array(MW * MH * 2).fill(900);
    maskTex = new THREE.DataTexture(maskData, MW, MH, THREE.RGFormat, THREE.FloatType);
    maskTex.magFilter = maskTex.minFilter = THREE.LinearFilter;
    maskTex.needsUpdate = true;
    uniforms.uMask.value = maskTex;
    sdField = (x, z) => {
      const fx = (x - rect.x0) / (rect.x1 - rect.x0) * (MW - 1), fz = (z - rect.z0) / (rect.z1 - rect.z0) * (MH - 1);
      const i = Math.max(0, Math.min(MW - 2, Math.floor(fx))), j = Math.max(0, Math.min(MH - 2, Math.floor(fz)));
      const tx = fx - i, tz = fz - j, m = (a: number, b: number) => maskData[(b * MW + a) * 2];
      return (m(i, j) * (1 - tx) + m(i + 1, j) * tx) * (1 - tz) + (m(i, j + 1) * (1 - tx) + m(i + 1, j + 1) * tx) * tz;
    };
    buildTerrain();
    buildFlats();
    buildFog();
    buildKitGeometry();
    buildCanals();
    buildLandmarks();
    buildLabels();
    if (disposed) return;
    applyLanterns();
    events.onReady?.();
  }

  // ----------------------------------------------------------------- reveal field
  let warp: Float32Array | null = null;
  // One customer in a neighbourhood charts the whole neighbourhood. The field is signed metres to
  // the edge of charted land (negative inside), from a distance transform of the charted mask.
  function hoodAt(x: number, z: number): string | null {
    for (const o of M.outline) if (pointInRing(x, z, o.p)) return o.n;
    return null;
  }
  function chamfer(src: Uint8Array, w: number, h: number, cell: number) {
    // distance (metres) from every pixel to the nearest pixel where src is 1; two-pass 8-neighbour chamfer
    const INF = 1e9, d = new Float32Array(w * h), D = cell, DD = cell * Math.SQRT2;
    for (let i = 0; i < w * h; i++) d[i] = src[i] ? 0 : INF;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + D);
      if (y > 0) {
        v = Math.min(v, d[i - w] + D);
        if (x > 0) v = Math.min(v, d[i - w - 1] + DD);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + DD);
      }
      d[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + D);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + D);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + DD);
        if (x > 0) v = Math.min(v, d[i + w - 1] + DD);
      }
      d[i] = v;
    }
    return d;
  }
  function rebuildMask(hoods: Set<string>, clearings: { x: number; z: number; r: number }[], runs: { x: number; z: number; r: number }[]) {
    const cv = document.createElement("canvas");
    cv.width = MW; cv.height = MH;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#000"; g.fillRect(0, 0, MW, MH);
    g.fillStyle = "#fff";
    const px = (x: number) => (x - rect.x0) / (rect.x1 - rect.x0) * (MW - 1);
    const pz = (z: number) => (z - rect.z0) / (rect.z1 - rect.z0) * (MH - 1);
    for (const o of M.outline) {
      if (!hoods.has(o.n)) continue;
      g.beginPath();
      o.p.forEach((q, k) => (k ? g.lineTo(px(q[0]), pz(q[1])) : g.moveTo(px(q[0]), pz(q[1]))));
      g.closePath();
      g.fill();
      // close the hairline seams between neighbouring charted outlines (the canals run there)
      g.lineWidth = 4;
      g.strokeStyle = "#fff";
      g.stroke();
    }
    const img = g.getImageData(0, 0, MW, MH).data;
    const cell = (rect.x1 - rect.x0) / (MW - 1);
    // close slivers between charted outlines (the boundary data leaves no-man's-land up to ~80 m wide
    // between some neighbours): dilate then erode by the same amount, so outer edges don't move
    const raw = new Uint8Array(MW * MH);
    for (let i = 0; i < MW * MH; i++) raw[i] = img[i * 4] > 127 ? 1 : 0;
    const CLOSE = 90;
    const toRaw = chamfer(raw, MW, MH, cell);
    const notDil = new Uint8Array(MW * MH);
    for (let i = 0; i < MW * MH; i++) notDil[i] = toRaw[i] <= CLOSE ? 0 : 1;
    const toNotDil = chamfer(notDil, MW, MH, cell);
    const inside = new Uint8Array(MW * MH), outside = new Uint8Array(MW * MH);
    for (let i = 0; i < MW * MH; i++) { const on = raw[i] === 1 || toNotDil[i] > CLOSE; inside[i] = on ? 1 : 0; outside[i] = on ? 0 : 1; }
    const toInside = chamfer(inside, MW, MH, cell), toOutside = chamfer(outside, MW, MH, cell);
    for (let i = 0; i < MW * MH; i++) {
      maskData[i * 2] = inside[i] ? -Math.min(400, toOutside[i]) : Math.min(900, toInside[i]);
      maskData[i * 2 + 1] = 900;
    }
    // a lone customer: a clean clearing around the lantern, and a door-hanger territory past it
    const stamp = (c: { x: number; z: number; r: number }, ch: number, reach: number) => {
      const cellZ = (rect.z1 - rect.z0) / (MH - 1);
      const i0 = Math.max(0, Math.floor((c.x - c.r - reach - rect.x0) / cell)), i1 = Math.min(MW - 1, Math.ceil((c.x + c.r + reach - rect.x0) / cell));
      const j0 = Math.max(0, Math.floor((c.z - c.r - reach - rect.z0) / cellZ)), j1 = Math.min(MH - 1, Math.ceil((c.z + c.r + reach - rect.z0) / cellZ));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = rect.x0 + cell * i, z = rect.z0 + cellZ * j;
        const k = (j * MW + i) * 2 + ch;
        maskData[k] = Math.min(maskData[k], Math.hypot(x - c.x, z - c.z) - c.r);
      }
    };
    for (const c of clearings) stamp(c, 0, 400);
    for (const r of runs) stamp(r, 1, 300);
    maskTex.needsUpdate = true;
  }

  // ----------------------------------------------------------------- terrain, flats, fog
  function landMaterial(frag: string, extra: Record<string, THREE.IUniform> = {}, vertexExtra = "") {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogChunk, ...extra }, fog: true,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vW; attribute float aAlong; varying float vAlong; attribute float aAcross; varying float vAcross; ${vertexExtra}
        ${FOG_V}
        void main() { vN = normal; vAlong = aAlong; vAcross = aAcross; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `
        varying vec3 vN; varying vec3 vW; varying float vAlong; varying float vAcross;
        ${FOG_F}
        ` + frag,
    });
  }
  function buildTerrain() {
    const T = M.terrain;
    const [x0, z0, x1, z1] = M.bounds;
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, T.nx - 1, T.nz - 1).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setY(k, ground(pos.getX(k), pos.getZ(k)));
    g.computeVertexNormals();
    g.setAttribute("aAlong", new THREE.BufferAttribute(new Float32Array(pos.count), 1));
    g.setAttribute("aAcross", new THREE.BufferAttribute(new Float32Array(pos.count), 1));
    scene.add(new THREE.Mesh(g, landMaterial(/* glsl */ `
      uniform vec3 uCol;
      void main() {
        float sd = sdMask(vW.xz), tr = terrMask(vW.xz);
        if (served(vW.xz) < .5 || canalD(vW.xz) < ${CANAL + 1}. || (sd > 40. && tr > 4.)) discard;
        float l = .55 + .45 * max(dot(normalize(vN), uSun), 0.);
        vec3 c = uCol * l * 1.3 * (.9 + .2 * fbm(vW.xz * .02));
        vec3 snow = vec3(.9, .91, .93) * (.82 + .18 * l);
        c = mix(c, snow, smoothstep(0., 40., sd));
        // the gold line around a door-hanger run
        float line = 1. - smoothstep(0., max(3.5, fwidth(tr) * 2.2), abs(tr));
        c = mix(c, vec3(1., .74, .3) * 2.4, line * step(0., sd));
        gl_FragColor = vec4(c, 1.);
        #include <fog_fragment>
      }`, { uCol: { value: DUSK_GROUND } })));
  }
  function flatMesh(pos: number[], idx: number[], along: number[] | null, frag: string, offset = true, across: number[] | null = null) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("aAcross", new THREE.Float32BufferAttribute(across ?? new Array(pos.length / 3).fill(0), 1));
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute("aAlong", new THREE.Float32BufferAttribute(along ?? new Array(pos.length / 3).fill(0), 1));
    g.setIndex(idx);
    const m = landMaterial(frag);
    if (offset) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
    m.side = THREE.DoubleSide;
    return new THREE.Mesh(g, m);
  }
  function buildFlats() {
    // water: flat at the lowest ground its outline touches
    {
      const pos: number[] = [], idx: number[] = [];
      for (const ring of M.water) {
        if (ring.length < 3) continue;
        let lo = 1e9;
        for (const p of ring) lo = Math.min(lo, ground(p[0], p[1]));
        const tris = THREE.ShapeUtils.triangulateShape(ring.map(p => new THREE.Vector2(p[0], p[1])), []);
        const base = pos.length / 3;
        for (const p of ring) pos.push(p[0], lo - 1.5, p[1]);
        for (const t of tris) idx.push(base + t[0], base + t[1], base + t[2]);
      }
      scene.add(flatMesh(pos, idx, null, /* glsl */ `
        void main() {
          if (served(vW.xz) < .5 || sdMask(vW.xz) > 40.) discard;
          float ripple = fbm(vW.xz * .045 + vec2(uTime * .05, -uTime * .03));
          vec3 c = mix(vec3(.05, .11, .2), vec3(.3, .4, .56), .25 + .5 * ripple);
          c += vec3(1., .78, .45) * smoothstep(.72, .8, fbm(vW.xz * .09 + uTime * .08)) * .35;
          gl_FragColor = vec4(c, 1.);
          #include <fog_fragment>
        }`, false));
    }
    {
      const pos: number[] = [], idx: number[] = [];
      for (const ring of M.parks) {
        if (ring.length < 3) continue;
        const tris = THREE.ShapeUtils.triangulateShape(ring.map(p => new THREE.Vector2(p[0], p[1])), []);
        const base = pos.length / 3;
        for (const p of ring) pos.push(p[0], ground(p[0], p[1]) + 0.6, p[1]);
        for (const t of tris) idx.push(base + t[0], base + t[1], base + t[2]);
      }
      scene.add(flatMesh(pos, idx, null, /* glsl */ `
        void main() { if (served(vW.xz) < .5 || sdMask(vW.xz) > 40.) discard;
          gl_FragColor = vec4(mix(vec3(.13, .21, .16), vec3(.2, .3, .2), fbm(vW.xz * .05)), 1.);
          #include <fog_fragment>
        }`));
    }
  }
  let fogMesh: THREE.Mesh;
  function buildFog() {
    const S = 900, Sz = Math.round(S * (rect.z1 - rect.z0) / (rect.x1 - rect.x0));
    const g = new THREE.PlaneGeometry(rect.x1 - rect.x0, rect.z1 - rect.z0, S, Sz).rotateX(-Math.PI / 2).translate((rect.x0 + rect.x1) / 2, 0, (rect.z0 + rect.z1) / 2);
    const gh = new Float32Array(g.attributes.position.count);
    for (let k = 0; k < gh.length; k++) gh[k] = ground(g.attributes.position.getX(k), g.attributes.position.getZ(k));
    g.setAttribute("aGround", new THREE.BufferAttribute(gh, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogChunk }, fog: true, transparent: true,
      vertexShader: COMMON + /* glsl */ `
        attribute float aGround; varying vec3 vW; varying vec3 vN;
        ${FOG_V}
        float lift(vec2 p) {
          float sd = sdMask(p);
          float body = smoothstep(18., 110., sd) * smoothstep(.0, .6, served(p));
          // beside a canal the fog lies flat at the coping, then swells smoothly away from the water
          float cv = smoothstep(${(CANAL + COPE).toFixed(1)}, ${CANAL + 130}., canalD(p));
          float rise = cv * cv * (3. - 2. * cv);
          float billow = fbm(p * .006 + uTime * .004) * 34. + fbm(p * .021 - uTime * .006) * 12.;
          float h = mix(.85, 30. + billow * 1.9, rise);
          float inRun = 1. - smoothstep(-60., 0., terrMask(p));
          h *= mix(1., .3, inRun);
          return body * h - (1. - body) * 30.;
        }
        void main() {
          vec3 p = position;
          float y0 = aGround + lift(p.xz), e = 16.;
          float yx = aGround + lift(p.xz + vec2(e, 0.)), yz = aGround + lift(p.xz + vec2(0., e));
          vN = normalize(vec3(y0 - yx, e, y0 - yz));
          p.y = y0;
          vec4 w = modelMatrix * vec4(p, 1.); vW = w.xyz;
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `
        varying vec3 vW; varying vec3 vN;
        ${FOG_F}
        vec2 vor(vec2 p) {
          vec2 n = floor(p), f = fract(p); float d1 = 8., d2 = 8.;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(i, j); vec2 o = vec2(h21(n + g), h21(n + g + 31.7));
            float d = length(g + o - f); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
          return vec2(d1, d2 - d1);
        }
        void main() {
          float sv = served(vW.xz);
          if (sv < .35) discard;
          float sd = sdMask(vW.xz);
          if (sd < 14.) discard;
          float trF = terrMask(vW.xz);
          float inRun = 1. - smoothstep(-40., 0., trF);
          // over a door-hanger run the fog is torn into drifting patches
          if (inRun > .01 && fbm(vW.xz * .011 + vec2(uTime * .012, uTime * .007)) < .5 + .08 * (1. - inRun)) discard;
          vec3 n = normalize(vN);
          float lam = max(dot(n, uSun), 0.);
          vec3 plaster = vec3(.97, .965, .955) * (.66 + .36 * lam) * (.9 + .1 * (.5 + .5 * n.y));
          plaster = mix(plaster, vec3(.8, .84, .91), (1. - lam) * .45);
          plaster *= .96 + .06 * fbm(vW.xz * .09);
          float band = pow(1. - smoothstep(0., 260., sd), 1.6);
          vec2 v = vor(vW.xz / 58. + fbm(vW.xz * .012) * 1.6);
          float crack = (1. - smoothstep(0., .03 + .05 * band, v.y)) * band * step(0., sd);
          float rim = (1. - smoothstep(0., 8., abs(sd - 3.))) * .5;
          float runCrack = (1. - smoothstep(0., .05, v.y)) * inRun;
          float runLine = 1. - smoothstep(0., max(4., fwidth(trF) * 2.2), abs(trF));
          vec3 c = mix(plaster, vec3(1., .72, .28) * 1.5, clamp(crack * 1.2 + rim + runCrack * .9, 0., 1.));
          c = mix(c, vec3(1., .74, .3) * 2.4, runLine);
          // the edge of the served world: a gold rule where the neighbourhoods end
          float cdF = canalD(vW.xz);
          if (cdF < ${(CANAL + COPE).toFixed(1)} + .2) discard;
          c = mix(c, vec3(1., .74, .32) * 1.3, (1. - smoothstep(${(CANAL + COPE).toFixed(1)} + .5, ${(CANAL + COPE).toFixed(1)} + 5., cdF)) * .6);
          float edge = 1. - smoothstep(.35, .55, sv);
          c = mix(c, vec3(1., .74, .32) * 1.2, edge * .8);
          gl_FragColor = vec4(c, smoothstep(.35, .45, sv));
          #include <fog_fragment>
        }`,
    });
    fogMesh = new THREE.Mesh(g, m);
    fogMesh.renderOrder = 2;
    scene.add(fogMesh);
  }

  // ----------------------------------------------------------------- canals: sunken water between stone walls
  const WATER_DROP = 3.2;    // water surface below the street
  const COPE_H = 0.5;        // coping stands this far above the street
  function smoothGroundAlong(pts: [number, number][]) {
    const g = pts.map(p => ground(p[0], p[1]));
    const out = g.slice();
    for (let i = 0; i < g.length; i++) {
      let s = 0, n = 0;
      for (let k = -6; k <= 6; k++) { const j = i + k; if (j >= 0 && j < g.length) { s += g[j]; n++; } }
      out[i] = s / n;
    }
    return out;
  }
  function resample(path: [number, number][], step: number) {
    const out: [number, number][] = [path[0]];
    for (let q = 0; q < path.length - 1; q++) {
      const a = path[q], c = path[q + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]), n = Math.max(1, Math.ceil(L / step));
      for (let k = 1; k <= n; k++) out.push([a[0] + (c[0] - a[0]) * k / n, a[1] + (c[1] - a[1]) * k / n]);
    }
    return out;
  }
  function stoneShader(kind: "wall" | "cope" | "bridge") {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogChunk }, fog: true,
      vertexShader: /* glsl */ `
        attribute vec2 aUV; varying vec2 vUV; varying vec3 vN; varying vec3 vW;
        ${FOG_V}
        void main() { vUV = aUV; vN = normal; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `
        varying vec2 vUV; varying vec3 vN; varying vec3 vW;
        ${FOG_F}
        void main() {
          if (served(vW.xz) < .5) discard;
          ${kind === "wall" ? `if (canalD(vW.xz) < ${CANAL}. - 3.) discard;` : kind === "cope" ? `if (canalD(vW.xz) < ${CANAL}. - 1.5) discard;` : ""}
          vec3 n = normalize(vN);
          float lam = max(dot(n, uSun), 0.);
          float sky = .5 + .5 * n.y;
          float fogged = smoothstep(${glf(CANAL + COPE + 30)}, ${glf(CANAL + COPE + 70)}, sdMask(vW.xz));
          vec3 stone = vec3(.74, .7, .64);
          ${kind === "wall" ? `
          // coursed stone: rows every 0.55 m, joints offset row to row, darker and wet near the water
          float row = floor(vUV.y / .55);
          vec2 cell = vec2(fract((vUV.x + row * .9) / 1.6), fract(vUV.y / .55));
          float fade = 1. - smoothstep(.02, .12, fwidth(vUV.x) / 1.6);
          float joint = (step(cell.x, .04) + step(cell.y, .08)) * fade;
          stone *= (.86 + .14 * h21(vec2(floor((vUV.x + row * .9) / 1.6), row))) * (1. - .35 * min(joint, 1.));
          stone *= mix(.55, 1., smoothstep(.0, 1.1, vUV.y));
          stone = mix(stone, vec3(.18, .26, .26), (1. - smoothstep(.05, .45, vUV.y)) * .7);` : kind === "cope" ? `
          float slab = step(fract(vUV.x / 2.4), .03);
          stone = vec3(.7, .66, .6) * (1. - .25 * slab) * (.92 + .08 * h21(vec2(floor(vUV.x / 2.4), 3.)));` : `
          float course = step(fract(vUV.y / .5), .07) + step(fract(vUV.x / 1.3 + floor(vUV.y / .5) * .5), .04);
          stone = vec3(.66, .62, .57) * (1. - .22 * min(course, 1.));`}
          vec3 lit = stone * (.42 + .6 * lam) * (.85 + .15 * sky);
          lit = mix(lit, lit * vec3(.72, .78, .95), .35);            // dusk
          vec3 plaster = vec3(.93, .93, .92) * (.8 + .22 * lam);
          gl_FragColor = vec4(mix(lit, plaster, fogged), 1.);
          #include <fog_fragment>
        }`,
    });
  }
  function buildCanals() {
    const wp: number[] = [], wa: number[] = [], wi: number[] = [];           // water
    const sp: number[] = [], sn: number[] = [], su: number[] = [], si: number[] = [];   // walls
    const cp: number[] = [], cn: number[] = [], cu: number[] = [], ci: number[] = [];   // coping
    // per-vertex normals, so a curving wall shades smoothly instead of in facets
    const quad = (P: number[], N: number[], U: number[], I: number[], v: number[][], n: number[] | number[][], uv: number[][]) => {
      const b = P.length / 3;
      for (let k = 0; k < 4; k++) { P.push(...v[k]); N.push(...(Array.isArray(n[0]) ? (n as number[][])[k] : (n as number[]))); U.push(...uv[k]); }
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    const smooth1 = (arr: number[], r: number) => arr.map((_, i) => { let s0 = 0, n0 = 0; for (let k = -r; k <= r; k++) { const j = i + k; if (j >= 0 && j < arr.length) { s0 += arr[j]; n0++; } } return s0 / n0; });
    CANALS.forEach((raw, ci_) => {
      const pts = resample(raw, 5);
      // ground on each bank, just outside the coping
      const bank = (q: number, side: number) => {
        const p = pts[q], nx_ = pts[Math.min(q + 1, pts.length - 1)], pv = pts[Math.max(q - 1, 0)];
        let dx = nx_[0] - pv[0], dz = nx_[1] - pv[1];
        const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        let hmax = -1e9;
        for (const r of [CANAL - 2, CANAL + 1, CANAL + COPE + 1.5]) hmax = Math.max(hmax, ground(p[0] - dz * side * r, p[1] + dx * side * r));
        return hmax;
      };
      const gl = smooth1(pts.map((_, q) => bank(q, 1)), 3), gr = smooth1(pts.map((_, q) => bank(q, -1)), 3);
      const nrm = pts.map((_, q) => {
        const nx_ = pts[Math.min(q + 1, pts.length - 1)], pv = pts[Math.max(q - 1, 0)];
        const dx = nx_[0] - pv[0], dz = nx_[1] - pv[1], L = Math.hypot(dx, dz) || 1;
        return [-dz / L, dx / L];
      });
      const lowBank = pts.map((_, q) => Math.min(gl[q], gr[q]));
      const g = lowBank.map((_, i) => { let s0 = 0, n0 = 0; for (let k = -6; k <= 6; k++) { const j = i + k; if (j >= 0 && j < lowBank.length) { s0 += lowBank[j]; n0++; } } return s0 / n0; });
      let along = 0;
      const eps = (ci_ % 7) * 0.012;
      for (let q = 0; q < pts.length; q++) {
        const p = pts[q], nx_ = pts[Math.min(q + 1, pts.length - 1)], pv = pts[Math.max(q - 1, 0)];
        let dx = nx_[0] - pv[0], dz = nx_[1] - pv[1];
        const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        const ox = -dz, oz = dx;   // left normal
        if (q) along += Math.hypot(p[0] - pts[q - 1][0], p[1] - pts[q - 1][1]);
        const yw = g[q] - WATER_DROP + eps;
        const W_ = CANAL + 0.4;
        wp.push(p[0] + ox * W_, yw, p[1] + oz * W_, p[0] - ox * W_, yw, p[1] - oz * W_);
        wa.push(along, -1, along, 1);
        if (q) { const b = wp.length / 3 - 4; wi.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
        if (!q) continue;
        const p0 = pts[q - 1], a0 = along - Math.hypot(p[0] - p0[0], p[1] - p0[1]);
        const [n0x, n0z] = nrm[q - 1], [n1x, n1z] = nrm[q];
        for (const side of [-1, 1]) {
          const sideG = side > 0 ? gl : gr;
          const y0 = sideG[q - 1], y1 = sideG[q];
          const at = (pp: [number, number], nx0: number, nz0: number, r: number) => [pp[0] + nx0 * side * r, pp[1] + nz0 * side * r];
          const [e0x, e0z] = at(p0, n0x, n0z, CANAL), [e1x, e1z] = at(p, n1x, n1z, CANAL);
          const top0 = y0 + COPE_H, top1 = y1 + COPE_H, bot0 = g[q - 1] - WATER_DROP - 0.4, bot1 = g[q] - WATER_DROP - 0.4;
          const in0 = [-n0x * side, 0, -n0z * side], in1 = [-n1x * side, 0, -n1z * side];   // the wall faces the water
          const h0 = top0 - bot0, h1 = top1 - bot1;
          const v = side > 0
            ? [[e0x, bot0, e0z], [e1x, bot1, e1z], [e1x, top1, e1z], [e0x, top0, e0z]]
            : [[e1x, bot1, e1z], [e0x, bot0, e0z], [e0x, top0, e0z], [e1x, top1, e1z]];
          const nv = side > 0 ? [in0, in1, in1, in0] : [in1, in0, in0, in1];
          const uv = side > 0 ? [[a0, 0], [along, 0], [along, h1], [a0, h0]] : [[along, 0], [a0, 0], [a0, h0], [along, h1]];
          quad(sp, sn, su, si, v, nv, uv);
          // the promenade: a flat slab on top, and its outer face down past the street
          const [o0x, o0z] = at(p0, n0x, n0z, CANAL + COPE), [o1x, o1z] = at(p, n1x, n1z, CANAL + COPE);
          const vt = side > 0 ? [[e0x, top0, e0z], [e1x, top1, e1z], [o1x, top1, o1z], [o0x, top0, o0z]] : [[e1x, top1, e1z], [e0x, top0, e0z], [o0x, top0, o0z], [o1x, top1, o1z]];
          quad(cp, cn, cu, ci, vt, [0, 1, 0], [[a0, 0], [along, 0], [along, 1], [a0, 1]]);
          const f0 = Math.min(y0, ground(o0x, o0z)) - 1.2, f1 = Math.min(y1, ground(o1x, o1z)) - 1.2;
          const vo = side > 0 ? [[o0x, top0, o0z], [o1x, top1, o1z], [o1x, f1, o1z], [o0x, f0, o0z]] : [[o1x, top1, o1z], [o0x, top0, o0z], [o0x, f0, o0z], [o1x, f1, o1z]];
          const out0 = [n0x * side, 0, n0z * side], out1 = [n1x * side, 0, n1z * side];
          quad(cp, cn, cu, ci, vo, side > 0 ? [out0, out1, out1, out0] : [out1, out0, out0, out1], [[a0, 0], [along, 0], [along, 1], [a0, 1]]);
        }
      }
    });
    // water
    const wg = new THREE.BufferGeometry();
    wg.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3));
    wg.setAttribute("aWater", new THREE.Float32BufferAttribute(wa, 2));
    wg.setIndex(wi);
    const water = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogChunk }, fog: true,
      vertexShader: /* glsl */ `
        attribute vec2 aWater; varying vec2 vWater; varying vec3 vW;
        ${FOG_V}
        void main() { vWater = aWater; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `
        varying vec2 vWater; varying vec3 vW;
        vec2 vorW(vec2 p) {
          vec2 n = floor(p), f = fract(p); float d1 = 8., d2 = 8.;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(i, j); vec2 o = .5 + .45 * sin(vec2(h21(n + g), h21(n + g + 17.3)) * 6.2831);
            float d = length(g + o - f); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
          return vec2(d1, d2 - d1);
        }
        ${FOG_F}
        void main() {
          if (served(vW.xz) < .5) discard;
          float t = uTime;
          vec2 p = vW.xz;
          // small wind ripples: two drifting noise layers give the surface normal
          float e = .6;
          float h0 = fbm(p * .16 + vec2(t * .09, t * .05)) + .5 * fbm(p * .45 - vec2(t * .12, -t * .08));
          float hx = fbm((p + vec2(e, 0.)) * .16 + vec2(t * .09, t * .05)) + .5 * fbm((p + vec2(e, 0.)) * .45 - vec2(t * .12, -t * .08));
          float hz = fbm((p + vec2(0., e)) * .16 + vec2(t * .09, t * .05)) + .5 * fbm((p + vec2(0., e)) * .45 - vec2(t * .12, -t * .08));
          vec3 n = normalize(vec3((h0 - hx) * 1.6, 1., (h0 - hz) * 1.6));
          vec3 V = normalize(cameraPosition - vW);
          float across = abs(vWater.y);
          // lit from below like an L.A. pool at night: bright aqua, turquoise at the shallows
          vec3 deep = vec3(.02, .26, .4), shallow = vec3(.1, .56, .64);
          vec3 base = mix(deep, shallow, smoothstep(.25, 1., across));
          float fres = pow(1. - max(dot(n, V), 0.), 4.);
          vec3 c = mix(base, vec3(.7, .86, .95), .08 + .45 * fres);
          // caustics: the bright net of light a pool throws on its own floor
          vec2 cp = p / 9. + n.xz * 1.4;
          vec2 v1 = vorW(cp + vec2(t * .25, t * .18)), v2 = vorW(cp * 1.7 - vec2(t * .2, -t * .3));
          float caus = (1. - smoothstep(0., .09, v1.y)) * .6 + (1. - smoothstep(0., .07, v2.y)) * .4;
          c += vec3(.45, .95, 1.) * caus * .26;
          // sun and lamp glints, and twinkling sparkle on the ripples
          vec3 R = reflect(-uSun, n);
          c += vec3(1., .92, .75) * pow(max(dot(R, V), 0.), 140.) * 2.2;
          float tw = step(.997, h21(floor(p * 1.1) + floor(t * 3.))) * smoothstep(.75, .95, h0);
          c += vec3(1.) * tw * 1.3;
          // lighter lip and white lace where the water meets the walls
          float edge = smoothstep(.84, .98, across);
          c = mix(c, vec3(.55, .92, .95), edge * .45);
          float foam = smoothstep(.93, .985, across) * smoothstep(.4, .7, fbm(p * .7 + vec2(t * .35, 0.)));
          c = mix(c, vec3(.95, 1., 1.), foam * .7);
          float fogged = smoothstep(${glf(CANAL + COPE + 30)}, ${glf(CANAL + COPE + 70)}, sdMask(vW.xz));
          c = mix(c, mix(vec3(.62, .76, .8), vec3(.86, .9, .92), fres), fogged * .75);
          gl_FragColor = vec4(c, 1.);
          #include <fog_fragment>
        }`,
    });
    water.side = THREE.DoubleSide;
    scene.add(new THREE.Mesh(wg, water));
    const walls = new THREE.BufferGeometry();
    walls.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    walls.setAttribute("normal", new THREE.Float32BufferAttribute(sn, 3));
    walls.setAttribute("aUV", new THREE.Float32BufferAttribute(su, 2));
    walls.setIndex(si);
    const wm = new THREE.Mesh(walls, stoneShader("wall"));
    wm.material.side = THREE.DoubleSide;
    scene.add(wm);
    const cope = new THREE.BufferGeometry();
    cope.setAttribute("position", new THREE.Float32BufferAttribute(cp, 3));
    cope.setAttribute("normal", new THREE.Float32BufferAttribute(cn, 3));
    cope.setAttribute("aUV", new THREE.Float32BufferAttribute(cu, 2));
    cope.setIndex(ci);
    const cm = new THREE.Mesh(cope, stoneShader("cope"));
    cm.material.side = THREE.DoubleSide;
    scene.add(cm);
    buildBoats();
  }

  // arched stone bridges where streets cross the canals
  const bridgeMat = () => { const m = stoneShader("bridge"); m.side = THREE.DoubleSide; return m; };
  let BRIDGE_MAT: THREE.ShaderMaterial | null = null;
  const bridgesAt: [number, number][] = [];
  function buildBridges(data: TileData, ox: number, oz: number) {
    BRIDGE_MAT ??= bridgeMat();
    const W: Record<string, number> = { motorway: 20, trunk: 16, primary: 15, secondary: 12, tertiary: 10, residential: 7, unclassified: 7, living_street: 6 };
    const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = [];
    const box = (corners: number[][], n: number[], uv: number[][]) => {
      const b = P.length / 3;
      for (let k = 0; k < 4; k++) { P.push(...corners[k]); N.push(...n); U.push(...uv[k]); }
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    for (const [k, , flat] of data.r) {
      const hw = (W[k] || 6) / 2 + 1.2;
      const raw: [number, number][] = [];
      for (let q = 0; q < flat.length; q += 2) raw.push([ox + flat[q] / 10, oz + flat[q + 1] / 10]);
      const pts = resample(raw, 1.5);
      let inside = -1;
      for (let q = 0; q <= pts.length; q++) {
        const wet = q < pts.length && canalAt(pts[q][0], pts[q][1]) < CANAL + COPE;
        if (wet && inside < 0) inside = q;
        if (!wet && inside >= 0) {
          const a = pts[Math.max(0, inside - 2)], c = pts[Math.min(pts.length - 1, q + 1)];
          inside = -1;
          const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
          if (bridgesAt.some(b => Math.hypot(b[0] - mx, b[1] - mz) < 14) || sdField(mx, mz) > CANAL + COPE + 40) continue;
          bridgesAt.push([mx, mz]);
          let dx = c[0] - a[0], dz = c[1] - a[1];
          const L = Math.hypot(dx, dz);
          if (L < 6 || L > 190) continue;
          dx /= L; dz /= L;
          const sx = -dz, sz = dx;
          const n = 24, ya = ground(a[0], a[1]) + 0.9, yc = ground(c[0], c[1]) + 0.9, rise = Math.min(4.5, L * 0.05);
          const arches = Math.max(1, Math.round(L / 26));
          const at = (u: number) => [a[0] + dx * L * u, ya + (yc - ya) * u + rise * Math.sin(Math.PI * u), a[1] + dz * L * u] as const;
          for (let i = 0; i < n; i++) {
            const u0 = i / n, u1 = (i + 1) / n, [x0, y0, z0] = at(u0), [x1, y1, z1] = at(u1);
            // deck
            box([[x0 - sx * hw, y0, z0 - sz * hw], [x0 + sx * hw, y0, z0 + sz * hw], [x1 + sx * hw, y1, z1 + sz * hw], [x1 - sx * hw, y1, z1 - sz * hw]], [0, 1, 0],
              [[u0 * L, 0], [u0 * L, hw * 2], [u1 * L, hw * 2], [u1 * L, 0]]);
            // parapets, and the arched fascia below each edge down to the water
            for (const side of [-1, 1]) {
              const ex0 = x0 + sx * hw * side, ez0 = z0 + sz * hw * side, ex1 = x1 + sx * hw * side, ez1 = z1 + sz * hw * side;
              const outN = [sx * side, 0, sz * side];
              box([[ex0, y0, ez0], [ex1, y1, ez1], [ex1, y1 + 1.1, ez1], [ex0, y0 + 1.1, ez0]], outN, [[u0 * L, 0], [u1 * L, 0], [u1 * L, 1.1], [u0 * L, 1.1]]);
              box([[ex0 - sx * side * .45, y0 + 1.1, ez0 - sz * side * .45], [ex1 - sx * side * .45, y1 + 1.1, ez1 - sz * side * .45], [ex1, y1 + 1.1, ez1], [ex0, y0 + 1.1, ez0]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
              const arch0 = y0 - 0.9 - (1 - Math.sin(Math.PI * u0)) * 0.0, arch1 = y1 - 0.9;
              const floor0 = ground(ex0, ez0) - WATER_DROP, floor1 = ground(ex1, ez1) - WATER_DROP;
              const hole0 = Math.abs(Math.sin(Math.PI * u0 * arches)), hole1 = Math.abs(Math.sin(Math.PI * u1 * arches));
              // the fascia follows the arch: full height at the abutments, a thin band over the span
              const b0 = arch0 - (arch0 - floor0) * (1 - Math.pow(hole0, 0.35)), b1 = arch1 - (arch1 - floor1) * (1 - Math.pow(hole1, 0.35));
              box([[ex0, b0, ez0], [ex1, b1, ez1], [ex1, y1, ez1], [ex0, y0, ez0]], outN, [[u0 * L, 0], [u1 * L, 0], [u1 * L, y1 - b1], [u0 * L, y0 - b0]]);
            }
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute("aUV", new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    return new THREE.Mesh(g, BRIDGE_MAT);
  }

  // moored boats along the canal walls, rocking a little
  function buildBoats() {
    const hull = (() => {
      const sh = new THREE.Shape();
      sh.moveTo(0, -3.4); sh.quadraticCurveTo(1.25, -1.6, 1.15, 1.6); sh.lineTo(0.9, 3); sh.lineTo(-0.9, 3); sh.lineTo(-1.15, 1.6); sh.quadraticCurveTo(-1.25, -1.6, 0, -3.4);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 2 });
      g.rotateX(-Math.PI / 2);
      return g;
    })();
    const cabin = new THREE.BoxGeometry(1.5, 0.8, 1.9).translate(0, 1.25, 0.6);
    const spots: { x: number; z: number; yaw: number; y: number; r: number }[] = [];
    let seed = 77;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const raw of CANALS) {
      const pts = resample(raw, 30);
      for (let q = 1; q < pts.length - 1; q++) {
        if (rnd() > 0.6) continue;
        const a = pts[q - 1], c = pts[q + 1];
        const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz) || 1;
        const side = rnd() < 0.5 ? -1 : 1;
        const x = pts[q][0] - (dz / L) * side * (CANAL - 4.5), z = pts[q][1] + (dx / L) * side * (CANAL - 4.5);
        spots.push({ x, z, yaw: Math.atan2(dx, dz), y: ground(pts[q][0], pts[q][1]) - WATER_DROP, r: rnd() });
      }
    }
    const mat = (cabinPart: boolean) => new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogChunk }, fog: true,
      vertexShader: /* glsl */ `
        uniform float uTime; varying vec3 vN; varying vec3 vW; varying float vSeed;
        ${FOG_V}
        void main() {
          vSeed = fract(instanceMatrix[3].x * .137 + instanceMatrix[3].z * .311);
          vN = normalize(mat3(instanceMatrix) * normal);
          vec3 p = position;
          float rock = sin(uTime * 1.3 + vSeed * 20.) * .05;
          p.y += p.x * rock + sin(uTime * .9 + vSeed * 9.) * .06;
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.); vW = w.xyz;
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `
        varying vec3 vN; varying vec3 vW; varying float vSeed;
        ${FOG_F}
        void main() {
          if (sdMask(vW.xz) > ${glf(CANAL + COPE + 40)} && terrMask(vW.xz) > 0.) discard;
          vec3 n = normalize(vN); float lam = max(dot(n, uSun), 0.);
          vec3 paint = vSeed < .25 ? vec3(.92, .9, .86) : vSeed < .5 ? vec3(.95, .45, .35) : vSeed < .75 ? vec3(.98, .8, .3) : vec3(.2, .55, .6);
          ${cabinPart ? "paint = vec3(.8, .78, .74);" : "paint = mix(paint, vec3(.08, .1, .12), step(vW.y, " + "0.) * 0.);"}
          vec3 c = paint * (.45 + .62 * lam);
          c = mix(c, c * vec3(.72, .78, .95), .35);
          gl_FragColor = vec4(c, 1.);
          #include <fog_fragment>
        }`,
    });
    const hm = new THREE.InstancedMesh(hull, mat(false), spots.length);
    const cm = new THREE.InstancedMesh(cabin, mat(true), spots.length);
    const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), One = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
    spots.forEach((s, i) => {
      Q.setFromAxisAngle(UP, s.yaw);
      V.set(s.x, s.y - 0.35, s.z);
      hm.setMatrixAt(i, M4.compose(V, Q, One));
      cm.setMatrixAt(i, s.r < 0.55 ? M4.compose(V, Q, One) : M4.makeScale(0, 0, 0));
    });
    for (const m of [hm, cm]) { m.computeBoundingSphere(); scene.add(m); }
    for (const raw of CANALS) { const bp = mkPath(resample(raw, 10)); if (bp) boatPaths.push(bp); }
    if (boatPaths.length) {
      movingBoats = new THREE.InstancedMesh(hull, mat(false), BOATS);
      movingBoats.frustumCulled = false;
      for (let i = 0; i < BOATS; i++) {
        const bp = boatPaths[Math.floor(lifeRnd() * boatPaths.length)];
        boatState.push({ p: bp, s: lifeRnd() * bp.len, v: 2.5 + lifeRnd() * 3, dir: lifeRnd() < 0.5 ? 1 : -1 });
      }
      scene.add(movingBoats);
    }
  }

  // ----------------------------------------------------------------- life: traffic on the real streets, boats on the canals
  type Path = { pts: [number, number][]; cum: number[]; len: number };
  const roadPaths: Path[] = [];
  function mkPath(pts: [number, number][]): Path | null {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = cum[cum.length - 1];
    return len > 40 ? { pts, cum, len } : null;
  }
  function along(p: Path, s: number, off: number, out: { x: number; z: number; yaw: number }) {
    let i = 1;
    while (i < p.cum.length - 1 && p.cum[i] < s) i++;
    const a = p.pts[i - 1], b = p.pts[i], L = p.cum[i] - p.cum[i - 1] || 1, u = Math.max(0, Math.min(1, (s - p.cum[i - 1]) / L));
    const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
    out.x = a[0] + (b[0] - a[0]) * u - dz * off;
    out.z = a[1] + (b[1] - a[1]) * u + dx * off;
    out.yaw = Math.atan2(dx, dz);
  }
  const CARS = 1600;
  const carGeo = new THREE.BoxGeometry(1.9, 1.35, 4.4).translate(0, 0.9, 0);
  const carMat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, ...fogChunk }, fog: true,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW; varying vec3 vL; varying float vSeed;
      ${FOG_V}
      void main() { vL = position; vSeed = fract(instanceMatrix[3].x * .173 + instanceMatrix[3].z * .291);
        vN = normalize(mat3(instanceMatrix) * normal);
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.); vW = w.xyz;
        vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: COMMON + /* glsl */ `
      varying vec3 vN; varying vec3 vW; varying vec3 vL; varying float vSeed;
      ${FOG_F}
      void main() {
        if (sdMask(vW.xz) > 20. && terrMask(vW.xz) > 0.) discard;
        vec3 n = normalize(vN); float lam = max(dot(n, uSun), 0.);
        vec3 paint = vSeed < .3 ? vec3(.92, .92, .9) : vSeed < .5 ? vec3(.08, .08, .09) : vSeed < .7 ? vec3(.62, .64, .66) : vSeed < .82 ? vec3(.2, .3, .55) : vSeed < .92 ? vec3(.6, .1, .1) : vec3(.35, .36, .38);
        vec3 c = paint * (.35 + .6 * lam + .25 * max(n.y, 0.));
        if (vL.y > 1.2 && abs(n.y) < .5) c = vec3(.08, .1, .14);                      // glass
        if (vL.z > 2.15) c = mix(c, vec3(1., .95, .8) * 3., step(.45, abs(vL.x)) * step(vL.y, 1.1));   // headlights
        if (vL.z < -2.15) c = mix(c, vec3(1., .1, .06) * 2.2, step(.5, abs(vL.x)) * step(vL.y, 1.1));  // tail lights
        gl_FragColor = vec4(c, 1.);
        #include <fog_fragment>
      }`,
  });
  const cars = new THREE.InstancedMesh(carGeo, carMat, CARS);
  cars.frustumCulled = false;
  cars.count = 0;
  scene.add(cars);
  const carState: { p: Path; s: number; v: number; dir: number }[] = [];
  const boatPaths: Path[] = [];
  const BOATS = 70;
  let movingBoats: THREE.InstancedMesh | null = null;
  const boatState: { p: Path; s: number; v: number; dir: number }[] = [];
  let lifeSeed = 3;
  const lifeRnd = () => (lifeSeed = (lifeSeed * 16807) % 2147483647) / 2147483647;
  function respawnCar(c: { p: Path; s: number; v: number; dir: number }) {
    const tg = controls.target;
    // prefer streets near where you are looking
    for (let tries = 0; tries < 8; tries++) {
      const p = roadPaths[Math.floor(lifeRnd() * roadPaths.length)];
      const m = p.pts[Math.floor(p.pts.length / 2)];
      const reach = Math.min(2400, Math.max(500, camera.position.distanceTo(tg) * 0.9));
      if (tries < 7 && Math.hypot(m[0] - tg.x, m[1] - tg.z) > reach) continue;
      c.p = p; c.s = lifeRnd() * p.len; c.v = 9 + lifeRnd() * 7; c.dir = lifeRnd() < 0.5 ? 1 : -1;
      return;
    }
  }
  const M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), V4 = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), UPV = new THREE.Vector3(0, 1, 0);
  const tmp = { x: 0, z: 0, yaw: 0 };
  function updateLife(dt: number, cd: number) {
    const show = cd < 5200 && roadPaths.length > 0;
    cars.visible = show;
    if (show) {
      while (carState.length < CARS) { const c = { p: roadPaths[0], s: 0, v: 10, dir: 1 }; respawnCar(c); carState.push(c); }
      cars.count = CARS;
      carState.forEach((c, i) => {
        c.s += c.v * dt * c.dir;
        if (c.s < 0 || c.s > c.p.len) respawnCar(c);
        along(c.p, c.s, 2.6 * c.dir, tmp);
        V4.set(tmp.x, ground(tmp.x, tmp.z) + 0.9, tmp.z);
        Q4.setFromAxisAngle(UPV, tmp.yaw + (c.dir < 0 ? Math.PI : 0));
        cars.setMatrixAt(i, M4.compose(V4, Q4, ONE));
      });
      cars.instanceMatrix.needsUpdate = true;
    }
    if (movingBoats) {
      boatState.forEach((b, i) => {
        b.s += b.v * dt * b.dir;
        if (b.s < 0 || b.s > b.p.len) b.dir *= -1;
        along(b.p, b.s, 9 * b.dir, tmp);
        V4.set(tmp.x, ground(tmp.x, tmp.z) - WATER_DROP - 0.35, tmp.z);
        Q4.setFromAxisAngle(UPV, tmp.yaw + (b.dir < 0 ? Math.PI : 0));
        movingBoats!.setMatrixAt(i, M4.compose(V4, Q4, ONE));
      });
      movingBoats.instanceMatrix.needsUpdate = true;
    }
  }

  // ----------------------------------------------------------------- kit
  const kitGeo: THREE.BufferGeometry[] = [];
  const atlasTex: THREE.Texture[] = [];
  const byCls: Record<string, number[]> = { house: [], mid: [], brick: [] };
  function buildKitGeometry() {
    const bin = Uint8Array.from(atob(KIT.blob), ch => ch.charCodeAt(0)).buffer;
    const TA: Record<string, any> = { float32: Float32Array, int8: Int8Array, uint16: Uint16Array, uint32: Uint32Array };
    const view = (spec: [number, string], n: number) => new TA[spec[1]](bin, spec[0], n);
    KIT.models.forEach((m, k) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(view(m.p, m.nv * 3), 3));
      g.setAttribute("normal", new THREE.BufferAttribute(view(m.n, m.nv * 3), 3, true));
      g.setAttribute("uv", new THREE.BufferAttribute(view(m.uv, m.nv * 2), 2));
      g.setIndex(new THREE.BufferAttribute(view(m.i, m.ni), 1));
      kitGeo.push(g);
      byCls[m.cls].push(k);
    });
    for (const src of KIT.atlases) {
      const t = new THREE.TextureLoader().load(src);
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false;
      atlasTex.push(t);
    }
  }
  function obb(pts: [number, number][]) {
    let best: any = null;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(ang), s = Math.sin(ang);
      let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
      for (const p of pts) { const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const A = (u1 - u0) * (v1 - v0);
      if (!best || A < best.A) best = { A, c, s, U: u1 - u0, V: v1 - v0, cu: (u0 + u1) / 2, cv: (v0 + v1) / 2 };
    }
    best.x = best.cu * best.c - best.cv * best.s;
    best.z = best.cu * best.s + best.cv * best.c;
    return best as { A: number; c: number; s: number; U: number; V: number; x: number; z: number };
  }
  function kitClass(b: Bldg, area: number) {
    const t = TYPES[b.t] ?? "other";
    if (t === "house" || t === "garage" || (b.u <= 2 && b.h < 9)) return "house";
    if (t === "apartments" || t === "residential") return hash2(b.i, 91) < 0.55 && area < 900 && b.h < 26 ? "brick" : "mid";
    return "mid";
  }
  function placeKit(b: Bldg, road: (x: number, z: number) => [number, number] | null) {
    const o = obb(b.p), area = o.U * o.V, cls = kitClass(b, area);
    const rd = road(o.x, o.z) ?? [o.x + 1, o.z];
    let vx = rd[0] - o.x, vz = rd[1] - o.z;
    const vl = Math.hypot(vx, vz) || 1;
    vx /= vl; vz /= vl;
    const axes: [number, number, string][] = [[o.c, o.s, "u"], [-o.c, -o.s, "u"], [-o.s, o.c, "v"], [o.s, -o.c, "v"]];
    let f = axes[0], fd = -2;
    for (const a of axes) { const d = a[0] * vx + a[1] * vz; if (d > fd) { fd = d; f = a; } }
    const depth = f[2] === "u" ? o.U : o.V, width = f[2] === "u" ? o.V : o.U;
    const H = b.h * (cls === "house" ? 1.75 : 1.6);
    const cand = byCls[cls].map(k => {
      const sz = KIT.models[k].size;
      return [Math.abs(Math.log((width / depth) / (sz[0] / sz[2]))) + 0.5 * Math.abs(Math.log((H / width) / (sz[1] / sz[0]))), k];
    }).sort((a, c) => a[0] - c[0]);
    const k = cand[Math.floor(hash2(b.i, 7) * Math.min(3, cand.length))][1];
    const sz = KIT.models[k].size;
    const m4 = new THREE.Matrix4().compose(new THREE.Vector3(o.x, ground(o.x, o.z) - 0.3, o.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(f[0], f[1])),
      new THREE.Vector3(Math.max(width * 0.94, 2) / sz[0], H / sz[1], Math.max(depth * 0.94, 2) / sz[2]));
    return { k, m4, cx: b.cx, cz: b.cz };
  }
  function kitMaterial(atlas: number, isLantern: boolean) {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogChunk, uAtlas: { value: atlasTex[atlas] }, uLit: { value: 1 } }, fog: true,
      vertexShader: /* glsl */ `
        attribute vec2 aCen; attribute float aSeed;
        varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec2 vCen; varying float vSeed; varying float vBase;
        ${FOG_V}
        void main() { vUv = uv; vCen = aCen; vSeed = aSeed; vBase = instanceMatrix[3].y;
          vN = normalize(transpose(inverse(mat3(instanceMatrix))) * normal);
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.); vW = w.xyz;
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `
        uniform sampler2D uAtlas; uniform float uLit;
        varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying vec2 vCen; varying float vSeed; varying float vBase;
        ${FOG_F}
        void main() {
          vec3 c = texture2D(uAtlas, vUv).rgb;
          float L = dot(c, vec3(.2126, .7152, .0722));
          float win = smoothstep(.03, .12, c.b - max(c.r, c.g));
          vec3 n = normalize(vN);
          float lam = max(dot(n, uSun), 0.);
          float sd = sdMask(vCen);
          ${isLantern ? /* glsl */ `
          vec3 facade = mix(vec3(1., .5, .14), vec3(1., .76, .38), smoothstep(.1, .7, L)) * (.55 + .7 * lam) * 1.45;
          float flick = .9 + .1 * sin(uTime * 2. + vSeed * 40.);
          float wall = 1. - smoothstep(.3, .6, abs(n.y));
          vec3 tng = normalize(cross(n, vec3(0., 1., 0.)) + 1e-4);
          vec2 cell = vec2(fract(dot(vW, tng) / 2.9), fract((vW.y - vBase) / 3.2));
          float pw = wall * step(.24, cell.x) * step(cell.x, .76) * step(.28, cell.y) * step(cell.y, .78) * step(1.6, vW.y - vBase);
          vec3 col = facade + vec3(1., .86, .52) * max(pw, win) * 4.6 * flick * uLit;
          if (n.y > .6) col = mix(facade, vec3(1., .8, .42) * (1. + 1.1 * uLit), .7);
          col *= .35 + .65 * uLit;
          ` : /* glsl */ `
          vec3 tint = mix(vec3(${hexv(DUSK_BLDG)}), vec3(${hexv(DUSK_ROOF)}), step(.5, n.y));
          float hemi = .5 + .5 * n.y;
          vec3 amb = mix(vec3(.62, .58, .6), vec3(.78, .84, 1.), hemi);           // warm bounce below, cool sky above
          vec3 dusk = mix(tint * (.45 + .95 * L), c * .7, .22) * (amb * .62 + vec3(1., .86, .7) * .62 * lam) * (.9 + .2 * vSeed);
          float baseAO = mix(.5, 1., smoothstep(0., 6., vW.y - vBase));             // darker where walls meet the street
          dusk *= baseAO;
          vec3 V = normalize(cameraPosition - vW);
          dusk += vec3(.55, .62, .85) * pow(1. - max(dot(n, V), 0.), 3.) * .18;      // cool rim that separates the silhouettes
          dusk += (tint * .8 + .2) * lanternLight(vW, n) * .55;
          float wallK = 1. - smoothstep(.25, .5, abs(n.y));
          dusk = mix(dusk, dusk * .5, win * wallK);
          float lit = step(.6, win) * wallK * step(.975, h21(floor(vW.xz * .4) + floor(vW.y * .3) + vSeed * 13.));
          dusk += vec3(.95, .78, .5) * lit * .45;
          vec3 plaster = vec3(.93, .93, .92) * (.78 + .24 * lam);
          vec3 col = mix(dusk, plaster, smoothstep(-6., 10., sd));
          `}
          gl_FragColor = vec4(col, 1.);
          #include <fog_fragment>
        }`,
    });
  }
  function kitInstances(places: { k: number; m4: THREE.Matrix4; cx: number; cz: number }[], isLantern: boolean) {
    const group = new THREE.Group();
    const byModel = new Map<number, number[]>();
    places.forEach((pl, j) => { if (!byModel.has(pl.k)) byModel.set(pl.k, []); byModel.get(pl.k)!.push(j); });
    for (const [k, idx] of byModel) {
      const geo = kitGeo[k].clone();
      const cen = new Float32Array(idx.length * 2), seed = new Float32Array(idx.length);
      idx.forEach((j, q) => { cen[q * 2] = places[j].cx; cen[q * 2 + 1] = places[j].cz; seed[q] = hash2(q, k); });
      geo.setAttribute("aCen", new THREE.InstancedBufferAttribute(cen, 2));
      geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 1));
      const im = new THREE.InstancedMesh(geo, kitMaterial(KIT.models[k].atlas, isLantern), idx.length);
      idx.forEach((j, q) => im.setMatrixAt(q, places[j].m4));
      im.computeBoundingSphere();
      group.add(im);
    }
    return group;
  }
  function boxMesh(list: Bldg[]) {
    const pos: number[] = [], nrm: number[] = [], cen: number[] = [], idx: number[] = [];
    for (const b of list) {
      const base = ground(b.cx, b.cz), y0 = base - 8, y1 = base + b.h * 1.6;
      const ring = b.p;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length], dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz);
        if (L < 0.05) continue;
        const k = pos.length / 3;
        pos.push(a[0], y0, a[1], c[0], y0, c[1], c[0], y1, c[1], a[0], y1, a[1]);
        for (let q = 0; q < 4; q++) { nrm.push(dz / L, 0, -dx / L); cen.push(b.cx, b.cz); }
        idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      }
      const tris = THREE.ShapeUtils.triangulateShape(ring.map(p => new THREE.Vector2(p[0], p[1])), []);
      const k = pos.length / 3;
      for (const p of ring) { pos.push(p[0], y1, p[1]); nrm.push(0, 1, 0); cen.push(b.cx, b.cz); }
      for (const t of tris) idx.push(k + t[0], k + t[2], k + t[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute("aCen", new THREE.Float32BufferAttribute(cen, 2));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogChunk }, fog: true,
      vertexShader: /* glsl */ `
        attribute vec2 aCen; varying vec2 vCen; varying vec3 vN;
        ${FOG_V}
        void main() { vCen = aCen; vN = normal; vec4 w = modelMatrix * vec4(position, 1.);
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `
        varying vec2 vCen; varying vec3 vN;
        ${FOG_F}
        void main() {
          float sd = sdMask(vCen);
          vec3 n = normalize(vN); float lam = max(dot(n, uSun), 0.);
          vec3 dusk = mix(vec3(${hexv(DUSK_BLDG)}), vec3(${hexv(DUSK_ROOF)}), step(.5, n.y)) * (.5 + .62 * lam) * (.85 + .3 * h21(vCen * .013));
          vec3 plaster = vec3(.93, .93, .92) * (.78 + .24 * lam);
          gl_FragColor = vec4(mix(dusk, plaster, smoothstep(-6., 10., sd)), 1.);
          #include <fog_fragment>
        }`,
    });
    return new THREE.Mesh(g, m);
  }

  // ----------------------------------------------------------------- tiles (streamed where land is charted)
  type Tile = { key: string; state: "loading" | "ready"; bldgs: Bldg[]; idMin: number; idMax: number; roadPts: number[]; group: THREE.Group; kit: THREE.Group | null; box: THREE.Mesh | null; cx: number; cz: number };
  const tiles = new Map<string, Tile>();
  let bid = 0;
  function tileKeyAt(x: number, z: number) {
    return `${Math.floor((x - M.bounds[0]) / M.tile)}_${Math.floor((z - M.bounds[1]) / M.tile)}`;
  }
  function wantedTiles() {
    const want = new Set<string>();
    const have = new Set(M.tiles.map(t => `${t[0]}_${t[1]}`));
    for (const [ti, tj] of M.tiles) {
      const x0 = M.bounds[0] + ti * M.tile, z0 = M.bounds[1] + tj * M.tile;
      let lit = false;
      for (let a = 0; a <= 4 && !lit; a++) for (let b = 0; b <= 4 && !lit; b++) {
        if (sdField(x0 + (M.tile * a) / 4, z0 + (M.tile * b) / 4) < 160 || terrField(x0 + (M.tile * a) / 4, z0 + (M.tile * b) / 4) < 60) lit = true;
      }
      if (lit && have.has(`${ti}_${tj}`)) want.add(`${ti}_${tj}`);
    }
    return want;
  }
  async function loadTile(key: string) {
    const [ti, tj] = key.split("_").map(Number);
    const t: Tile = { key, state: "loading", bldgs: [], idMin: 0, idMax: -1, roadPts: [], group: new THREE.Group(), kit: null, box: null,
      cx: M.bounds[0] + (ti + 0.5) * M.tile, cz: M.bounds[1] + (tj + 0.5) * M.tile };
    tiles.set(key, t);
    const data: TileData = await fetch(`${WORLD_BASE}/world/tiles/${key}.json`).then(r => r.json());
    if (disposed) return;
    const [ox, oz] = data.o;
    t.idMin = bid;
    for (const rec of data.b) {
      const flat = rec[0], p: [number, number][] = [];
      let cx = 0, cz = 0;
      for (let k = 0; k < flat.length; k += 2) { const x = ox + flat[k] / 10, z = oz + flat[k + 1] / 10; p.push([x, z]); cx += x; cz += z; }
      cx /= p.length; cz /= p.length;
      t.bldgs.push({ i: bid++, p, cx, cz, h: rec[1] / 10, u: rec[2], t: rec[3], name: rec[4] });
    }
    t.idMax = bid - 1;
    for (const b of t.bldgs) if (nearLandmark(b.cx, b.cz)) hidden.add(b.i);
    // roads: ribbons, with soft cool street lamps
    const W: Record<string, number> = { motorway: 20, trunk: 16, primary: 15, secondary: 12, tertiary: 10, residential: 7, unclassified: 7, living_street: 6 };
    const pos: number[] = [], idx: number[] = [], along: number[] = [], across: number[] = [];
    for (const [k, , flat] of data.r) {
      const w = (W[k] || 6) / 2, pts: [number, number][] = [];
      const raw: [number, number][] = [];
      for (let q = 0; q < flat.length; q += 2) raw.push([ox + flat[q] / 10, oz + flat[q + 1] / 10]);
      for (let q = 0; q < raw.length - 1; q++) {
        const a = raw[q], c = raw[q + 1], n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 12));
        for (let s = 0; s < n; s++) pts.push([a[0] + (c[0] - a[0]) * s / n, a[1] + (c[1] - a[1]) * s / n]);
      }
      if (raw.length) pts.push(raw[raw.length - 1]);
      let s = 0;
      for (let q = 0; q < pts.length; q++) {
        const p = pts[q], nx_ = pts[Math.min(q + 1, pts.length - 1)], pv = pts[Math.max(q - 1, 0)];
        let dx = nx_[0] - pv[0], dz = nx_[1] - pv[1];
        const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        if (q) s += Math.hypot(p[0] - pts[q - 1][0], p[1] - pts[q - 1][1]);
        const y = ground(p[0], p[1]) + 0.9;
        pos.push(p[0] - dz * w, y, p[1] + dx * w, p[0] + dz * w, y, p[1] - dx * w);
        along.push(s, s);
        across.push(-1, 1);
        if (q) { const b = pos.length / 3 - 4; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
        if (q % 2 === 0) t.roadPts.push(p[0], p[1]);
      }
      if (k !== "motorway") { const rp = mkPath(pts); if (rp) roadPaths.push(rp); }
    }
    t.group.add(flatMesh(pos, idx, along, /* glsl */ `
      void main() { float sdR = sdMask(vW.xz); if (served(vW.xz) < .5 || (sdR > 30. && terrMask(vW.xz) > 0.)) discard;
        vec3 c = vec3(.36, .40, .5);
        float lamp = 1. - smoothstep(0., 2.2, abs(mod(vAlong, 38.) - 19.));
        c += vec3(.55, .6, .7) * lamp * .35;
        if (canalD(vW.xz) < ${(CANAL + COPE).toFixed(1)}) discard;
        c = mix(c, vec3(.8, .82, .86), smoothstep(0., 30., sdR));
        gl_FragColor = vec4(c, 1.);
        #include <fog_fragment>
      }`, true, across));
    t.group.add(buildBridges(data, ox, oz));
    t.state = "ready";
    scene.add(t.group);
    rebuildTile(t);
    applyLanterns();
  }
  function roadNear(t: Tile) {
    return (x: number, z: number): [number, number] | null => {
      let best: [number, number] | null = null, bd = 1e9;
      const arr = t.roadPts;
      for (let k = 0; k < arr.length; k += 2) { const d = (arr[k] - x) ** 2 + (arr[k + 1] - z) ** 2; if (d < bd) { bd = d; best = [arr[k], arr[k + 1]]; } }
      return best;
    };
  }
  function lanternBuildingIds() {
    return new Set(placedLanterns.filter(l => l.b).map(l => l.b!.i));
  }
  // long evening shadows: each building's footprint swept away from the sun, drawn on the ground
  const SH = new THREE.Vector2(-SUN.x / SUN.y, -SUN.z / SUN.y);
  let SHADOW_MAT: THREE.ShaderMaterial | null = null;
  function shadowMaterial() {
    SHADOW_MAT ??= new THREE.ShaderMaterial({
      uniforms: { ...uniforms }, transparent: true, depthWrite: false,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: COMMON + /* glsl */ `
        varying vec3 vW;
        void main() {
          if (sdMask(vW.xz) > 10. && terrMask(vW.xz) > 0.) discard;
          if (canalD(vW.xz) < ${glf(CANAL)}) discard;
          gl_FragColor = vec4(.05, .07, .16, .42);
        }`,
    });
    return SHADOW_MAT;
  }
  function hull(pts: [number, number][]) {
    const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo: [number, number][] = [], hi: [number, number][] = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
  }
  function shadowMesh(places: { k: number; m4: THREE.Matrix4 }[], blobs: number[][]) {
    const pos: number[] = [], idx: number[] = [];
    const v = new THREE.Vector3();
    const addPoly = (poly: [number, number][]) => {
      if (poly.length < 3) return;
      const b = pos.length / 3;
      for (const [x, z] of poly) pos.push(x, ground(x, z) + 0.35, z);
      for (let i = 1; i < poly.length - 1; i++) idx.push(b, b + i + 1, b + i);
    };
    for (const pl of places) {
      const sz = KIT.models[pl.k].size, pts: [number, number][] = [];
      v.set(0, sz[1], 0).applyMatrix4(pl.m4);
      const top = v.y;
      v.set(0, 0, 0).applyMatrix4(pl.m4);
      const h = Math.max(1, top - v.y);
      for (const [sx, sz2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        v.set(sx * sz[0] / 2, 0, sz2 * sz[2] / 2).applyMatrix4(pl.m4);
        pts.push([v.x, v.z], [v.x + SH.x * h, v.z + SH.y * h]);
      }
      addPoly(hull(pts));
    }
    for (const [x, z, r, h] of blobs) {
      const cx = x + SH.x * h * 0.5, cz = z + SH.y * h * 0.5, poly: [number, number][] = [];
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; poly.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
      addPoly(poly);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, shadowMaterial());
    m.renderOrder = 1;
    m.name = "shadows";
    return m;
  }
  function rebuildTile(t: Tile) {
    if (t.kit) { t.group.remove(t.kit); t.kit.traverse(o => (o as THREE.Mesh).geometry?.dispose()); t.kit = null; }
    if (t.box) { t.group.remove(t.box); t.box.geometry.dispose(); t.box = null; }
    const lit = lanternBuildingIds();
    const near = t.bldgs.filter(b => !lit.has(b.i) && !hidden.has(b.i) && (sdField(b.cx, b.cz) < 150 || terrField(b.cx, b.cz) < 20) && !b.p.some(q => canalAt(q[0], q[1]) < CANAL + COPE + 3));
    const nearest = roadNear(t);
    const places = near.map(b => placeKit(b, nearest));
    t.kit = kitInstances(places, false);
    t.box = boxMesh(near);
    t.group.add(t.kit, t.box);
    updateLod(true);
    // street and yard trees
    const old = t.group.getObjectByName("trees");
    if (old) t.group.remove(old);
    const blobs: number[][] = [];
    t.group.add(buildTrees(t, near, blobs));
    const oldS = t.group.getObjectByName("shadows");
    if (oldS) { t.group.remove(oldS); (oldS as THREE.Mesh).geometry.dispose(); }
    t.group.add(shadowMesh(places, blobs));
  }
  let lodAt = new THREE.Vector3(1e9, 0, 0);
  function updateLod(force = false) {
    const tg = controls.target;
    if (!force && tg.distanceTo(lodAt) < 120) return;
    lodAt.copy(tg);
    const far = camera.position.distanceTo(tg) > 4200;
    for (const t of tiles.values()) {
      if (t.state !== "ready" || !t.kit || !t.box) continue;
      const d = Math.hypot(t.cx - tg.x, t.cz - tg.z);
      const kit = !far && d < KIT_RADIUS;
      t.kit.visible = kit;
      t.box.visible = !kit;
    }
  }
  const treeCanopy = new THREE.IcosahedronGeometry(1, 1);
  const palmTrunk = new THREE.CylinderGeometry(0.35, 0.55, 1, 5).translate(0, 0.5, 0);
  const palmFrond = new THREE.ConeGeometry(1, 0.6, 7).translate(0, -0.3, 0);
  function treeMat(col: string) {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogChunk, uCol: { value: new THREE.Color(col) } }, fog: true,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vW;
        ${FOG_V}
        void main() { vN = normalize(mat3(instanceMatrix) * normal);
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.); vW = w.xyz;
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `
        uniform vec3 uCol; varying vec3 vN; varying vec3 vW;
        ${FOG_F}
        void main() { float sdT = sdMask(vW.xz); if ((sdT > 6. && terrMask(vW.xz) > 0.) || served(vW.xz) < .5) discard;
          float lam = max(dot(normalize(vN), uSun), 0.);
          vec3 col = uCol * (.55 + .7 * lam) * (.8 + .4 * h21(floor(vW.xz)));
          gl_FragColor = vec4(mix(col, vec3(.92, .93, .95) * (.8 + .25 * lam), smoothstep(0., 30., sdT)), 1.);
          #include <fog_fragment>
        }`,
    });
  }
  const TREE_MATS = { canopy: null as THREE.ShaderMaterial | null, trunk: null as THREE.ShaderMaterial | null, frond: null as THREE.ShaderMaterial | null };
  function buildTrees(t: Tile, near: Bldg[], blobs: number[][] = []) {
    TREE_MATS.canopy ??= treeMat("#3f5a4a");
    TREE_MATS.trunk ??= treeMat("#6b6a70");
    TREE_MATS.frond ??= treeMat("#4d6b50");
    const PX = 2, x0 = t.cx - M.tile / 2 - 20, z0 = t.cz - M.tile / 2 - 20, cw = Math.ceil((M.tile + 40) / PX);
    const cv = document.createElement("canvas");
    cv.width = cv.height = cw;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#000";
    for (const b of t.bldgs) { g.beginPath(); b.p.forEach((q, k) => { const X = (q[0] - x0) / PX, Y = (q[1] - z0) / PX; k ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.closePath(); g.fill(); }
    const occ = g.getImageData(0, 0, cw, cw).data;
    const blocked = (x: number, z: number) => { const i = Math.floor((x - x0) / PX), j = Math.floor((z - z0) / PX); if (i < 1 || j < 1 || i >= cw - 1 || j >= cw - 1) return true; return occ[(j * cw + i) * 4 + 3] > 0 || occ[(j * cw + i + 1) * 4 + 3] > 0; };
    let seed = (hash2(t.cx | 0, t.cz | 0) * 2147483646 + 1) | 0;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const trees: number[][] = [], palms: number[][] = [], hedges: number[][] = [];
    const rp = t.roadPts;
    for (let k = 0; k < rp.length - 2; k += 2) {
      const dx = rp[k + 2] - rp[k], dz = rp[k + 3] - rp[k + 1], L = Math.hypot(dx, dz);
      if (L < 1 || L > 40) continue;
      for (const side of [-1, 1]) {
        if (rnd() < 0.5) continue;
        const x = rp[k] - (dz / L) * 8 * side, z = rp[k + 1] + (dx / L) * 8 * side;
        if (blocked(x, z) || (sdField(x, z) > 60 && terrField(x, z) > 0) || canalAt(x, z) < CANAL + COPE + 4) continue;
        (rnd() < 0.18 ? palms : trees).push([x, z, rnd()]);
      }
    }
    // a promenade of palms along every canal bank
    for (const path of CANALS) {
      let acc = 0;
      for (let q = 0; q < path.length - 1; q++) {
        const a = path[q], c = path[q + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (L < 0.01) continue;
        const nx0 = -(c[1] - a[1]) / L, nz0 = (c[0] - a[0]) / L;
        for (let d0 = (16 - acc) % 16; d0 < L; d0 += 16) {
          const bx = a[0] + (c[0] - a[0]) * d0 / L, bz = a[1] + (c[1] - a[1]) * d0 / L;
          if (bx < x0 + 20 || bx > x0 + 20 + M.tile || bz < z0 + 20 || bz > z0 + 20 + M.tile) continue;
          for (const side of [-1, 1]) {
            const x = bx + nx0 * side * (CANAL + COPE + 3.2), z = bz + nz0 * side * (CANAL + COPE + 3.2);
            if ((sdField(x, z) < 40 || terrField(x, z) < 0) && !blocked(x, z) && canalAt(x, z) > CANAL + COPE + 1.5) palms.push([x, z, rnd()]);
            // a low hedge between the palms, right at the promenade edge
            const hx = bx + nx0 * side * (CANAL + COPE + 1.2) + (c[0] - a[0]) / L * 8, hz = bz + nz0 * side * (CANAL + COPE + 1.2) + (c[1] - a[1]) / L * 8;
            if ((sdField(hx, hz) < 40 || terrField(hx, hz) < 0) && canalAt(hx, hz) > CANAL + COPE + 0.4) hedges.push([hx, hz, rnd()]);
          }
        }
        acc = (acc + L) % 16;
      }
    }
    for (let k = 0; k < 1400; k++) {
      const x = x0 + 20 + rnd() * M.tile, z = z0 + 20 + rnd() * M.tile;
      if (!blocked(x, z) && (sdField(x, z) < 60 || terrField(x, z) < 0) && servedAt(x, z) && canalAt(x, z) > CANAL + COPE + 4) trees.push([x, z, rnd()]);
    }
    const grp = new THREE.Group();
    grp.name = "trees";
    const Mx = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), Sc = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    const tm = new THREE.InstancedMesh(treeCanopy, TREE_MATS.canopy, trees.length);
    trees.forEach(([x, z, r], k) => { const s = 3.2 + r * 3.4; V.set(x, ground(x, z) + s * 1.35, z); Sc.set(s, s * 1.15, s); Q.setFromAxisAngle(UP, r * 6.28); tm.setMatrixAt(k, Mx.compose(V, Q, Sc)); });
    const pt = new THREE.InstancedMesh(palmTrunk, TREE_MATS.trunk, palms.length);
    const pc = new THREE.InstancedMesh(palmFrond, TREE_MATS.frond, palms.length);
    palms.forEach(([x, z, r], k) => {
      const h = 18 + r * 12, y = ground(x, z);
      V.set(x, y, z); Sc.set(1, h, 1); Q.identity(); pt.setMatrixAt(k, Mx.compose(V, Q, Sc));
      V.set(x, y + h + 1.2, z); Sc.set(4.2, 2.4, 4.2); Q.setFromAxisAngle(UP, r * 6.28); pc.setMatrixAt(k, Mx.compose(V, Q, Sc));
    });
    const hm = new THREE.InstancedMesh(treeCanopy, TREE_MATS.canopy, hedges.length);
    hedges.forEach(([x, z, r], k) => { V.set(x, ground(x, z) + 1.3, z); Sc.set(2.6 + r, 1.3, 2.6 + r); Q.setFromAxisAngle(UP, r * 6.28); hm.setMatrixAt(k, Mx.compose(V, Q, Sc)); });
    for (const [x, z, r] of trees) blobs.push([x, z, 3.2 + r * 3.4, 8]);
    for (const [x, z] of palms) blobs.push([x, z, 2.6, 20]);
    for (const m of [tm, pt, pc, hm]) m.computeBoundingSphere();
    grp.add(tm, pt, pc, hm);
    return grp;
  }

  // ----------------------------------------------------------------- landmarks (2D art on a camera-facing card for now)
  const LANDMARKS = [
    { id: "opus_la" as const, src: `${ASSETS}/v4/tower-opus-la.png`, h: 210 },
    { id: "century_park_east" as const, src: `${ASSETS}/v4/tower-century-park-east.png`, h: 290 },
  ];
  const hidden = new Set<number>();            // footprints the landmark art replaces
  const landmarks: { mesh: THREE.Mesh; x: number; z: number }[] = [];
  function buildLandmarks() {
    for (const L of LANDMARKS) {
      const geo = CANONICAL_BUILDING_GEOGRAPHY[L.id];
      const { x, z } = ll(geo.latitude, geo.longitude);
      const tex = new THREE.TextureLoader().load(L.src, t => {
        const a = t.image.width / t.image.height;
        mesh.geometry.dispose();
        mesh.geometry = new THREE.PlaneGeometry(L.h * a, L.h).translate(0, L.h / 2, 0);
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.ShaderMaterial({
        uniforms: { ...uniforms, ...fogChunk, uMap: { value: tex }, uC: { value: new THREE.Vector2(x, z) } }, fog: true, transparent: false,
        vertexShader: /* glsl */ `varying vec2 vUv;
          ${FOG_V}
          void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: COMMON + /* glsl */ `uniform sampler2D uMap; uniform vec2 uC; varying vec2 vUv;
          ${FOG_F}
          void main() {
            vec4 t = texture2D(uMap, vUv);
            if (t.a < .5) discard;
            float sd = sdMask(uC);
            // charted: the art as painted; under the fog: a pale plaster silhouette rising out of it
            float L = dot(t.rgb, vec3(.3, .59, .11));
            vec3 ghost = vec3(.9, .91, .93) * (.75 + .3 * L);
            gl_FragColor = vec4(mix(t.rgb * 1.08, ghost, smoothstep(0., 40., sd)), 1.);
            #include <fog_fragment>
          }`,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(L.h * 0.69, L.h).translate(0, L.h / 2, 0), m);
      mesh.position.set(x, ground(x, z) - 2, z);
      mesh.renderOrder = 3;
      scene.add(mesh);
      landmarks.push({ mesh, x, z });
    }
  }
  function nearLandmark(x: number, z: number) {
    return landmarks.some(l => Math.hypot(l.x - x, l.z - z) < 55);
  }

  // ----------------------------------------------------------------- lanterns
  function pointInRing(x: number, z: number, ring: [number, number][]) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }
  function findBuilding(x: number, z: number): Bldg | null {
    const t = tiles.get(tileKeyAt(x, z));
    if (!t || t.state !== "ready") return null;
    let best: Bldg | null = null, bd = 60 * 60;
    for (const b of t.bldgs) {
      if (pointInRing(x, z, b.p)) return b;
      const d = (b.cx - x) ** 2 + (b.cz - z) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  function brightness(l: LanternInput) {
    if (l.active > 0) return 1;
    if (l.dimming > 0) return 0.55;
    return 0.22;
  }
  let lastRegionsKey = "";
  let lightSpots: { x: number; y: number; z: number; k: number }[] = [];
  function updateLights() {
    const tg = controls.target, arr = uniforms.uLights.value as THREE.Vector4[];
    const sorted = lightSpots.map(l => [Math.hypot(l.x - tg.x, l.z - tg.z), l] as const).sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < arr.length; i++) {
      const e = sorted[i];
      if (e) arr[i].set(e[1].x, e[1].y, e[1].z, e[1].k); else arr[i].set(0, -1e5, 0, 0);
    }
  }
  const ORB_GEO = new THREE.IcosahedronGeometry(2.6, 2);
  function orbMaterial(k: number) {
    // HDR gold so the bloom makes each customer's lantern glow
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.72, 0.3).multiplyScalar(1 + 2.6 * k), toneMapped: true });
  }
  let hoodCounts = new Map<string, { buildings: number; customers: number }>();
  let runs: { key: string; hood: string; label: string; x: number; z: number; r: number }[] = [];
  // the radius that holds the nearest RUN_DOORS doors around a point (from the real unit counts)
  function runRadius(x: number, z: number) {
    const D = M.doors, cells: [number, number][] = [];
    const ci = Math.floor((x - M.bounds[0]) / D.cell), cj = Math.floor((z - M.bounds[1]) / D.cell);
    for (let j = cj - 8; j <= cj + 8; j++) for (let i = ci - 8; i <= ci + 8; i++) {
      if (i < 0 || j < 0 || i >= D.nx || j >= D.nz) continue;
      const cx = M.bounds[0] + (i + 0.5) * D.cell, cz = M.bounds[1] + (j + 0.5) * D.cell;
      cells.push([Math.hypot(cx - x, cz - z), D.v[j * D.nx + i]]);
    }
    cells.sort((a, b) => a[0] - b[0]);
    let acc = 0;
    for (const [d, v] of cells) { acc += v; if (acc >= RUN_DOORS) return Math.max(140, Math.min(650, d + D.cell * 0.5)); }
    return 650;
  }
  function applyLanterns() {
    if (!M) return;
    // regions from where lanterns are, even before their tile loads
    const inside = lanterns.map(l => ({ l, ...ll(l.latitude, l.longitude) })).filter(p => servedAt(p.x, p.z));
    // 0 customer buildings: fog. 1: a clearing around the lantern and a door-hanger territory.
    // 2 or more anywhere in the neighbourhood: the whole neighbourhood is charted.
    const perHood = new Map<string, typeof inside>();
    for (const p of inside) { const h = hoodAt(p.x, p.z); if (h) { if (!perHood.has(h)) perHood.set(h, []); perHood.get(h)!.push(p); } }
    hoodCounts = new Map([...perHood].map(([h, ps]) => [h, { buildings: ps.length, customers: ps.length }]));
    const hoods = new Set([...perHood].filter(([, ps]) => ps.length >= 2).map(([h]) => h));   // 2+ customers
    const singles = [...perHood].filter(([, ps]) => ps.length === 1).map(([h, ps]) => ({ hood: h, ...ps[0] }));
    runs = singles.map(sg => ({ key: sg.l.key, hood: sg.hood, label: sg.l.label, x: sg.x, z: sg.z, r: runRadius(sg.x, sg.z) }));
    const rk = [...hoods].sort().join(";") + "|" + runs.map(r => `${r.x | 0},${r.z | 0}`).join(";");
    if (rk !== lastRegionsKey) {
      lastRegionsKey = rk;
      rebuildMask(hoods, singles.map(sg => ({ x: sg.x, z: sg.z, r: CLEARING })), runs);
      for (const key of wantedTiles()) if (!tiles.has(key)) void loadTile(key);
    }
    // lantern meshes: each customer lights their building; a building with several customers also
    // carries one floating lantern per customer above its roof, so every customer can be hovered
    for (const o of [...lanternGroup.children]) lanternGroup.remove(o);
    const prevIds = lanternBuildingIds();
    const groups = new Map<string, { b: Bldg | null; x: number; z: number; members: typeof inside }>();
    for (const p of inside) {
      const b = findBuilding(p.x, p.z);
      const gk = b ? `b${b.i}` : `p${Math.round(p.x / 10)},${Math.round(p.z / 10)}`;
      if (!groups.has(gk)) groups.set(gk, { b, x: b?.cx ?? p.x, z: b?.cz ?? p.z, members: [] });
      groups.get(gk)!.members.push(p);
    }
    placedLanterns = [];
    lightSpots = [];
    for (const g of groups.values()) {
      const keys = g.members.map(m => m.l.key);
      const k = Math.max(...g.members.map(m => brightness(m.l)));
      let mesh: THREE.Object3D | null = null;
      const tile = tiles.get(tileKeyAt(g.x, g.z));
      let roofY = ground(g.x, g.z) + 14;
      if (g.b && tile && !hidden.has(g.b.i)) {
        const placed = placeKit(g.b, roadNear(tile));
        mesh = kitInstances([placed], true);
        mesh.traverse(o => { const mm = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined; if (mm?.uniforms?.uLit) mm.uniforms.uLit.value = k; });
        mesh.userData.keys = keys;
        lanternGroup.add(mesh);
        roofY = ground(g.x, g.z) + g.b.h * (kitClass(g.b, 1) === "house" ? 1.75 : 1.6);
      }
      if (g.members.length > 1 || !mesh) {
        // floating lanterns, one per customer, in a small grid above the roof
        const n = g.members.length, cols = Math.ceil(Math.sqrt(n)), gap = 7;
        g.members.forEach((m, i) => {
          const orb = new THREE.Mesh(ORB_GEO, orbMaterial(brightness(m.l)));
          const cx = (i % cols - (cols - 1) / 2) * gap, cz = (Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2) * gap;
          orb.position.set(g.x + cx, roofY + 9 + (i % 2) * 1.5, g.z + cz);
          orb.userData.keys = [m.l.key];
          orb.userData.orb = true;
          lanternGroup.add(orb);
        });
      }
      const alone = runs.some(r0 => keys.includes(r0.key));
      const r = (60 + Math.sqrt(g.members.length) * 22) * (alone ? 1.6 : 1);
      const halo = new THREE.Mesh(new THREE.CircleGeometry(r, 40).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uA: { value: alone ? Math.min(1.6, k * 1.5) : k } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `uniform float uA; varying vec2 vUv; void main(){ float d = length(vUv - .5) * 2.; float a = pow(1. - clamp(d,0.,1.), 2.2) * .5 * uA; gl_FragColor = vec4(vec3(1., .66, .25) * a, a); }`,
      }));
      halo.position.set(g.x, ground(g.x, g.z) + 1.6, g.z);
      halo.userData.halo = true;
      if (!mesh && g.members.length === 1) halo.userData.keys = keys;
      lanternGroup.add(halo);
      for (const m of g.members) placedLanterns.push({ input: m.l, x: g.x, z: g.z, b: g.b, mesh, halo });
      lightSpots.push({ x: g.x, y: (ground(g.x, g.z) + roofY) / 2 + 4, z: g.z, k: (alone ? 1.5 : 1) * k * Math.min(2, 0.8 + g.members.length * 0.2) });
    }
    // a building that just became a lantern must leave the dim city
    const nowIds = lanternBuildingIds();
    const changed = [...prevIds].filter(i => !nowIds.has(i)).concat([...nowIds].filter(i => !prevIds.has(i)));
    if (changed.length) {
      for (const t of tiles.values()) {
        if (t.state === "ready" && changed.some(i => i >= t.idMin && i <= t.idMax)) rebuildTile(t);
      }
    }
    if (!framed && placedLanterns.length) frameHome();
    refreshLabels();
    reportStats();
  }
  function frameHome() {
    framed = true;
    if (placedLanterns.length) {
      let best = placedLanterns[0], bs = -1;
      for (const a of placedLanterns) {
        let s0 = 0;
        for (const b of placedLanterns) if (Math.hypot(a.x - b.x, a.z - b.z) < 1800) s0++;
        if (s0 > bs) { bs = s0; best = a; }
      }
      frame(best.x, best.z + 150, 2600, 0, 0.92);
      return;
    }
    // open on the whole board: every lantern in view
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const l of placedLanterns) { x0 = Math.min(x0, l.x); x1 = Math.max(x1, l.x); z0 = Math.min(z0, l.z); z1 = Math.max(z1, l.z); }
    // the whole board, north up, every neighbourhood in view
    x0 = Math.min(x0, M.bounds[0]); x1 = Math.max(x1, M.bounds[2]);
    z0 = Math.min(z0, M.bounds[1]); z1 = Math.max(z1, M.bounds[3]);
    const aspect = Math.max(0.4, container.clientWidth / Math.max(1, container.clientHeight));
    const ex = x1 - x0 + 600, ez = z1 - z0 + 600;
    const dist = Math.min(controls.maxDistance, Math.max(2600, (Math.max(ex / aspect, ez * 1.35) / (2 * Math.tan((13 * Math.PI) / 180))) * 1.02));
    frame((x0 + x1) / 2, (z0 + z1) / 2 + ez * 0.1, dist, 0);
  }
  function frame(x: number, z: number, dist: number, yaw = 0, pitch = 0.95) {
    const ty = ground(x, z);
    controls.target.set(x, ty, z);
    camera.position.set(x + Math.sin(yaw) * Math.sin(pitch) * dist, ty + Math.cos(pitch) * dist, z + Math.cos(yaw) * Math.sin(pitch) * dist);
    controls.update();
  }
  let fly: null | { t: number; dur: number; fromT: THREE.Vector3; fromP: THREE.Vector3; toT: THREE.Vector3; toP: THREE.Vector3 } = null;
  function flyTo(x: number, z: number, dist: number) {
    const fromT = controls.target.clone(), fromP = camera.position.clone();
    const off = fromP.clone().sub(fromT).normalize().multiplyScalar(dist);
    const toT = new THREE.Vector3(x, ground(x, z), z);
    fly = { t: 0, dur: 1.4, fromT, fromP, toT, toP: toT.clone().add(off) };
  }

  // ----------------------------------------------------------------- stats and the uncharted-land card
  function reportStats() {
    const D = M.doors;
    let lit = 0, charted = 0, served = 0;
    for (let j = 0; j < D.nz; j++) for (let i = 0; i < D.nx; i++) {
      const x = M.bounds[0] + (i + 0.5) * D.cell, z = M.bounds[1] + (j + 0.5) * D.cell;
      if (!servedAt(x, z)) continue;
      served++;
      if (sdField(x, z) < 0) { charted++; lit += D.v[j * D.nx + i]; }
    }
    events.onStats?.({
      lanterns: placedLanterns.length,
      outside: lanterns.length - placedLanterns.length,
      chartedPct: served ? Math.max(charted ? 1 : 0, Math.round((charted / served) * 100)) : 0,
      doorsInLight: lit,
    });
    events.onMission?.(pickMission());
  }
  function pickMission(): Mission | null {
    if (!placedLanterns.length) return null;
    if (runs.length) {
      const r = runs.slice().sort((a, b) => a.r - b.r)[0];
      const addr = r.label.split(",")[0];
      return { kind: "run", title: `Door-hanger run · ${r.hood}`, body: `~${RUN_DOORS} doors inside the gold line around ${addr}. Win a second building and all of ${r.hood} comes out of the fog.`,
        hood: r.hood, where: addr, doors: RUN_DOORS, buildings: 0, miles: 0, x: r.x, z: r.z, radius: r.r };
    }
    const D = M.doors;
    let best: { x: number; z: number; s: number; doors: number } | null = null;
    for (let j = 1; j < D.nz - 1; j++) for (let i = 1; i < D.nx - 1; i++) {
      const x = M.bounds[0] + (i + 0.5) * D.cell, z = M.bounds[1] + (j + 0.5) * D.cell;
      const sd = sdField(x, z);
      if (sd < 60 || sd > 900 || !servedAt(x, z)) continue;
      let doors = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) doors += D.v[(j + b) * D.nx + i + a];
      const s = doors / (1 + sd / 600);
      if (!best || s > best.s) best = { x, z, s, doors };
    }
    if (!best) return null;
    // name the place by the two nearest main roads
    const named: [string, number][] = [];
    for (const [n, pts] of Object.entries(M.major)) {
      let d = 1e9;
      for (const p of pts) d = Math.min(d, (p[0] - best.x) ** 2 + (p[1] - best.z) ** 2);
      named.push([n, d]);
    }
    named.sort((a, b) => a[1] - b[1]);
    const short = (n: string) => n.replace(/^(North|South|East|West) /, "").replace(" Boulevard", " Blvd").replace(" Avenue", " Ave").replace(" Street", " St");
    const where = named.length >= 2 ? `near ${short(named[0][0])} & ${short(named[1][0])}` : named.length ? `near ${short(named[0][0])}` : "past your light";
    let nearest = 1e9;
    for (const l of placedLanterns) nearest = Math.min(nearest, Math.hypot(l.x - best.x, l.z - best.z));
    // a whole neighbourhood comes out of the fog, so count its doors, not a block's
    const hood = hoodAt(best.x, best.z) ?? "";
    let doors = 0;
    if (hood) {
      for (let j = 0; j < D.nz; j++) for (let i = 0; i < D.nx; i++) {
        const x = M.bounds[0] + (i + 0.5) * D.cell, z = M.bounds[1] + (j + 0.5) * D.cell;
        if (D.v[j * D.nx + i] && hoodAt(x, z) === hood) doors += D.v[j * D.nx + i];
      }
    }
    const rounded = Math.max(5, Math.round((doors || best.doors) / 50) * 50);
    return { kind: "uncharted", title: hood ? `Uncharted: ${hood}` : `Uncharted: ${where}`,
      body: hood ? `Nobody's knocked yet. Your first building ${where} breaks the fog open in ${hood}.` : "Nobody's knocked yet.",
      hood, where, doors: rounded, buildings: 0, miles: nearest / 1609, x: best.x, z: best.z, radius: 0 };
  }

  // ----------------------------------------------------------------- neighbourhood labels
  const labelLayer = document.createElement("div");
  labelLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
  container.appendChild(labelLayer);
  let labels: { name: string; x: number; z: number; el: HTMLDivElement; count: HTMLSpanElement; state: HTMLSpanElement }[] = [];
  function labelPoint(ring: [number, number][]) {
    // the interior point farthest from the outline, so the label sits squarely inside
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    let best: [number, number] = [(x0 + x1) / 2, (z0 + z1) / 2], bd = -1;
    for (let a = 1; a < 24; a++) for (let b = 1; b < 24; b++) {
      const x = x0 + (x1 - x0) * a / 24, z = z0 + (z1 - z0) * b / 24;
      if (!pointInRing(x, z, ring)) continue;
      let d = 1e9;
      for (let k = 0; k < ring.length; k++) {
        const p = ring[k], q = ring[(k + 1) % ring.length], ex = q[0] - p[0], ez = q[1] - p[1];
        const t = Math.max(0, Math.min(1, ((x - p[0]) * ex + (z - p[1]) * ez) / (ex * ex + ez * ez || 1)));
        d = Math.min(d, Math.hypot(x - p[0] - ex * t, z - p[1] - ez * t));
      }
      if (d > bd) { bd = d; best = [x, z]; }
    }
    return best;
  }
  function buildLabels() {
    const biggest = new Map<string, [number, number][]>();
    const area = (r: [number, number][]) => { let a = 0; for (let k = 0; k < r.length; k++) { const p = r[k], q = r[(k + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); };
    for (const o of M.outline) { const cur = biggest.get(o.n); if (!cur || area(o.p) > area(cur)) biggest.set(o.n, o.p); }
    for (const [name, ring] of biggest) {
      const [x, z] = labelPoint(ring);
      const el = document.createElement("div");
      el.style.cssText = "position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:3px;white-space:nowrap;transition:opacity .2s;";
      const nm = document.createElement("div");
      nm.textContent = name.toUpperCase();
      nm.style.cssText = "font:700 15px/1 'Barlow Condensed',system-ui,sans-serif;letter-spacing:.14em;color:#0b0f14;background:rgba(251,251,250,.92);border:1px solid #dcdfe4;border-radius:8px;padding:6px 10px 5px;box-shadow:0 4px 14px rgba(20,26,40,.18);";
      const sub = document.createElement("div");
      sub.style.cssText = "display:flex;gap:6px;align-items:center;font:600 12px/1 'Barlow Condensed',system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;";
      const count = document.createElement("span");
      const state = document.createElement("span");
      sub.append(count, state);
      el.append(nm, sub);
      labelLayer.appendChild(el);
      labels.push({ name, x, z, el, count, state });
    }
  }
  function refreshLabels() {
    for (const L of labels) {
      const c = hoodCounts.get(L.name);
      const b = c?.buildings ?? 0;
      const pill = (bg: string, fg: string) => `background:${bg};color:${fg};border-radius:999px;padding:4px 8px;`;
      if (!b) {
        L.count.textContent = "Uncharted";
        L.count.style.cssText = pill("rgba(255,255,255,.85)", "#6b7280") + "border:1px solid #dcdfe4;";
        L.state.textContent = "";
        L.state.style.cssText = "display:none";
      } else {
        L.count.textContent = `${c!.customers} customer${c!.customers === 1 ? "" : "s"}`;
        L.count.style.cssText = pill("#0b0f14", "#ffc84d");
        L.state.textContent = b === 1 ? "Door-hanger run" : "Charted";
        L.state.style.cssText = b === 1 ? pill("#ffc84d", "#3a2600") : pill("rgba(255,255,255,.9)", "#0b0f14") + "border:1px solid #dcdfe4;";
      }
    }
  }
  const lv = new THREE.Vector3();
  function placeLabels() {
    const w = container.clientWidth, h = container.clientHeight;
    const far = camera.position.distanceTo(controls.target);
    for (const L of labels) {
      lv.set(L.x, ground(L.x, L.z) + 90, L.z).project(camera);
      const vis = lv.z < 1 && Math.abs(lv.x) < 1.1 && Math.abs(lv.y) < 1.1;
      L.el.style.opacity = vis ? "1" : "0";
      if (vis) L.el.style.transform = `translate(${((lv.x + 1) / 2) * w}px, ${((1 - lv.y) / 2) * h}px) translate(-50%,-50%) scale(${far < 2500 ? 0.9 : 1})`;
    }
  }

  // ----------------------------------------------------------------- picking
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downAt: [number, number] | null = null;
  function onDown(e: PointerEvent) { downAt = [e.clientX, e.clientY]; }
  function onUp(e: PointerEvent) {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    events.onSelect?.(pickKeys(e));
  }
  const pv = new THREE.Vector3();
  function pickKeys(e: PointerEvent): string[] | null {
    const r = renderer.domElement.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    // nearest lantern on screen: every customer's light is an easy target at any zoom
    let best: string[] | null = null, bd = 30;
    for (const o of lanternGroup.children) {
      if (!o.userData.keys) continue;
      if (o.userData.orb) pv.copy(o.position);
      else {
        const pl = placedLanterns.find(p => (o.userData.keys as string[]).includes(p.input.key));
        if (!pl) continue;
        pv.set(pl.x, ground(pl.x, pl.z) + (pl.b ? pl.b.h * 1.2 : 8), pl.z);
      }
      pv.project(camera);
      if (pv.z > 1) continue;
      const sx = ((pv.x + 1) / 2) * r.width, sy = ((1 - pv.y) / 2) * r.height;
      const d = Math.hypot(sx - mx, sy - my);
      if (d < bd) { bd = d; best = o.userData.keys as string[]; }
    }
    if (best) return best;
    ndc.set((mx / r.width) * 2 - 1, -(my / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(lanternGroup.children.filter(o => !o.userData.halo || o.userData.keys), true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.keys) o = o.parent;
      if (o) return o.userData.keys as string[];
    }
    return null;
  }
  // hover: the customer's name, lifetime spend and last order, right at the house
  const tip = document.createElement("div");
  tip.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;opacity:0;transition:opacity .12s;background:rgba(251,251,250,.97);border:1px solid #dcdfe4;border-radius:12px;box-shadow:0 10px 28px rgba(20,26,40,.22);padding:10px 12px;min-width:190px;max-width:280px;font:500 13px/1.35 Barlow,system-ui,sans-serif;color:#0b0f14;z-index:3;";
  container.appendChild(tip);
  const money = (c?: number) => (c == null ? "—" : `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  const day = (iso?: string) => { if (!iso) return "—"; const d = new Date(iso); return isNaN(+d) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
  const dot = (l: LanternInput) => (l.active ? "#ffb020" : l.dimming ? "#d99a4a" : "#8a8f99");
  function tipHtml(keys: string[]) {
    const ls = keys.map(k => lanterns.find(l => l.key === k)).filter((l): l is LanternInput => !!l);
    if (!ls.length) return "";
    const row = (l: LanternInput) => `<div style="display:flex;gap:8px;align-items:flex-start;padding:4px 0;">
      <span style="width:9px;height:9px;border-radius:50%;margin-top:4px;flex:none;background:${dot(l)};box-shadow:0 0 6px ${dot(l)}"></span>
      <div><div style="font:700 15px/1.15 'Barlow Condensed',system-ui,sans-serif;letter-spacing:.02em">${esc(l.name ?? "Customer")}</div>
      <div style="color:#4a5160;font-variant-numeric:tabular-nums">${money(l.spendCents)} lifetime · last order ${day(l.lastOrderAt)}</div></div></div>`;
    const head = `<div style="font:600 11px/1 'Barlow Condensed',system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#9a6400;margin-bottom:4px">${esc((ls[0].label || "").split(",")[0])}</div>`;
    return head + ls.slice(0, 6).map(row).join("") + (ls.length > 6 ? `<div style="color:#4a5160;padding-top:2px">+ ${ls.length - 6} more — click to see all</div>` : "");
  }
  const esc = (t: string) => t.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  let hoverKeys = "", moveQueued: PointerEvent | null = null;
  function onMove(e: PointerEvent) {
    if (e.buttons) { tip.style.opacity = "0"; hoverKeys = ""; return; }
    if (!moveQueued) requestAnimationFrame(() => {
      const ev = moveQueued!;
      moveQueued = null;
      const keys = pickKeys(ev);
      const r = container.getBoundingClientRect();
      if (!keys) { tip.style.opacity = "0"; hoverKeys = ""; renderer.domElement.style.cursor = ""; return; }
      const id = keys.join("|");
      if (id !== hoverKeys) { tip.innerHTML = tipHtml(keys); hoverKeys = id; }
      renderer.domElement.style.cursor = "pointer";
      const x = Math.min(ev.clientX - r.left + 16, r.width - 300), y = Math.max(12, ev.clientY - r.top - 16);
      tip.style.transform = `translate(${x}px, ${y}px)`;
      tip.style.opacity = "1";
    });
    moveQueued = e;
  }
  renderer.domElement.addEventListener("pointermove", onMove);
  renderer.domElement.addEventListener("pointerleave", () => { tip.style.opacity = "0"; hoverKeys = ""; });
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);

  // ----------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  let raf = 0;
  function tick() {
    if (disposed) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    uniforms.uTime.value = clock.elapsedTime;
    if (fly) {
      fly.t += dt / fly.dur;
      const e = fly.t >= 1 ? 1 : 1 - Math.pow(1 - fly.t, 3);
      controls.target.lerpVectors(fly.fromT, fly.toT, e);
      camera.position.lerpVectors(fly.fromP, fly.toP, e);
      if (fly.t >= 1) fly = null;
    }
    controls.update();
    // haze scales with height so the whole board reads from far out and close streets stay crisp
    const cd = camera.position.distanceTo(controls.target);
    fogChunk.fogNear.value = cd * 1.1;
    fogChunk.fogFar.value = cd * 3.2;
    (scene.fog as THREE.Fog).near = cd * 1.1;
    (scene.fog as THREE.Fog).far = cd * 3.2;
    camera.far = cd * 4 + 2000;
    // from far out the pools of light grow so every lantern still reads on the board
    const hs = Math.min(11, Math.max(1, cd / 2200));
    for (const o of lanternGroup.children) { if (o.userData.halo) o.scale.setScalar(hs); else if (o.userData.orb) o.scale.setScalar(Math.max(1, hs * 0.7)); }
    camera.updateProjectionMatrix();
    for (const l of landmarks) l.mesh.rotation.y = Math.atan2(camera.position.x - l.x, camera.position.z - l.z);
    if (M) { updateLights(); updateLife(dt, cd); }
    if (M) { updateLod(); placeLabels(); }
    composer.render();
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  load().catch(e => events.onError?.(e));

  return {
    setLanterns(next: LanternInput[]) {
      lanterns = next;
      applyLanterns();
    },
    probe(x: number, z: number) {
      return { sd: Math.round(sdField(x, z)), canal: Math.round(canalAt(x, z) * 10) / 10, ground: Math.round(ground(x, z) * 10) / 10, served: servedAt(x, z), hood: hoodAt(x, z) };
    },
    debug() {
      return placedLanterns.map(p => ({ key: p.input.key, b: p.b ? { i: p.b.i, h: p.b.h, t: p.b.t, cx: Math.round(p.b.cx), cz: Math.round(p.b.cz) } : null,
        mesh: !!p.mesh, meshes: p.mesh ? p.mesh.children.length : 0, x: Math.round(p.x), z: Math.round(p.z),
        inTile: (() => { const t = tiles.get(tileKeyAt(p.x, p.z)); return t ? { state: t.state, has: p.b ? t.bldgs.includes(p.b) : false } : null; })() }));
    },
    keys() {
      return placedLanterns.map(p => p.input.key);
    },
    focus(key: string, dist = 900) {
      const l = placedLanterns.find(p => p.input.key === key) ?? placedLanterns[Number(key.replace(/\D/g, "")) || 0];
      if (l) flyTo(l.x, l.z, dist);
    },
    focusPoint(x: number, z: number, dist = 1600) {
      flyTo(x, z, dist);
    },
    attribution() {
      return M?.attribution ?? "";
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      tip.remove();
      controls.dispose();
      scene.traverse(o => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach(x => x.dispose());
      });
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labelLayer.remove();
    },
  };
}
export type LanternWorld = ReturnType<typeof createLanternWorld>;
