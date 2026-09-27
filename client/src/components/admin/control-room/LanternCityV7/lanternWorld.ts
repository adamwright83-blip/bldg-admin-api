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

export const WORLD_BASE = "/assets/goldline/lantern-city/v7";

export type LanternInput = {
  key: string;
  latitude: number;
  longitude: number;
  label: string;
  total: number;
  active: number;
  dimming: number;
  dark: number;
};
export type WorldStats = { lanterns: number; outside: number; chartedPct: number; doorsInLight: number };
export type Mission = { title: string; doors: number; buildings: number; miles: number; x: number; z: number };
export type WorldEvents = {
  onReady?: () => void;
  onStats?: (s: WorldStats) => void;
  onMission?: (m: Mission | null) => void;
  onSelect?: (key: string | null) => void;
  onError?: (e: unknown) => void;
};

type Manifest = {
  origin: [number, number];
  kx: number;
  kz: number;
  bounds: [number, number, number, number];
  tile: number;
  tiles: [number, number, number][];
  outline: { n: string; p: [number, number][] }[];
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
const hexv = (c: THREE.Color) => `${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)}`;

const COMMON = /* glsl */ `
  uniform sampler2D uMask; uniform sampler2D uServe; uniform sampler2D uCanal; uniform vec4 uRect; uniform vec4 uBounds; uniform vec3 uSun; uniform float uTime;
  float canalD(vec2 xz) { vec2 uv = (xz - uBounds.xy) / (uBounds.zw - uBounds.xy);
    if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return 255.;
    return texture2D(uCanal, uv).r * 255.; }
  float sdMask(vec2 xz) { return texture2D(uMask, (xz - uRect.xy) / (uRect.zw - uRect.xy)).r; }
  float served(vec2 xz) { return texture2D(uServe, (xz - uRect.xy) / (uRect.zw - uRect.xy)).r; }
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
  float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
`;
const FOG_V = /* glsl */ `#include <fog_pars_vertex>`;
const FOG_F = /* glsl */ `#include <fog_pars_fragment>`;

export function createLanternWorld(container: HTMLElement, events: WorldEvents = {}) {
  let disposed = false;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  const scene = new THREE.Scene();
  scene.background = PAPER;
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
  const SUN = new THREE.Vector3(-0.55, 0.62, -0.56).normalize();

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.6, 0.3, 1.05);
  composer.addPass(bloom);
  const tilt = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(2, 2) }, uAmt: { value: 2.0 } },
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
  const uniforms: Record<string, THREE.IUniform> = {
    uMask: { value: null }, uServe: { value: null }, uCanal: { value: null }, uRect: { value: new THREE.Vector4() }, uBounds: { value: new THREE.Vector4() },
    uSun: { value: SUN }, uTime: { value: 0 },
  };
  const fogChunk = { fogColor: { value: PAPER }, fogNear: { value: 5200 }, fogFar: { value: 13000 } };
  let lanterns: LanternInput[] = [];
  let placedLanterns: { input: LanternInput; x: number; z: number; b: Bldg | null; mesh: THREE.Object3D | null; halo: THREE.Mesh }[] = [];
  const lanternGroup = new THREE.Group();
  scene.add(lanternGroup);
  let maskData: Float32Array;
  let maskTex: THREE.DataTexture;
  const MW = 1024;
  let MH = 512;
  let rect = { x0: 0, z0: 0, x1: 1, z1: 1 };
  let servedAt = (_x: number, _z: number) => false;
  let canalAt = (_x: number, _z: number) => 255;
  const CANAL = 13;     // half-width of the water, metres
  let framed = false;

  const ll = (lat: number, lon: number) => ({ x: (lon - M.origin[1]) * M.kx, z: -(lat - M.origin[0]) * M.kz });

  async function load() {
    const [m, k] = await Promise.all([
      fetch(`${WORLD_BASE}/world/manifest.json`).then(r => r.json()),
      fetch(`${WORLD_BASE}/kit.json`).then(r => r.json()),
    ]);
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
      const fx = (x - M.bounds[0]) / (M.bounds[2] - M.bounds[0]) * cc.width, fz = (z - M.bounds[1]) / (M.bounds[3] - M.bounds[1]) * cc.height;
      const i = Math.floor(fx), j = Math.floor(fz);
      if (i < 0 || j < 0 || i >= cc.width - 1 || j >= cc.height - 1) return 255;
      const tx = fx - i, tz = fz - j, v = (a: number, b: number) => cdata[(b * cc.width + a) * 4];
      return (v(i, j) * (1 - tx) + v(i + 1, j) * tx) * (1 - tz) + (v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx) * tz;
    };
    maskData = new Float32Array(MW * MH).fill(900);
    maskTex = new THREE.DataTexture(maskData, MW, MH, THREE.RedFormat, THREE.FloatType);
    maskTex.magFilter = maskTex.minFilter = THREE.LinearFilter;
    maskTex.needsUpdate = true;
    uniforms.uMask.value = maskTex;
    sdField = (x, z) => {
      const fx = (x - rect.x0) / (rect.x1 - rect.x0) * (MW - 1), fz = (z - rect.z0) / (rect.z1 - rect.z0) * (MH - 1);
      const i = Math.max(0, Math.min(MW - 2, Math.floor(fx))), j = Math.max(0, Math.min(MH - 2, Math.floor(fz)));
      const tx = fx - i, tz = fz - j, m = (a: number, b: number) => maskData[b * MW + a];
      return (m(i, j) * (1 - tx) + m(i + 1, j) * tx) * (1 - tz) + (m(i, j + 1) * (1 - tx) + m(i + 1, j + 1) * tx) * tz;
    };
    buildTerrain();
    buildFlats();
    buildFog();
    buildKitGeometry();
    buildLandmarks();
    if (disposed) return;
    applyLanterns();
    events.onReady?.();
  }

  // ----------------------------------------------------------------- reveal field
  let warp: Float32Array | null = null;
  function rebuildMask(regions: { x: number; z: number; r: number }[]) {
    if (!warp) {
      warp = new Float32Array(MW * MH);
      for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
        const x = rect.x0 + (rect.x1 - rect.x0) * i / (MW - 1), z = rect.z0 + (rect.z1 - rect.z0) * j / (MH - 1);
        warp[j * MW + i] = (fbm(x * 0.0065 + 11, z * 0.0065 - 7) - 0.5) * 120;
      }
    }
    // per-region stamp: only the texels near each region are touched
    maskData.fill(900);
    const cellX = (rect.x1 - rect.x0) / (MW - 1), cellZ = (rect.z1 - rect.z0) / (MH - 1);
    for (const r of regions) {
      const reach = r.r + 700;
      const i0 = Math.max(0, Math.floor((r.x - reach - rect.x0) / cellX)), i1 = Math.min(MW - 1, Math.ceil((r.x + reach - rect.x0) / cellX));
      const j0 = Math.max(0, Math.floor((r.z - reach - rect.z0) / cellZ)), j1 = Math.min(MH - 1, Math.ceil((r.z + reach - rect.z0) / cellZ));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = rect.x0 + cellX * i, z = rect.z0 + cellZ * j;
        const sd = Math.hypot(x - r.x, z - r.z) - r.r + warp[j * MW + i];
        const k = j * MW + i;
        if (sd < maskData[k]) maskData[k] = Math.max(-400, sd);
      }
    }
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
        if (served(vW.xz) < .5) discard;
        float sd = sdMask(vW.xz);
        float cd = canalD(vW.xz);
        bool fogged = sd > 40.;
        if (fogged && cd > ${CANAL + 6}.) discard;
        float l = .55 + .45 * max(dot(normalize(vN), uSun), 0.);
        vec3 c = uCol * l * 1.3 * (.9 + .2 * fbm(vW.xz * .02));
        // Venice-style canal: teal water with moving ripples, pale stone banks
        float ripple = fbm(vW.xz * .07 + vec2(uTime * .06, -uTime * .04));
        vec3 water = mix(vec3(.05, .24, .3), vec3(.16, .44, .5), .3 + .5 * ripple);
        water += vec3(1., .82, .5) * smoothstep(.74, .82, fbm(vW.xz * .12 + uTime * .1)) * .3;
        vec3 bank = vec3(.62, .6, .58) * l;
        if (fogged) { water = mix(water, vec3(.62, .78, .82), .55); bank = vec3(.9, .9, .88); }
        c = mix(c, bank, 1. - smoothstep(${CANAL + 3}., ${CANAL + 4}.5, cd));
        c = mix(c, water, 1. - smoothstep(${CANAL}., ${CANAL + 1}.2, cd));
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
    const S = 520, Sz = Math.round(S * (rect.z1 - rect.z0) / (rect.x1 - rect.x0));
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
          float body = smoothstep(-10., 90., sd) * smoothstep(.0, .6, served(p)) * smoothstep(${CANAL + 2}., ${CANAL + 34}., canalD(p));
          float billow = fbm(p * .006 + uTime * .004) * 34. + fbm(p * .021 - uTime * .006) * 12.;
          return body * (30. + billow * 1.9) - (1. - body) * 30.;
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
          if (sd < -12.) discard;
          vec3 n = normalize(vN);
          float lam = max(dot(n, uSun), 0.);
          vec3 plaster = vec3(.97, .965, .955) * (.66 + .36 * lam) * (.9 + .1 * (.5 + .5 * n.y));
          plaster = mix(plaster, vec3(.8, .84, .91), (1. - lam) * .45);
          plaster *= .96 + .06 * fbm(vW.xz * .09);
          float band = pow(1. - smoothstep(0., 260., sd), 1.6);
          vec2 v = vor(vW.xz / 58. + fbm(vW.xz * .012) * 1.6);
          float crack = (1. - smoothstep(0., .03 + .05 * band, v.y)) * band * step(0., sd);
          float rim = (1. - smoothstep(0., 8., abs(sd - 3.))) * .5;
          vec3 c = mix(plaster, vec3(1., .72, .28) * 1.5, clamp(crack * 1.2 + rim, 0., 1.));
          // the edge of the served world: a gold rule where the neighbourhoods end
          float cdF = canalD(vW.xz);
          c = mix(c, vec3(1., .74, .32) * 1.3, (1. - smoothstep(${CANAL + 2}., ${CANAL + 10}., cdF)) * .75);
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
          vec3 dusk = mix(tint * (.45 + .95 * L), c * .7, .22) * (.5 + .62 * lam) * (.9 + .2 * vSeed);
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
        if (sdField(x0 + (M.tile * a) / 4, z0 + (M.tile * b) / 4) < 160) lit = true;
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
        const over = 1 - ease((canalAt(p[0], p[1]) - (CANAL + 2)) / 14);
        const y = ground(p[0], p[1]) + 0.9 + 3.4 * over;
        pos.push(p[0] - dz * w, y, p[1] + dx * w, p[0] + dz * w, y, p[1] - dx * w);
        along.push(s, s);
        across.push(-1, 1);
        if (q) { const b = pos.length / 3 - 4; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
        if (q % 2 === 0) t.roadPts.push(p[0], p[1]);
      }
    }
    t.group.add(flatMesh(pos, idx, along, /* glsl */ `
      void main() { if (served(vW.xz) < .5 || sdMask(vW.xz) > 30.) discard;
        vec3 c = vec3(.36, .40, .5);
        float lamp = 1. - smoothstep(0., 2.2, abs(mod(vAlong, 38.) - 19.));
        c += vec3(.55, .6, .7) * lamp * .35;
        // over a canal the road becomes a stone bridge with dark rails
        float br = 1. - smoothstep(${CANAL + 2}., ${CANAL + 4}., canalD(vW.xz));
        vec3 deck = vec3(.66, .64, .6) * (.9 + .1 * fbm(vW.xz * .3));
        deck = mix(deck, vec3(.2, .22, .27), smoothstep(.8, .9, abs(vAcross)));
        c = mix(c, deck, br);
        gl_FragColor = vec4(c, 1.);
        #include <fog_fragment>
      }`, true, across));
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
  function rebuildTile(t: Tile) {
    if (t.kit) { t.group.remove(t.kit); t.kit.traverse(o => (o as THREE.Mesh).geometry?.dispose()); t.kit = null; }
    if (t.box) { t.group.remove(t.box); t.box.geometry.dispose(); t.box = null; }
    const lit = lanternBuildingIds();
    const near = t.bldgs.filter(b => !lit.has(b.i) && !hidden.has(b.i) && sdField(b.cx, b.cz) < 150 && !b.p.some(q => canalAt(q[0], q[1]) < CANAL + 3));
    const nearest = roadNear(t);
    t.kit = kitInstances(near.map(b => placeKit(b, nearest)), false);
    t.box = boxMesh(near);
    t.group.add(t.kit, t.box);
    updateLod(true);
    // street and yard trees
    const old = t.group.getObjectByName("trees");
    if (old) t.group.remove(old);
    t.group.add(buildTrees(t, near));
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
        void main() { if (sdMask(vW.xz) > 6. || served(vW.xz) < .5) discard;
          float lam = max(dot(normalize(vN), uSun), 0.);
          gl_FragColor = vec4(uCol * (.55 + .7 * lam) * (.8 + .4 * h21(floor(vW.xz))), 1.);
          #include <fog_fragment>
        }`,
    });
  }
  const TREE_MATS = { canopy: null as THREE.ShaderMaterial | null, trunk: null as THREE.ShaderMaterial | null, frond: null as THREE.ShaderMaterial | null };
  function buildTrees(t: Tile, near: Bldg[]) {
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
    const trees: number[][] = [], palms: number[][] = [];
    const rp = t.roadPts;
    for (let k = 0; k < rp.length - 2; k += 2) {
      const dx = rp[k + 2] - rp[k], dz = rp[k + 3] - rp[k + 1], L = Math.hypot(dx, dz);
      if (L < 1 || L > 40) continue;
      for (const side of [-1, 1]) {
        if (rnd() < 0.5) continue;
        const x = rp[k] - (dz / L) * 8 * side, z = rp[k + 1] + (dx / L) * 8 * side;
        if (blocked(x, z) || sdField(x, z) > 60 || canalAt(x, z) < CANAL + 5) continue;
        (rnd() < 0.18 ? palms : trees).push([x, z, rnd()]);
      }
    }
    for (let k = 0; k < 1400; k++) {
      const x = x0 + 20 + rnd() * M.tile, z = z0 + 20 + rnd() * M.tile;
      if (!blocked(x, z) && sdField(x, z) < 60 && servedAt(x, z) && canalAt(x, z) > CANAL + 5) trees.push([x, z, rnd()]);
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
    for (const m of [tm, pt, pc]) m.computeBoundingSphere();
    grp.add(tm, pt, pc);
    return grp;
  }

  // ----------------------------------------------------------------- landmarks (2D art on a camera-facing card for now)
  const LANDMARKS = [
    { id: "opus_la" as const, src: "/assets/goldline/lantern-city/v4/tower-opus-la.png", h: 210 },
    { id: "century_park_east" as const, src: "/assets/goldline/lantern-city/v4/tower-century-park-east.png", h: 290 },
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
  function applyLanterns() {
    if (!M) return;
    // regions from where lanterns are, even before their tile loads
    const inside = lanterns.map(l => ({ l, ...ll(l.latitude, l.longitude) })).filter(p => servedAt(p.x, p.z));
    const regions = inside.map(p => ({ x: p.x, z: p.z, r: 220 + Math.min(p.l.total, 24) * 6 }));
    const rk = regions.map(r => `${r.x | 0},${r.z | 0},${r.r | 0}`).join(";");
    if (rk !== lastRegionsKey) {
      lastRegionsKey = rk;
      rebuildMask(regions);
      for (const key of wantedTiles()) if (!tiles.has(key)) void loadTile(key);
    }
    // lantern meshes
    for (const pl of placedLanterns) { if (pl.mesh) lanternGroup.remove(pl.mesh); lanternGroup.remove(pl.halo); }
    const prevIds = lanternBuildingIds();
    placedLanterns = inside.map(p => {
      const b = findBuilding(p.x, p.z);
      const k = brightness(p.l);
      let mesh: THREE.Object3D | null = null;
      const tile = tiles.get(tileKeyAt(p.x, p.z));
      if (b && tile && !hidden.has(b.i)) {
        mesh = kitInstances([placeKit(b, roadNear(tile))], true);
        mesh.traverse(o => { const mm = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined; if (mm?.uniforms?.uLit) mm.uniforms.uLit.value = k; });
        mesh.userData.key = p.l.key;
        lanternGroup.add(mesh);
      }
      const r = 70 + Math.sqrt(Math.max(p.l.total, 1)) * 18;
      const halo = new THREE.Mesh(new THREE.CircleGeometry(r, 40).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uA: { value: k } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
        fragmentShader: `uniform float uA; varying vec2 vUv; void main(){ float d = length(vUv - .5) * 2.; float a = pow(1. - clamp(d,0.,1.), 1.8) * .75 * uA; gl_FragColor = vec4(vec3(1., .66, .25) * a, a); }`,
      }));
      const cx = b?.cx ?? p.x, cz = b?.cz ?? p.z;
      halo.position.set(cx, ground(cx, cz) + 1.6, cz);
      halo.userData.key = p.l.key;
      halo.userData.halo = true;
      lanternGroup.add(halo);
      return { input: p.l, x: cx, z: cz, b, mesh, halo };
    });
    // a building that just became a lantern must leave the dim city
    const nowIds = lanternBuildingIds();
    const changed = [...prevIds].filter(i => !nowIds.has(i)).concat([...nowIds].filter(i => !prevIds.has(i)));
    if (changed.length) {
      for (const t of tiles.values()) {
        if (t.state === "ready" && changed.some(i => i >= t.idMin && i <= t.idMax)) rebuildTile(t);
      }
    }
    if (!framed && placedLanterns.length) frameHome();
    reportStats();
  }
  function frameHome() {
    framed = true;
    // open on the whole board: every lantern in view
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const l of placedLanterns) { x0 = Math.min(x0, l.x); x1 = Math.max(x1, l.x); z0 = Math.min(z0, l.z); z1 = Math.max(z1, l.z); }
    const aspect = Math.max(0.4, container.clientWidth / Math.max(1, container.clientHeight));
    const portrait = aspect < 1;
    // on a phone the board turns so its long east-west run goes up the screen
    const ex = (portrait ? z1 - z0 : x1 - x0) + 2200, ez = (portrait ? x1 - x0 : z1 - z0) + 2200;
    const dist = Math.min(controls.maxDistance, Math.max(2600, (Math.max(ex / aspect, ez) / (2 * Math.tan((13 * Math.PI) / 180))) * (portrait ? 0.92 : 0.78)));
    frame((x0 + x1) / 2, (z0 + z1) / 2, dist, portrait ? -Math.PI / 2 - 0.25 : -0.3);
  }
  function frame(x: number, z: number, dist: number, yaw = -0.3, pitch = 0.95) {
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
    const D = M.doors;
    let best: { x: number; z: number; s: number; doors: number } | null = null;
    for (let j = 1; j < D.nz - 1; j++) for (let i = 1; i < D.nx - 1; i++) {
      const x = M.bounds[0] + (i + 0.5) * D.cell, z = M.bounds[1] + (j + 0.5) * D.cell;
      const sd = sdField(x, z);
      if (sd < 90 || sd > 520 || !servedAt(x, z)) continue;
      let doors = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) doors += D.v[(j + b) * D.nx + i + a];
      const s = doors / (1 + sd / 400);
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
    const rounded = Math.max(5, Math.round(best.doors / 5) * 5);
    return { title: `Uncharted: ${where}`, doors: rounded, buildings: 0, miles: nearest / 1609, x: best.x, z: best.z };
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
    const hits = ray.intersectObjects(lanternGroup.children, true);
    let key: string | null = null;
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.key) o = o.parent;
      if (o) { key = o.userData.key; break; }
    }
    events.onSelect?.(key);
  }
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
    const hs = Math.min(6, Math.max(1, cd / 2600));
    for (const o of lanternGroup.children) if (o.userData.halo) o.scale.setScalar(hs);
    camera.updateProjectionMatrix();
    for (const l of landmarks) l.mesh.rotation.y = Math.atan2(camera.position.x - l.x, camera.position.z - l.z);
    if (M) updateLod();
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
    debug() {
      return placedLanterns.map(p => ({ key: p.input.key, b: p.b ? { i: p.b.i, h: p.b.h, t: p.b.t, cx: Math.round(p.b.cx), cz: Math.round(p.b.cz) } : null,
        mesh: !!p.mesh, meshes: p.mesh ? p.mesh.children.length : 0, x: Math.round(p.x), z: Math.round(p.z),
        inTile: (() => { const t = tiles.get(tileKeyAt(p.x, p.z)); return t ? { state: t.state, has: p.b ? t.bldgs.includes(p.b) : false } : null; })() }));
    },
    keys() {
      return placedLanterns.map(p => p.input.key);
    },
    focus(key: string, dist = 900) {
      const l = placedLanterns.find(p => p.input.key === key);
      if (l) flyTo(l.x, l.z, dist);
    },
    focusPoint(x: number, z: number) {
      flyTo(x, z, 1600);
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
    },
  };
}
export type LanternWorld = ReturnType<typeof createLanternWorld>;
