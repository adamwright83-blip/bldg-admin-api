import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OutlineEffect } from "three/examples/jsm/effects/OutlineEffect.js";
import { getAudioManager } from "@/game/audio/AudioManager";
import { noOutline, stylizeObject } from "./stylize";

/**
 * Silver Lake in 3D: a cozy floating courtyard you walk around as the adventurer.
 *
 * One imperative three.js loop owned by one React component, with explicit dispose. It holds NO business
 * authority: villagers are whatever the component hands it, and talking to one only calls `onTalk`.
 * The Letter Desk, consent, sends and schedules stay in the existing React components.
 *
 * Coordinates: the courtyard metadata is written in Blender (x, y up-plane, z up); three is
 * x = x, y = z, z = -y. The hero model faces +Z at rotation 0; heading h faces (sin h, cos h).
 */

export type VillagerView = {
  key: string;
  slot: number; // 0..7, matches courtyard.json villagerSpots
  name: string;
  status: string;
  sprite: string;
  cropBottom?: number; // fraction of the image height to hide (some 2D sprites carry a painted name)
  ambient: boolean; // a fictional neighbour, not a customer
  done: boolean; // a verified or committed outcome already exists
};

export type RuntimeCallbacks = {
  onReady?: () => void;
  onProgress?: (fraction: number) => void;
  onNear?: (villagerKey: string | null) => void;
  onTalk?: (villagerKey: string) => void;
  onError?: (message: string) => void;
};

export type SilverLakeHandle = {
  setVillagers(list: VillagerView[]): void;
  setFeature(choice: string | null): void;
  setPaused(paused: boolean): void;
  talkNearest(): void;
  focusVillager(key: string): void;
  jump(): void;
  dispose(): void;
};

type CourtyardMeta = {
  spawn: { x: number; y: number; face: number };
  walkRadius: number;
  plazaRadius: number;
  villagerSpots: { x: number; y: number; face: number; house: number | null }[];
  colliders: { circles: { x: number; y: number; r: number }[]; polys: [number, number][][]; segments?: [number, number, number, number][] };
  feature: { x: number; y: number };
  chimneys: [number, number, number][];
};

const HERO_RADIUS = 0.45;
const WALK_SPEED = 4.2;
const RUN_SPEED = 7.4;
const GRAVITY = 32;
const JUMP_V = 10.5;
const TALK_RANGE = 2.9;

const b2t = (x: number, y: number, z = 0) => new THREE.Vector3(x, z, -y);
const headingFromBlender = (a: number) => Math.atan2(Math.cos(a), -Math.sin(a));
const damp = (a: number, b: number, lambda: number, dt: number) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const dampAngle = (a: number, b: number, lambda: number, dt: number) => a + wrap(b - a) * (1 - Math.exp(-lambda * dt));

export async function createSilverLake(
  container: HTMLElement,
  assetBase: string,
  callbacks: RuntimeCallbacks = {}
): Promise<SilverLakeHandle> {
  const disposers: Array<() => void> = [];
  let disposed = false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.6 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = "sl3d-canvas";
  renderer.domElement.setAttribute("data-testid", "silver-lake-3d-canvas");
  container.appendChild(renderer.domElement);
  const outline = new OutlineEffect(renderer, { defaultThickness: 0.0042, defaultColor: [0.16, 0.1, 0.07], defaultAlpha: 1, defaultKeepAlive: true });
  disposers.push(() => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.domElement.remove();
  });

  const scene = new THREE.Scene();
  const sky = document.createElement("canvas");
  sky.width = 4;
  sky.height = 256;
  const g = sky.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#8ec5f2");
  grad.addColorStop(0.45, "#cfe7fa");
  grad.addColorStop(0.72, "#ffe2c2");
  grad.addColorStop(1, "#ffc59a");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog(0xf6dcc4, 60, 150);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);

  const hemi = new THREE.HemisphereLight(0xffe9d2, 0x86b45c, 1.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd7a3, 2.6);
  sun.position.set(-24, 22, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -26;
  sc.right = 26;
  sc.top = 26;
  sc.bottom = -26;
  sc.near = 1;
  sc.far = 90;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  // ---------------------------------------------------------------- loading
  const loader = new GLTFLoader();
  const progress = { court: 0, hero: 0 };
  const report = () => callbacks.onProgress?.((progress.court + progress.hero) / 2);
  const load = (file: string, key: keyof typeof progress) =>
    new Promise<GLTF>((resolve, reject) =>
      loader.load(
        assetBase + file,
        gl => {
          progress[key] = 1;
          report();
          resolve(gl);
        },
        e => {
          if (e.total) {
            progress[key] = Math.min(0.99, e.loaded / e.total);
            report();
          }
        },
        reject
      )
    );
  const metaPromise = fetch(assetBase + "courtyard.json").then(r => {
    if (!r.ok) throw new Error("courtyard.json missing");
    return r.json() as Promise<CourtyardMeta>;
  });
  let court: GLTF, heroGltf: GLTF, meta: CourtyardMeta;
  try {
    [court, heroGltf, meta] = await Promise.all([load("courtyard.glb", "court"), load("hero/adventurer.glb", "hero"), metaPromise]);
  } catch (err) {
    callbacks.onError?.(err instanceof Error ? err.message : String(err));
    disposers.forEach(d => d());
    throw err;
  }
  if (disposed) throw new Error("disposed");

  // ---------------------------------------------------------------- world
  const glowMats: Array<{ emissiveIntensity: number }> = [];
  court.scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some(mt => Boolean((mt as THREE.MeshStandardMaterial).map))) m.receiveShadow = false;
    for (const mat of mats) {
      const sm = mat as THREE.MeshStandardMaterial;
      if (sm.map && sm.transparent) {
        sm.alphaTest = 0.5;
        sm.transparent = false;
      }

    }
    if (m.name.startsWith("VIS_Grass") || m.name.startsWith("VIS_path") || m.name === "VIS_grass") m.castShadow = false;
  });
  stylizeObject(court.scene);
  court.scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshToonMaterial;
    if (mat.name && mat.name.includes("lamp_glow") && !glowMats.includes(mat as never)) glowMats.push(mat as never);
  });
  scene.add(court.scene);
  const glowBase = glowMats.map(m => m.emissiveIntensity);

  // clouds: soft puffs drifting around and below the island
  const cloudMat = new THREE.MeshToonMaterial({ color: 0xffffff, emissive: 0xfff3ea, emissiveIntensity: 0.45 });
  cloudMat.userData.outlineParameters = { thickness: 0.003, color: [0.85, 0.72, 0.7], alpha: 1, visible: true };
  const puffGeo = new THREE.IcosahedronGeometry(1, 2);
  const clouds: { g: THREE.Group; r: number; a: number; speed: number; y: number }[] = [];
  for (let i = 0; i < 16; i++) {
    const grp = new THREE.Group();
    const n = 4 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const puff = new THREE.Mesh(puffGeo, cloudMat);
      const s = 2.2 + Math.random() * 2.6;
      puff.scale.set(s * 1.25, s * 0.8, s);
      puff.position.set((k - n / 2) * 2.6 + Math.random(), Math.random() * 1.4, Math.random() * 2);
      grp.add(puff);
    }
    const c = { g: grp, r: 34 + Math.random() * 26, a: Math.random() * Math.PI * 2, speed: (0.008 + Math.random() * 0.01) * (Math.random() > 0.5 ? 1 : -1), y: -6 + Math.random() * 16 };
    clouds.push(c);
    scene.add(grp);
  }

  // chimney smoke
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false });
  noOutline(smokeMat);
  const smokeGeo = new THREE.IcosahedronGeometry(0.32, 1);
  const smoke: { m: THREE.Mesh; base: THREE.Vector3; t: number }[] = [];
  for (const [x, y, z] of meta.chimneys ?? []) {
    for (let k = 0; k < 5; k++) {
      const sm = smokeMat.clone();
      noOutline(sm);
      const m = new THREE.Mesh(smokeGeo, sm);
      scene.add(m);
      smoke.push({ m, base: b2t(x, y, z), t: k / 5 });
    }
  }

  // fireflies / pollen floating over the plaza
  const motesGeo = new THREE.BufferGeometry();
  const MOTES = 70;
  const motePos = new Float32Array(MOTES * 3);
  const moteSeed = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) {
    const r = 3 + Math.random() * 15;
    const a = Math.random() * Math.PI * 2;
    moteSeed.set([r, a, 0.6 + Math.random() * 3], i * 3);
  }
  motesGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
  const moteMat = new THREE.PointsMaterial({ color: 0xfff1a8, size: 0.16, transparent: true, opacity: 0.85, depthWrite: false });
  noOutline(moteMat);
  const motes = new THREE.Points(motesGeo, moteMat);
  scene.add(motes);

  // ---------------------------------------------------------------- hero
  const hero = heroGltf.scene;
  hero.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = false;
      m.frustumCulled = false;
    }
  });
  stylizeObject(hero);
  scene.add(hero);
  const mixer = new THREE.AnimationMixer(hero);
  const clip = (name: string) => heroGltf.animations.find(a => a.name === name);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const a of heroGltf.animations) actions.set(a.name, mixer.clipAction(a));
  let current: THREE.AnimationAction | null = null;
  let currentName = "";
  const play = (name: string, fade = 0.18, once = false) => {
    if (currentName === name) return;
    const next = actions.get(name);
    if (!next) return;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    next.fadeIn(fade).play();
    if (current) current.fadeOut(fade);
    current = next;
    currentName = name;
  };
  play(clip("Idle_A") ? "Idle_A" : heroGltf.animations[0]?.name ?? "", 0);

  const spawn = b2t(meta.spawn.x, meta.spawn.y);
  const pos = spawn.clone();
  let heading = headingFromBlender(meta.spawn.face);
  let speed = 0;
  let vy = 0;
  let grounded = true;
  let airborne = 0;
  let gesture: { name: string; until: number } | null = null;
  hero.position.copy(pos);
  hero.rotation.y = heading;

  // ---------------------------------------------------------------- collisions (2D, blender plane)
  const circles = meta.colliders.circles.map(c => ({ x: c.x, z: -c.y, r: c.r }));
  const polys = meta.colliders.polys.map(p => p.map(([x, y]) => new THREE.Vector2(x, -y)));
  const segments = (meta.colliders.segments ?? []).map(([x0, y0, x1, y1]) => ({ ax: x0, az: -y0, bx: x1, bz: -y1 }));
  const tmp2 = new THREE.Vector2();
  function resolve(p: THREE.Vector3) {
    for (const c of circles) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + HERO_RADIUS;
      if (d < min && d > 1e-5) {
        p.x = c.x + (dx / d) * min;
        p.z = c.z + (dz / d) * min;
      }
    }
    for (const poly of polys) {
      // inside test + closest edge point
      let inside = false;
      let best = Infinity;
      let bx = 0;
      let bz = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.y > p.z !== b.y > p.z && p.x < ((b.x - a.x) * (p.z - a.y)) / (b.y - a.y + 1e-9) + a.x) inside = !inside;
        tmp2.set(b.x - a.x, b.y - a.y);
        const len2 = tmp2.lengthSq() || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * tmp2.x + (p.z - a.y) * tmp2.y) / len2));
        const cx = a.x + tmp2.x * t;
        const cz = a.y + tmp2.y * t;
        const d = Math.hypot(p.x - cx, p.z - cz);
        if (d < best) {
          best = d;
          bx = cx;
          bz = cz;
        }
      }
      if (inside) {
        const dx = bx - p.x;
        const dz = bz - p.z;
        const d = Math.hypot(dx, dz) || 1;
        p.x = bx + (dx / d) * HERO_RADIUS;
        p.z = bz + (dz / d) * HERO_RADIUS;
      } else if (best < HERO_RADIUS) {
        const dx = p.x - bx;
        const dz = p.z - bz;
        const d = Math.hypot(dx, dz) || 1;
        p.x = bx + (dx / d) * HERO_RADIUS;
        p.z = bz + (dz / d) * HERO_RADIUS;
      }
    }
    for (const sg of segments) {
      const ex = sg.bx - sg.ax;
      const ez = sg.bz - sg.az;
      const len2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((p.x - sg.ax) * ex + (p.z - sg.az) * ez) / len2));
      const cx = sg.ax + ex * t;
      const cz = sg.az + ez * t;
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d = Math.hypot(dx, dz);
      const min = HERO_RADIUS + 0.12;
      if (d < min) {
        const nx = d > 1e-5 ? dx / d : -ez / Math.sqrt(len2);
        const nz = d > 1e-5 ? dz / d : ex / Math.sqrt(len2);
        p.x = cx + nx * min;
        p.z = cz + nz * min;
      }
    }
    const r = Math.hypot(p.x, p.z);
    if (r > meta.walkRadius) {
      p.x *= meta.walkRadius / r;
      p.z *= meta.walkRadius / r;
    }
  }

  // ---------------------------------------------------------------- villagers (paper-cutout billboards)
  const texLoader = new THREE.TextureLoader();
  const labelLayer = document.createElement("div");
  labelLayer.className = "sl3d-labels";
  container.appendChild(labelLayer);
  disposers.push(() => labelLayer.remove());
  type Villager = { view: VillagerView; group: THREE.Group; card: THREE.Mesh; ring: THREE.Mesh; label: HTMLDivElement; base: THREE.Vector3; face: number; phase: number };
  const villagers = new Map<string, Villager>();
  const ringGeo = new THREE.RingGeometry(0.75, 0.95, 40);
  ringGeo.rotateX(-Math.PI / 2);

  function makeVillager(v: VillagerView): Villager | null {
    const spot = meta.villagerSpots[v.slot];
    if (!spot) return null;
    const group = new THREE.Group();
    const base = b2t(spot.x, spot.y);
    group.position.copy(base);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.08, side: THREE.DoubleSide, toneMapped: false });
    noOutline(mat);
    const card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    card.position.y = 1.1;
    group.add(card);
    texLoader.load(v.sprite, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      const crop = v.cropBottom ?? 0;
      t.offset.y = crop;
      t.repeat.y = 1 - crop;
      mat.map = t;
      mat.needsUpdate = true;
      const img = t.image as HTMLImageElement;
      const aspect = img.width / Math.max(1, img.height * (1 - crop));
      const h = 2.0;
      card.scale.set(h * aspect, h, 1);
      card.position.y = h / 2;
    });
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x2b3b1c, transparent: true, opacity: 0.22, depthWrite: false });
    noOutline(shadowMat);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.6, 24).rotateX(-Math.PI / 2), shadowMat);
    shadow.position.y = 0.04;
    group.add(shadow);
    const ringMat0 = new THREE.MeshBasicMaterial({ color: v.ambient ? 0xfff2c4 : 0xffc74d, transparent: true, opacity: 0, depthWrite: false });
    noOutline(ringMat0);
    const ring = new THREE.Mesh(ringGeo, ringMat0);
    ring.position.y = 0.06;
    group.add(ring);
    scene.add(group);
    const label = document.createElement("div");
    label.className = "sl3d-label";
    label.dataset.villager = v.key;
    labelLayer.appendChild(label);
    const out: Villager = { view: v, group, card, ring, label, base, face: headingFromBlender(spot.face), phase: Math.random() * 6 };
    updateLabel(out);
    return out;
  }

  function updateLabel(v: Villager) {
    v.label.replaceChildren();
    const name = document.createElement("b");
    name.textContent = v.view.name;
    const status = document.createElement("span");
    status.textContent = v.view.status;
    v.label.append(name, status);
    v.label.classList.toggle("is-ambient", v.view.ambient);
    v.label.classList.toggle("is-done", v.view.done);
  }

  function removeVillager(v: Villager) {
    scene.remove(v.group);
    v.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry !== ringGeo && m.geometry.dispose();
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
    });
    v.label.remove();
  }
  disposers.push(() => villagers.forEach(removeVillager));

  // ---------------------------------------------------------------- courtyard feature (Phase 3 memory choice)
  let featureObj: THREE.Object3D | null = null;
  function buildFeature(choice: string | null) {
    if (featureObj) {
      scene.remove(featureObj);
      featureObj = null;
    }
    if (!choice) return;
    const wood = new THREE.MeshStandardMaterial({ name: "bench", color: 0xa46a3e, roughness: 0.8 });
    const grp = new THREE.Group();
    if (choice === "lantern_post") {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.4, 10), new THREE.MeshStandardMaterial({ name: "timber", color: 0x3d5a45 }));
      post.position.y = 1.2;
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.5, 12), new THREE.MeshStandardMaterial({ name: "lamp_glow", color: 0xffcf73, emissive: 0xffcf73, emissiveIntensity: 2.5 }));
      lamp.position.y = 2.6;
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.35, 12), new THREE.MeshStandardMaterial({ name: "timber", color: 0x3d5a45 }));
      hat.position.y = 3.0;
      grp.add(post, lamp, hat);
    } else if (choice === "tea_table") {
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.12, 24), wood);
      top.position.y = 0.9;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 0.9, 10), wood);
      leg.position.y = 0.45;
      const cloth = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.04, 24), new THREE.MeshStandardMaterial({ color: 0xff8a73 }));
      cloth.position.y = 0.98;
      const pot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), new THREE.MeshStandardMaterial({ color: 0xfbf6ec }));
      pot.position.y = 1.15;
      grp.add(top, leg, cloth, pot);
    } else {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.7), wood);
      seat.position.y = 0.55;
      const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 0.14), wood);
      back.position.set(0, 0.92, -0.32);
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.32), new THREE.MeshStandardMaterial({ color: 0x4f79b8 }));
      book.position.set(0.5, 0.68, 0);
      grp.add(seat, back, book);
    }
    stylizeObject(grp);
    grp.traverse(o => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));
    grp.position.copy(b2t(meta.feature.x, meta.feature.y));
    grp.rotation.y = Math.atan2(grp.position.x, grp.position.z) + Math.PI;
    grp.scale.setScalar(0.01);
    scene.add(grp);
    featureObj = grp;
    circles.push({ x: grp.position.x, z: grp.position.z, r: choice === "tea_table" ? 0.85 : 1.1 });
  }

  // ---------------------------------------------------------------- input
  const keys = new Set<string>();
  let jumpQueued = false;
  let talkQueued = false;
  let paused = false;
  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (paused) return;
    keys.add(e.code);
    if (e.code === "Space") {
      jumpQueued = true;
      e.preventDefault();
    }
    if (e.code === "KeyE" || e.code === "Enter") talkQueued = true;
    if (e.code.startsWith("Arrow")) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  const onBlur = () => keys.clear();
  window.addEventListener("blur", onBlur);
  disposers.push(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  });

  // pointer: left half = floating thumbstick, right half (or mouse drag) = look
  const stick = document.createElement("div");
  stick.className = "sl3d-stick";
  const knob = document.createElement("div");
  knob.className = "sl3d-stick-knob";
  stick.appendChild(knob);
  container.appendChild(stick);
  disposers.push(() => stick.remove());
  let stickId: number | null = null;
  const stickOrigin = { x: 0, y: 0 };
  const stickVal = { x: 0, y: 0 };
  let lookId: number | null = null;
  let lookLast = { x: 0, y: 0 };
  let lookYaw = 0;
  let lookAt = -Infinity;
  const el = renderer.domElement;
  el.style.touchAction = "none";
  const onDown = (e: PointerEvent) => {
    if (paused) return;
    const rect = el.getBoundingClientRect();
    const leftHalf = e.clientX - rect.left < rect.width * 0.45;
    if (e.pointerType !== "mouse" && leftHalf && stickId === null) {
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

  // ---------------------------------------------------------------- camera
  let camYaw = heading + Math.PI;
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const intro = { t: 0, dur: reduceMotion ? 0 : 2.6 };
  let focus: { target: THREE.Vector3; until: number } | null = null;
  function blocked(x: number, z: number) {
    for (const poly of polys) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y + 1e-9) + a.x) inside = !inside;
      }
      if (inside) return true;
    }
    return Math.hypot(x, z) > meta.walkRadius + 3.5;
  }
  let armLen = 9;
  function cameraGoal(out: THREE.Vector3, look: THREE.Vector3, dt = 0) {
    const dist = coarse ? 10.5 : 9.2;
    const height = 4.6;
    const dx = Math.sin(camYaw);
    const dz = Math.cos(camYaw);
    // march the arm out from the hero; stop short of any cottage
    let free = dist;
    for (let d = 1.2; d <= dist; d += 0.3) {
      if (blocked(pos.x + dx * d, pos.z + dz * d)) {
        free = Math.max(2.6, d - 0.8);
        break;
      }
    }
    armLen = dt > 0 ? (free < armLen ? damp(armLen, free, 14, dt) : damp(armLen, free, 2.5, dt)) : free;
    const k = armLen / dist;
    out.set(pos.x + dx * armLen, pos.y + height * (0.55 + 0.45 * k), pos.z + dz * armLen);
    look.set(pos.x, pos.y + 1.5, pos.z);
  }

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 60 : 48;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  disposers.push(() => ro.disconnect());

  // ---------------------------------------------------------------- loop
  const audio = getAudioManager();
  audio.primeOnGesture?.();
  let nearKey: string | null = null;
  let featureGrow = 0;
  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  const proj = new THREE.Vector3();
  let elapsed = 0;

  function frame() {
    const dt = Math.min(0.05, clock.getDelta());
    elapsed += dt;
    const now = performance.now();

    // movement intent, camera-relative
    let mx = stickVal.x;
    let my = stickVal.y;
    if (keys.has("KeyW") || keys.has("ArrowUp")) my += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) my -= 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
    if (keys.has("KeyQ")) lookYaw += dt * 2.2;
    if (keys.has("KeyR")) lookYaw -= dt * 2.2;
    let mag = Math.min(1, Math.hypot(mx, my));
    if (paused || intro.t < intro.dur) mag = 0;
    const run = keys.has("ShiftLeft") || keys.has("ShiftRight") || Math.hypot(stickVal.x, stickVal.y) > 0.92;
    const target = mag > 0.05 ? (run ? RUN_SPEED : WALK_SPEED) * mag : 0;
    speed = damp(speed, target, target > speed ? 9 : 12, dt);
    if (mag > 0.05) {
      const camForward = camYaw + Math.PI; // direction the camera looks along the ground
      const want = camForward - Math.atan2(mx, my);
      heading = dampAngle(heading, want, 12, dt);
      gesture = null;
    }
    pos.x += Math.sin(heading) * speed * dt;
    pos.z += Math.cos(heading) * speed * dt;

    // jump
    if (jumpQueued && grounded && !paused && intro.t >= intro.dur) {
      vy = JUMP_V;
      grounded = false;
      airborne = 0;
      play("Jump_Start", 0.08, true);
      audio.play("jump");
    }
    jumpQueued = false;
    if (!grounded) {
      vy -= GRAVITY * dt;
      pos.y += vy * dt;
      airborne += dt;
      if (airborne > 0.25 && currentName === "Jump_Start") play("Jump_Idle", 0.12);
      if (pos.y <= 0) {
        pos.y = 0;
        vy = 0;
        grounded = true;
        play("Jump_Land", 0.06, true);
        gesture = { name: "Jump_Land", until: now + 260 };
        audio.play("land");
      }
    }
    resolve(pos);
    hero.position.copy(pos);
    hero.rotation.y = heading;

    // animation state
    if (grounded && (!gesture || now > gesture.until || speed > 0.6)) {
      if (gesture && now > gesture.until) gesture = null;
      if (!gesture) {
        if (speed > 5.2) play("Running_A");
        else if (speed > 0.35) play("Walking_A");
        else play("Idle_A", 0.3);
      }
    }
    const walk = actions.get("Walking_A");
    if (walk && currentName === "Walking_A") walk.timeScale = THREE.MathUtils.clamp(speed / 2.6, 0.7, 1.6);
    const runA = actions.get("Running_A");
    if (runA && currentName === "Running_A") runA.timeScale = THREE.MathUtils.clamp(speed / 6.6, 0.85, 1.3);
    mixer.update(dt);

    // camera: recentre behind the hero while walking unless the player just looked around
    if (mag > 0.05 && now - lookAt > 1400) camYaw = dampAngle(camYaw, heading + Math.PI, 2.2, dt);
    if (lookYaw !== 0) {
      camYaw += lookYaw;
      lookYaw = 0;
    }
    cameraGoal(tmp, proj, dt);
    if (intro.t < intro.dur) {
      intro.t += dt;
      const u = THREE.MathUtils.smootherstep(Math.min(1, intro.t / intro.dur), 0, 1);
      const start = new THREE.Vector3(0, 46, 34);
      camPos.copy(start).lerp(tmp, u);
      camLook.set(0, 0, 0).lerp(proj, u);
    } else if (focus && now < focus.until) {
      camPos.x = damp(camPos.x, focus.target.x, 3, dt);
      camPos.y = damp(camPos.y, focus.target.y, 3, dt);
      camPos.z = damp(camPos.z, focus.target.z, 3, dt);
      camLook.lerp(proj, 1 - Math.exp(-4 * dt));
    } else {
      focus = null;
      camPos.x = damp(camPos.x, tmp.x, 6, dt);
      camPos.y = damp(camPos.y, tmp.y, 4, dt);
      camPos.z = damp(camPos.z, tmp.z, 6, dt);
      camLook.lerp(proj, 1 - Math.exp(-10 * dt));
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    // villagers: face the camera (paper cutouts), bob, notice the hero
    let best: Villager | null = null;
    let bestD = TALK_RANGE;
    villagers.forEach(v => {
      const d = Math.hypot(v.base.x - pos.x, v.base.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    });
    const nextNear = best && intro.t >= intro.dur ? (best as Villager).view.key : null;
    if (nextNear !== nearKey) {
      nearKey = nextNear;
      callbacks.onNear?.(nearKey);
      if (nearKey) audio.play("ui_tap", { volume: 0.4 } as never);
    }
    const w = container.clientWidth;
    const h = container.clientHeight;
    villagers.forEach(v => {
      const near = v.view.key === nearKey;
      const yawToCam = Math.atan2(camera.position.x - v.group.position.x, camera.position.z - v.group.position.z);
      v.card.rotation.y = yawToCam - v.group.rotation.y;
      const bob = reduceMotion ? 0 : Math.abs(Math.sin(elapsed * (near ? 6 : 2.2) + v.phase)) * (near ? 0.22 : 0.07);
      v.card.position.y = v.card.scale.y / 2 + bob;
      const sq = reduceMotion ? 1 : 1 + Math.sin(elapsed * 2.2 + v.phase) * 0.025;
      v.card.scale.x = Math.abs(v.card.scale.x) * 1;
      v.card.scale.y = (v.card.scale.y / (v.card.userData.sq ?? 1)) * sq;
      v.card.userData.sq = sq;
      const ringMat = v.ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = damp(ringMat.opacity, near ? 0.9 : v.view.done ? 0 : 0.28, 8, dt);
      v.ring.scale.setScalar(near ? 1 + Math.sin(elapsed * 5) * 0.06 : 1);
      // label
      proj.set(v.group.position.x, v.group.position.y + 2.55 + bob, v.group.position.z).project(camera);
      const visible = intro.t >= intro.dur && proj.z < 1 && Math.hypot(v.base.x - camera.position.x, v.base.z - camera.position.z) < 34;
      v.label.style.opacity = visible ? (near ? "1" : "0.86") : "0";
      v.label.style.transform = `translate(-50%, -100%) translate(${((proj.x + 1) / 2) * w}px, ${((1 - proj.y) / 2) * h}px) scale(${near ? 1.08 : 0.92})`;
      v.label.classList.toggle("is-near", near);
    });
    // reconsume proj for the camera (it was used as scratch)
    cameraGoal(tmp, proj);

    if (talkQueued) {
      talkQueued = false;
      if (nearKey && !paused) talkTo(nearKey);
    }

    // ambience
    for (const s of smoke) {
      s.t = (s.t + dt * 0.18) % 1;
      s.m.position.set(s.base.x + Math.sin(s.t * 6 + s.base.x) * 0.35, s.base.y + s.t * 3.4, s.base.z + s.t * 1.1);
      s.m.scale.setScalar(0.6 + s.t * 1.8);
      (s.m.material as THREE.MeshLambertMaterial).opacity = 0.62 * (1 - s.t);
    }
    for (let i = 0; i < MOTES; i++) {
      const r = moteSeed[i * 3];
      const a = moteSeed[i * 3 + 1] + elapsed * 0.05 * (i % 2 ? 1 : -1);
      motePos[i * 3] = Math.cos(a) * r + Math.sin(elapsed * 0.7 + i) * 0.4;
      motePos[i * 3 + 1] = moteSeed[i * 3 + 2] + Math.sin(elapsed * 1.3 + i * 1.7) * 0.35;
      motePos[i * 3 + 2] = Math.sin(a) * r;
    }
    motesGeo.attributes.position.needsUpdate = true;
    clouds.forEach(c => {
      c.a += c.speed * dt;
      c.g.position.set(Math.cos(c.a) * c.r, c.y, Math.sin(c.a) * c.r);
      c.g.lookAt(0, c.y, 0);
    });
    glowMats.forEach((m, i) => (m.emissiveIntensity = glowBase[i] * (0.9 + Math.sin(elapsed * 3.1 + i * 1.3) * 0.06 + Math.sin(elapsed * 7.7 + i) * 0.04)));
    if (featureObj && featureGrow < 1) {
      featureGrow = Math.min(1, featureGrow + dt * 1.6);
      const k = featureGrow < 1 ? 1 + Math.sin(featureGrow * Math.PI) * 0.18 : 1;
      featureObj.scale.setScalar(Math.max(0.01, featureGrow) * k);
    }

    outline.render(scene, camera);
  }

  function talkTo(key: string) {
    const v = villagers.get(key);
    if (!v) return;
    heading = Math.atan2(v.base.x - pos.x, v.base.z - pos.z);
    speed = 0;
    play("Waving", 0.15, true);
    gesture = { name: "Waving", until: performance.now() + 1500 };
    // camera eases to a two-shot of the hero and the villager
    const mid = new THREE.Vector3().addVectors(pos, v.base).multiplyScalar(0.5);
    const side = new THREE.Vector3(v.base.z - pos.z, 0, -(v.base.x - pos.x)).normalize();
    focus = { target: mid.clone().add(side.multiplyScalar(6.5)).add(new THREE.Vector3(0, 3.2, 0)), until: performance.now() + 2200 };
    audio.play("ui_tap");
    callbacks.onTalk?.(key);
  }

  renderer.setAnimationLoop(frame);
  callbacks.onReady?.();
  (window as unknown as { __silverLake3d?: unknown }).__silverLake3d = {
    ready: true,
    state: () => ({ x: pos.x, z: pos.z, y: pos.y, heading, speed, anim: currentName, near: nearKey, villagers: villagers.size, intro: intro.t >= intro.dur, clips: heroGltf.animations.map(a => a.name) }),
    teleportNear: (key: string) => {
      const v = villagers.get(key);
      if (!v) return false;
      pos.set(v.base.x + Math.sin(v.face) * 1.8, 0, v.base.z + Math.cos(v.face) * 1.8);
      return true;
    },
  };
  disposers.push(() => delete (window as unknown as { __silverLake3d?: unknown }).__silverLake3d);

  return {
    setVillagers(list) {
      const keep = new Set(list.map(v => v.key));
      villagers.forEach((v, k) => {
        if (!keep.has(k)) {
          removeVillager(v);
          villagers.delete(k);
        }
      });
      for (const view of list) {
        const existing = villagers.get(view.key);
        if (existing) {
          const spriteChanged = existing.view.sprite !== view.sprite || existing.view.slot !== view.slot;
          if (spriteChanged) {
            removeVillager(existing);
            villagers.delete(view.key);
          } else {
            existing.view = view;
            updateLabel(existing);
            continue;
          }
        }
        const made = makeVillager(view);
        if (made) villagers.set(view.key, made);
      }
    },
    setFeature(choice) {
      featureGrow = 0;
      buildFeature(choice);
    },
    setPaused(p) {
      paused = p;
      if (p) keys.clear();
    },
    talkNearest() {
      if (nearKey) talkTo(nearKey);
    },
    focusVillager(key) {
      const v = villagers.get(key);
      if (!v) return;
      pos.set(v.base.x + Math.sin(v.face) * 2.2, 0, v.base.z + Math.cos(v.face) * 2.2);
      heading = Math.atan2(v.base.x - pos.x, v.base.z - pos.z);
      camYaw = heading + Math.PI;
    },
    jump() {
      jumpQueued = true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach(mat => {
            (mat as THREE.MeshStandardMaterial).map?.dispose();
            mat.dispose();
          });
        }
      });
      skyTex.dispose();
      disposers.forEach(d => d());
    },
  };
}
