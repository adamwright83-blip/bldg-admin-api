/**
 * Lantern City, the island board: every neighbourhood we serve is its own island, in its real place,
 * with water between them. Islands where we have customers are open, their customers' buildings
 * lit gold; islands we haven't won yet sit under a sea of cloud that burns off when the first
 * customer there lights up.
 *
 * - Islands are the neighbourhood outlines pulled apart by water (islandLayout.ts), standing on
 *   rock cliffs, carrying their own real hills.
 * - Buildings are Lantern City's LA building set (laBuildings.ts), laid out on each island's own
 *   street grid at S times real size so a house reads as a game piece from across the board.
 * - The ground is one painted texture: the stand-in for the island paintings, which drop in
 *   as a texture swap.
 * - Golden hour: a low sun in the west-south-west, real shadows, cel bands, ink outlines.
 *
 * Imperative three.js, like LanternCityV7/lanternWorld.ts.
 */
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { K, LABuilder, planLA, VS, type Plan, type PlanInput } from "../LanternCityV7/laBuildings";
import {
  buildField, coastAt, heightSampler, layoutIslands, lonLatToBoard, ontoLand, ownerAt, pointInRing, repairOutlines,
  ringArea, rng, roadDistance, roadSegments, S, styleFor, TOP, type Field, type IslandLayout, type WorldManifest,
} from "./islandLayout";

export type IslandLantern = { key: string; latitude: number; longitude: number; name?: string; territoryName?: string };
export type IslandInfo = { name: string; lanterns: number; served: boolean; x: number; z: number };
export type IslandEvents = {
  onReady?: () => void;
  onError?: (e: unknown) => void;
  onIsland?: (info: IslandInfo | null) => void;
  onStats?: (s: { islands: number; open: number; lanterns: number }) => void;
  /** the pointer is over a lit home: every customer there, and where to show the card (page px) */
  onHover?: (h: { keys: string[]; x: number; y: number; tower?: string } | null) => void;
  /** one of our towers was clicked: open its floors */
  onTower?: (id: string) => void;
  /** game-world Laundry Farm hub: after the camera arrives, enter Operations Command */
  onOperationsHub?: () => void;
  /** the pointer is over the Operations Hub (page px), or left it */
  onOperationsHubHover?: (h: { x: number; y: number } | null) => void;
  /** the Hollywood Tin Can House was clicked up close: the camera has arrived, open the game */
  onSuitcase?: () => void;
  /** the pointer is over the Tin Can House (page px), or left it */
  onSuitcaseHover?: (h: { x: number; y: number } | null) => void;
};

const DEFAULT_BASE = "/assets/goldline/lantern-city";
const glf = (v: number) => (Number.isInteger(v) ? `${v}.` : `${v}`);

// layers: the sun's shadow pass sees layer 0 only; the ink pre-pass skips INK_SKIP
const INK_SKIP = 1;
const NO_SHADOW = 2;

const SKY_TOP = new THREE.Color("#8fb4dc");
const HAZE = new THREE.Color("#f3d6b4");

const COMMON = /* glsl */ `
  uniform vec3 uSun; uniform float uTime;
  uniform sampler2D uShadow; uniform mat4 uShadowM; uniform vec2 uShadowPx; uniform float uShadowBias;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
  float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
  // the sun's depth map, 3x3 soft
  float sunShadow(vec3 w, vec3 n) {
    vec4 p = uShadowM * vec4(w + n * 2.5, 1.);
    vec3 s = p.xyz * .5 + .5;
    if (s.x < 0. || s.y < 0. || s.x > 1. || s.y > 1. || s.z > 1.) return 1.;
    float z = s.z - uShadowBias, acc = 0.;
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) acc += step(z, texture2D(uShadow, s.xy + vec2(float(i), float(j)) * uShadowPx).r);
    return acc / 9.;
  }
  // golden hour, in cel bands: a warm sun, violet-blue shade, sky light from above
  vec3 toon(vec3 alb, vec3 n, vec3 w, float ao) {
    float ndl = dot(n, uSun);
    float sh = sunShadow(w, n);
    float lit = smoothstep(.02, .09, ndl) * sh;
    float hot = smoothstep(.55, .6, ndl) * sh;
    vec3 sunC = vec3(1., .9, .76);
    vec3 sky = mix(vec3(.36, .38, .58), vec3(.58, .67, .88), .5 + .5 * n.y);
    return alb * (sky * .62 * ao + sunC * (lit * .86 + hot * .2));
  }
`;
const FOG_V = /* glsl */ `#include <fog_pars_vertex>`;
const FOG_F = /* glsl */ `#include <fog_pars_fragment>`;

export function createIslandBoard(container: HTMLElement, events: IslandEvents = {}, opts: { assetBase?: string; capture?: boolean } = {}) {
  const ASSETS = opts.assetBase ?? DEFAULT_BASE;
  let disposed = false;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: !!opts.capture });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";

  const scene = new THREE.Scene();
  scene.background = (() => {
    const c = document.createElement("canvas");
    c.width = 4; c.height = 256;
    const g = c.getContext("2d")!;
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, "#7fa6d6"); gr.addColorStop(0.5, "#b9c9e0"); gr.addColorStop(0.8, "#f1d4b2"); gr.addColorStop(1, "#f6c99a");
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  scene.fog = new THREE.Fog(HAZE, 20000, 60000);
  const fogU = { fogColor: { value: HAZE }, fogNear: { value: 20000 }, fogFar: { value: 60000 } };

  const camera = new THREE.PerspectiveCamera(28, 1, 20, 80000);
  camera.layers.enable(INK_SKIP);
  camera.layers.enable(NO_SHADOW);
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 260;
  controls.maxDistance = 30000;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = 1.2;
  controls.screenSpacePanning = false;
  controls.minAzimuthAngle = -0.5;
  controls.maxAzimuthAngle = 0.5;

  // the sun: west-south-west, low; shadows stretch east-north-east across the channels
  const SUN = new THREE.Vector3(-0.78, 0.5, 0.38).normalize();
  const uniforms: Record<string, THREE.IUniform> = {
    uSun: { value: SUN }, uTime: { value: 0 },
    uShadow: { value: null }, uShadowM: { value: new THREE.Matrix4() }, uShadowPx: { value: new THREE.Vector2(1 / 4096, 1 / 4096) }, uShadowBias: { value: 0.0006 },
  };

  // ----------------------------------------------------------------- the sun's shadow map
  const SHADOW_SIZE = 4096;
  const shadowTarget = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, { depthBuffer: true });
  shadowTarget.depthTexture = new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE);
  shadowTarget.depthTexture.type = THREE.UnsignedIntType;
  uniforms.uShadow.value = shadowTarget.depthTexture;
  const sunCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2);
  const shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  let shadowDirty = true;
  function fitSun(x0: number, z0: number, x1: number, z1: number) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, R = Math.hypot(x1 - x0, z1 - z0) / 2 + 1500;
    sunCam.position.set(cx, 0, cz).addScaledVector(SUN, R * 2);
    sunCam.up.set(0, 1, 0);
    sunCam.lookAt(cx, 0, cz);
    sunCam.updateMatrixWorld();
    // bound the board's corners (and the tallest towers) in the sun's view
    const inv = sunCam.matrixWorldInverse;
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity, n = Infinity, f = -Infinity;
    for (const x of [x0, x1]) for (const z of [z0, z1]) for (const y of [-60, 1100]) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(inv);
      a = Math.min(a, v.x); b = Math.max(b, v.x); c = Math.min(c, v.y); d = Math.max(d, v.y); n = Math.min(n, -v.z); f = Math.max(f, -v.z);
    }
    Object.assign(sunCam, { left: a, right: b, bottom: c, top: d, near: Math.max(1, n - 50), far: f + 50 });
    sunCam.updateProjectionMatrix();
    const bias = new THREE.Matrix4();
    uniforms.uShadowM.value.copy(bias.multiplyMatrices(sunCam.projectionMatrix, sunCam.matrixWorldInverse));
    uniforms.uShadowBias.value = 6 / (sunCam.far - sunCam.near);
  }
  // the shadow map covers what you're looking at: the whole board from far out, a few blocks up close
  let shadowFit = { x: 0, z: 0, r: 0 };
  function fitShadowToView(cd: number) {
    const full = Math.hypot(rect.x1 - rect.x0, rect.z1 - rect.z0) / 2;
    const r = Math.min(full, Math.max(1400, cd * 1.5));
    const t = controls.target;
    const moved = Math.hypot(t.x - shadowFit.x, t.z - shadowFit.z);
    if (shadowFit.r && moved < shadowFit.r * 0.2 && r / shadowFit.r < 1.25 && r / shadowFit.r > 0.8) return;
    if (r >= full) fitSun(rect.x0 + 1000, rect.z0 + 1000, rect.x1 - 1000, rect.z1 - 1000);
    else fitSun(t.x - r, t.z - r * 0.7, t.x + r, t.z + r * 1.1);
    shadowFit = { x: t.x, z: t.z, r };
    shadowDirty = true;
  }
  function renderShadows() {
    const bg = scene.background, fog = scene.fog;
    scene.background = null; scene.fog = null; scene.overrideMaterial = shadowMat;
    renderer.setRenderTarget(shadowTarget);
    renderer.clear();
    renderer.render(scene, sunCam);
    renderer.setRenderTarget(null);
    scene.background = bg; scene.fog = fog; scene.overrideMaterial = null;
    shadowDirty = false;
  }

  // ----------------------------------------------------------------- post: paint, ink, bloom, tilt-shift, grade
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const inkTarget = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  inkTarget.depthTexture = new THREE.DepthTexture(2, 2);
  const inkNormals = new THREE.MeshNormalMaterial();
  const quadV = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`;
  // paint: a four-sector Kuwahara filter flattens the render into brush-sized patches of colour
  const paint = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uPx: { value: new THREE.Vector2(1, 1) }, uR: { value: 3 } },
    vertexShader: quadV,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform vec2 uPx; uniform float uR; varying vec2 vUv;
      void main() {
        vec3 m[4]; vec3 s[4];
        for (int k = 0; k < 4; k++) { m[k] = vec3(0.); s[k] = vec3(0.); }
        float n = 0.;
        for (int j = 0; j <= 3; j++) for (int i = 0; i <= 3; i++) {
          vec2 o = vec2(float(i), float(j)) * uPx * uR / 3.;
          vec3 a = texture2D(tDiffuse, vUv + vec2(-o.x, -o.y)).rgb, b = texture2D(tDiffuse, vUv + vec2(o.x, -o.y)).rgb;
          vec3 c = texture2D(tDiffuse, vUv + vec2(-o.x, o.y)).rgb, d = texture2D(tDiffuse, vUv + o).rgb;
          m[0] += a; s[0] += a * a; m[1] += b; s[1] += b * b; m[2] += c; s[2] += c * c; m[3] += d; s[3] += d * d;
          n += 1.;
        }
        float best = 1e9; vec3 col = vec3(0.);
        for (int k = 0; k < 4; k++) {
          vec3 mu = m[k] / n; vec3 v = abs(s[k] / n - mu * mu);
          float sg = v.r + v.g + v.b;
          if (sg < best) { best = sg; col = mu; }
        }
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  composer.addPass(paint);
  const ink = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, tNormal: { value: inkTarget.texture }, tDepth: { value: inkTarget.depthTexture },
      uPx: { value: new THREE.Vector2(1, 1) }, uNear: { value: 1 }, uFar: { value: 1000 }, uStrength: { value: 0.9 },
    },
    vertexShader: quadV,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform sampler2D tNormal; uniform sampler2D tDepth;
      uniform vec2 uPx; uniform float uNear; uniform float uFar; uniform float uStrength; varying vec2 vUv;
      float lin(vec2 uv) { float z = texture2D(tDepth, uv).x * 2. - 1.; return 2. * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
      vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).xyz * 2. - 1.; }
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float d0 = lin(vUv); vec3 n0 = nrm(vUv);
        float dd = 0., nd = 0.;
        for (int i = 0; i < 4; i++) {
          vec2 o = (i == 0 ? vec2(1., 0.) : i == 1 ? vec2(-1., 0.) : i == 2 ? vec2(0., 1.) : vec2(0., -1.)) * uPx;
          float di = lin(vUv + o);
          dd = max(dd, (d0 - di) / d0);
          nd = max(nd, 1. - dot(n0, nrm(vUv + o)));
        }
        float e = max(smoothstep(.01, .026, dd), smoothstep(.2, .45, nd));
        vec3 inkCol = c.rgb * .3 + vec3(.05, .03, .06);
        gl_FragColor = vec4(mix(c.rgb, inkCol, e * uStrength), c.a);
      }`,
  });
  ink.uniforms.tNormal.value = inkTarget.texture;
  ink.uniforms.tDepth.value = inkTarget.depthTexture;
  composer.addPass(ink);
  function renderInkPrepass() {
    const bg = scene.background, fog = scene.fog;
    scene.background = null; scene.fog = null; scene.overrideMaterial = inkNormals;
    camera.layers.disable(INK_SKIP);
    renderer.setRenderTarget(inkTarget);
    renderer.setClearColor(0x8080ff, 1);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    camera.layers.enable(INK_SKIP);
    scene.background = bg; scene.fog = fog; scene.overrideMaterial = null;
    ink.uniforms.uNear.value = camera.near;
    ink.uniforms.uFar.value = camera.far;
  }
  // only true light sources bloom (lanterns, lamps, glints); sunlit stucco stays below the threshold
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.5, 0.35, 1.18);
  composer.addPass(bloom);
  const tilt = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(2, 2) }, uAmt: { value: 1.3 } },
    vertexShader: quadV,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uAmt; varying vec2 vUv;
      void main() {
        float b = smoothstep(.2, .62, abs(vUv.y - .52)) * uAmt;
        vec4 s = vec4(0.); float ws = 0.;
        for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) {
          vec2 o = vec2(float(i), float(j)) * b / uRes; float w = 1. - length(vec2(i, j)) / 4.5;
          if (w > 0.) { s += texture2D(tDiffuse, vUv + o) * w; ws += w; }
        }
        vec3 c = (s / ws).rgb;
        // grade: warm highlights, cool violet shadows, a soft vignette
        float L = dot(c, vec3(.3, .59, .11));
        c = mix(c * vec3(.93, .95, 1.08), c * vec3(1.06, 1.01, .92), smoothstep(.2, .8, L));
        c = mix(vec3(L), c, 1.12);
        float vg = smoothstep(1.25, .45, length((vUv - .5) * vec2(1.25, 1.)));
        gl_FragColor = vec4(c * mix(.78, 1., vg), 1.);
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
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    inkTarget.setSize(db.x, db.y);
    ink.uniforms.uPx.value.set(1 / db.x, 1 / db.y);
    paint.uniforms.uPx.value.set(1 / db.x, 1 / db.y);
    tilt.uniforms.uRes.value.set(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ----------------------------------------------------------------- state
  let M: WorldManifest;
  let F: Field;
  let H = (_x: number, _z: number, _o?: number) => 0;
  let islands: IslandLayout[] = [];
  let ready = false;
  const labelScene = new THREE.Scene();      // drawn after the post chain, crisp
  const world = new THREE.Group();          // board space
  const mini = new THREE.Group();           // mini space, drawn S times larger
  mini.scale.setScalar(S);
  scene.add(world, mini);
  let groundTex: THREE.CanvasTexture;
  let coastTex: THREE.DataTexture;
  const rect = { x0: 0, z0: 0, x1: 1, z1: 1 };
  const U = {
    uGround: { value: null as THREE.Texture | null }, uCoast: { value: null as THREE.Texture | null }, uRect: { value: new THREE.Vector4() },
    uOwn: { value: null as THREE.Texture | null }, uIsl: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) },
    uIslShift: { value: new Array(16).fill(0) }, uBoats: { value: Array.from({ length: 24 }, () => new THREE.Vector4(0, 0, 0, 0)) },
  };

  // ----------------------------------------------------------------- load
  async function load() {
    const m = await fetch(`${ASSETS}/v7/world/manifest.json`).then(r => r.json());
    M = { ...m, outline: repairOutlines(m.outline) };
    F = buildField(M.outline, M.bounds);
    H = heightSampler(M, F);
    rect.x0 = F.x0; rect.z0 = F.z0; rect.x1 = F.x0 + (F.nx - 1) * F.cell; rect.z1 = F.z0 + (F.nz - 1) * F.cell;
    U.uRect.value.set(rect.x0, rect.z0, rect.x1, rect.z1);
    const segs = roadSegments(M);
    const road = roadDistance(segs, F);
    const byName = new Map<string, typeof segs>();
    for (const s of segs) { const l = byName.get(s.n) ?? []; l.push(s); byName.set(s.n, l); }
    const roadNamed = (names: string[], x: number, z: number) => {
      let best = 1e9;
      for (const n of names) for (const s of byName.get(n) ?? []) best = Math.min(best, Math.hypot(x - (s.a[0] + s.b[0]) / 2, z - (s.a[1] + s.b[1]) / 2));
      return best;
    };
    const bigParks = M.parks.filter(p => ringArea(p) > 40000);
    const lakes = M.water.filter(p => ringArea(p) > 20000);
    const nearLake = (x: number, z: number) => lakes.some(p => pointInRing(x, z, p) || p.some(([a, b]) => Math.hypot(a - x, b - z) < 60));
    islands = layoutIslands(M, { field: F, height: H, road, roadNamed, park: (x, z) => bigParks.some(p => pointInRing(x, z, p)), lake: nearLake });
    addLandmarks();
    try { addOperationsHub(); } catch (e) { console.warn("[islands] Laundry Farm operations hub skipped", e); }
    try { addSuitcase(); } catch (e) { console.warn("[islands] suitcase landmark skipped", e); }   // never let the easter egg take the city down
    buildCoastTexture();
    paintGround(segs, bigParks);
    buildLand();
    buildWater();
    buildTrees();
    buildBridges();
    buildBoats();
    buildClouds();
    buildLabels();
    fitSun(rect.x0 + 1000, rect.z0 + 1000, rect.x1 - 1000, rect.z1 - 1000);
    startBuildings();
    ready = true;
    frameBoard();
    applyLanterns(true);
    if (opts.capture) console.log(`[islands] ${islands.map(l => `${l.name}:${l.plans.length}`).join(" ")}`);
  }

  // ----------------------------------------------------------------- landmarks: our two towers, the observatory
  const LANDMARKS: { id?: string; name: string; lat: number; lon: number; kind: "tower" | "observatory" | "round"; h?: number }[] = [
    { id: "opus_la", name: "OPUS LA", lat: 34.0618, lon: -118.3011, kind: "tower", h: 78 },
    { id: "century_park_east", name: "Century Park East", lat: 34.0591, lon: -118.4147, kind: "tower", h: 96 },
    { name: "Observatory", lat: 34.1184, lon: -118.3004, kind: "observatory" },
    { name: "Round tower", lat: 34.1032, lon: -118.3267, kind: "round" },
  ];
  const extraMeshes: THREE.BufferGeometry[] = [];
  /** Viral entry point: a game-world Laundry Farm Operations Hub in Silver Lake. It is not a literal processing-facility address. */
  let operationsHub: { x: number; z: number; h: number } | null = null;
  /** Small Comforts: the lost-property suitcase on Hollywood. Zoom to the island, click it, you're inside. */
  let suitcase: { x: number; z: number; h: number } | null = null;
  const ourTowers: { id: string; planId: number; x: number; z: number; h: number }[] = [];
  /** the tower of ours under the pointer (within 40px of its shaft on screen) */
  function towerAt(cx: number, cy: number) {
    const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3();
    for (const t of ourTowers) for (const f of [0.3, 0.6, 0.9]) {
      v.set(t.x, H(t.x, t.z) + t.h * f, t.z).project(camera);
      if (v.z < 1 && Math.hypot(r.left + ((v.x + 1) / 2) * r.width - cx, r.top + ((1 - v.y) / 2) * r.height - cy) < 40) return t;
    }
    return null;
  }
  function addLandmarks() {
    // landmark towers are ordinary buildings (customers live in them); only the kit pieces sit at 900000+
    let id = 800000;
    for (const L of LANDMARKS) {
      let { x, z } = lonLatToBoard(M, L.lat, L.lon);
      ({ x, z } = ontoLand(F, x, z, L.kind === "observatory" ? 90 : 60));
      const own = ownerAt(F, x, z);
      const isl = islands[own];
      if (!isl) continue;
      // clear anything standing where the landmark goes
      isl.plans = isl.plans.filter(p => Math.hypot(p.x - x / S, p.z - z / S) > (L.kind === "tower" ? 30 : 26));
      isl.trees = isl.trees.filter(t => Math.hypot(t.x - x / S, t.z - z / S) > 22);
      if (L.kind === "tower") {
        ourTowers.push({ id: L.id!, planId: id, x, z, h: L.h! * VS * S });
        isl.plans.push({ i: id, cx: id, cz: 0, h: L.h!, u: 0, type: "office", hood: isl.name, x: x / S, z: z / S, fx: 0, fz: 1, W: 30, D: 34, fill: 1 });
        id++;
      } else extraMeshes.push(L.kind === "observatory" ? observatory(x / S, z / S) : roundTower(x / S, z / S));
    }
    // Century City is towers: a hand-set cluster around Century Park East and the Avenue of the Stars
    const cc = islands.find(i => i.name === "Century City");
    if (cc) {
      const r = rng(4242);
      const c0 = lonLatToBoard(M, 34.0575, -118.4165);
      for (let t = 0; t < 60 && cc.plans.length < 16; t++) {
        const p = ontoLand(F, c0.x + (r() - 0.5) * 900, c0.z + (r() - 0.5) * 1500, 70);
        if (!p.ok || ownerAt(F, p.x, p.z) !== cc.index) continue;
        if (cc.plans.some(q => Math.hypot(q.x - p.x / S, q.z - p.z / S) < 44)) continue;
        const a = 0.62, fx = -Math.sin(a), fz = Math.cos(a);
        cc.plans.push({ i: id, cx: id, cz: 0, h: 40 + r() * 60, u: 0, type: "office", hood: cc.name, x: p.x / S, z: p.z / S, fx, fz, W: 24 + r() * 10, D: 26 + r() * 10, fill: 1 });
        id++;
      }
    }
  }
  function addOperationsHub() {
    // This is deliberately a game-world hub, not a claim about where Laundry Farm physically processes orders.
    // Silver Lake gives the viral zoom-in a dense, central-looking LA setting close to the visual heart of the board.
    const isl =
      islands.find(i => i.name === "Silver Lake") ??
      islands.find(i => i.name === "East Hollywood") ??
      islands.find(i => i.name === "Los Feliz") ??
      islands.find(i => i.plans.length);
    if (!isl) return;

    const target = lonLatToBoard(M, 34.0915, -118.2810);
    let { x, z } = ontoLand(F, target.x, target.z, 100);
    if (ownerAt(F, x, z) !== isl.index) {
      ({ x, z } = ontoLand(F, isl.label[0], isl.label[1], 100));
    }
    if (ownerAt(F, x, z) !== isl.index) {
      x = isl.label[0];
      z = isl.label[1];
    }

    // Give the hub visual breathing room so the landmark reads at island scale.
    isl.plans = isl.plans.filter(p => Math.hypot(p.x - x / S, p.z - z / S) > 74);
    isl.trees = isl.trees.filter(t => Math.hypot(t.x - x / S, t.z - z / S) > 54);

    const mx = x / S, mz = z / S, y = H(x, z) / S;
    const forest = "#214d3c", forestDark = "#17382d", cream = "#f2eadb";
    const orange = "#f2581b", gold = "#ffc84d", glass = "#83b8c9";
    const box = (w: number, h: number, d: number, px: number, py: number, pz: number) =>
      new THREE.BoxGeometry(w, h, d).translate(mx + px, y + py, mz + pz);

    const parts: { g: THREE.BufferGeometry; col: string; k: number }[] = [
      // Low industrial/operations building with a bold roof band.
      { g: box(64, 15, 42, 0, 7.5, 0), col: cream, k: K.WALL },
      { g: box(68, 2.4, 46, 0, 16.2, 0), col: forest, k: K.ROOF },
      { g: box(66, 3.2, 5.5, 0, 12.3, 20.3), col: forestDark, k: K.TRIM },
      { g: box(58, 0.8, 14, 0, 0.4, 26), col: "#d8cdb8", k: K.TRIM },
      // Orange loading/dispatch stripe: the same operational accent as the floor view.
      { g: box(50, 1.3, 1.4, 0, 4.2, 21.5), col: orange, k: K.TRIM },
    ];

    // Three round machine-window motifs on the facade make "laundry" readable without text.
    for (const dx of [-18, 0, 18]) {
      const ring = new THREE.CylinderGeometry(5.2, 5.2, 1.2, 24)
        .rotateX(Math.PI / 2)
        .translate(mx + dx, y + 8.2, mz + 21.5);
      const drum = new THREE.CylinderGeometry(3.7, 3.7, 1.35, 24)
        .rotateX(Math.PI / 2)
        .translate(mx + dx, y + 8.2, mz + 22.0);
      parts.push({ g: ring, col: forestDark, k: K.TRIM });
      parts.push({ g: drum, col: glass, k: K.CURTAIN });
    }

    // A gold map pin makes the hub visible from the full-board camera.
    parts.push({
      g: new THREE.ConeGeometry(7, 16, 14).rotateX(Math.PI).translate(mx, y + 36, mz),
      col: gold,
      k: K.TRIM,
    });
    parts.push({
      g: new THREE.SphereGeometry(5.4, 14, 10).translate(mx, y + 49, mz),
      col: gold,
      k: K.BEACON,
    });

    extraMeshes.push(kitGeo(parts, 900400));
    operationsHub = { x, z, h: 56 * S };

    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(760, 760).rotateX(-Math.PI / 2),
      haloMat,
    );
    halo.position.set(x, H(x, z) + 3, z);
    halo.layers.set(INK_SKIP);
    scene.add(halo);
  }

  function addSuitcase() {
    const isl = islands.find(i => i.name === "Hollywood") ?? islands.find(i => i.plans.length);
    if (!isl) return;
    let { x, z } = ontoLand(F, isl.label[0], isl.label[1], 90);
    const own = ownerAt(F, x, z);
    if (own !== isl.index) ({ x, z } = { x: isl.label[0], z: isl.label[1] });
    isl.plans = isl.plans.filter(p => Math.hypot(p.x - x / S, p.z - z / S) > 62);
    isl.trees = isl.trees.filter(t => Math.hypot(t.x - x / S, t.z - z / S) > 44);

    const mx = x / S, mz = z / S, y = H(x, z) / S;
    const metal = "#9ea4a6", metalDark = "#60676b", rust = "#955a3c";
    const brass = "#d8a93d", cream = "#f6ebd3", warm = "#ffb347";
    const f = 1.55;
    const parts: { g: THREE.BufferGeometry; col: string; k: number }[] = [];

    // The Hollywood landmark is the Tin Can House: an oversized found-object
    // dwelling that visually matches the updated Small Comforts proprietor game.
    parts.push({
      g: new THREE.CylinderGeometry(20 * f, 20 * f, 30 * f, 28).translate(mx, y + 15 * f, mz),
      col: metal,
      k: K.WALL,
    });
    parts.push({
      g: new THREE.CylinderGeometry(21.5 * f, 21.5 * f, 2.6 * f, 28).translate(mx, y + 31 * f, mz),
      col: metalDark,
      k: K.ROOF,
    });
    parts.push({
      g: new THREE.CylinderGeometry(21 * f, 21 * f, 2.2 * f, 28).translate(mx, y + 1.1 * f, mz),
      col: rust,
      k: K.TRIM,
    });
    for (const h of [7, 14, 21, 28]) {
      parts.push({
        g: new THREE.TorusGeometry(20.25 * f, 0.65 * f, 6, 28)
          .rotateX(Math.PI / 2)
          .translate(mx, y + h * f, mz),
        col: metalDark,
        k: K.TRIM,
      });
    }

    // Front door and found-object windows.
    parts.push({
      g: new THREE.BoxGeometry(8 * f, 13 * f, 1.4 * f).translate(mx, y + 7 * f, mz + 20.2 * f),
      col: cream,
      k: K.TRIM,
    });
    parts.push({
      g: new THREE.CylinderGeometry(4.2 * f, 4.2 * f, 1.5 * f, 20)
        .rotateX(Math.PI / 2)
        .translate(mx - 8 * f, y + 19 * f, mz + 20.5 * f),
      col: warm,
      k: K.BEACON,
    });
    parts.push({
      g: new THREE.CylinderGeometry(3.6 * f, 3.6 * f, 1.5 * f, 20)
        .rotateZ(Math.PI / 2)
        .translate(mx + 20.5 * f, y + 18 * f, mz - 5 * f),
      col: warm,
      k: K.BEACON,
    });

    // Thimble chimney and brass roof marker.
    parts.push({
      g: new THREE.CylinderGeometry(3.4 * f, 2.8 * f, 10 * f, 16)
        .translate(mx + 10 * f, y + 36 * f, mz - 3 * f),
      col: rust,
      k: K.TRIM,
    });
    parts.push({
      g: new THREE.ConeGeometry(5, 11, 12).rotateX(Math.PI).translate(mx, y + 58, mz),
      col: brass,
      k: K.TRIM,
    });
    parts.push({
      g: new THREE.SphereGeometry(4.2, 12, 8).translate(mx, y + 68, mz),
      col: brass,
      k: K.BEACON,
    });

    // Use the approved Small Comforts Tin Can House art on the map instead
    // of a low-detail procedural placeholder. The interaction anchor remains
    // in world space so click/hover/fly behavior is unchanged.
    const tinCanTexture = new THREE.TextureLoader().load(
      "/assets/joystick-home/tin-can-house.webp"
    );
    tinCanTexture.colorSpace = THREE.SRGBColorSpace;
    const tinCanSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tinCanTexture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
      })
    );
    tinCanSprite.position.set(mx, y + 30 * f, mz);
    tinCanSprite.scale.set(88, 59, 1);
    tinCanSprite.center.set(0.5, 0.08);
    tinCanSprite.renderOrder = 5;
    tinCanSprite.layers.set(INK_SKIP);
    mini.add(tinCanSprite);

    suitcase = { x, z, h: 58 * S };
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(560, 560).rotateX(-Math.PI / 2), haloMat);
    halo.position.set(x, H(x, z) + 3, z);
    halo.layers.set(INK_SKIP);
    scene.add(halo);
  }
  // tiny geometry builders in mini space with the building shader's attributes
  function kitGeo(parts: { g: THREE.BufferGeometry; col: string; k: number }[], id: number) {
    const gs = parts.map(({ g, col, k }) => {
      const gg = g.index ? g.toNonIndexed() : g;
      gg.deleteAttribute("uv");
      const n = gg.attributes.position.count, c = new THREE.Color(col);
      gg.setAttribute("aCol", new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [c.r, c.g, c.b]), 3));
      gg.setAttribute("aK", new THREE.Float32BufferAttribute(new Array(n).fill(k), 1));
      gg.setAttribute("aC", new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [id, 0, 0, 0.5]), 4));
      return gg;
    });
    return mergeGeometries(gs)!;
  }
  function observatory(x: number, z: number) {
    const y = H(x * S, z * S) / S;
    const white = "#f2eee4", dome = "#6c8f86", trim = "#d8c9a8";
    const g = kitGeo([
      { g: new THREE.BoxGeometry(34, 7, 12).translate(x, y + 3.5, z + 2), col: white, k: K.WALL },
      { g: new THREE.BoxGeometry(12, 9, 14).translate(x, y + 4.5, z), col: white, k: K.WALL },
      { g: new THREE.CylinderGeometry(7.5, 7.5, 3, 24).translate(x, y + 10, z), col: trim, k: K.TRIM },
      { g: new THREE.SphereGeometry(7.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, y + 11.5, z), col: dome, k: K.ROOF },
      { g: new THREE.CylinderGeometry(4, 4, 3, 18).translate(x - 15, y + 8, z + 2), col: trim, k: K.TRIM },
      { g: new THREE.SphereGeometry(3.9, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2).translate(x - 15, y + 9.5, z + 2), col: dome, k: K.ROOF },
      { g: new THREE.CylinderGeometry(4, 4, 3, 18).translate(x + 15, y + 8, z + 2), col: trim, k: K.TRIM },
      { g: new THREE.SphereGeometry(3.9, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2).translate(x + 15, y + 9.5, z + 2), col: dome, k: K.ROOF },
      { g: new THREE.BoxGeometry(46, 0.6, 26).translate(x, y + 0.3, z + 4), col: "#e6dcc6", k: K.TRIM },
    ], 900100);
    return g;
  }
  function roundTower(x: number, z: number) {
    const y = H(x * S, z * S) / S;
    const parts: { g: THREE.BufferGeometry; col: string; k: number }[] = [];
    for (let f = 0; f < 12; f++) {
      const r = 8.5;
      parts.push({ g: new THREE.CylinderGeometry(r, r, 3.2, 28).translate(x, y + f * 3.6 + 1.6, z), col: "#dfe6ea", k: K.CURTAIN });
      parts.push({ g: new THREE.CylinderGeometry(r + 1.2, r + 1.2, 0.4, 28).translate(x, y + f * 3.6 + 3.4, z), col: "#f4f2ec", k: K.TRIM });
    }
    parts.push({ g: new THREE.CylinderGeometry(0.25, 0.4, 16, 6).translate(x, y + 12 * 3.6 + 8, z), col: "#e8e4dc", k: K.TRIM });
    parts.push({ g: new THREE.SphereGeometry(0.7, 8, 6).translate(x, y + 12 * 3.6 + 16.4, z), col: "#ff4030", k: K.BEACON });
    return kitGeo(parts, 900200);
  }

  // ----------------------------------------------------------------- the coast as a texture (water shading, foam)
  function buildCoastTexture() {
    const data = new Float32Array(F.nx * F.nz * 2);
    for (let k = 0; k < F.c.length; k++) { data[k * 2] = F.c[k]; data[k * 2 + 1] = F.own[k] + 1; }
    coastTex = new THREE.DataTexture(data, F.nx, F.nz, THREE.RGFormat, THREE.FloatType);
    coastTex.magFilter = coastTex.minFilter = THREE.LinearFilter;
    coastTex.needsUpdate = true;
    U.uCoast.value = coastTex;
    // island owner, nearest-sampled, for the street grid in the ground shader
    const o = new Uint8Array(F.nx * F.nz);
    for (let k = 0; k < F.c.length; k++) o[k] = F.own[k] + 1;
    const ot = new THREE.DataTexture(o, F.nx, F.nz, THREE.RedFormat, THREE.UnsignedByteType);
    ot.magFilter = ot.minFilter = THREE.NearestFilter;
    ot.needsUpdate = true;
    U.uOwn.value = ot;
    // each island's street grid: centre, rotation
    islands.forEach((l, i) => {
      let sx = 0, sz = 0, n = 0;
      for (let k = 0; k < F.c.length; k++) if (F.own[k] === i) { sx += F.x0 + (k % F.nx) * F.cell; sz += F.z0 + Math.floor(k / F.nx) * F.cell; n++; }
      const rot = styleFor(l.name).rot;
      if (n && i < 16) U.uIsl.value[i].set(sx / n, sz / n, Math.cos(rot), Math.sin(rot));
    });
  }

  // ----------------------------------------------------------------- the painted ground (the painting slot)
  function paintGround(segs: { a: [number, number]; b: [number, number] }[], parks: [number, number][][]) {
    const W = 4096, Hh = Math.round((W * (rect.z1 - rect.z0)) / (rect.x1 - rect.x0));
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = Hh;
    const g = cv.getContext("2d")!;
    const px = (x: number) => ((x - rect.x0) / (rect.x1 - rect.x0)) * W, pz = (z: number) => ((z - rect.z0) / (rect.z1 - rect.z0)) * Hh;
    const ppm = W / (rect.x1 - rect.x0);
    // base: each island's ground colour, mottled
    const img = g.createImageData(W, Hh);
    const cols = islands.map(l => new THREE.Color(styleFor(l.name).ground));
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
      const x = rect.x0 + (i / W) * (rect.x1 - rect.x0), z = rect.z0 + (j / Hh) * (rect.z1 - rect.z0);
      const o = ownerAt(F, x, z), q = (j * W + i) * 4;
      const c = o >= 0 ? cols[o] : new THREE.Color("#d9c38a");
      const n = Math.sin(x * 0.011 + Math.sin(z * 0.007) * 2) * 0.5 + Math.sin(z * 0.013 + Math.sin(x * 0.005) * 3) * 0.5;
      const v = 1 + n * 0.05;
      img.data[q] = Math.min(255, c.r * 255 * v); img.data[q + 1] = Math.min(255, c.g * 255 * v); img.data[q + 2] = Math.min(255, c.b * 255 * v); img.data[q + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // blocks: shops and towers on paving, houses on lawns, parks deep green
    for (const l of islands) {
      const st = styleFor(l.name);
      for (const b of l.blocks) {
        g.save();
        g.translate(px(b.cx), pz(b.cz));
        g.rotate(b.rot);
        const w = 6 * 15 * S * ppm, d = 2 * 36 * S * ppm;
        g.fillStyle = b.program === "park" ? "#5f9e45" : b.program === "towers" ? "#e2d6bc" : b.program === "apartments" ? "#cdbf9c" : st.lawn;
        g.fillRect(-w / 2, -d / 2, w, d);
        if (b.program === "park") {
          g.strokeStyle = "#e8d7ab"; g.lineWidth = 2.2;
          g.beginPath(); g.moveTo(-w / 2, -d / 2); g.quadraticCurveTo(0, d * 0.1, w / 2, d / 2); g.moveTo(-w / 2, d / 2); g.quadraticCurveTo(w * 0.1, 0, w / 2, -d / 2); g.stroke();
        } else if (b.program !== "towers") {
          // lot lines: each back yard a slightly different green
          for (let q = 0; q < 12; q++) {
            g.fillStyle = `rgba(${q % 3 ? 40 : 255},${q % 2 ? 80 : 120},30,${0.05 + (q % 4) * 0.02})`;
            g.fillRect(-w / 2 + (q % 6) * (w / 6), q < 6 ? -d / 2 : 0, w / 6 - 1, d / 2 - 1);
          }
        }
        g.restore();
      }
    }
    // parks from the map
    g.fillStyle = "#5c9a43";
    for (const p of parks) {
      g.beginPath();
      p.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z))));
      g.closePath(); g.fill();
    }
    // boulevards: kerb, asphalt, a planted median
    g.lineCap = "round";
    for (const [w, c] of [[88, "#efe3c8"], [72, "#77706c"], [8, "#6f9a4f"]] as const) {
      g.strokeStyle = c; g.lineWidth = w * ppm;
      g.beginPath();
      for (const s of segs) { g.moveTo(px(s.a[0]), pz(s.a[1])); g.lineTo(px(s.b[0]), pz(s.b[1])); }
      g.stroke();
    }
    // lakes
    g.fillStyle = "#2fa9c0";
    for (const p of M.water) if (ringArea(p) > 20000) { g.beginPath(); p.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z)))); g.closePath(); g.fill(); }
    groundTex = new THREE.CanvasTexture(cv);
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.flipY = false;   // row 0 is the north edge, as the shader reads it
    groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    groundTex.generateMipmaps = true;
    groundTex.minFilter = THREE.LinearMipmapLinearFilter;
    U.uGround.value = groundTex;
  }

  // ----------------------------------------------------------------- islands: painted tops on rock cliffs
  function buildLand() {
    const { nx, nz, x0, z0, cell, c, own } = F;
    const vid = new Int32Array(nx * nz).fill(-1);
    const P: number[] = [], topOf: number[] = [], vOwn: number[] = [];
    const snapped: boolean[] = [];
    const gradAt = (x: number, z: number) => {
      const e = cell * 0.5;
      const gx = (coastAt(F, x + e, z) - coastAt(F, x - e, z)) / (2 * e), gz = (coastAt(F, x, z + e) - coastAt(F, x, z - e)) / (2 * e);
      return [gx, gz];
    };
    const V = (i: number, j: number) => {
      const k = j * nx + i;
      if (vid[k] >= 0) return vid[k];
      let x = x0 + i * cell, z = z0 + j * cell;
      let o = own[k];
      const out = c[k] < 0;
      if (out) {
        // pull the vertex onto the coastline (a Newton step along the field's gradient)
        for (let it = 0; it < 3; it++) {
          const cc = coastAt(F, x, z);
          const [gx, gz] = gradAt(x, z);
          const g2 = gx * gx + gz * gz;
          if (g2 < 1e-6) break;
          let dx = (-cc * gx) / g2, dz = (-cc * gz) / g2;
          const L = Math.hypot(dx, dz);
          if (L > cell * 1.5) { dx *= (cell * 1.5) / L; dz *= (cell * 1.5) / L; }
          x += dx; z += dz;
        }
        for (const kk of [k - 1, k + 1, k - nx, k + nx, k - nx - 1, k - nx + 1, k + nx - 1, k + nx + 1]) if (kk >= 0 && kk < own.length && own[kk] >= 0) { o = own[kk]; break; }
      }
      const y = H(x, z, o);
      vid[k] = P.length / 3;
      P.push(x, y, z); topOf.push(y); vOwn.push(o); snapped.push(out);
      return vid[k];
    };
    const I: number[] = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      const a = c[k] >= 0, b = c[k + 1] >= 0, d = c[k + nx] >= 0, e = c[k + nx + 1] >= 0;
      if (!a && !b && !d && !e) continue;
      const v00 = V(i, j), v10 = V(i + 1, j), v01 = V(i, j + 1), v11 = V(i + 1, j + 1);
      const tri = (p: number, q: number, r: number, ip: boolean, iq: boolean, ir: boolean) => { if (ip || iq || ir) I.push(p, q, r); };
      if ((a && e) || !(b && d)) { tri(v00, v01, v11, a, d, e); tri(v00, v11, v10, a, e, b); }
      else { tri(v10, v00, v01, b, a, d); tri(v10, v01, v11, b, d, e); }
    }
    const top = new THREE.BufferGeometry();
    top.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    top.setIndex(I);
    top.computeVertexNormals();
    const topMesh = new THREE.Mesh(top, groundMaterial());
    world.add(topMesh);

    // cliffs: extrude every open edge of the top down to the sea floor, in rock strata
    const edgeCount = new Map<number, number>();
    const N = P.length / 3;
    const key = (p: number, q: number) => (p < q ? p * N + q : q * N + p);
    for (let t = 0; t < I.length; t += 3) for (const [p, q] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) edgeCount.set(key(p, q), (edgeCount.get(key(p, q)) ?? 0) + 1);
    const bEdges: [number, number][] = [];
    for (let t = 0; t < I.length; t += 3) for (const [p, q] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) if (edgeCount.get(key(p, q)) === 1) bEdges.push([p, q]);
    const rings: [number, number][] = [];  // [drop below top (or absolute when negative marker), outward offset]
    const RING = (ty: number, k: number, v: number): [number, number] => {
      // k: ring index; heights run from the top down past the waterline
      const noise = Math.sin(P[v * 3] * 0.021 + k * 1.7) * Math.cos(P[v * 3 + 2] * 0.017 - k) * 3.2;
      if (k === 0) return [ty, 0];
      if (k === 1) return [ty - 2.5, 3.2];
      if (k === 2) return [ty - 7, 0.8];
      const nMid = 6;
      if (k <= 2 + nMid) { const t = (k - 2) / nMid; return [ty - 7 - (ty - 9) * t, (k % 2 ? 2.8 : -0.6) + noise + t * 7]; }
      if (k === 3 + nMid) return [-1.5, 12 + noise];
      return [-45, 55];
    };
    const NR = 11;
    void rings;
    const wallIndex = new Map<number, number>();
    const WP: number[] = [], WT: number[] = [], WI: number[] = [];
    const wallV = (v: number) => {
      if (wallIndex.has(v)) return wallIndex.get(v)!;
      const x = P[v * 3], z = P[v * 3 + 2], ty = P[v * 3 + 1];
      const [gx, gz] = gradAt(x, z);
      const gl = Math.hypot(gx, gz) || 1;
      const ox = -gx / gl, oz = -gz / gl;
      const base = WP.length / 3;
      for (let k = 0; k < NR; k++) {
        const [y, off] = RING(ty, k, v);
        WP.push(x + ox * off, y, z + oz * off);
        WT.push(ty);
      }
      wallIndex.set(v, base);
      return base;
    };
    for (const [p, q] of bEdges) {
      const a = wallV(p), b = wallV(q);
      // the top triangle runs p -> q; the cliff hangs outside it, facing away from the island
      for (let k = 0; k < NR - 1; k++) WI.push(a + k, a + k + 1, b + k, b + k, a + k + 1, b + k + 1);
    }
    const wall = new THREE.BufferGeometry();
    wall.setAttribute("position", new THREE.Float32BufferAttribute(WP, 3));
    wall.setAttribute("aTop", new THREE.Float32BufferAttribute(WT, 1));
    wall.setIndex(WI);
    wall.computeVertexNormals();
    // make sure the faces look outward: test one face against the coast gradient
    if (WI.length) {
      const nrm = wall.attributes.normal;
      let agree = 0;
      for (let t = 0; t < Math.min(WI.length, 3000); t += 6) {
        const v = WI[t];
        const x = WP[v * 3], z = WP[v * 3 + 2];
        const [gx, gz] = gradAt(x, z);
        agree += -(gx * nrm.getX(v) + gz * nrm.getZ(v)) > 0 ? 1 : -1;
      }
      if (agree < 0) {
        for (let t = 0; t < WI.length; t += 3) { const s = WI[t + 1]; WI[t + 1] = WI[t + 2]; WI[t + 2] = s; }
        wall.setIndex(WI);
        wall.computeVertexNormals();
      }
    }
    world.add(new THREE.Mesh(wall, cliffMaterial()));
  }

  function groundMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogU, ...U }, fog: true,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vW;
        ${FOG_V}
        void main() { vN = normal; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `
        uniform sampler2D uGround; uniform sampler2D uOwn; uniform vec4 uRect; uniform vec4 uIsl[16];
        varying vec3 vN; varying vec3 vW;
        ${FOG_F}
        // an island's street grid, drawn crisp at any zoom (the painting underneath carries the rest)
        float streets(vec2 xz, out float kerb) {
          kerb = 0.;
          vec2 uv = (xz - uRect.xy) / (uRect.zw - uRect.xy);
          float id = floor(texture2D(uOwn, uv).r * 255. + .5) - 1.;
          if (id < 0.) return 0.;
          vec4 I = uIsl[0];
          for (int i = 0; i < 16; i++) if (float(i) == id) I = uIsl[i];
          vec2 d = (xz - I.xy) / ${glf(S)};
          vec2 q = vec2(d.x * I.z + d.y * I.w, -d.x * I.w + d.y * I.z);
          float PX = ${glf(6 * 15 + 12)}, PZ = ${glf(2 * 36 + 12)};
          float bj = floor(q.y / PZ + .5);
          float sh = mod(bj, 2.) > .5 ? PX * .18 : 0.;
          float du = abs(q.x - sh - PX * floor((q.x - sh) / PX + .5));
          float dv = abs(q.y - PZ * bj);
          float su = smoothstep(${glf((6 * 15) / 2)}, ${glf((6 * 15) / 2 + 0.8)}, du), sv = smoothstep(36., 36.8, dv);
          kerb = max(smoothstep(${glf((6 * 15) / 2 - 1.8)}, ${glf((6 * 15) / 2 - 0.8)}, du) - su, smoothstep(34.2, 35.2, dv) - sv);
          return max(su, sv);
        }
        void main() {
          vec3 n = normalize(vN);
          vec2 uv = (vW.xz - uRect.xy) / (uRect.zw - uRect.xy);
          vec3 alb = texture2D(uGround, uv).rgb;
          // hand-painted texture: broad strokes of lighter and darker colour
          float stroke = fbm(vW.xz * vec2(.012, .03)) - .5;
          alb *= 1. + stroke * .16;
          float kerb;
          float st = streets(vW.xz, kerb);
          alb = mix(alb, vec3(.93, .87, .74), kerb * .9);
          alb = mix(alb, vec3(.47, .44, .43) * (1. + stroke * .1), st * .92);
          // hillsides go to dry grass and then to rock
          float slope = 1. - n.y;
          alb = mix(alb, vec3(.74, .66, .42), smoothstep(.12, .25, slope) * .8);
          alb = mix(alb, vec3(.72, .56, .42), smoothstep(.35, .55, slope));
          vec3 col = toon(alb, n, vW, 1.);
          gl_FragColor = vec4(col, 1.);
          #include <fog_fragment>
        }`,
    });
  }
  function cliffMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogU, ...U }, fog: true,
      vertexShader: /* glsl */ `
        attribute float aTop; varying vec3 vN; varying vec3 vW; varying float vTop;
        ${FOG_V}
        void main() { vN = normal; vTop = aTop; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `
        uniform sampler2D uGround; uniform vec4 uRect;
        varying vec3 vN; varying vec3 vW; varying float vTop;
        ${FOG_F}
        void main() {
          vec3 n = normalize(vN);
          float below = vTop - vW.y;
          vec2 uv = (vW.xz - uRect.xy) / (uRect.zw - uRect.xy);
          vec3 grass = texture2D(uGround, uv).rgb * .92;
          // warm sandstone in bands, each band its own shade, with cracks
          float wob = fbm(vec2(vW.x + vW.z, vW.y * 3.) * .02) * 6.;
          float band = floor((vW.y + wob) / 9.);
          float bh = h21(vec2(band, 3.));
          vec3 rock = mix(vec3(.86, .6, .38), vec3(.95, .78, .52), bh);
          rock = mix(rock, vec3(.74, .47, .33), step(.72, bh));
          rock *= .86 + .2 * fbm(vec2((vW.x + vW.z) * .05, vW.y * .3));
          float crack = smoothstep(.46, .5, fbm(vec2((vW.x - vW.z) * .04, vW.y * .06)));
          rock *= 1. - crack * .25;
          vec3 soil = vec3(.45, .3, .22);
          vec3 alb = mix(grass, soil, smoothstep(2.2, 3.6, below));
          alb = mix(alb, rock, smoothstep(6., 8., below));
          // wet and weedy at the waterline
          alb = mix(alb, vec3(.28, .34, .26), smoothstep(5., 1., vW.y) * .8);
          vec3 col = toon(alb, n, vW, mix(.72, 1., smoothstep(0., 30., vW.y)));
          gl_FragColor = vec4(col, 1.);
          #include <fog_fragment>
        }`,
    });
  }

  // ----------------------------------------------------------------- the sea
  let water: THREE.Mesh;
  function buildWater() {
    const g = new THREE.PlaneGeometry(rect.x1 - rect.x0 + 120000, rect.z1 - rect.z0 + 120000, 1, 1).rotateX(-Math.PI / 2);
    g.translate((rect.x0 + rect.x1) / 2, 0, (rect.z0 + rect.z1) / 2);
    const m = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogU, ...U }, fog: true,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        ${FOG_V}
        void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `
        uniform sampler2D uCoast; uniform vec4 uRect; uniform vec4 uBoats[24];
        varying vec3 vW;
        ${FOG_F}
        void main() {
          vec2 uv = (vW.xz - uRect.xy) / (uRect.zw - uRect.xy);
          float c = (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) ? -900. : texture2D(uCoast, uv).r;
          float d = -c;                                  // metres from the nearest shore
          // shallows to deep: aqua over sand, turquoise, then deep teal-blue
          vec3 shallow = vec3(.45, .86, .8), mid = vec3(.13, .63, .72), deep = vec3(.07, .33, .5);
          vec3 col = mix(shallow, mid, smoothstep(4., 60., d));
          col = mix(col, deep, smoothstep(60., 420., d));
          // slow painted ripples
          float t = uTime;
          float rip = fbm(vW.xz * .006 + vec2(t * .02, t * .013)) + fbm(vW.xz * .014 - vec2(t * .015, -t * .02)) * .5;
          col *= .92 + rip * .14;
          // open water: hand-drawn crests, short white strokes that drift with the swell
          vec2 cp = vW.xz * vec2(.0022, .0045) + vec2(t * .006, 0.);
          float bandN = fbm(cp * 1.3) * 7. + vW.z * .0016;
          float crest = 1. - smoothstep(.012, .03, .5 - abs(fract(bandN) - .5));
          float patchy = smoothstep(.58, .7, vn(vW.xz * .0011 + vec2(13., t * .004)));
          col = mix(col, vec3(.82, .94, .96), crest * patchy * smoothstep(90., 260., d) * .55);
          // foam: a hard white rim, then rings breathing out from the shore
          float wob = fbm(vW.xz * .03 + t * .05) * 14.;
          float rim = 1. - smoothstep(4., 9., d + wob * .4);
          float ring = step(.72, sin((d + wob) * .16 - t * 1.6)) * (1. - smoothstep(10., 70., d)) * step(6., d);
          col = mix(col, vec3(.97, .99, .98), max(rim, ring * .8));
          // boats leave white wakes: a V behind each one
          for (int i = 0; i < 24; i++) {
            vec4 b = uBoats[i];
            if (b.w <= 0.) continue;
            vec2 p = vW.xz - b.xy; vec2 f = vec2(cos(b.z), sin(b.z));
            float along = -dot(p, f), across = abs(dot(p, vec2(-f.y, f.x)));
            if (along < 0. || along > 260.) continue;
            float v = 1. - smoothstep(0., 7., abs(across - along * .32 - 3.));
            float core = (1. - smoothstep(0., 5., across)) * (1. - smoothstep(0., 120., along));
            col = mix(col, vec3(.95, .98, .97), max(v * (1. - along / 260.) * .8, core * .7));
          }
          // the sun on the water: a warm glittering path
          vec3 V = normalize(cameraPosition - vW);
          vec3 Hh = normalize(V + uSun);
          float sp = pow(max(dot(vec3(0., 1., 0.), Hh), 0.), 260.);
          float glit = step(.6, vn(vW.xz * .12 + t * .6)) * sp * 8.;
          col += vec3(1., .8, .52) * min(sp * 1.5 + glit, 1.4);
          // island shadows fall on the water
          float sh = sunShadow(vW, vec3(0., 1., 0.));
          col *= mix(vec3(.62, .64, .82), vec3(1.), sh);
          gl_FragColor = vec4(col, 1.);
          #include <fog_fragment>
        }`,
    });
    water = new THREE.Mesh(g, m);
    water.layers.set(NO_SHADOW);
    water.renderOrder = -1;
    scene.add(water);
    // lakes on the islands (Silver Lake's reservoir): flat water set into the ground
    for (const p of M.water) {
      if (ringArea(p) < 20000) continue;
      const [cx, cz] = p.reduce((s, q) => [s[0] + q[0] / p.length, s[1] + q[1] / p.length], [0, 0]);
      if (ownerAt(F, cx, cz) < 0) continue;
      const shape = new THREE.Shape(p.map(([x, z]) => new THREE.Vector2(x, -z)));
      const lg = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
      let lo = Infinity;
      for (const [x, z] of p) lo = Math.min(lo, H(x, z));
      lg.translate(0, lo + 0.8, 0);
      const lm = new THREE.Mesh(lg, lakeMaterial());
      lm.layers.set(NO_SHADOW);
      world.add(lm);
    }
  }
  function lakeMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogU }, fog: true,
      vertexShader: /* glsl */ `varying vec3 vW;
        ${FOG_V}
        void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `varying vec3 vW;
        ${FOG_F}
        void main() {
          vec3 col = vec3(.16, .6, .7) * (.9 + .15 * fbm(vW.xz * .01 + uTime * .03));
          vec3 V = normalize(cameraPosition - vW); vec3 Hh = normalize(V + uSun);
          col += vec3(1., .8, .52) * pow(max(Hh.y, 0.), 200.) * 1.2;
          col *= mix(vec3(.62, .64, .82), vec3(1.), sunShadow(vW, vec3(0., 1., 0.)));
          gl_FragColor = vec4(col, 1.);
          #include <fog_fragment>
        }`,
    });
  }

  // ----------------------------------------------------------------- buildings
  const litIds = new Set<number>();
  let litTex: THREE.DataTexture;
  const LIT_W = 1024;
  let buildingMat: THREE.ShaderMaterial;
  const builders: { b: LABuilder; mesh: THREE.Mesh | null }[] = [];
  let allPlans: Plan[] = [];
  function startBuildings() {
    const n = 1024 * 1024;
    litTex = new THREE.DataTexture(new Uint8Array(n), LIT_W, n / LIT_W, THREE.RedFormat, THREE.UnsignedByteType);
    litTex.magFilter = litTex.minFilter = THREE.NearestFilter;
    litTex.needsUpdate = true;
    buildingMat = buildingMaterial();
    const ground = (x: number, z: number) => H(x * S, z * S) / S;
    allPlans = [];
    for (const l of islands) {
      const occupied = (x: number, z: number) => l.plans.some(p => Math.abs(p.x - x) < p.W / 2 + 1 && Math.abs(p.z - z) < p.D / 2 + 1);
      const plans = l.plans.map((pi: PlanInput) => planLA(pi, occupied));
      allPlans.push(...plans);
      // a few big meshes: one per island, built in slices so the page never stalls
      builders.push({ b: new LABuilder(plans, ground, p => (p.i >= 900000 ? null : l.name)), mesh: null });
    }
    for (const g of extraMeshes) {
      const mesh = new THREE.Mesh(g, buildingMat);
      mini.add(mesh);
    }
    shadowDirty = true;
  }
  function pumpBuildings(budget: number) {
    const t0 = performance.now();
    for (const it of builders) {
      if (it.mesh) continue;
      const done = it.b.step(Math.max(0, budget - (performance.now() - t0)));
      if (done) {
        it.mesh = new THREE.Mesh(it.b.geometry(), buildingMat);
        mini.add(it.mesh);
        shadowDirty = true;
      }
      if (performance.now() - t0 > budget) return false;
    }
    return builders.every(b => b.mesh);
  }
  function buildingMaterial() {
    const k = (n: number) => `${n}.`;
    return new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogU, uLitTex: { value: litTex } }, fog: true,
      vertexShader: /* glsl */ `
        attribute vec3 aCol; attribute float aK; attribute vec4 aC;
        uniform sampler2D uLitTex;
        varying vec3 vCol; flat varying float vK; flat varying vec4 vC; varying vec3 vN; varying vec3 vW; varying vec3 vL; flat varying float vLit;
        ${FOG_V}
        void main() { vCol = aCol; vK = aK; vC = aC; vN = normalize(mat3(modelMatrix) * normal); vL = position;
          float id = aC.x;
          vec2 luv = (vec2(mod(id, ${glf(LIT_W)}), floor(id / ${glf(LIT_W)})) + .5) / vec2(${glf(LIT_W)}, ${glf(LIT_W)});
          vLit = id < 900000. ? texture2D(uLitTex, luv).r : 0.;
          vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `
        varying vec3 vCol; flat varying float vK; flat varying vec4 vC; varying vec3 vN; varying vec3 vW; varying vec3 vL; flat varying float vLit;
        ${FOG_F}
        float box2(vec2 c, vec2 lo, vec2 hi) { vec2 w = fwidth(c) * .8 + 1e-4;
          vec2 a = smoothstep(lo - w, lo + w, c) * (1. - smoothstep(hi - w, hi + w, c));
          float far = smoothstep(.18, .4, max(w.x, w.y));
          return mix(a.x * a.y, (hi.x - lo.x) * (hi.y - lo.y), far); }
        void main() {
          vec3 n = normalize(vN);
          float k = floor(vK + .5);
          vec3 alb = vCol;
          float hgt = vL.y - vC.z;
          vec2 lp = vL.xz;
          vec3 tng = normalize(cross(vec3(0., 1., 0.), n) + vec3(1e-4, 0., 0.));
          float fu = dot(vec3(lp.x, 0., lp.y), tng);
          float wallish = 1. - step(.6, abs(n.y));
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1. - max(dot(n, V), 0.), 2.);
          float gm = 0., cell = 0.;
          if (k == ${k(K.GRID)}) { vec2 c = vec2(fract(fu / 3.2), fract(hgt / ${glf(3.1 * VS)})); gm = box2(c, vec2(.24, .3), vec2(.76, .8)) * step(1.5, hgt) * wallish; cell = h21(vec2(floor(fu / 3.2), floor(hgt / ${glf(3.1 * VS)})) + vC.w * 31.); }
          else if (k == ${k(K.RIBBON)}) { vec2 c = vec2(fract(fu / 1.6), fract(hgt / ${glf(3.1 * VS)})); gm = box2(c, vec2(.07, .34), vec2(.93, .86)) * wallish; cell = h21(vec2(floor(fu / 1.6), floor(hgt / ${glf(3.1 * VS)})) + vC.w * 17.); }
          else if (k == ${k(K.CURTAIN)}) { vec2 c = vec2(fract(fu / 1.7), fract(hgt / ${glf(2.9 * VS)})); gm = box2(c, vec2(.06, .14), vec2(.94, 1.)) * wallish; cell = h21(vec2(floor(fu / 1.7), floor(hgt / ${glf(2.9 * VS)})) + vC.w * 7.); }
          else if (k == ${k(K.GLASS)}) { gm = 1.; cell = h21(floor(lp * .45) + floor(hgt * .35) + vC.w * 13.); }
          vec3 surf = alb;
          if (k == ${k(K.TILE)}) surf *= (.78 + .22 * abs(sin(fu * 8.5))) * (.88 + .12 * step(.18, fract(hgt * 2.2)));
          else if (k == ${k(K.AWNING)}) surf = mix(surf, vec3(.96, .95, .92), step(.5, fract(fu / 1.1)));
          else if (k == ${k(K.BREEZE)}) { vec2 c = fract(vec2(fu, hgt) / .62) - .5; surf *= mix(.32, 1., smoothstep(.2, .27, length(c))); }
          else if (k == ${k(K.SHUTTER)}) surf *= .8 + .2 * step(.3, fract(hgt * 3.2));
          else if (k == ${k(K.CORRUGATED)}) surf *= .84 + .16 * sin(fu * 11.);
          else if (k == ${k(K.SOLAR)}) { vec2 c = fract(lp * .9); surf = mix(vec3(.07, .11, .24), vec3(.5, .6, .76), step(.9, max(c.x, c.y))); }
          else if (k == ${k(K.ROOF)}) surf *= .88 + .14 * vn(lp * .8 + vC.w * 40.);
          else if (k == ${k(K.LAWN)}) surf *= .82 + .24 * vn(lp * 1.3 + vC.w * 40.);
          else if (k == ${k(K.DARK)}) surf *= .5;
          float ao = mix(.62, 1., smoothstep(0., 3.5, hgt));
          vec3 col = toon(surf, n, vW, ao);
          if (gm > .01) {
            // golden-hour glass: the sky and the sunset reflected, a few rooms already lit
            vec3 sky = mix(vec3(.3, .38, .58), vec3(1., .78, .56), fres * .8 + .15);
            vec3 g = k == ${k(K.CURTAIN)} ? mix(alb * .6, sky, .6) : vec3(.12, .15, .24) + sky * .45;
            g *= .75 + .25 * sunShadow(vW, n);
            float lit = step(.8, cell);
            g = mix(g, vec3(1., .78, .45) * 1.1, lit);
            col = mix(col, g, gm);
          }
          if (k == ${k(K.POOL)}) { float c = sin(lp.x * 1.7 + uTime * 1.3) * sin(lp.y * 1.9 - uTime * 1.1); col = vec3(.2, .82, .94) * (1. + .15 * c); }
          if (k == ${k(K.NEON)}) col = alb * (1.4 + .8 * step(.35, fract(fu * .8)));
          if (k == ${k(K.LAMP)}) col = vec3(1., .82, .52) * 1.6;
          if (k == ${k(K.BEACON)}) col = vec3(1., .16, .08) * (.35 + 2.4 * step(.55, fract(uTime * .7 + vC.w * 3.)));
          if (vLit > .5) {
            // a customer's home: gold stucco, every window burning
            float flick = .92 + .08 * sin(uTime * 2. + vC.w * 40.);
            vec3 gold = mix(vec3(1., .56, .16), vec3(1., .76, .36), smoothstep(.3, .9, dot(alb, vec3(.33))));
            vec3 facade = toon(mix(alb, gold, .8), n, vW, ao) * .9 + gold * .1;
            float glow = max(gm, float(k == ${k(K.GLASS)}));
            // windows burn hotter than the walls, so the building reads as lit from inside
            col = mix(facade, vec3(1., .82, .5) * 1.9 * flick, glow);
            if (k == ${k(K.ROOF)} || k == ${k(K.TRIM)}) col = mix(col, gold * 1.25, .35);
          }
          gl_FragColor = vec4(col, 1.);
          #include <fog_fragment>
        }`,
    });
  }

  // ----------------------------------------------------------------- trees
  function buildTrees() {
    const all = islands.flatMap(l => l.trees);
    const ground = (x: number, z: number) => H(x * S, z * S) / S;
    const lobe = (r: number, x: number, y: number, z: number) => mergeVertices(new THREE.IcosahedronGeometry(r, 1).deleteAttribute("uv").deleteAttribute("normal")).translate(x, y, z);
    const canopy = mergeGeometries([
      new THREE.CylinderGeometry(0.35, 0.5, 4, 5).deleteAttribute("uv").translate(0, 2, 0),
      mergeVertices(mergeGeometries([lobe(3.2, 0, 6.2, 0), lobe(2.3, 1.9, 5.2, 0.6), lobe(2.2, -1.7, 5.4, -0.8)])!),
    ].map(g => { g.deleteAttribute("normal"); return g; }))!;
    canopy.computeVertexNormals();
    const cypress = mergeVertices(new THREE.CapsuleGeometry(1.1, 7, 3, 7).deleteAttribute("uv").translate(0, 5, 0));
    cypress.computeVertexNormals();
    // palm: a slim trunk and a burst of drooping fronds
    const fronds: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.22, 0.34, 11, 5).deleteAttribute("uv").translate(0, 5.5, 0)];
    for (let f = 0; f < 8; f++) {
      const a = (f / 8) * Math.PI * 2;
      const blade = new THREE.BufferGeometry();
      const L = 3.8, w = 0.9;
      const pts = [[0, 0, 0], [L * 0.5, 0.6, w], [L * 0.5, 0.6, -w], [L, -1.3, 0]];
      blade.setAttribute("position", new THREE.Float32BufferAttribute([...pts[0], ...pts[1], ...pts[3], ...pts[0], ...pts[3], ...pts[2], ...pts[0], ...pts[3], ...pts[1], ...pts[0], ...pts[2], ...pts[3]], 3));
      blade.rotateY(a).translate(0, 11, 0);
      fronds.push(blade);
    }
    const palm = mergeGeometries(fronds.map(g => { g.deleteAttribute("normal"); return g.index ? g.toNonIndexed() : g; }))!;
    palm.computeVertexNormals();
    const geos = [canopy, cypress, palm];
    const cols = [["#4f8f3c", "#3f7a36", "#68a044", "#2f6b3a", "#7aa84a"], ["#2d5e36", "#355f33"], ["#5c9a3e", "#4e8a3a"]];
    for (let kind = 0; kind < 3; kind++) {
      const list = all.filter(t => t.kind === kind);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(geos[kind], treeMaterial(kind === 2), list.length);
      const Mx = new THREE.Matrix4(), Q = new THREE.Quaternion(), Pv = new THREE.Vector3(), Sv = new THREE.Vector3(), C = new THREE.Color();
      list.forEach((t, i) => {
        Pv.set(t.x, ground(t.x, t.z) - 0.2, t.z);
        Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.tint * 40);
        const s = t.s * (kind === 2 ? 1.25 : 1);
        Sv.set(s, s * (0.85 + t.tint * 0.3), s);
        mesh.setMatrixAt(i, Mx.compose(Pv, Q, Sv));
        mesh.setColorAt(i, C.set(cols[kind][Math.floor(t.tint * 97) % cols[kind].length]));
      });
      mesh.frustumCulled = false;
      mini.add(mesh);
    }
  }
  function treeMaterial(palm: boolean) {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogU }, fog: true, side: palm ? THREE.DoubleSide : THREE.FrontSide,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vW; varying vec3 vCol; varying float vY;
        ${FOG_V}
        void main() { vCol = instanceColor; vY = position.y;
          mat4 m = modelMatrix * instanceMatrix;
          vN = normalize(mat3(m) * normal);
          vec4 w = m * vec4(position, 1.); vW = w.xyz;
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `
        varying vec3 vN; varying vec3 vW; varying vec3 vCol; varying float vY;
        ${FOG_F}
        void main() {
          vec3 n = normalize(vN);
          if (!gl_FrontFacing) n = -n;
          ${palm ? "bool trunk = vY < 10.6;" : "bool trunk = vY < 3.6;"}
          vec3 alb = trunk ? vec3(.5, .38, .28) : vCol * (.9 + .2 * vn(vW.xz * .2 + vY));
          // foliage catches a warm rim where the sun comes through
          vec3 col = toon(alb, n, vW, trunk ? .8 : mix(.7, 1., smoothstep(${palm ? "10., 12." : "3., 8."}, vY)));
          gl_FragColor = vec4(col, 1.);
          #include <fog_fragment>
        }`,
    });
  }

  // ----------------------------------------------------------------- bridges between neighbouring islands
  function buildBridges() {
    // walk out from every coast point until land comes up again; the shortest crossings win
    const cands: { x0: number; z0: number; x1: number; z1: number; a: number; b: number; L: number }[] = [];
    const road = roadDistance(roadSegments(M), F);
    for (let j = 2; j < F.nz - 2; j += 2) for (let i = 2; i < F.nx - 2; i += 2) {
      const k = j * F.nx + i;
      const c = F.c[k];
      if (c < 0 || c > F.cell * 1.2) continue;
      const x = F.x0 + i * F.cell, z = F.z0 + j * F.cell, a = F.own[k];
      const e = F.cell;
      const gx = coastAt(F, x + e, z) - coastAt(F, x - e, z), gz = coastAt(F, x, z + e) - coastAt(F, x, z - e);
      const g = Math.hypot(gx, gz) || 1;
      const dx = -gx / g, dz = -gz / g;
      for (let s = 30; s < 520; s += 12) {
        const px = x + dx * s, pz = z + dz * s;
        const cc = coastAt(F, px, pz);
        if (cc > 8) {
          const b = ownerAt(F, px, pz);
          if (b >= 0 && b !== a) cands.push({ x0: x, z0: z, x1: px, z1: pz, a, b, L: s - (road(x, z) < 90 ? 120 : 0) });
          break;
        }
      }
    }
    cands.sort((p, q) => p.L - q.L);
    const chosen: typeof cands = [];
    for (const c of cands) {
      if (chosen.some(o => Math.hypot(o.x0 - c.x0, o.z0 - c.z0) < 1600 || Math.hypot(o.x1 - c.x0, o.z1 - c.z0) < 1600)) continue;
      const pair = chosen.filter(o => (o.a === c.a && o.b === c.b) || (o.a === c.b && o.b === c.a)).length;
      if (pair >= 2) continue;
      chosen.push(c);
    }
    const parts: { g: THREE.BufferGeometry; col: string; k: number }[] = [];
    for (const c of chosen) {
      // pull both ends back onto solid ground
      const L = Math.hypot(c.x1 - c.x0, c.z1 - c.z0), ux = (c.x1 - c.x0) / L, uz = (c.z1 - c.z0) / L;
      const ax = c.x0 - ux * 40, az = c.z0 - uz * 40, bx = c.x1 + ux * 40, bz = c.z1 + uz * 40;
      const ya = H(ax, az) / S, yb = H(bx, bz) / S;
      const span = Math.hypot(bx - ax, bz - az) / S, yaw = Math.atan2(bx - ax, bz - az);
      const mx = (ax + bx) / 2 / S, mz = (az + bz) / 2 / S;
      const deck = new THREE.BoxGeometry(7, 1.2, span, 1, 1, 12);
      // a gentle hump
      const pp = deck.attributes.position;
      for (let v = 0; v < pp.count; v++) { const t = pp.getZ(v) / span + 0.5; pp.setY(v, pp.getY(v) + ya + (yb - ya) * t + Math.sin(t * Math.PI) * 2.2 - 0.6); }
      deck.computeVertexNormals();
      const place = (g: THREE.BufferGeometry) => g.rotateY(yaw).translate(mx, 0, mz);
      parts.push({ g: place(deck), col: "#d9c7a6", k: K.WALL });
      for (const side of [-1, 1]) {
        const rail = new THREE.BoxGeometry(0.7, 1.1, span, 1, 1, 12);
        const rp = rail.attributes.position;
        for (let v = 0; v < rp.count; v++) { const t = rp.getZ(v) / span + 0.5; rp.setX(v, rp.getX(v) + side * 3.2); rp.setY(v, rp.getY(v) + ya + (yb - ya) * t + Math.sin(t * Math.PI) * 2.2 + 0.5); }
        rail.computeVertexNormals();
        parts.push({ g: place(rail), col: "#efe4cc", k: K.TRIM });
      }
      // piers down to the water
      const nP = Math.max(1, Math.floor(span / 16));
      for (let q = 1; q < nP; q++) {
        const t = q / nP, y = ya + (yb - ya) * t + Math.sin(t * Math.PI) * 2.2 - 1.2;
        parts.push({ g: place(new THREE.BoxGeometry(5.2, y + 2, 2.4).translate(0, (y - 2) / 2, (t - 0.5) * span)), col: "#c9a57c", k: K.WALL });
      }
      // lamps along the rail
      for (let q = 0; q <= nP; q++) {
        const t = q / Math.max(1, nP), y = ya + (yb - ya) * t + Math.sin(t * Math.PI) * 2.2;
        for (const side of [-1, 1]) parts.push({ g: place(new THREE.SphereGeometry(0.45, 6, 4).translate(side * 3.2, y + 2.1, (t - 0.5) * span)), col: "#ffd27a", k: K.LAMP });
      }
    }
    if (parts.length) mini.add(new THREE.Mesh(kitGeo(parts, 900300), buildingMaterial()));
  }

  // ----------------------------------------------------------------- boats
  type Boat = { x: number; z: number; yaw: number; v: number; turn: number; kind: number };
  const boats: Boat[] = [];
  let boatMesh: THREE.InstancedMesh | null = null;
  function buildBoats() {
    const r = rng(99);
    for (let t = 0; t < 400 && boats.length < 24; t++) {
      const x = rect.x0 + 800 + r() * (rect.x1 - rect.x0 - 1600), z = rect.z0 + 800 + r() * (rect.z1 - rect.z0 - 1600);
      const c = coastAt(F, x, z);
      if (c > -70 || c < -500) continue;
      boats.push({ x, z, yaw: r() * Math.PI * 2, v: 14 + r() * 16, turn: 0, kind: r() < 0.6 ? 0 : 1 });
    }
    // a sailboat: white hull, a tall sail; a launch: red hull and a cabin
    const hull = new THREE.CylinderGeometry(1.2, 0.5, 7, 6, 1).rotateX(Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.4, 0);
    const sail = new THREE.BufferGeometry();
    sail.setAttribute("position", new THREE.Float32BufferAttribute([0, 1, -2.5, 0, 9, -0.6, 0, 1, 1.8], 3));
    const cabin = new THREE.BoxGeometry(1.6, 1.2, 2.4).translate(0, 1.3, -0.6);
    const tag = (g: THREE.BufferGeometry, c: string) => {
      const gg = g.index ? g.toNonIndexed() : g;
      gg.deleteAttribute("uv");
      gg.deleteAttribute("normal");
      const col = new THREE.Color(c);
      gg.setAttribute("color", new THREE.Float32BufferAttribute(new Array(gg.attributes.position.count).fill(0).flatMap(() => [col.r, col.g, col.b]), 3));
      return gg;
    };
    const geo = mergeGeometries([tag(hull, "#f4f1ea"), tag(sail, "#fbf7ee"), tag(cabin, "#c8423a")])!;
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogU }, fog: true, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `attribute vec3 color; varying vec3 vN; varying vec3 vW; varying vec3 vCol;
        ${FOG_V}
        void main() { vCol = color * instanceColor; mat4 m = modelMatrix * instanceMatrix; vN = normalize(mat3(m) * normal);
          vec4 w = m * vec4(position, 1.); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `varying vec3 vN; varying vec3 vW; varying vec3 vCol;
        ${FOG_F}
        void main() { vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
          gl_FragColor = vec4(toon(vCol, n, vW, 1.), 1.);
          #include <fog_fragment>
        }`,
    });
    boatMesh = new THREE.InstancedMesh(geo, mat, boats.length);
    const C = new THREE.Color();
    boats.forEach((b, i) => boatMesh!.setColorAt(i, C.set(b.kind ? "#ffffff" : ["#ffffff", "#ffe9c9", "#e8f4ff"][i % 3])));
    boatMesh.frustumCulled = false;
    boatMesh.layers.set(NO_SHADOW);
    mini.add(boatMesh);
    moveBoats(0);
  }
  function moveBoats(dt: number) {
    if (!boatMesh) return;
    const Mx = new THREE.Matrix4(), Q = new THREE.Quaternion(), Pv = new THREE.Vector3(), Sv = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
    boats.forEach((b, i) => {
      // feel the coast ahead-left and ahead-right; steer toward open water, wander a little
      const f = 90, s = 0.5;
      const cl = coastAt(F, b.x + Math.cos(b.yaw - s) * f, b.z + Math.sin(b.yaw - s) * f);
      const cr = coastAt(F, b.x + Math.cos(b.yaw + s) * f, b.z + Math.sin(b.yaw + s) * f);
      const ahead = coastAt(F, b.x + Math.cos(b.yaw) * f * 1.3, b.z + Math.sin(b.yaw) * f * 1.3);
      let steer = (cl - cr) * 0.012 + Math.sin(uniforms.uTime.value * 0.1 + i * 7) * 0.05;
      if (ahead > -40) steer += (cl < cr ? -1 : 1) * 1.2;
      b.turn += (Math.max(-0.6, Math.min(0.6, steer)) - b.turn) * Math.min(1, dt * 2);
      b.yaw += b.turn * dt;
      b.x += Math.cos(b.yaw) * b.v * dt; b.z += Math.sin(b.yaw) * b.v * dt;
      if (coastAt(F, b.x, b.z) > -25) { b.yaw += Math.PI * 0.9; }
      Pv.set(b.x / S, 0, b.z / S);
      Q.setFromAxisAngle(Y, -b.yaw + Math.PI / 2);
      boatMesh!.setMatrixAt(i, Mx.compose(Pv, Q, Sv));
      if (i < 24) U.uBoats.value[i].set(b.x, b.z, b.yaw, 1);
    });
    boatMesh.instanceMatrix.needsUpdate = true;
  }

  // ----------------------------------------------------------------- the cloud sea over islands not yet won
  let puffs: THREE.InstancedMesh | null = null;
  let puffGlow: THREE.InstancedBufferAttribute;
  type Puff = { x: number; z: number; y: number; r0: number; seed: number; island: number; cur: number; from: number; to: number; t: number; delay: number };
  const puffList: Puff[] = [];
  let puffBusy = false;
  function buildClouds() {
    const r = rng(7);
    const STEP = 210;
    for (let z = rect.z0; z < rect.z1; z += STEP) for (let x = rect.x0; x < rect.x1; x += STEP) {
      const px = x + (r() - 0.5) * STEP * 0.9, pz = z + (r() - 0.5) * STEP * 0.9;
      const c = coastAt(F, px, pz);
      if (c < -30) continue;
      let o = ownerAt(F, px, pz);
      if (o < 0) {
        const p = ontoLand(F, px, pz, 10);
        o = ownerAt(F, p.x, p.z);
      }
      if (o < 0) continue;
      const r0 = (150 + r() * 90) * (c < 40 ? 0.7 : 1);
      puffList.push({ x: px, z: pz, y: H(px, pz, o) + 90 + r() * 50, r0, seed: r(), island: o, cur: 0, from: 0, to: 0, t: 1, delay: 0 });
    }
    const lobeC = (rr: number, x: number, y: number, z: number) => mergeVertices(new THREE.IcosahedronGeometry(rr, 1).deleteAttribute("uv").deleteAttribute("normal")).translate(x, y, z);
    const geo = mergeVertices(mergeGeometries([lobeC(1, 0, 0.05, 0), lobeC(0.72, 0.8, -0.08, 0.1), lobeC(0.68, -0.76, -0.1, -0.08), lobeC(0.56, 0.16, 0.54, -0.06)])!);
    const pp = geo.attributes.position;
    for (let k = 0; k < pp.count; k++) { const y = pp.getY(k); if (y < -0.18) pp.setY(k, -0.18 + (y + 0.18) * 0.22); }
    geo.computeVertexNormals();
    puffGlow = new THREE.InstancedBufferAttribute(new Float32Array(puffList.length), 1);
    geo.setAttribute("aGlow", puffGlow);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...fogU }, fog: true,
      vertexShader: /* glsl */ `
        attribute float aGlow; varying vec3 vN; varying vec3 vW; varying float vH; varying float vGlow;
        ${FOG_V}
        void main() { vN = normalize(mat3(instanceMatrix) * normal); vH = position.y; vGlow = aGlow;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.); vW = w.xyz;
          vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: COMMON + /* glsl */ `
        varying vec3 vN; varying vec3 vW; varying float vH; varying float vGlow;
        ${FOG_F}
        void main() {
          vec3 n = normalize(vN);
          float lam = dot(n, uSun);
          float sh = sunShadow(vW, n);
          float band = smoothstep(-.1, -.04, lam) * .45 + smoothstep(.34, .4, lam) * .55 * sh;
          // sunset clouds: peach where lit, lilac mid-tones, blue-violet bellies
          vec3 shade = vec3(.56, .56, .78), mid = vec3(.86, .8, .9), lit = vec3(1., .9, .78);
          vec3 c = mix(shade, mid, smoothstep(0., .45, band));
          c = mix(c, lit, smoothstep(.5, 1., band));
          c = mix(c, shade * .9, smoothstep(0., -.7, vH) * .5);
          vec3 V = normalize(cameraPosition - vW);
          float rim = pow(1. - max(dot(n, V), 0.), 3.) * max(lam, 0.);
          c += vec3(1., .66, .38) * smoothstep(.2, .32, rim) * .45;
          c = mix(c, vec3(1., .74, .34) * 2.2, vGlow);
          gl_FragColor = vec4(c, 1.);
          #include <fog_fragment>
        }`,
    });
    puffs = new THREE.InstancedMesh(geo, mat, puffList.length);
    puffs.frustumCulled = false;
    world.add(puffs);
  }
  function setClouds(open: Set<number>, immediate: boolean) {
    if (!puffs) return;
    for (const p of puffList) {
      const target = open.has(p.island) ? 0 : p.r0;
      if (immediate) { p.cur = p.to = target; p.t = 1; continue; }
      if (Math.abs(target - p.to) < 0.5) continue;
      p.from = p.cur; p.to = target; p.t = 0;
      // burn off from the island's heart outward, a rolling wave
      const l = islands[p.island];
      p.delay = p.seed * 0.7 + Math.hypot(p.x - l.label[0], p.z - l.label[1]) / 1400;
      puffBusy = true;
    }
    writePuffs();
    shadowDirty = true;
  }
  function writePuffs() {
    if (!puffs) return;
    const Mx = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), Sc = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    const t = uniforms.uTime.value;
    puffList.forEach((p, k) => {
      if (p.cur < 0.5) { puffs!.setMatrixAt(k, Mx.makeScale(0, 0, 0)); return; }
      V.set(p.x + Math.sin(t * 0.05 + p.seed * 9) * 12, p.y + p.cur * 0.2 + Math.sin(t * 0.3 + p.seed * 20) * 2, p.z);
      Q.setFromAxisAngle(UP, p.seed * 6.28);
      Sc.set(p.cur, p.cur * (0.7 + p.seed * 0.25), p.cur * (0.8 + p.seed * 0.3));
      puffs!.setMatrixAt(k, Mx.compose(V, Q, Sc));
    });
    puffs.instanceMatrix.needsUpdate = true;
  }
  function animateClouds(dt: number) {
    if (!puffs) return;
    if (puffBusy) {
      let busy = false;
      const glow = puffGlow.array as Float32Array;
      puffList.forEach((p, k) => {
        if (p.t >= 1) return;
        busy = true;
        if (p.delay > 0) { p.delay -= dt; return; }
        p.t = Math.min(1, p.t + dt / 1.2);
        const t = p.t;
        if (p.to < p.from) {
          const c1 = 2.2, e = (c1 + 1) * t * t * t - c1 * t * t;
          p.cur = Math.max(0, p.from + (p.to - p.from) * e);
          glow[k] = Math.sin(Math.min(1, t * 1.3) * Math.PI) * 0.8;
        } else {
          p.cur = p.from + (p.to - p.from) * (1 - Math.pow(1 - t, 3));
          glow[k] = 0;
        }
        if (t >= 1) glow[k] = 0;
      });
      puffGlow.needsUpdate = true;
      puffBusy = busy;
      shadowDirty = true;
    }
    writePuffs();
  }

  // ----------------------------------------------------------------- lanterns
  let lanternInputs: IslandLantern[] = [];
  const placed: { key: string; x: number; z: number; island: number; plan: Plan | null }[] = [];
  const beams = new THREE.Group();
  world.add(beams);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uFade: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: /* glsl */ `uniform float uTime; uniform float uFade; varying vec2 vUv;
      void main() {
        float a = pow(1. - vUv.y, 1.6) * (.55 + .45 * sin(vUv.y * 30. - uTime * 2.)) * smoothstep(0., .06, vUv.y);
        float edge = 1. - abs(vUv.x - .5) * 2.;
        gl_FragColor = vec4(vec3(1., .72, .32) * a * (.4 + .6 * edge) * .9 * uFade, 1.);
      }`,
  });
  const haloMat = new THREE.ShaderMaterial({
    uniforms: {}, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `varying vec2 vUv; void main(){ float d = length(vUv - .5) * 2.; float a = pow(max(0., 1. - d), 2.6); gl_FragColor = vec4(vec3(1., .6, .22) * a * .38, 1.); }`,
  });
  function applyLanterns(immediate = false) {
    if (!ready) return;
    placed.length = 0;
    litIds.clear();
    const counts = new Map<number, number>();
    for (const L of lanternInputs) {
      const b = lonLatToBoard(M, L.latitude, L.longitude);
      const p = ontoLand(F, b.x, b.z, 30);
      const canonicalIsland = L.territoryName
        ? islands.find(candidate => candidate.name === L.territoryName) ?? null
        : null;
      const island = canonicalIsland?.index ?? ownerAt(F, p.x, p.z);
      if (island < 0) continue;
      // Territory identity is business/geographic truth. Inside that territory,
      // the real coordinate still chooses the nearest physical-looking building.
      let best: Plan | null = null, bd = Infinity;
      for (const q of allPlans) {
        // a tower is an apartment building: many customers can share it
        if (litIds.has(q.i) && q.arch !== "tower") continue;
        if (ownerAt(F, q.x * S, q.z * S) !== island) continue;
        const d = Math.hypot(q.x * S - p.x, q.z * S - p.z) - (q.arch === "tower" ? 260 : 0);
        if (d < bd) { bd = d; best = q; }
      }
      if (best) litIds.add(best.i);
      placed.push({
        key: L.key,
        x: best ? best.x * S : canonicalIsland?.label[0] ?? p.x,
        z: best ? best.z * S : canonicalIsland?.label[1] ?? p.z,
        island,
        plan: best,
      });
      counts.set(island, (counts.get(island) ?? 0) + 1);
    }
    const data = litTex.image.data as Uint8Array;
    data.fill(0);
    for (const id of litIds) if (id < data.length) data[id] = 255;
    litTex.needsUpdate = true;
    // a beam of light over every lit building, and a pool of warm light around it
    beams.clear();
    const seen = new Set<number>();
    for (const p of placed) {
      if (!p.plan || seen.has(p.plan.i)) continue;
      seen.add(p.plan.i);
      const y = H(p.x, p.z) + p.plan.top * S;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(9, 26, 900, 12, 1, true).translate(0, 450, 0), beamMat);
      beam.position.set(p.x, y - 20, p.z);
      beam.userData.beam = true;
      beam.layers.set(INK_SKIP);
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2), haloMat);
      halo.position.set(p.x, H(p.x, p.z) + 3, p.z);
      halo.layers.set(INK_SKIP);
      // no beam: a lit home and its warm pool of light are the marker, not a searchlight
      void beam;
      beams.add(halo);
    }
    const open = new Set<number>([...counts.keys()]);
    setClouds(open, immediate);
    islandCounts = counts;
    refreshLabels();
    events.onStats?.({ islands: islands.filter(l => l.area > 0).length, open: open.size, lanterns: lanternInputs.length });
  }
  let islandCounts = new Map<number, number>();

  // ----------------------------------------------------------------- labels: painted banners over each island
  const labels: { sprite: THREE.Sprite; island: number; canvas: HTMLCanvasElement; w: number }[] = [];
  function drawLabel(cv: HTMLCanvasElement, name: string, n: number) {
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, cv.width, cv.height);
    const open = n > 0;
    g.font = `700 64px "Barlow Condensed", "Arial Narrow", sans-serif`;
    const text = name.toUpperCase();
    const w = Math.min(cv.width - 20, g.measureText(text).width + 64);
    const x0 = (cv.width - w) / 2, y0 = 18, h = 92;
    g.fillStyle = open ? "rgba(34,24,40,.86)" : "rgba(250,246,238,.9)";
    g.beginPath(); g.roundRect(x0, y0, w, h, 46); g.fill();
    g.lineWidth = 4; g.strokeStyle = open ? "#ffc84d" : "rgba(120,110,140,.5)"; g.stroke();
    g.fillStyle = open ? "#fff4dc" : "#5d5670";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, cv.width / 2, y0 + h / 2 + 3);
    g.font = `700 40px "Barlow Condensed", "Arial Narrow", sans-serif`;
    const sub = open ? `${n} LANTERN${n === 1 ? "" : "S"}` : "UNCHARTED";
    const sw = g.measureText(sub).width + 40;
    g.fillStyle = open ? "#ffc84d" : "rgba(93,86,112,.85)";
    g.beginPath(); g.roundRect((cv.width - sw) / 2, y0 + h + 10, sw, 52, 26); g.fill();
    g.fillStyle = open ? "#3a2600" : "#fff";
    g.fillText(sub, cv.width / 2, y0 + h + 37);
    return w;
  }
  function buildLabels() {
    islands.forEach(l => {
      if (l.area < 200000) return;
      const cv = document.createElement("canvas");
      cv.width = 640; cv.height = 190;
      drawLabel(cv, l.name, 0);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
      sp.position.set(l.label[0], H(l.label[0], l.label[1]) + 420, l.label[1]);
      sp.center.set(0.5, 0);
      sp.renderOrder = 10;
      labelScene.add(sp);
      labels.push({ sprite: sp, island: l.index, canvas: cv, w: 400 });
    });
    // repaint once the web font arrives
    document.fonts?.ready.then(() => refreshLabels());
  }
  function refreshLabels() {
    for (const L of labels) {
      L.w = drawLabel(L.canvas, islands[L.island].name, islandCounts.get(L.island) ?? 0);
      (L.sprite.material.map as THREE.Texture).needsUpdate = true;
    }
  }
  function placeLabels(cd: number) {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    const a = THREE.MathUtils.smoothstep(cd, 2200, 4200);
    // islands with lanterns first, then the big ones; a label that would overlap one already
    // placed stays hidden until you zoom in
    const order = labels.slice().sort((p, q) => (islandCounts.get(q.island) ?? 0) - (islandCounts.get(p.island) ?? 0) || islands[q.island].area - islands[p.island].area);
    const taken: [number, number, number, number][] = [];
    const v = new THREE.Vector3();
    for (const L of order) {
      const open = (islandCounts.get(L.island) ?? 0) > 0;
      const px = open ? 72 : 54;       // label height on screen
      const s = (px * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / h;
      L.sprite.scale.set(s * (640 / 190), s, 1);
      v.copy(L.sprite.position).project(camera);
      const sx = ((v.x + 1) / 2) * w, sy = ((1 - v.y) / 2) * h, hw = (L.w * px) / 190 / 2 + 6;
      const r: [number, number, number, number] = [sx - hw, sy - px - 4, sx + hw, sy + 4];
      const clash = taken.some(t => r[0] < t[2] && r[2] > t[0] && r[1] < t[3] && r[3] > t[1]);
      L.sprite.visible = a > 0.02 && !clash && v.z < 1;
      L.sprite.material.opacity = a;
      if (L.sprite.visible) taken.push(r);
    }
  }

  // ----------------------------------------------------------------- camera
  function frame(x: number, z: number, dist: number, yaw = 0, pitch = 0.82) {
    // the camera orbits the board's plinth height, so gliding over water and hills never bobs
    const ty = TOP;
    controls.target.set(x, ty, z);
    camera.position.set(x + Math.sin(yaw) * Math.sin(pitch) * dist, ty + Math.cos(pitch) * dist, z + Math.cos(yaw) * Math.sin(pitch) * dist);
    controls.update();
  }
  function frameBoard() {
    const aspect = Math.max(0.5, container.clientWidth / Math.max(1, container.clientHeight));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < F.c.length; k++) if (F.c[k] > 0) {
      const x = F.x0 + (k % F.nx) * F.cell, z = F.z0 + Math.floor(k / F.nx) * F.cell;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    // room at the sides for the edge islands' banners
    const ex = x1 - x0 + 2800, ez = z1 - z0 + 900;
    const dist = (Math.max(ex / aspect, ez * 1.25) / (2 * Math.tan((14 * Math.PI) / 180))) * 0.98;
    frame((x0 + x1) / 2, (z0 + z1) / 2 + ez * 0.06, dist, 0, 0.86);
  }
  let fly: null | { t: number; fromT: THREE.Vector3; fromP: THREE.Vector3; toT: THREE.Vector3; toP: THREE.Vector3; done?: () => void } = null;
  function flyTo(x: number, z: number, dist: number, done?: () => void) {
    const fromT = controls.target.clone(), fromP = camera.position.clone();
    const off = fromP.clone().sub(fromT).normalize().multiplyScalar(dist);
    const toT = new THREE.Vector3(x, TOP, z);
    fly = { t: 0, fromT, fromP, toT, toP: toT.clone().add(off), done };
  }
  /** the Hollywood Tin Can House under the pointer. Touch gets a larger hit target than a mouse. */
  function suitcaseAt(cx: number, cy: number, radius = 64) {
    if (!suitcase) return null;
    const r = renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(suitcase.x, H(suitcase.x, suitcase.z) + suitcase.h * 0.5, suitcase.z).project(camera);
    if (v.z >= 1) return null;
    return Math.hypot(r.left + ((v.x + 1) / 2) * r.width - cx, r.top + ((1 - v.y) / 2) * r.height - cy) < radius ? suitcase : null;
  }
  /** the Laundry Farm Operations Hub under the pointer. */
  function operationsHubAt(cx: number, cy: number, radius = 76) {
    if (!operationsHub) return null;
    const r = renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(
      operationsHub.x,
      H(operationsHub.x, operationsHub.z) + operationsHub.h * 0.5,
      operationsHub.z,
    ).project(camera);
    if (v.z >= 1) return null;
    return Math.hypot(
      r.left + ((v.x + 1) / 2) * r.width - cx,
      r.top + ((1 - v.y) / 2) * r.height - cy,
    ) < radius ? operationsHub : null;
  }
  /** zoom two is available only after Hollywood was chosen as zoom one. */
  let activeIslandName: string | null = null;
  let entering = false;

  // ----------------------------------------------------------------- picking: click an island
  const ray = new THREE.Raycaster();
  let downAt: { x: number; y: number; pointerId: number; pointerType: string } | null = null;
  const onDown = (e: PointerEvent) => {
    downAt = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, pointerType: e.pointerType };
  };
  const onUp = (e: PointerEvent) => {
    const down = downAt;
    downAt = null;
    if (!down || down.pointerId !== e.pointerId || !ready) return;
    const tapSlop = down.pointerType === "touch" ? 22 : down.pointerType === "pen" ? 12 : 6;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > tapSlop) return;
    const hubRadius = down.pointerType === "touch" ? 120 : down.pointerType === "pen" ? 96 : 76;
    const hub = operationsHubAt(e.clientX, e.clientY, hubRadius);
    if (hub && !entering) {
      entering = true;
      events.onOperationsHubHover?.(null);
      flyTo(hub.x, hub.z, 520, () => {
        entering = false;
        events.onOperationsHub?.();
      });
      return;
    }
    const tw = towerAt(e.clientX, e.clientY);
    if (tw) { events.onTower?.(tw.id); return; }
    const suitcaseRadius = down.pointerType === "touch" ? 108 : down.pointerType === "pen" ? 84 : 64;
    const sc = suitcaseAt(e.clientX, e.clientY, suitcaseRadius);
    if (sc && !entering && activeIslandName === "Hollywood") {
      entering = true;
      events.onSuitcaseHover?.(null);
      flyTo(sc.x, sc.z, 420, () => { entering = false; events.onSuitcase?.(); });
      return;
    }
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    // march the ray until it meets an island top
    const o = ray.ray.origin, d = ray.ray.direction;
    for (let t = 0; t < 60000; t += 20) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < 0) { events.onIsland?.(null); return; }
      const own = ownerAt(F, x, z);
      if (own >= 0 && y < H(x, z, own)) {
        const l = islands[own];
        activeIslandName = l.name;
        events.onIsland?.({ name: l.name, lanterns: islandCounts.get(own) ?? 0, served: l.served, x: l.label[0], z: l.label[1] });
        flyTo(l.label[0], l.label[1], Math.max(2400, Math.sqrt(l.area) * 1.6));
        return;
      }
    }
  };
  // hover: the lit home nearest the pointer (within 34px on screen) surfaces its customers, no click
  let hoverSig = "";
  const onMove = (e: PointerEvent) => {
    if (!ready) return;
    const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3();
    let best: typeof placed[number] | null = null, bd = 34;
    for (const p of placed) {
      v.set(p.x, H(p.x, p.z) + (p.plan ? p.plan.top * S * 0.6 : 0), p.z).project(camera);
      const d = Math.hypot(r.left + ((v.x + 1) / 2) * r.width - e.clientX, r.top + ((1 - v.y) / 2) * r.height - e.clientY);
      if (v.z < 1 && d < bd) { bd = d; best = p; }
    }
    const keys = best ? placed.filter(q => q.plan && q.plan === best!.plan).map(q => q.key) : [];
    const tw = towerAt(e.clientX, e.clientY);
    const hub = !entering ? operationsHubAt(e.clientX, e.clientY) : null;
    const sc = !entering && activeIslandName === "Hollywood" ? suitcaseAt(e.clientX, e.clientY) : null;
    events.onOperationsHubHover?.(hub ? { x: e.clientX, y: e.clientY } : null);
    events.onSuitcaseHover?.(sc ? { x: e.clientX, y: e.clientY } : null);
    const sig = keys.join("|") + (tw ? tw.id : "");
    if (sig !== hoverSig || keys.length || tw) events.onHover?.(keys.length || tw ? { keys, x: e.clientX, y: e.clientY, tower: tw?.id } : null);
    hoverSig = sig;
    renderer.domElement.style.cursor = keys.length || tw || hub || sc ? "pointer" : "";
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("pointermove", onMove);

  // ----------------------------------------------------------------- the loop
  let raf = 0;
  let simTime = 0;
  let last = performance.now();
  let paused = false;
  function tick() {
    if (disposed) return;
    if (paused) { last = performance.now(); raf = requestAnimationFrame(tick); return; }
    const now = performance.now();
    step(Math.min((now - last) / 1000, 0.05));
    last = now;
    raf = requestAnimationFrame(tick);
  }
  let readySent = false;
  function step(dt: number) {
    simTime += dt;
    uniforms.uTime.value = simTime;
    if (fly) {
      fly.t += dt / 1.5;
      const e = fly.t >= 1 ? 1 : 1 - Math.pow(1 - fly.t, 3);
      controls.target.lerpVectors(fly.fromT, fly.toT, e);
      camera.position.lerpVectors(fly.fromP, fly.toP, e);
      if (fly.t >= 1) { const done = fly.done; fly = null; done?.(); }
    }
    controls.update();
    const cd = camera.position.distanceTo(controls.target);
    const near = cd * 1.6, far = cd * 4.5;
    fogU.fogNear.value = near; fogU.fogFar.value = far;
    (scene.fog as THREE.Fog).near = near; (scene.fog as THREE.Fog).far = far;
    camera.near = Math.max(10, cd * 0.02);
    camera.far = cd * 6 + 4000;
    camera.updateProjectionMatrix();
    // the brush grows as you pull back, so the board reads as one painting from far out
    paint.uniforms.uR.value = THREE.MathUtils.clamp(cd / 4000, 1.2, 3.2);
    // ink lines thin out from far away, where they'd only be noise
    ink.uniforms.uStrength.value = THREE.MathUtils.clamp(1.15 - cd / 16000, 0.35, 0.9);
    if (ready) {
      const built = pumpBuildings(opts.capture ? 1e9 : 10);
      if (built && !readySent) { readySent = true; events.onReady?.(); }
      moveBoats(dt);
      animateClouds(dt);
      placeLabels(cd);
      const bs = Math.max(1, cd / 3200);
      // beams mark lanterns from afar; down among the streets the lit windows do that job
      beamMat.uniforms.uFade.value = THREE.MathUtils.smoothstep(cd, 1200, 3600);
      for (const o of beams.children) if (o.userData.beam) o.scale.set(bs, 1 + (bs - 1) * 0.25, bs);
      fitShadowToView(cd);
      if (shadowDirty) renderShadows();
    }
    renderInkPrepass();
    composer.render();
    renderer.autoClear = false;
    renderer.render(labelScene, camera);
    renderer.autoClear = true;
  }
  if (!opts.capture) raf = requestAnimationFrame(tick);
  load().catch(e => events.onError?.(e));

  return {
    setLanterns(next: IslandLantern[]) {
      lanternInputs = next;
      applyLanterns(false);
    },
    /** capture: put the camera somewhere at once; pitch 0 looks straight down */
    jump(x: number, z: number, dist: number, pitch = 0.82, yaw = 0) {
      fly = null;
      frame(x, z, dist, yaw, pitch);
    },
    board() { activeIslandName = null; frameBoard(); },
    /** the game sits on top: stop drawing the city underneath */
    setPaused(p: boolean) { paused = p; entering = false; },
    /** the camera as jump() takes it */
    cam() {
      const t = controls.target, off = camera.position.clone().sub(t), d = off.length();
      return { x: t.x, z: t.z, d, pitch: Math.acos(off.y / d), yaw: Math.atan2(off.x, off.z) };
    },
    renderFrame(dt = 1 / 30) { step(dt); },
    /**
     * A real coordinate on screen, in container pixels, placed the same way a
     * lantern is (stepped onto land). Null until the board has loaded.
     * `visible` is false when the point is behind the camera or off screen.
     */
    project(latitude: number, longitude: number) {
      if (!ready) return null;
      const b = lonLatToBoard(M, latitude, longitude);
      const p = ontoLand(F, b.x, b.z, 30);
      const v = new THREE.Vector3(p.x, H(p.x, p.z), p.z).project(camera);
      const w = container.clientWidth || 1, h = container.clientHeight || 1;
      const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
      return { x, y, visible: v.z < 1 && x >= -40 && y >= -40 && x <= w + 40 && y <= h + 40 };
    },
    /** where the Hollywood Tin Can House is on screen, in container pixels (null until loaded) */
    suitcaseScreen() {
      if (!suitcase) return null;
      const v = new THREE.Vector3(suitcase.x, H(suitcase.x, suitcase.z) + suitcase.h * 0.5, suitcase.z).project(camera);
      const w = container.clientWidth || 1, h = container.clientHeight || 1;
      return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, visible: v.z < 1 };
    },
    lanternAt(key: string) {
      const p = placed.find(q => q.key === key);
      return p ? { x: p.x, z: p.z } : null;
    },
    islandAt(name: string) {
      const l = islands.find(i => i.name === name);
      return l ? { x: l.label[0], z: l.label[1], area: l.area } : null;
    },
    focusIsland(name: string) {
      const l = islands.find(i => i.name === name);
      if (l) {
        activeIslandName = l.name;
        flyTo(l.label[0], l.label[1], Math.max(2400, Math.sqrt(l.area) * 1.6));
      }
    },
    stats() {
      return { islands: islands.map(l => ({ name: l.name, buildings: l.plans.length, trees: l.trees.length, lanterns: islandCounts.get(l.index) ?? 0 })), puffs: puffList.length, boats: boats.length };
    },
    setPaint(r: number) { paint.enabled = r > 0; },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      controls.dispose();
      scene.traverse(o => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach(x => x.dispose());
      });
      shadowTarget.dispose();
      inkTarget.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
export type IslandBoard = ReturnType<typeof createIslandBoard>;
