import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { Autopilot } from "./autopilot";
import { Locomotion, deriveBriskWalk, measureGroundSpeed } from "./character";
import { PlayerController, WALK_SPEED } from "./controller";
import { createEnv, withSunFog } from "./env";
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
  dispose(): void;
};

export const PROOF_BUILD = "coastal-proof stage1";

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
  const loadGltf = (file: string) =>
    new Promise<GLTF>((resolve, reject) => {
      progress.set(file, 0);
      loader.load(
        assetBase + file,
        g => {
          progress.set(file, 1);
          report();
          resolve(g);
        },
        e => {
          if (e.total) progress.set(file, e.loaded / e.total);
          report();
        },
        reject
      );
    });
  const levelDataP = fetch(assetBase + "level.json").then(r => {
    if (!r.ok) throw new Error(`level.json ${r.status}`);
    progress.set("level.json", 1);
    return r.json() as Promise<LevelData>;
  });
  const [levelGltf, data, heroGltf, animsA] = await Promise.all([
    loadGltf("level.glb"),
    levelDataP,
    loadGltf("base_female.glb"),
    loadGltf("anims_a.glb"),
  ]);
  if (disposed) throw new Error("disposed during load");

  // ---------- world
  const env = createEnv(scene, data.sunDirection);
  disposers.push(() => env.dispose());
  const level = splitLevel(levelGltf);
  const materials: THREE.Material[] = [];
  for (const [name, meshes] of level.meshesByMaterial) {
    for (const mesh of meshes) {
      const src = mesh.material as THREE.MeshStandardMaterial;
      let mat: THREE.Material;
      if (name === "glow") {
        mat = withSunFog(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.72, 0.38).multiplyScalar(2.4) }));
      } else {
        mat = withSunFog(new THREE.MeshLambertMaterial({ color: src.color.clone(), vertexColors: true, side: THREE.DoubleSide }));
      }
      src.dispose();
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

  // Stage 1 placeholder sea (Stage 2 replaces it)
  const seaMat = withSunFog(new THREE.MeshLambertMaterial({ color: "#2f5d6e" }));
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2), seaMat);
  sea.receiveShadow = true;
  scene.add(sea);
  materials.push(seaMat);

  // ---------- Trailblazer (Stage 1: the plain base on the real rig)
  const route = new Route(data);
  const hero = SkeletonUtils.clone(heroGltf.scene);
  hero.traverse(o => {
    const m = o as THREE.SkinnedMesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    }
  });
  const body = new THREE.Group();
  body.add(hero);
  const heroRoot = new THREE.Group();
  heroRoot.add(body);
  scene.add(heroRoot);

  const clipByName = new Map(animsA.animations.map(c => [c.name, c]));
  const idleClip = clipByName.get("Idle_Loop");
  const walkClip = clipByName.get("Walk_Loop");
  if (!idleClip || !walkClip) throw new Error("missing locomotion clips");
  const stride = params.stride ?? 1.32;
  const brisk = deriveBriskWalk(hero, walkClip, stride);
  const groundSpeed = measureGroundSpeed(hero, brisk);
  const loco = new Locomotion(body, hero, { idle: idleClip, walk: brisk }, groundSpeed);

  // ---------- control
  const controller = new PlayerController(level.colliders, route, data.surfaceByKind);
  const follow = new FollowCamera(camera, level.colliders.cam);
  const input = new ProofInput(container);
  disposers.push(() => input.dispose());
  input.enabled = false;
  const autopilot = params.autowalk ? new Autopilot(route) : null;
  const perf = new PerfMeter(params.perf ? container : null, renderer, PROOF_BUILD);
  disposers.push(() => perf.dispose());

  const startS = params.shot ? data.shots[params.shot] ?? 5 : data.shots.overlook ?? 5;
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
