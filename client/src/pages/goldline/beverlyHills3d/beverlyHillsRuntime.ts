/**
 * Beverly Hills, walkable: the commercial level's 3D runtime (three.js).
 *
 * The world is built by scripts/assets/beverly-hills/build_plaza.py, the people by build_cast.py (all CC0 sources).
 * The look is golden hour: the Poly Haven belfast_sunset sky lights and reflects everything (gold, brass, glass,
 * water), with plaster, terracotta and limestone detail projected per surface, soft shadows, ambient occlusion,
 * bloom on the lamps and flashes, and a warm grade. Palms sway; the fountain shimmers.
 *
 * The gag (velvetRope.ts) lives in React; this runtime renders its state and reports what the heroine does:
 * walking into an influencer's shot, catching the pug at a sprint, and pressing to talk or grab.
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { getAudioManager } from "@/game/audio/AudioManager";
import { INFLUENCERS, type InfluencerId, type RopeState } from "./velvetRope";

export type PromptId = "doorman" | "barista" | "shades" | "door";
export type Interaction =
  | { kind: "talk_doorman" }
  | { kind: "talk_barista" }
  | { kind: "grab_shades" }
  | { kind: "enter_door" }
  | { kind: "photobomb"; who: InfluencerId }
  | { kind: "catch_pug" }
  | { kind: "pug_too_slow" };

export type BeverlyHillsCallbacks = {
  onProgress?: (fraction: number) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  onPrompt?: (prompt: { id: PromptId; label: string } | null) => void;
  onInteract?: (i: Interaction) => void;
};

export type BeverlyHillsHandle = {
  setRope(state: RopeState): void;
  setHotelName(name: string): void;
  setPaused(paused: boolean): void;
  interact(): void;
  jump(): void;
  setSprint(on: boolean): void;
  celebrate(): void;
  dispose(): void;
};

type PlazaMeta = {
  colliders: {
    boxes: Array<{ x: number; y: number; w: number; d: number; rot: number; tag?: string }>;
    circles: Array<{ x: number; y: number; r: number; tag?: string }>;
    rings: Array<{ x: number; y: number; r0: number; r1: number; top: number }>;
    platforms: Array<{ x: number; y: number; r: number; top: number; water?: number }>;
  };
  points: {
    spawn: [number, number, number];
    hotel: { door: [number, number]; gate: [number, number]; doorman: [number, number]; sign: [number, number, number]; carpetStart: [number, number] };
    juice: { barista: [number, number]; counter: [number, number]; queue: Array<[number, number]>; sign: [number, number, number] };
    shades: [number, number, number];
    pugLoop: { x: number; y: number; r: number };
    lamps: Array<[number, number, number]>;
  };
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
};

const HERO_R = 0.32;
const WALK = 1.9;
const JOG = 3.7;
const SPRINT = 6.6;
const GRAVITY = 22;
const JUMP_V = 7.2;
const STEP = 0.36;
const PUG_SPRINT_CATCH = 4.6;

// Blender (x, y, z) -> three (x, z, -y)
const b2t = (x: number, y: number, z = 0) => new THREE.Vector3(x, z, -y);
const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const dampAngle = (a: number, b: number, l: number, dt: number) => a + wrapA(b - a) * (1 - Math.exp(-l * dt));

const SHOP_SIGNS: Record<string, { text: string; sub: string; bg: string; fg: string }> = {
  SIGN_SHOP_A: { text: "MAISON LULU", sub: "PARIS · BEVERLY HILLS", bg: "#171519", fg: "#e9c46a" },
  SIGN_SHOP_B: { text: "RODEO & RYE", sub: "FINE TAILORING", bg: "#1f4d3a", fg: "#f6efe0" },
  SIGN_SHOP_C: { text: "BISOU", sub: "FLOWERS & SECRETS", bg: "#f6efe0", fg: "#b0365f" },
  SIGN_JUICE: { text: "SUNSET SQUEEZE", sub: "COLD-PRESSED · $26", bg: "#fbe3ea", fg: "#d03a6c" },
};

/** A painted golden-hour sky: lavender overhead, peach and gold at the horizon, a soft sun low in the west. */
function paintedSky() {
  const w = 2048;
  const h = 1024;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0.0, "#6f7fc4");
  grad.addColorStop(0.28, "#b49bd6");
  grad.addColorStop(0.42, "#f2b8c4");
  grad.addColorStop(0.5, "#ffd2a1");
  grad.addColorStop(0.56, "#ffe7c2");
  grad.addColorStop(1.0, "#f6c49c");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // the sun, low in the west (three's -X is u = 0.75 on an equirectangular map seen from inside)
  const sx = w * 0.62;
  const sy = h * 0.47;
  const sun = g.createRadialGradient(sx, sy, 0, sx, sy, 380);
  sun.addColorStop(0, "rgba(255,248,226,1)");
  sun.addColorStop(0.06, "rgba(255,236,190,0.95)");
  sun.addColorStop(0.25, "rgba(255,200,140,0.45)");
  sun.addColorStop(1, "rgba(255,180,140,0)");
  g.fillStyle = sun;
  g.fillRect(0, 0, w, h);
  // a few long, lit cloud streaks
  g.globalAlpha = 0.35;
  for (let i = 0; i < 14; i++) {
    const y = h * (0.3 + Math.random() * 0.16);
    const x = Math.random() * w;
    const len = 200 + Math.random() * 420;
    const cl = g.createLinearGradient(x, y, x + len, y);
    cl.addColorStop(0, "rgba(255,226,200,0)");
    cl.addColorStop(0.5, "rgba(255,214,190,0.9)");
    cl.addColorStop(1, "rgba(255,226,200,0)");
    g.fillStyle = cl;
    g.fillRect(x, y, len, 6 + Math.random() * 10);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

function signTexture(text: string, sub: string, bg: string, fg: string, w = 1024, h = 192) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = 6;
  g.strokeRect(14, 14, w - 28, h - 28);
  g.fillStyle = fg;
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = 92;
  g.font = `600 ${size}px "Didot", "Bodoni 72", "Playfair Display", Georgia, serif`;
  while (g.measureText(text).width > w - 120 && size > 30) {
    size -= 4;
    g.font = `600 ${size}px "Didot", "Bodoni 72", "Playfair Display", Georgia, serif`;
  }
  g.fillText(text, w / 2, sub ? h * 0.44 : h / 2);
  if (sub) {
    g.font = `500 30px "Avenir Next", "Helvetica Neue", Arial, sans-serif`;
    g.fillText(sub.split("").join(" "), w / 2, h * 0.8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Plaster / terracotta / limestone detail projected per surface: the CC0 Poly Haven textures' light and shade
 *  modulate the palette colour, so every wall reads as real material without UV-mapping the procedural geometry. */
function addTriplanar(mat: THREE.MeshStandardMaterial, tex: THREE.Texture, scale: number, strength: number, key: string, mean = 0.55) {
  mat.onBeforeCompile = shader => {
    shader.uniforms.bhDetail = { value: tex };
    shader.uniforms.bhScale = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBhPos;\nvarying vec3 vBhNrm;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBhPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvBhNrm = normalize(mat3(modelMatrix) * objectNormal);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBhPos;\nvarying vec3 vBhNrm;\nuniform sampler2D bhDetail;\nuniform float bhScale;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          vec3 w = pow(abs(normalize(vBhNrm)), vec3(4.0));
          w /= max(1e-4, w.x + w.y + w.z);
          vec3 p = vBhPos * bhScale;
          vec3 d = texture2D(bhDetail, p.zy).rgb * w.x + texture2D(bhDetail, p.xz).rgb * w.y + texture2D(bhDetail, p.xy).rgb * w.z;
          float l = dot(d, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb *= mix(1.0, l / ${mean.toFixed(2)}, ${strength.toFixed(2)});
        }`
      );
  };
  mat.customProgramCacheKey = () => `bh-tri-${key}`;
}

export async function createBeverlyHills(container: HTMLElement, assetBase: string, callbacks: BeverlyHillsCallbacks = {}): Promise<BeverlyHillsHandle> {
  const disposers: Array<() => void> = [];
  let disposed = false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const audio = getAudioManager();

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = "bh3d-canvas";
  renderer.domElement.setAttribute("data-testid", "beverly-hills-3d-canvas");
  container.appendChild(renderer.domElement);
  const softwareGl = (() => {
    try {
      const gl = renderer.getContext();
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      return /swiftshader|llvmpipe|software|basic render/i.test(name);
    } catch {
      return false;
    }
  })();
  const highQuality = !softwareGl && !coarse;
  if (softwareGl) {
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = false;
  }
  disposers.push(() => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.domElement.remove();
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);

  // ---------------------------------------------------------------- loading
  const loader = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();
  const files = ["plaza.glb", "cast/heroine.glb", "cast/sterling.glb", "cast/influencer_a.glb", "cast/influencer_b.glb", "cast/influencer_c.glb", "cast/barista.glb", "cast/anims.glb"];
  const progress = new Map<string, number>(files.map(f => [f, 0]));
  const report = () => callbacks.onProgress?.([...progress.values()].reduce((a, b) => a + b, 0) / progress.size);
  const load = (file: string) =>
    new Promise<GLTF>((resolve, reject) =>
      loader.load(assetBase + file, g => { progress.set(file, 1); report(); resolve(g); }, e => { if (e.total) { progress.set(file, Math.min(0.99, e.loaded / e.total)); report(); } }, reject)
    );
  const tex = (file: string, srgb = true) =>
    new Promise<THREE.Texture>((resolve, reject) =>
      texLoader.load(assetBase + file, t => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        resolve(t);
      }, undefined, reject)
    );
  let plaza: GLTF, heroG: GLTF, sterlingG: GLTF, infA: GLTF, infB: GLTF, infC: GLTF, baristaG: GLTF, animsG: GLTF, meta: PlazaMeta;
  let plasterT: THREE.Texture, roofT: THREE.Texture, pavingT: THREE.Texture, skyT: THREE.Texture, envHdr: THREE.DataTexture;
  try {
    [plaza, heroG, sterlingG, infA, infB, infC, baristaG, animsG] = await Promise.all(files.map(load));
    [meta, plasterT, roofT, pavingT, skyT, envHdr] = await Promise.all([
      fetch(assetBase + "plaza.json").then(r => { if (!r.ok) throw new Error("plaza.json missing"); return r.json() as Promise<PlazaMeta>; }),
      tex("tex/plaster_diff.webp"),
      tex("tex/roof_diff.webp"),
      tex("tex/paving_diff.webp"),
      tex("tex/sky.webp"),
      new HDRLoader().loadAsync(assetBase + "tex/env.hdr") as Promise<THREE.DataTexture>,
    ]);
  } catch (err) {
    callbacks.onError?.(err instanceof Error ? err.message : String(err));
    disposers.forEach(d => d());
    throw err;
  }
  if (disposed) throw new Error("disposed");

  // ---------------------------------------------------------------- sky, light
  skyT.dispose();
  scene.background = paintedSky();
  const pmrem = new THREE.PMREMGenerator(renderer);
  envHdr.mapping = THREE.EquirectangularReflectionMapping;
  const envRT = pmrem.fromEquirectangular(envHdr);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.32;
  pmrem.dispose();
  disposers.push(() => envRT.dispose());
  scene.fog = new THREE.Fog(0xf4cdb0, 38, 150);

  const sun = new THREE.DirectionalLight(0xffbf7a, 2.9);
  // low golden sun from the west-south-west, raking across the hotel facade
  sun.position.set(-34, 17, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(highQuality ? 4096 : 2048, highQuality ? 4096 : 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -34;
  sc.right = 34;
  sc.top = 34;
  sc.bottom = -34;
  sc.near = 1;
  sc.far = 120;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xffd9c4, 0xb48a6c, 0.45);
  scene.add(hemi);

  // ---------------------------------------------------------------- world materials
  const timeU = { value: 0 };
  const glow: THREE.MeshStandardMaterial[] = [];
  const signMeshes = new Map<string, THREE.Mesh>();
  let ropeGate: THREE.Object3D | null = null;
  let statueShades: THREE.Object3D | null = null;
  plaza.scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const src = m.material as THREE.MeshStandardMaterial;
    const name = src.name || "";
    const mat = src.clone();
    mat.envMapIntensity = 0.75;
    if (name.startsWith("BH_plaster")) {
      mat.roughness = 0.94;
      addTriplanar(mat, plasterT, 0.42, 0.75, name);
    } else if (name === "BH_roof_terracotta") {
      mat.roughness = 0.8;
      addTriplanar(mat, roofT, 0.9, 0.95, name);
    } else if (name.startsWith("BH_paving") || name === "BH_sidewalk") {
      mat.roughness = 0.82;
      addTriplanar(mat, pavingT, name === "BH_sidewalk" ? 0.6 : 0.34, 0.55, name, 0.36);
      m.castShadow = false;
    } else if (name === "BH_asphalt" || name === "BH_paint_white" || name === "BH_curb") {
      m.castShadow = false;
      mat.roughness = 0.95;
      if (name === "BH_asphalt") addTriplanar(mat, pavingT, 0.9, 0.5, name);
    } else if (name === "BH_marble") {
      mat.roughness = 0.22;
      mat.envMapIntensity = 1.1;
      addTriplanar(mat, plasterT, 0.8, 0.22, name);
    } else if (name === "BH_gold" || name === "BH_brass") {
      mat.metalness = 1;
      mat.roughness = name === "BH_gold" ? 0.2 : 0.28;
      mat.envMapIntensity = 1.6;
    } else if (name === "BH_glass_dark") {
      mat.roughness = 0.04;
      mat.metalness = 0.4;
      mat.envMapIntensity = 2.2;
    } else if (name === "BH_glass_glow" || name === "BH_lamp_glow") {
      mat.emissive = mat.color.clone();
      mat.emissiveIntensity = name === "BH_lamp_glow" ? 3.2 : 1.1;
      m.castShadow = false;
      glow.push(mat);
    } else if (name === "BH_water") {
      mat.color.set(0x4fb2c8);
      mat.roughness = 0.04;
      mat.metalness = 0.15;
      mat.envMapIntensity = 1.8;
      mat.transparent = true;
      mat.opacity = 0.88;
      m.castShadow = false;
      mat.onBeforeCompile = shader => {
        shader.uniforms.bhTime = timeU;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vBhPos;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBhPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vBhPos;\nuniform float bhTime;")
          .replace(
            "#include <normal_fragment_maps>",
            `#include <normal_fragment_maps>
            {
              vec2 q = vBhPos.xz;
              float r = length(q);
              vec2 rip = vec2(sin(q.x * 3.1 + bhTime * 1.7) + sin(r * 6.0 - bhTime * 2.6) * 0.8, cos(q.y * 2.7 - bhTime * 1.3) + cos(r * 5.0 - bhTime * 2.2) * 0.8);
              normal = normalize(normal + vec3(rip.x, 0.0, rip.y) * 0.11);
            }`
          );
      };
      mat.customProgramCacheKey = () => "bh-water";
    } else if (name === "BH_palm_leaf" || name === "BH_palm_skirt" || name === "BH_bougain") {
      mat.side = THREE.DoubleSide;
      mat.roughness = 0.75;
      if (name !== "BH_bougain") {
        mat.onBeforeCompile = shader => {
          shader.uniforms.bhTime = timeU;
          shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nuniform float bhTime;")
            .replace(
              "#include <begin_vertex>",
              `#include <begin_vertex>
              {
                vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
                float h = max(0.0, wp.y - 6.0);
                float sway = sin(bhTime * 1.1 + wp.x * 0.21 + wp.z * 0.17) * 0.05 + sin(bhTime * 2.3 + wp.x * 0.9) * 0.018;
                transformed.x += sway * h;
                transformed.z += sway * h * 0.6;
              }`
            );
        };
        mat.customProgramCacheKey = () => `bh-sway-${name}`;
      }
    } else if (name === "BH_sign") {
      mat.roughness = 0.5;
    }
    m.material = mat;
    if (m.name.startsWith("SIGN_")) {
      const g = m.geometry;
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const ext = bb.getSize(new THREE.Vector3());
      const axes = (["x", "y", "z"] as const).slice().sort((a, b) => ext[b] - ext[a]);
      const [ua, va] = [axes[0], axes[1]];
      const pa = g.attributes.position;
      const uv = new Float32Array(pa.count * 2);
      for (let k = 0; k < pa.count; k++) {
        const v = new THREE.Vector3().fromBufferAttribute(pa, k);
        uv[k * 2] = (v[ua] - bb.min[ua]) / (ext[ua] || 1);
        uv[k * 2 + 1] = 1 - (v[va] - bb.min[va]) / (ext[va] || 1);
      }
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      signMeshes.set(m.name, m);
    }
    if (m.name.startsWith("ROPE_GATE")) ropeGate = m;
    if (m.name.startsWith("SHADES")) statueShades = m;
  });
  scene.add(plaza.scene);
  const glowBase = glow.map(g => g.emissiveIntensity);
  // shop and juice-bar signs (fiction); the hotel's is the real prospect's name
  for (const [name, s] of Object.entries(SHOP_SIGNS)) {
    const mesh = signMeshes.get(name);
    if (!mesh) continue;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.map = signTexture(s.text, s.sub, s.bg, s.fg);
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveMap = mat.map;
    mat.emissiveIntensity = 0.25;
    mat.needsUpdate = true;
  }
  function paintHotelSign(name: string) {
    const mesh = signMeshes.get("SIGN_HOTEL");
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.map = signTexture(name.toUpperCase(), "", "#141218", "#e7bd5e", 1536, 256);
    mat.emissive = new THREE.Color(0xffffff);
    mat.emissiveMap = mat.map;
    mat.emissiveIntensity = 0.55;
    mat.needsUpdate = true;
  }
  {
    const hs = signMeshes.get("SIGN_HOTEL");
    if (hs) {
      hs.position.y = 7.25;
      hs.position.z += 0.18;
      hs.scale.set(1.25, 1.25, 1.25);
      (hs.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    }
    for (const [name, mesh] of signMeshes) if (name !== "SIGN_HOTEL") (mesh.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  }
  paintHotelSign("THE GRAND");

  // ---------------------------------------------------------------- scenery around the plaza
  // a ring of distant pastel buildings with lit windows, and palm silhouettes, so the plaza sits in a town
  {
    const winTex = (() => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 128;
      const g = c.getContext("2d")!;
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, 64, 128);
      for (let y = 10; y < 128; y += 26) for (let x = 8; x < 64; x += 24) {
        g.fillStyle = Math.random() < 0.4 ? "#ffe2b8" : "#b9a7b4";
        g.fillRect(x, y, 12, 16);
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    })();
    const pastel = [0xf3d6c2, 0xf0c4c8, 0xe9dcc0, 0xd9cfe8, 0xf5e3c4, 0xe7c6a8];
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + Math.random() * 0.05;
      const r = 66 + Math.random() * 26;
      const hgt = 6 + Math.random() * 11;
      const wdt = 7 + Math.random() * 9;
      const t = winTex.clone();
      t.repeat.set(Math.max(1, Math.round(wdt / 3)), Math.max(1, Math.round(hgt / 4)));
      t.needsUpdate = true;
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: pastel[i % pastel.length], map: t, emissiveMap: t, emissive: 0x6b4a30, emissiveIntensity: 0.12, roughness: 0.95 }));
      m.scale.set(wdt, hgt, 6);
      m.position.set(Math.cos(a) * r, hgt / 2, Math.sin(a) * r);
      m.lookAt(0, hgt / 2, 0);
      scene.add(m);
    }
    const palmMat = new THREE.MeshBasicMaterial({ color: 0x5a4a5e, side: THREE.DoubleSide });
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 28;
      const h = 14 + Math.random() * 8;
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, h, 5), palmMat);
      trunk.position.y = h / 2;
      g.add(trunk);
      for (let k = 0; k < 9; k++) {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 3.2), palmMat);
        f.position.y = h;
        f.rotation.set(1.0 + Math.random() * 0.4, (k / 9) * Math.PI * 2, 0);
        f.translateY(1.4);
        g.add(f);
      }
      g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      scene.add(g);
    }
    const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 48), new THREE.MeshStandardMaterial({ color: 0xcdb7a0, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.21;
    scene.add(ground);
  }

  // string lights draped over the plaza (warm bulbs that bloom at dusk)
  const bulbs: THREE.InstancedMesh = (() => {
    const runs: Array<[THREE.Vector3, THREE.Vector3]> = [
      [b2t(-12.5, 13.6, 7.2), b2t(-9, 8.5, 6.4)],
      [b2t(12.5, 13.6, 7.2), b2t(9, 8.5, 6.4)],
      [b2t(-9, 8.5, 6.4), b2t(9, 8.5, 6.4)],
      [b2t(-9, 8.5, 6.4), b2t(-11, -8.5, 6.0)],
      [b2t(9, 8.5, 6.4), b2t(10.5, -9, 6.0)],
      [b2t(-11, -8.5, 6.0), b2t(10.5, -9, 6.0)],
      [b2t(-14, 6, 6.6), b2t(-9, 8.5, 6.4)],
    ];
    const per = 26;
    const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffc870, emissiveIntensity: 4.5 }), runs.length * per);
    const wire = new THREE.LineBasicMaterial({ color: 0x2a2220 });
    const m4 = new THREE.Matrix4();
    let n = 0;
    for (const [a, b] of runs) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= per; i++) {
        const t = i / per;
        const p = a.clone().lerp(b, t);
        p.y -= Math.sin(Math.PI * t) * 1.3;
        pts.push(p);
        if (i < per) {
          m4.makeTranslation(p.x, p.y - 0.12, p.z);
          inst.setMatrixAt(n++, m4);
        }
      }
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wire));
    }
    inst.count = n;
    scene.add(inst);
    return inst;
  })();
  void bulbs;

  // fountain water: arcs falling from each tier's lip into the basin below, and a sparkle of spray
  const sprayGeo = new THREE.BufferGeometry();
  const SPRAY = softwareGl ? 220 : 900;
  const sprayPos = new Float32Array(SPRAY * 3);
  const sprayLife = new Float32Array(SPRAY);
  const sprayVel = new Float32Array(SPRAY * 3);
  const tiers = [{ r: 1.95, y: 1.18 }, { r: 1.15, y: 2.18 }];
  const spawnSpray = (i: number) => {
    const t = tiers[i % tiers.length];
    const a = Math.random() * Math.PI * 2;
    sprayPos.set([Math.cos(a) * t.r, t.y, Math.sin(a) * t.r], i * 3);
    const out = 0.35 + Math.random() * 0.25;
    sprayVel.set([Math.cos(a) * out, 0.15 + Math.random() * 0.2, Math.sin(a) * out], i * 3);
    sprayLife[i] = Math.random();
  };
  for (let i = 0; i < SPRAY; i++) spawnSpray(i);
  sprayGeo.setAttribute("position", new THREE.BufferAttribute(sprayPos, 3));
  const dot = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.4, "rgba(230,248,255,0.7)");
    r.addColorStop(1, "rgba(230,248,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  const spray = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ color: 0xf2fcff, map: dot, size: 0.09, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  spray.position.copy(b2t(0, 0));
  scene.add(spray);

  // pigeons: peck about near the fountain, burst into the air when you run at them
  const birdMat = new THREE.MeshStandardMaterial({ color: 0x9aa1ad, roughness: 0.8 });
  const birds = Array.from({ length: 7 }, (_, i) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), birdMat);
    body.scale.set(0.8, 0.75, 1.3);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), birdMat);
    head.position.set(0, 0.08, 0.11);
    const wl = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.12), new THREE.MeshStandardMaterial({ color: 0x7c8390, side: THREE.DoubleSide }));
    const wr = wl.clone();
    wl.position.set(0.08, 0.04, 0);
    wr.position.set(-0.08, 0.04, 0);
    g.add(body, head, wl, wr);
    const a = (i / 7) * Math.PI * 2 + Math.random();
    const home = b2t(Math.cos(a) * (6.2 + Math.random()), Math.sin(a) * (6.2 + Math.random()), 0.1);
    g.position.copy(home);
    scene.add(g);
    return { g, head, wl, wr, home, fly: 0, vel: new THREE.Vector3(), phase: Math.random() * 10 };
  });

  // parked cars along the curb (Kenney Car Kit, CC0)
  void (async () => {
    const spots: Array<[string, number, number, number]> = [
      ["cars/sedan-sports.glb", -15.5, -18.6, 0],
      ["cars/suv-luxury.glb", -9.0, -18.7, 0.03],
      ["cars/hatchback-sports.glb", 8.5, -18.6, -0.02],
      ["cars/sedan-sports.glb", 15.5, -18.7, 0.02],
    ];
    const cache = new Map<string, GLTF>();
    for (const [file, x, y, rot] of spots) {
      try {
        let g = cache.get(file);
        if (!g) {
          g = await load(file);
          cache.set(file, g);
        }
        const car = g.scene.clone(true);
        car.scale.setScalar(1.62);
        car.position.copy(b2t(x, y, 0.02));
        car.rotation.y = Math.PI / 2 + rot;
        car.traverse(o => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            const mat = m.material as THREE.MeshStandardMaterial;
            mat.roughness = 0.35;
            mat.metalness = 0.3;
            mat.envMapIntensity = 1.3;
          }
        });
        scene.add(car);
      } catch {
        // a missing car is scenery, not a failure
      }
    }
  })();

  // lamp light pools (a few real point lights near the play area; the rest is bloom)
  for (const [x, y] of meta.points.lamps.slice(0, highQuality ? 6 : 2)) {
    const l = new THREE.PointLight(0xffc982, 6, 9, 2);
    l.position.copy(b2t(x, y, 3.3));
    scene.add(l);
  }

  // ---------------------------------------------------------------- people
  const clips = animsG.animations;
  type Person = { root: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; current: string; play(name: string, fade?: number, once?: boolean): void };
  function person(g: GLTF, clone = false): Person {
    const root = clone ? SkeletonUtils.clone(g.scene) : g.scene;
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat && !mat.map) {
        mat.roughness = 0.72;
        mat.envMapIntensity = 0.5;
      }
    });
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const c of clips) actions.set(c.name, mixer.clipAction(c));
    const p: Person = {
      root,
      mixer,
      actions,
      current: "",
      play(name, fade = 0.2, once = false) {
        if (p.current === name) return;
        const next = actions.get(name);
        if (!next) return;
        next.reset();
        next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
        next.clampWhenFinished = once;
        next.fadeIn(fade).play();
        const prev = actions.get(p.current);
        if (prev) prev.fadeOut(fade);
        p.current = name;
      },
    };
    scene.add(root);
    return p;
  }
  const hero = person(heroG);
  const heroSunglasses = hero.root.getObjectByName("SUNGLASSES");
  if (heroSunglasses) heroSunglasses.visible = false;
  hero.play("Idle_Loop", 0);
  const sterling = person(sterlingG);
  sterling.root.scale.setScalar(1.08); // a very tall doorman
  const [dmx, dmy] = meta.points.hotel.doorman;
  sterling.root.position.copy(b2t(dmx, dmy));
  sterling.root.rotation.y = 0; // faces the plaza (+Z, south)
  sterling.play("Idle_FoldArms_Loop", 0);
  const barista = person(baristaG);
  const [bax, bay] = meta.points.juice.barista;
  barista.root.position.copy(b2t(bax, bay));
  barista.root.rotation.y = -Math.PI / 2; // faces west, over the counter
  barista.play("Idle_Loop", 0);

  // influencers: each films a talking-head video into a phone on a ring-light tripod; the shot looks back past them
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 2.4 });
  const tripodMat = new THREE.MeshStandardMaterial({ color: 0x1c1b1f, roughness: 0.4, metalness: 0.6 });
  const shotMat = new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  type Influencer = { id: InfluencerId; p: Person; base: THREE.Vector3; face: number; rig: THREE.Group; shot: THREE.Mesh; gone: boolean; leaving: number; dwell: number };
  const influencers: Influencer[] = INFLUENCERS.map((inf, i) => {
    const g = [infA, infB, infC][i];
    const p = person(g);
    const [qx, qy] = meta.points.juice.queue[i];
    const base = b2t(qx, qy);
    // they face the plaza (west), with the pink juice bar behind them as the backdrop
    const face = -Math.PI / 2 + (i - 1) * 0.35;
    p.root.position.copy(base);
    p.root.rotation.y = face;
    p.play(i === 1 ? "Idle_TalkingPhone_Loop" : "Idle_Talking_Loop", 0);
    const rig = new THREE.Group();
    const fwd = new THREE.Vector3(Math.sin(face), 0, Math.cos(face));
    rig.position.copy(base).addScaledVector(fwd, 1.5);
    const legGeo = new THREE.CylinderGeometry(0.012, 0.012, 1.55, 6);
    for (let k = 0; k < 3; k++) {
      const leg = new THREE.Mesh(legGeo, tripodMat);
      const a = (k / 3) * Math.PI * 2;
      leg.position.set(Math.cos(a) * 0.18, 0.74, Math.sin(a) * 0.18);
      leg.rotation.set(Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22);
      rig.add(leg);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 10, 40), ringMat);
    ring.position.y = 1.58;
    ring.rotation.y = face + Math.PI;
    const phone = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.012), tripodMat);
    phone.position.y = 1.58;
    phone.rotation.y = face + Math.PI;
    rig.add(ring, phone);
    scene.add(rig);
    // the shot: a soft wedge of light on the ground, opening out behind them
    const shape = new THREE.Shape();
    shape.moveTo(-0.35, 0);
    shape.lineTo(0.35, 0);
    shape.lineTo(1.25, 2.6);
    shape.lineTo(-1.25, 2.6);
    shape.closePath();
    const shotGeo = new THREE.ShapeGeometry(shape);
    shotGeo.rotateX(-Math.PI / 2);
    const shot = new THREE.Mesh(shotGeo, shotMat.clone());
    shot.position.copy(base).addScaledVector(fwd, -0.35);
    shot.position.y = 0.06;
    shot.rotation.y = face + Math.PI;
    scene.add(shot);
    return { id: inf.id, p, base, face, rig, shot, gone: false, leaving: 0, dwell: 0 };
  });

  // Biscotti the pug: built here so she can be exactly as round and smug as required
  const pug = (() => {
    const fawn = new THREE.MeshStandardMaterial({ color: 0xe0b98a, roughness: 0.85 });
    const mask = new THREE.MeshStandardMaterial({ color: 0x2b211c, roughness: 0.7 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const pink = new THREE.MeshStandardMaterial({ color: 0xff7aa8, roughness: 0.45 });
    const sparkle = new THREE.MeshStandardMaterial({ color: 0xeaf6ff, roughness: 0.05, metalness: 0.9, envMapIntensity: 2 });
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), fawn);
    torso.scale.set(0.95, 0.85, 1.35);
    torso.position.set(0, 0.2, 0);
    const head = new THREE.Group();
    head.position.set(0, 0.32, 0.19);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), fawn);
    skull.scale.set(1.1, 0.95, 0.95);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 10), mask);
    muzzle.scale.set(1.25, 0.8, 0.7);
    muzzle.position.set(0, -0.03, 0.1);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), mask);
    nose.position.set(0, -0.005, 0.15);
    head.add(skull, muzzle, nose);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), white);
      eye.position.set(sx * 0.055, 0.03, 0.095);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.019, 10, 8), mask);
      pupil.position.set(sx * 0.057, 0.032, 0.118);
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mask);
      ear.scale.set(0.6, 1, 0.35);
      ear.position.set(sx * 0.1, 0.08, 0.01);
      ear.rotation.z = sx * 0.6;
      head.add(eye, pupil, ear);
    }
    const bow = new THREE.Group();
    for (const sx of [-1, 1]) {
      const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), pink);
      lobe.scale.set(1.4, 0.9, 0.5);
      lobe.position.x = sx * 0.035;
      bow.add(lobe);
    }
    bow.position.set(0.04, 0.12, 0.0);
    head.add(bow);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.016, 8, 20), sparkle);
    collar.position.set(0, 0.27, 0.12);
    collar.rotation.x = Math.PI / 2.4;
    const legs: THREE.Mesh[] = [];
    for (const [lx, lz] of [[-0.07, 0.11], [0.07, 0.11], [-0.07, -0.11], [0.07, -0.11]] as const) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.13, 8), fawn);
      leg.geometry.translate(0, -0.065, 0);
      leg.position.set(lx, 0.15, lz);
      body.add(leg);
      legs.push(leg);
    }
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.016, 8, 14, Math.PI * 1.6), fawn);
    tail.position.set(0, 0.3, -0.19);
    tail.rotation.y = Math.PI / 2;
    body.add(torso, head, collar, tail);
    root.traverse(o => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    scene.add(root);
    return { root, body, head, legs, tail };
  })();
  const pugState = { a: 0, speed: 2.6, caught: false, bagT: 0, gait: 0 };

  // props: juice cup in her hand, the pug in her backpack
  const cup = new THREE.Group();
  const cupBody = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.036, 0.15, 16), new THREE.MeshStandardMaterial({ color: 0x86c34a, roughness: 0.3, transparent: true, opacity: 0.92 }));
  const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.14, 6), new THREE.MeshStandardMaterial({ color: 0xff7aa8 }));
  straw.position.set(0.012, 0.11, 0);
  straw.rotation.z = -0.25;
  cup.add(cupBody, straw);
  cup.visible = false;
  const handR = hero.root.getObjectByName("hand_r");
  if (handR) {
    handR.add(cup);
    cup.position.set(-0.06, 0.02, 0.0);
  } else scene.add(cup);
  const spine3 = hero.root.getObjectByName("spine_03");

  // ---------------------------------------------------------------- collisions (three XZ)
  const boxes = meta.colliders.boxes.map(b => ({ x: b.x, z: -b.y, hx: b.w / 2, hz: b.d / 2, tag: b.tag }));
  const circles = meta.colliders.circles.map(c => ({ x: c.x, z: -c.y, r: c.r }));
  const rings = meta.colliders.rings.map(r => ({ x: r.x, z: -r.y, r0: r.r0, r1: r.r1, top: r.top }));
  const platforms = meta.colliders.platforms.map(p => ({ x: p.x, z: -p.y, r: p.r, top: p.top, water: p.water ?? null }));
  // the side ropes are walls too (the posts alone have gaps you could slip through)
  const [gx, gy] = meta.points.hotel.gate;
  const [, doorY] = meta.points.hotel.door;
  for (const sx of [-1.75, 1.75]) boxes.push({ x: sx, z: -((gy + doorY) / 2), hx: 0.08, hz: Math.abs(doorY - gy) / 2, tag: "side_rope" });
  let gateOpen = false;

  function support(x: number, z: number) {
    let top = 0;
    let water: number | null = null;
    for (const p of platforms) if (Math.hypot(x - p.x, z - p.z) <= p.r && p.top >= top) { top = p.top; water = p.water; }
    for (const r of rings) {
      const d = Math.hypot(x - r.x, z - r.z);
      if (d >= r.r0 && d <= r.r1 && r.top >= top) { top = r.top; water = null; }
    }
    return { top, water };
  }
  function resolve(p: THREE.Vector3, prevX: number, prevZ: number) {
    for (const b of boxes) {
      if (b.tag === "rope_gate" && gateOpen) continue;
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const ox = b.hx + HERO_R - Math.abs(dx);
      const oz = b.hz + HERO_R - Math.abs(dz);
      if (ox > 0 && oz > 0) {
        if (ox < oz) p.x += Math.sign(dx || 1) * ox;
        else p.z += Math.sign(dz || 1) * oz;
      }
    }
    for (const c of circles) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + HERO_R;
      if (d < min && d > 1e-5) {
        p.x = c.x + (dx / d) * min;
        p.z = c.z + (dz / d) * min;
      }
    }
    // a step too tall to walk up: stay where you were (jump instead)
    const here = support(p.x, p.z);
    if (here.top > p.y + STEP) {
      p.x = prevX;
      p.z = prevZ;
    }
    const b = meta.bounds;
    p.x = Math.max(b.minX, Math.min(b.maxX, p.x));
    p.z = Math.max(-b.maxY, Math.min(-b.minY, p.z));
  }
  function blockedForCamera(x: number, z: number, y: number) {
    for (const b of boxes) if (b.tag !== "side_rope" && b.tag !== "rope_gate" && Math.abs(x - b.x) < b.hx + 0.3 && Math.abs(z - b.z) < b.hz + 0.3 && y < 9) return true;
    return false;
  }

  // ---------------------------------------------------------------- input
  const keys = new Set<string>();
  let jumpQueued = false;
  let interactQueued = false;
  let sprintTouch = false;
  let paused = false;
  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (paused) return;
    keys.add(e.code);
    if (e.code === "Space") { jumpQueued = true; e.preventDefault(); }
    if (e.code === "KeyE" || e.code === "Enter") interactQueued = true;
    if (e.code.startsWith("Arrow")) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  const onBlur = () => keys.clear();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  disposers.push(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  });
  const stick = document.createElement("div");
  stick.className = "bh3d-stick";
  const knob = document.createElement("div");
  knob.className = "bh3d-stick-knob";
  stick.appendChild(knob);
  container.appendChild(stick);
  disposers.push(() => stick.remove());
  let stickId: number | null = null;
  const stickOrigin = { x: 0, y: 0 };
  const stickVal = { x: 0, y: 0 };
  let lookId: number | null = null;
  let lookLast = { x: 0, y: 0 };
  let lookYaw = 0;
  let lookPitch = 0;
  let lookAt = -Infinity;
  const el = renderer.domElement;
  el.style.touchAction = "none";
  const onDown = (e: PointerEvent) => {
    if (paused) return;
    const rect = el.getBoundingClientRect();
    if (e.pointerType !== "mouse" && e.clientX - rect.left < rect.width * 0.45 && stickId === null) {
      stickId = e.pointerId;
      stickOrigin.x = e.clientX;
      stickOrigin.y = e.clientY;
      stick.style.left = `${e.clientX - rect.left}px`;
      stick.style.top = `${e.clientY - rect.top}px`;
      stick.classList.add("is-on");
    } else if (lookId === null) {
      lookId = e.pointerId;
      lookLast = { x: e.clientX, y: e.clientY };
    }
    el.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId === stickId) {
      const dx = e.clientX - stickOrigin.x;
      const dy = e.clientY - stickOrigin.y;
      const d = Math.hypot(dx, dy);
      const max = 56;
      const k = d > max ? max / d : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const mag = Math.min(1, d / max);
      stickVal.x = d > 0 ? (dx / d) * mag : 0;
      stickVal.y = d > 0 ? (-dy / d) * mag : 0;
    } else if (e.pointerId === lookId) {
      lookYaw -= (e.clientX - lookLast.x) * 0.006;
      lookPitch = THREE.MathUtils.clamp(lookPitch + (e.clientY - lookLast.y) * 0.003, -0.35, 0.5);
      lookLast = { x: e.clientX, y: e.clientY };
      lookAt = performance.now();
    }
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId === stickId) {
      stickId = null;
      stickVal.x = stickVal.y = 0;
      knob.style.transform = "";
      stick.classList.remove("is-on");
    }
    if (e.pointerId === lookId) lookId = null;
  };
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  disposers.push(() => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
  });

  // ---------------------------------------------------------------- post-processing
  const size = new THREE.Vector2();
  const composerTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: softwareGl ? 0 : 4 });
  const composer = new EffectComposer(renderer, composerTarget);
  composer.addPass(new RenderPass(scene, camera));
  let gtao: GTAOPass | null = null;
  if (highQuality) {
    gtao = new GTAOPass(scene, camera, 1, 1);
    gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
    gtao.blendIntensity = 0.85;
    composer.addPass(gtao);
  }
  const bloom = softwareGl ? null : new UnrealBloomPass(new THREE.Vector2(1, 1), 0.28, 0.45, 1.7);
  if (bloom) composer.addPass(bloom);
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uFlash: { value: 0 }, uVig: { value: 0.32 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uFlash; uniform float uVig; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        // warm golden-hour grade: lift the shadows toward violet, push the highs toward peach
        float l = dot(c.rgb, vec3(0.299,0.587,0.114));
        c.rgb = mix(vec3(l), c.rgb, 1.1);
        c.rgb = mix(c.rgb, c.rgb * vec3(1.06, 0.98, 0.9), smoothstep(0.35, 1.2, l));
        c.rgb = mix(c.rgb, c.rgb + vec3(0.025, 0.0, 0.04), 1.0 - smoothstep(0.0, 0.35, l));
        vec2 d = vUv - 0.5;
        c.rgb *= 1.0 - uVig * dot(d, d) * 1.6;
        c.rgb += vec3(uFlash);
        gl_FragColor = c;
      }`,
  });
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  disposers.push(() => {
    composer.dispose();
    composerTarget.dispose();
  });

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    renderer.getDrawingBufferSize(size);
    gtao?.setSize(size.x, size.y);
    camera.aspect = w / h;
    camera.fov = w < h ? 62 : 50;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  disposers.push(() => ro.disconnect());

  // ---------------------------------------------------------------- effects: confetti and flashes
  const confettiGeo = new THREE.PlaneGeometry(0.06, 0.1);
  const confettiMats = [0xf2c14e, 0xff7aa8, 0xffffff, 0x7fd1c7].map(c => new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.3, emissive: c, emissiveIntensity: 0.2 }));
  const confetti: { m: THREE.Mesh; v: THREE.Vector3; spin: THREE.Vector3; life: number }[] = [];
  function burstConfetti(at: THREE.Vector3, n = 160) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(confettiGeo, confettiMats[i % confettiMats.length]);
      m.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 3, 3.5 + Math.random() * 2, (Math.random() - 0.5) * 3));
      scene.add(m);
      confetti.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2), spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), life: 6 + Math.random() * 2 });
    }
  }
  const flashes: { l: THREE.PointLight; t: number }[] = [];
  let flashU = 0;
  function paparazzi(at: THREE.Vector3) {
    for (let i = 0; i < 9; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      const a = (i / 9) * Math.PI - Math.PI;
      l.position.copy(at).add(new THREE.Vector3(Math.cos(a) * 3.5, 1.7, Math.sin(a) * 1.5 + 3));
      scene.add(l);
      flashes.push({ l, t: -i * 0.18 - Math.random() * 0.2 });
    }
  }

  // ---------------------------------------------------------------- state
  const [sx, sy] = meta.points.spawn;
  const pos = b2t(sx, sy);
  let heading = Math.PI; // facing the hotel (north)
  let speed = 0;
  let vy = 0;
  let grounded = true;
  let gesture: { name: string; until: number } | null = null;
  hero.root.position.copy(pos);
  let rope: RopeState | null = null;
  let admittedAt = 0;
  let celebrateUntil = 0;
  let prompt: { id: PromptId; label: string } | null = null;
  let lastTooSlow = 0;
  let autopilot: { target: THREE.Vector3; until: number; sprint: boolean; follow?: () => THREE.Vector3 } | null = null;
  const intro = { t: 0, dur: reduceMotion ? 0 : 3.2 };
  let camYaw = heading + Math.PI;
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const look = new THREE.Vector3();
  let armLen = 6.2;

  function cameraGoal(out: THREE.Vector3, at: THREE.Vector3, dt: number) {
    const dist = coarse ? 7.0 : 6.2;
    const height = 2.4 + lookPitch * 4;
    const dx = Math.sin(camYaw);
    const dz = Math.cos(camYaw);
    let free = dist;
    for (let d = 1.0; d <= dist; d += 0.25) {
      if (blockedForCamera(pos.x + dx * d, pos.z + dz * d, pos.y + height)) {
        free = Math.max(2.2, d - 0.6);
        break;
      }
    }
    armLen = dt > 0 ? (free < armLen ? damp(armLen, free, 14, dt) : damp(armLen, free, 2.5, dt)) : free;
    out.set(pos.x + dx * armLen, pos.y + height * (0.6 + 0.4 * (armLen / dist)), pos.z + dz * armLen);
    at.set(pos.x, pos.y + 1.45, pos.z);
  }

  function setPrompt(next: { id: PromptId; label: string } | null) {
    if (next?.id === prompt?.id && next?.label === prompt?.label) return;
    prompt = next;
    callbacks.onPrompt?.(next);
  }

  function interact() {
    if (!prompt || paused) return;
    if (prompt.id === "doorman") callbacks.onInteract?.({ kind: "talk_doorman" });
    if (prompt.id === "barista") callbacks.onInteract?.({ kind: "talk_barista" });
    if (prompt.id === "door") callbacks.onInteract?.({ kind: "enter_door" });
    if (prompt.id === "shades") {
      hero.play("PickUp_Table", 0.12, true);
      gesture = { name: "PickUp_Table", until: performance.now() + 1100 };
      callbacks.onInteract?.({ kind: "grab_shades" });
    }
  }

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  let elapsed = 0;
  const doorman = b2t(dmx, dmy);
  const counter = b2t(...meta.points.juice.counter);
  const shadesAt = b2t(meta.points.shades[0], meta.points.shades[1], meta.points.shades[2]);
  const door = b2t(...meta.points.hotel.door);
  const pugLoop = meta.points.pugLoop;
  const pugCenter = b2t(pugLoop.x, pugLoop.y);
  let skipFrame = false;
  let pausedAt = 0;

  function frame() {
    if (paused && performance.now() - pausedAt > 1600) {
      skipFrame = !skipFrame;
      if (skipFrame) return;
    }
    const dt = Math.min(0.05, clock.getDelta());
    elapsed += dt;
    timeU.value = elapsed;
    const now = performance.now();

    // ---- movement
    let mx = stickVal.x;
    let my = stickVal.y;
    if (keys.has("KeyW") || keys.has("ArrowUp")) my += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) my -= 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
    if (autopilot && now < autopilot.until) {
      if (autopilot.follow) autopilot.target.copy(autopilot.follow());
      const tx = autopilot.target.x - pos.x;
      const tz = autopilot.target.z - pos.z;
      if (Math.hypot(tx, tz) > 0.25) {
        // steer as if the stick pointed at the target, relative to the camera
        const want = Math.atan2(tx, tz);
        const rel = (camYaw + Math.PI) - want;
        mx = Math.sin(rel);
        my = Math.cos(rel);
      }
    } else autopilot = null;
    let mag = Math.min(1, Math.hypot(mx, my));
    if (paused || intro.t < intro.dur || now < celebrateUntil) mag = 0;
    const sprinting = keys.has("ShiftLeft") || keys.has("ShiftRight") || sprintTouch || Math.hypot(stickVal.x, stickVal.y) > 0.96 || Boolean(autopilot?.sprint);
    const here = support(pos.x, pos.z);
    const wading = here.water !== null && pos.y <= (here.water ?? 0) + 0.05;
    let target = mag > 0.05 ? (sprinting ? SPRINT : mag < 0.55 && stickId !== null ? WALK : JOG) * mag : 0;
    if (wading) target *= 0.55;
    speed = damp(speed, target, target > speed ? 7 : 11, dt);
    if (mag > 0.05) {
      const camForward = camYaw + Math.PI;
      heading = dampAngle(heading, camForward - Math.atan2(mx, my), 11, dt);
      gesture = null;
    }
    const prevX = pos.x;
    const prevZ = pos.z;
    pos.x += Math.sin(heading) * speed * dt;
    pos.z += Math.cos(heading) * speed * dt;

    // ---- jump, gravity, platforms
    if (jumpQueued && grounded && !paused && intro.t >= intro.dur) {
      vy = JUMP_V;
      grounded = false;
      hero.play("Jump_Start", 0.08, true);
      audio.play("jump");
    }
    jumpQueued = false;
    resolve(pos, prevX, prevZ);
    const ground = support(pos.x, pos.z).top;
    if (!grounded || pos.y > ground + 0.02) {
      grounded = false;
      vy -= GRAVITY * dt;
      pos.y += vy * dt;
      if (vy < 0 && hero.current === "Jump_Start" && pos.y - ground > 0.6) hero.play("Jump_Loop", 0.12);
      if (pos.y <= ground) {
        const fell = vy;
        pos.y = ground;
        vy = 0;
        grounded = true;
        if (fell < -4) {
          hero.play("Jump_Land", 0.06, true);
          gesture = { name: "Jump_Land", until: now + 240 };
          audio.play("land");
        }
      }
    } else {
      pos.y = ground;
    }
    hero.root.position.copy(pos);
    hero.root.rotation.y = heading;

    // ---- hero animation
    if (now < celebrateUntil) hero.play("Dance_Loop", 0.25);
    else if (grounded && (!gesture || now > gesture.until || speed > 0.8)) {
      if (gesture && now > gesture.until) gesture = null;
      if (!gesture) {
        if (speed > 5.0) hero.play("Sprint_Loop", 0.15);
        else if (speed > 2.6) hero.play("Jog_Fwd_Loop", 0.2);
        else if (speed > 0.3) hero.play("Walk_Loop", 0.2);
        else hero.play("Idle_Loop", 0.3);
      }
    }
    const scaleFor: Record<string, number> = { Walk_Loop: speed / 1.7, Jog_Fwd_Loop: speed / 3.6, Sprint_Loop: speed / 6.2 };
    const act = hero.actions.get(hero.current);
    if (act && scaleFor[hero.current]) act.timeScale = THREE.MathUtils.clamp(scaleFor[hero.current], 0.7, 1.5);
    hero.mixer.update(dt);

    // ---- influencers: walking into their shot, and leaving in disgust
    for (const inf of influencers) {
      inf.p.mixer.update(dt);
      const sm = inf.shot.material as THREE.MeshBasicMaterial;
      if (inf.gone) {
        if (inf.leaving > 0) {
          inf.leaving -= dt;
          const away = new THREE.Vector3(Math.sin(inf.p.root.rotation.y), 0, Math.cos(inf.p.root.rotation.y));
          inf.p.root.position.addScaledVector(away, 1.6 * dt);
          sm.opacity = damp(sm.opacity, 0, 4, dt);
          (inf.rig.children[3] as THREE.Mesh | undefined)?.scale.setScalar(1);
          if (inf.leaving <= 0) {
            inf.p.root.visible = false;
            inf.rig.visible = false;
            inf.shot.visible = false;
          }
        }
        continue;
      }
      sm.opacity = 0.16 + Math.sin(elapsed * 2.4 + inf.base.x) * 0.06;
      // inside the wedge behind them?
      const back = new THREE.Vector3(-Math.sin(inf.face), 0, -Math.cos(inf.face));
      const rel = new THREE.Vector3(pos.x - inf.base.x, 0, pos.z - inf.base.z);
      const along = rel.dot(back);
      const side = Math.abs(rel.x * back.z - rel.z * back.x);
      const inShot = along > 0.2 && along < 2.9 && side < 0.35 + along * 0.36 && pos.y < 1.5;
      inf.dwell = inShot && !paused ? inf.dwell + dt : Math.max(0, inf.dwell - dt * 2);
      if (inf.dwell > 0.45) {
        inf.gone = true;
        inf.leaving = 6;
        inf.p.play("Idle_No_Loop", 0.15);
        setTimeout(() => {
          inf.p.root.rotation.y = inf.face + Math.PI * 0.85;
          inf.p.play("Walk_Loop", 0.25);
        }, 1600);
        callbacks.onInteract?.({ kind: "photobomb", who: inf.id });
        audio.play("ui_tap");
      }
    }

    // ---- Biscotti
    if (!pugState.caught) {
      const d = Math.hypot(pos.x - pug.root.position.x, pos.z - pug.root.position.z);
      const want = d < 3.6 ? 4.8 : 2.4;
      pugState.speed = damp(pugState.speed, want, 3, dt);
      pugState.a += (pugState.speed / pugLoop.r) * dt;
      const px = pugCenter.x + Math.cos(pugState.a) * pugLoop.r;
      const pz = pugCenter.z + Math.sin(pugState.a) * pugLoop.r;
      pug.root.position.set(px, 0, pz);
      pug.root.rotation.y = Math.atan2(-Math.sin(pugState.a), Math.cos(pugState.a));
      pugState.gait += dt * (6 + pugState.speed * 2.6);
      const hop = Math.abs(Math.sin(pugState.gait)) * 0.07;
      pug.body.position.y = hop;
      pug.body.rotation.x = Math.sin(pugState.gait * 2) * 0.12;
      pug.legs.forEach((l, k) => (l.rotation.x = Math.sin(pugState.gait + (k < 2 ? 0 : Math.PI)) * 0.9));
      pug.tail.rotation.z = Math.sin(pugState.gait * 3) * 0.4;
      pug.head.rotation.z = Math.sin(pugState.gait * 0.5) * 0.12;
      if (d < 1.6 && grounded && intro.t >= intro.dur) {
        if (speed > PUG_SPRINT_CATCH) {
          pugState.caught = true;
          pug.legs.forEach(l => (l.rotation.x = 0));
          pug.body.position.y = 0;
          pug.body.rotation.x = 0;
          callbacks.onInteract?.({ kind: "catch_pug" });
          audio.play("scout_discovery");
        } else if (now - lastTooSlow > 5000) {
          lastTooSlow = now;
          callbacks.onInteract?.({ kind: "pug_too_slow" });
        }
      }
    } else if (spine3) {
      // she rides in the backpack, head out, looking very pleased with herself
      pugState.bagT = Math.min(1, pugState.bagT + dt * 2.2);
      const bag = new THREE.Vector3();
      spine3.getWorldPosition(bag);
      const backDir = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading));
      const target = bag.clone().addScaledVector(backDir, 0.24).add(new THREE.Vector3(0, 0.18, 0));
      pug.root.position.lerp(target, pugState.bagT < 1 ? 0.25 : 1);
      pug.root.position.y += pugState.bagT < 1 ? Math.sin(pugState.bagT * Math.PI) * 0.6 : 0;
      pug.root.rotation.y = heading + Math.PI;
      // smug head bob from the backpack
      pug.head.rotation.z = Math.sin(elapsed * 2.2) * 0.15;
      pug.tail.rotation.z = Math.sin(elapsed * 9) * 0.5;
    }

    // ---- doorman and barista
    sterling.mixer.update(dt);
    barista.mixer.update(dt);
    const toDoorman = Math.hypot(pos.x - doorman.x, pos.z - doorman.z);
    if (!gateOpen && toDoorman < 3.2 && sterling.current === "Idle_FoldArms_Loop" && rope && rope.phase !== "ready") {
      // he shakes his head the moment you approach
      sterling.play("Idle_No_Loop", 0.25);
      setTimeout(() => !gateOpen && sterling.play("Idle_FoldArms_Loop", 0.4), 2600);
    }

    // ---- what can be done here
    let next: { id: PromptId; label: string } | null = null;
    if (intro.t >= intro.dur && !paused) {
      if (!gateOpen && toDoorman < 3.6) next = { id: "doorman", label: "Talk to Sterling" };
      else if (Math.hypot(pos.x - counter.x, pos.z - counter.z) < 2.4 && rope && !rope.have.juice) next = { id: "barista", label: "Order at the juice bar" };
      else if (rope && !rope.have.shades && Math.hypot(pos.x - shadesAt.x, pos.z - shadesAt.z) < 1.5 && pos.y > 1.9) next = { id: "shades", label: "Take the poodle's sunglasses" };
      else if (gateOpen && Math.hypot(pos.x - door.x, pos.z - door.z) < 2.6) next = { id: "door", label: "Go inside" };
    }
    setPrompt(next);
    if (interactQueued) interact();
    interactQueued = false;

    // ---- the rope, the flashes, the confetti
    if (ropeGate) {
      const target = gateOpen ? 1 : 0;
      ropeGate.userData.t = damp(ropeGate.userData.t ?? 0, target, 3, dt);
      const t = ropeGate.userData.t;
      ropeGate.position.y = -t * 0.7;
      ropeGate.rotation.x = -t * 0.4;
    }
    flashU = damp(flashU, 0, 9, dt);
    for (const f of flashes) {
      f.t += dt;
      const phase = f.t % 0.9;
      const on = f.t > 0 && f.t < 4.5 && phase < 0.06;
      f.l.intensity = on ? 140 : 0;
      if (on && phase < dt) {
        flashU = Math.max(flashU, 0.06);
        audio.play("ui_tap", { volume: 0.25 } as never);
      }
    }
    grade.uniforms.uFlash.value = flashU;
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.life -= dt;
      c.v.y -= 2.2 * dt;
      c.v.multiplyScalar(1 - 0.9 * dt);
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.spin.x * dt;
      c.m.rotation.y += c.spin.y * dt;
      if (c.m.position.y < 0.02) c.m.position.y = 0.02;
      if (c.life <= 0) {
        scene.remove(c.m);
        confetti.splice(i, 1);
      }
    }
    glow.forEach((g, i) => (g.emissiveIntensity = glowBase[i] * (1 + Math.sin(elapsed * 1.7 + i) * 0.04)));
    for (let i = 0; i < SPRAY; i++) {
      sprayLife[i] += dt;
      sprayVel[i * 3 + 1] -= 9.8 * dt;
      sprayPos[i * 3] += sprayVel[i * 3] * dt;
      sprayPos[i * 3 + 1] += sprayVel[i * 3 + 1] * dt;
      sprayPos[i * 3 + 2] += sprayVel[i * 3 + 2] * dt;
      if (sprayPos[i * 3 + 1] < 0.45 || sprayLife[i] > 1.4) spawnSpray(i);
    }
    sprayGeo.attributes.position.needsUpdate = true;
    for (const b of birds) {
      const d = Math.hypot(pos.x - b.g.position.x, pos.z - b.g.position.z);
      if (b.fly <= 0 && d < (speed > 3 ? 3.2 : 1.4)) {
        b.fly = 4 + Math.random() * 3;
        b.vel.set((b.g.position.x - pos.x) / (d || 1) * 3.5, 4.5 + Math.random() * 2, (b.g.position.z - pos.z) / (d || 1) * 3.5);
        audio.play("ui_tap", { volume: 0.15 } as never);
      }
      if (b.fly > 0) {
        b.fly -= dt;
        b.g.position.addScaledVector(b.vel, dt);
        b.vel.y -= 0.6 * dt;
        b.g.rotation.y = Math.atan2(b.vel.x, b.vel.z);
        const flap = Math.sin(elapsed * 28 + b.phase) * 0.9;
        b.wl.rotation.z = flap;
        b.wr.rotation.z = -flap;
        if (b.fly <= 0) b.g.position.copy(b.home);
      } else {
        b.wl.rotation.z = 0.15;
        b.wr.rotation.z = -0.15;
        const peck = Math.max(0, Math.sin(elapsed * 3 + b.phase));
        b.head.position.y = 0.08 - peck * 0.07;
        b.g.rotation.y += Math.sin(elapsed * 0.7 + b.phase) * 0.01;
      }
    }

    // ---- camera
    if (lookYaw !== 0) {
      camYaw += lookYaw;
      lookYaw = 0;
    }
    if (mag > 0.05 && now - lookAt > 1400) camYaw = dampAngle(camYaw, heading + Math.PI, 2.0, dt);
    cameraGoal(tmp, look, dt);
    if (intro.t < intro.dur) {
      intro.t += dt;
      const u = THREE.MathUtils.smootherstep(Math.min(1, intro.t / intro.dur), 0, 1);
      // open on the hotel and the golden poodle, then swoop down behind her
      const start = new THREE.Vector3(10, 16, -2);
      camPos.copy(start).lerp(tmp, u);
      camLook.set(0, 4, -10).lerp(look, u);
    } else if (admittedAt && now - admittedAt < 3200) {
      // the reveal: hold on the carpet and the flashes
      const reveal = new THREE.Vector3(pos.x + 3.2, 2.2, pos.z + 3.4);
      camPos.lerp(reveal, 1 - Math.exp(-2.5 * dt));
      camLook.lerp(new THREE.Vector3(pos.x, 1.4, pos.z), 1 - Math.exp(-4 * dt));
    } else {
      camPos.x = damp(camPos.x, tmp.x, 6, dt);
      camPos.y = damp(camPos.y, tmp.y, 4, dt);
      camPos.z = damp(camPos.z, tmp.z, 6, dt);
      camLook.lerp(look, 1 - Math.exp(-10 * dt));
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    sun.target.position.set(pos.x, 0, pos.z);
    sun.position.set(pos.x - 34, 17, pos.z + 22);

    composer.render(dt);
  }
  renderer.setAnimationLoop(frame);
  callbacks.onReady?.();

  // test hook (e2e): read the world and move the heroine like a person would
  const testHook = {
    ready: true,
    state: () => ({ x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2), anim: hero.current, prompt: prompt?.id ?? null, gateOpen, pugCaught: pugState.caught, gone: influencers.filter(i => i.gone).map(i => i.id) }),
    teleport: (bx: number, by: number, z = 0) => {
      pos.copy(b2t(bx, by, z));
      grounded = false;
      intro.t = intro.dur;
    },
    /** steer toward a Blender-plane point for ms milliseconds, walking or sprinting (e2e) */
    driveTo: (bx: number, by: number, ms = 1500, sprint = false) => {
      autopilot = { target: b2t(bx, by), until: performance.now() + ms, sprint };
      intro.t = intro.dur;
    },
    chasePug: (ms = 2500) => {
      autopilot = { target: pug.root.position.clone(), until: performance.now() + ms, sprint: true, follow: () => pug.root.position };
      intro.t = intro.dur;
    },
    pugDebug: () => {
      const box = new THREE.Box3().setFromObject(pug.root);
      const sz = box.getSize(new THREE.Vector3());
      const meshes: string[] = [];
      pug.root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o.name); });
      return { size: [sz.x, sz.y, sz.z].map(v => +v.toFixed(3)), pos: pug.root.position.toArray().map(v => +v.toFixed(2)), scale: pug.root.scale.toArray(), meshes, children: pug.root.children.map(c => [c.name, c.scale.toArray().map(v => +v.toFixed(3))]) };
    },
    pug: () => ({ x: +pug.root.position.x.toFixed(2), y: +(-pug.root.position.z).toFixed(2), caught: pugState.caught }),
    points: meta.points,
  };
  (window as unknown as { __beverlyHills?: typeof testHook }).__beverlyHills = testHook;
  disposers.push(() => {
    const w = window as unknown as { __beverlyHills?: unknown };
    if (w.__beverlyHills === testHook) delete w.__beverlyHills;
  });

  return {
    setRope(state) {
      const firstAdmit = state.phase === "admitted" && !gateOpen;
      rope = state;
      for (const inf of influencers) if (state.photobombed.includes(inf.id) && !inf.gone) {
        inf.gone = true;
        inf.p.root.visible = false;
        inf.rig.visible = false;
        inf.shot.visible = false;
      }
      cup.visible = state.have.juice;
      if (statueShades) statueShades.visible = !state.have.shades;
      if (heroSunglasses) heroSunglasses.visible = state.have.shades;
      if (state.have.pug && !pugState.caught) {
        pugState.caught = true;
        pugState.bagT = 1;
      }
      if (firstAdmit) {
        gateOpen = true;
        admittedAt = performance.now();
        sterling.play("Yes", 0.2, true);
        setTimeout(() => sterling.play("Idle_Talking_Loop", 0.4), 1400);
        if (!state.skipped) {
          paparazzi(pos.clone());
          burstConfetti(pos.clone());
          celebrateUntil = performance.now() + 2600;
        }
      }
    },
    setHotelName(name) {
      paintHotelSign(name);
    },
    setPaused(p) {
      paused = p;
      pausedAt = performance.now();
      if (p) {
        keys.clear();
        stickVal.x = stickVal.y = 0;
      }
    },
    interact,
    jump() {
      jumpQueued = true;
    },
    setSprint(on) {
      sprintTouch = on;
    },
    celebrate() {
      celebrateUntil = performance.now() + 2200;
    },
    dispose() {
      disposed = true;
      disposers.forEach(d => d());
    },
  };
}
