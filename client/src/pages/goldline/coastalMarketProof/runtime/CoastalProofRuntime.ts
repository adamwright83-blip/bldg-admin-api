import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { Autopilot } from "./autopilot";
import { Locomotion, deriveBriskWalk, measureGroundSpeed } from "./character";
import { PlayerController, WALK_SPEED } from "./controller";
import { createEnv } from "./env";
import { createLevelMaterial, patchDynamicSunVis, type MaterialContext } from "./materials";
import { createWater } from "./water";
import { FollowCamera } from "./followCamera";
import { ProofInput } from "./input";
import { Route, splitLevel, type LevelData } from "./level";
import type { ProofParams } from "./params";
import { PerfMeter } from "./perf";

/**
 * The Coastal Market proof: one imperative three.js loop, owned by one React
 * page, with explicit dispose. It has no business authority: it reads only
 * its own static assets and writes nothing anywhere.
 */
export type RuntimeCallbacks = {
  onLoadProgress?: (fraction: number) => void;
  onReachWaterfront?: () => void;
};

export type RuntimeHandle = {
  begin(): void;
  togglePerf(): void;
  dispose(): void;
};

export const PROOF_BUILD = "coastal-proof stage2";

type TestApi = {
  ready: boolean;
  state(): Record<string, unknown>;
  perf(): ReturnType<PerfMeter["snapshot"]>;
  teleport(s: number): void;
};

export async function createCoastalProof(
  container: HTMLElement,
  assetBase: string,
  params: ProofParams,
  callbacks: RuntimeCallbacks = {}
): Promise<RuntimeHandle> {
  const disposers: Array<() => void> = [];
  let disposed = false;

  // ---------- renderer
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", stencil: false });
  const dprCap = params.dpr ?? (coarse ? 1.6 : 2);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = true;
  renderer.domElement.className = "cmp-canvas";
  container.appendChild(renderer.domElement);
  disposers.push(() => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.domElement.remove();
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 5000);

  // ---------- assets
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const progress = new Map<string, number>();
  const report = () => {
    let sum = 0;
    for (const v of progress.values()) sum += v;
    callbacks.onLoadProgress?.(sum / 5);
  };
  // Fetch with progress. The claude.ai artifact host does not serve .glb, so
  // stageArtifact.mjs ships each one as `<name>.glb.json` ({ data: base64 });
  // decode that in memory rather than fetching a data: URI.
  const fetchBytes = async (url: string, key: string): Promise<ArrayBuffer | null> => {
    const res = await fetch(url);
    if (!res.ok) return null;
    const total = Number(res.headers.get("content-length")) || 0;
    if (!res.body || !total) {
      const buf = await res.arrayBuffer();
      progress.set(key, 1);
      report();
      return buf;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      progress.set(key, Math.min(1, got / total));
      report();
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out.buffer;
  };
  const loadGltf = async (file: string): Promise<GLTF> => {
    progress.set(file, 0);
    let bytes = await fetchBytes(assetBase + file, file).catch(() => null);
    // a host may answer a missing file with an HTML page; only a real GLB starts with "glTF"
    const isGlb = (b: ArrayBuffer | null) => !!b && b.byteLength > 12 && new Uint32Array(b, 0, 1)[0] === 0x46546c67;
    if (!isGlb(bytes)) {
      const wrapped = await fetchBytes(assetBase + file + ".json", file);
      if (!wrapped) throw new Error(`${file} not found`);
      const { data } = JSON.parse(new TextDecoder().decode(wrapped)) as { data: string };
      const bin = atob(data);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      bytes = u8.buffer;
    }
    progress.set(file, 1);
    report();
    if (!bytes) throw new Error(`${file} not found`);
    return loader.parseAsync(bytes, assetBase);
  };
  const fetchJson = async <T,>(file: string): Promise<T> => {
    const r = await fetch(assetBase + file);
    if (!r.ok) throw new Error(`${file} ${r.status}`);
    progress.set(file, 1);
    return (await r.json()) as T;
  };
  const texLoader = new THREE.TextureLoader();
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loadTex = (file: string, opts: { srgb?: boolean; repeat?: boolean; flipY?: boolean; aniso?: number } = {}) =>
    new Promise<THREE.Texture>((resolve, reject) => {
      texLoader.load(
        assetBase + file,
        t => {
          t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
          if (opts.flipY === false) t.flipY = false;
          t.anisotropy = opts.aniso ?? 1;
          t.needsUpdate = true;
          resolve(t);
        },
        undefined,
        () => reject(new Error(`${file} failed to load`))
      );
    });
  const TEXTURE_SETS = ["rock", "cobble", "stone", "plaster", "wood", "wood_dark", "roof", "sand"];
  const [levelGltf, data, heroGltf, animsA, skyMeta] = await Promise.all([
    loadGltf("level.glb"),
    fetchJson<LevelData>("level.json"),
    loadGltf("base_female.glb"),
    loadGltf("anims_a.glb"),
    fetchJson<{ horizonSun: [number, number, number]; horizonAway: [number, number, number]; zenith: [number, number, number]; skyVFraction: number }>("tex/sky.json"),
  ]);
  const [skyTex, waterNormal, shoreTex, ...setTextures] = await Promise.all([
    loadTex("tex/sky.webp", { srgb: true }),
    loadTex("tex/water_normal.webp", { repeat: true }),
    loadTex(data.shore.texture),
    ...TEXTURE_SETS.flatMap(name => [
      loadTex(`tex/${name}_albedo.webp`, { srgb: true, repeat: true, aniso: maxAniso }),
      loadTex(`tex/${name}_normal.webp`, { repeat: true, aniso: maxAniso }),
    ]),
  ]);
  const lightmapEntries = await Promise.all(
    Object.entries(data.lightmaps ?? {}).map(async ([name, file]) => {
      const t = await loadTex(file, { flipY: false });
      t.channel = 1;
      return [name, t] as const;
    })
  );
  if (disposed) throw new Error("disposed during load");
  const textures: THREE.Texture[] = [skyTex, waterNormal, shoreTex, ...setTextures, ...lightmapEntries.map(([, t]) => t)];
  disposers.push(() => textures.forEach(t => t.dispose()));

  // ---------- world
  const env = createEnv(scene, data.sunDirection, {
    texture: skyTex,
    vBottom: 1 - skyMeta.skyVFraction,
    horizonSun: skyMeta.horizonSun,
    horizonAway: skyMeta.horizonAway,
    zenith: skyMeta.zenith,
  });
  disposers.push(() => env.dispose());
  const windUniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector3(0.16, 0.02, -0.07) } };
  const matCtx: MaterialContext = {
    textures: new Map(TEXTURE_SETS.map((name, i) => [name, { albedo: setTextures[i * 2], normal: setTextures[i * 2 + 1] }])),
    lightmaps: new Map(lightmapEntries),
    lightmapOf: new Map(Object.entries(data.lightmapGroups ?? {}).flatMap(([lm, mats]) => mats.map(m => [m, lm] as [string, string]))),
    windUniforms,
  };
  const level = splitLevel(levelGltf);
  const materials: THREE.Material[] = [];
  for (const [name, meshes] of level.meshesByMaterial) {
    for (const mesh of meshes) {
      (mesh.material as THREE.Material).dispose();
      const mat = createLevelMaterial(name, matCtx, !!mesh.userData.far, mesh.geometry);
      mesh.material = mat;
      materials.push(mat);
      mesh.receiveShadow = !mesh.userData.far;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
    }
  }
  scene.add(level.visual, level.far);
  disposers.push(() => {
    materials.forEach(m => m.dispose());
    scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    level.colliders.walkMesh.geometry.dispose();
    level.colliders.camMesh.geometry.dispose();
  });

  const water = createWater({
    normalMap: waterNormal,
    sky: skyTex,
    skyVBottom: 1 - skyMeta.skyVFraction,
    shore: shoreTex,
    shoreRect: [data.shore.x0, data.shore.y0, data.shore.size],
    sunDir: env.sunDir,
    sunColor: new THREE.Color(1.0, 0.7, 0.42),
  });
  scene.add(water.mesh);
  disposers.push(() => water.dispose());

  // sky-lit environment for the characters (the level is lit by hemisphere + baked light)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(env.sky.clone());
  const envRT = pmrem.fromScene(envScene, 0, 0.1, 100);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  disposers.push(() => envRT.dispose());

  // ---------- Trailblazer (Stage 1: the plain base on the real rig)
  const route = new Route(data);
  const hero = SkeletonUtils.clone(heroGltf.scene);
  const heroSunVis = { value: 1 };
  hero.traverse(o => {
    const m = o as THREE.SkinnedMesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      patchDynamicSunVis(m.material as THREE.Material, heroSunVis);
    }
  });
  // one ray per frame toward the sun decides whether she stands in a building's shadow
  const sunRay = new THREE.Ray();
  const updateHeroSun = (dt: number) => {
    sunRay.origin.copy(controller.position).add(new THREE.Vector3(0, 1.25, 0));
    sunRay.direction.copy(env.sunDir);
    const hit = level.colliders.cam.raycastFirst(sunRay, THREE.DoubleSide, 0.3, 300);
    heroSunVis.value += ((hit ? 0.0 : 1.0) - heroSunVis.value) * Math.min(1, dt * 6);
  };
  const body = new THREE.Group();
  body.add(hero);
  const heroRoot = new THREE.Group();
  heroRoot.add(body);
  scene.add(heroRoot);

  const clipByName = new Map(animsA.animations.map(c => [c.name, c]));
  const idleClip = clipByName.get("Idle_Loop");
  const walkClip = clipByName.get("Walk_Loop");
  if (!idleClip || !walkClip) throw new Error("missing locomotion clips");
  const stride = params.stride ?? 1.3;
  const brisk = deriveBriskWalk(hero, walkClip, stride);
  const groundSpeed = measureGroundSpeed(hero, brisk);
  const loco = new Locomotion(body, hero, { idle: idleClip, walk: brisk }, groundSpeed);

  // QA metric: horizontal speed of whichever foot is planted (lowest), while walking
  const feet = ["ball_l", "ball_r"].map(n => hero.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
  const footPrev = feet.map(() => new THREE.Vector3());
  const footNow = feet.map(() => new THREE.Vector3());
  const slipSamples: number[] = [];
  const measureSlip = (dt: number) => {
    feet.forEach((f, i) => f.getWorldPosition(footNow[i]));
    if (controller.speed > 1.0 && dt > 0) {
      const low = footNow[0].y < footNow[1].y ? 0 : 1;
      const d = Math.hypot(footNow[low].x - footPrev[low].x, footNow[low].z - footPrev[low].z) / dt;
      slipSamples.push(d);
      if (slipSamples.length > 240) slipSamples.shift();
    }
    feet.forEach((_, i) => footPrev[i].copy(footNow[i]));
  };

  // ---------- control
  const controller = new PlayerController(level.colliders, route, data.surfaceByKind);
  const follow = new FollowCamera(camera, level.colliders.cam);
  follow.orbit = params.orbit;
  const input = new ProofInput(container);
  disposers.push(() => input.dispose());
  input.enabled = false;
  const autopilot = params.autowalk ? new Autopilot(route) : null;
  const perf = new PerfMeter(container, renderer, PROOF_BUILD, params.perf);
  disposers.push(() => perf.dispose());

  const startS = params.shot ? data.shots[params.shot] ?? 5 : params.start ?? data.shots.overlook ?? 5;
  controller.placeAt(startS);
  const camState = () => ({
    position: controller.position,
    heading: controller.heading,
    speed: controller.speed,
    verticalRate: controller.verticalRate,
  });

  // ---------- viewport
  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    follow.setViewport(w, h);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  disposers.push(() => ro.disconnect());
  follow.snap(camState());

  // ---------- loop
  const clock = new THREE.Timer();
  let reachedEnd = false;
  let began = false;
  const frame = (t: number) => {
    clock.update(t);
    const dt = Math.min(clock.getDelta(), 1 / 20);
    const now = performance.now();
    if (autopilot && began) {
      input.override = autopilot.steer(now, controller.position, controller.progress, follow.yaw);
    }
    input.update(dt, now);
    if (!params.shot) controller.update(input.move, follow.yaw, dt);
    loco.update(dt, controller.speed, controller.angularVelocity);
    heroRoot.position.copy(controller.position);
    body.rotation.y = controller.heading;
    follow.update(camState(), params.shot ? { yaw: 0, pitch: 0 } : input.consumeLook(), dt, now);
    env.followShadow(controller.position);
    windUniforms.uTime.value = t / 1000;
    water.update(t / 1000, camera.position);
    updateHeroSun(dt);
    heroRoot.updateMatrixWorld(true);
    measureSlip(dt);
    renderer.render(scene, camera);
    perf.frame(now, renderer);
    if (!reachedEnd && controller.progress > route.length - 3) {
      reachedEnd = true;
      callbacks.onReachWaterfront?.();
    }
  };

  const onVisibility = () => {
    renderer.setAnimationLoop(document.hidden ? null : frame);
  };
  document.addEventListener("visibilitychange", onVisibility);
  disposers.push(() => document.removeEventListener("visibilitychange", onVisibility));
  renderer.setAnimationLoop(frame);

  // ---------- test / QA hooks (read-only views of the experiment)
  const api: TestApi = {
    ready: true,
    state: () => ({
      progress: controller.progress,
      routeLength: route.length,
      position: controller.position.toArray(),
      heading: controller.heading,
      speed: controller.speed,
      surface: controller.surface,
      kind: route.samples[controller.routeIndex].kind,
      reachedEnd,
      autowalkSeconds: autopilot?.elapsedSeconds ?? null,
      autowalkFinished: autopilot ? autopilot.finishedAt >= 0 : null,
      walkGroundSpeed: groundSpeed,
      // median planted-foot speed (m/s) over the last ~4 s of walking; 0 = no skating
      footSlip: slipSamples.length ? [...slipSamples].sort((a, b) => a - b)[Math.floor(slipSamples.length / 2)] : null,
      walkSpeed: WALK_SPEED,
      cameraYaw: follow.yaw,
      camera: camera.position.toArray(),
    }),
    perf: () => perf.snapshot(),
    teleport: (s: number) => {
      controller.placeAt(s);
      follow.snap(camState());
    },
  };
  if (params.debug) Object.assign(api, { scene, camera, renderer, env });
  (window as unknown as { __coastalProof?: TestApi }).__coastalProof = api;
  disposers.push(() => {
    delete (window as unknown as { __coastalProof?: TestApi }).__coastalProof;
  });

  const begin = () => {
    if (began) return;
    began = true;
    input.enabled = !params.shot;
  };
  if (params.noGate) begin();

  return {
    begin,
    togglePerf: () => perf.toggle(),
    dispose() {
      disposed = true;
      for (const fn of disposers.splice(0).reverse()) {
        try {
          fn();
        } catch {
          /* keep tearing down */
        }
      }
    },
  };
}
