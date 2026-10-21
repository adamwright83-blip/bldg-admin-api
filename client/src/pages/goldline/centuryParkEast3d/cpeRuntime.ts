/**
 * Century Park East, playable: the tower's shared floors opened like the dollhouse cutaway the building view already
 * uses (warm rooms, front wall gone, dusk through the back windows), so walking in from the tower feels like zooming
 * into the same drawing. Three floors joined by one elevator: the ground floor (package room, mailroom, lobby, leasing
 * lounge), the amenity floor (laundry, gym, the closet hall, the dog spa) and the roof (pool deck, sky lounge).
 *
 * Two vibes over the same building and the same errands:
 *  - zombie: slow, dumb, comedic zombies. A bite flattens you into paper (the first one) and knocks you out (the
 *    second). An extinguisher dazes them; a dazed zombie shuffles after you, so you lead it into a closet and jam the
 *    broom through the handles.
 *  - cozy: the same shufflers are sleepwalking neighbours in robes; a "bite" is an overwhelming hug, the extinguisher is
 *    lavender mist, and the closet is where they finish their nap.
 * Expensive dogs are hiding everywhere: walk into one and it climbs onto your shoulders (they stack); carry them to the
 * dog spa to save them. A bite scatters the stack.
 *
 * The runtime knows nothing about customers. React tells it which errands exist and where each one stands; the
 * runtime reports what the player did. Nothing here reads or writes the business.
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export type Vibe = "cozy" | "zombie";
export type ItemKind = "robot_vacuum" | "garment_bag" | "leash" | "suitcase" | "package" | "yoga_mat" | "cake" | "spare_key";
export type ErrandPhase = "locked" | "need" | "carrying" | "waiting" | "done";
export type ErrandView = { slot: number; phase: ErrandPhase };
export type PromptId = "talk" | "quiet" | "item" | "elevator" | "closet" | "extinguisher" | "pump" | "concierge" | "rope_up" | "rope_down" | "climb";
export type Interaction =
  | { kind: "talk"; slot: number }
  | { kind: "quiet"; index: number }
  | { kind: "pickup_item"; slot: number }
  | { kind: "elevator"; floor: number }
  | { kind: "lock_closet"; trapped: number }
  | { kind: "extinguisher"; charges: number }
  | { kind: "pump" }
  | { kind: "concierge" }
  | { kind: "rope_top"; floor: number }
  | { kind: "rope_fell" }
  | { kind: "out_of_foam" };

export type CpeCallbacks = {
  onProgress?: (p: number) => void;
  onPrompt?: (prompt: { id: PromptId; label: string } | null) => void;
  onInteract?: (i: Interaction) => void;
  onBite?: (bites: number) => void;
  onDogs?: (d: { carried: number; saved: number; total: number }) => void;
  onCharges?: (n: number) => void;
  onFloor?: (floor: number) => void;
  onBubble?: (b: { who: string; text: string } | null) => void;
  /** climbing a rope: how far up (0..1), or null when she's not on one */
  onClimb?: (progress: number | null) => void;
};

export type CpeHandle = {
  setVibe(v: Vibe): void;
  setErrands(errands: ErrandView[]): void;
  setPaused(p: boolean): void;
  interact(): void;
  spray(): void;
  jump(): void;
  setSprint(on: boolean): void;
  /** after a knockout: wake up in the lobby, whole again */
  respawn(): void;
  finale(): void;
  dispose(): void;
};

// ------------------------------------------------------------------ the building (metres)
const FLOOR_H = 4.4;
const WALL_H = 3.5;
const DEPTH = 5;
const DOOR_Z0 = -3.4;
const DOOR_Z1 = -1.3;
const ELEV_X0 = 27;
const ELEV_X1 = 30;
const WIDTH = 38;

type Room = { name: string; x0: number; x1: number; wall: string; floor: string; open?: boolean };
const FLOORS: { name: string; rooms: Room[] }[] = [
  {
    name: "Ground floor",
    rooms: [
      { name: "Package room", x0: 0, x1: 8, wall: "#c8674e", floor: "#8a6a52" },
      { name: "Mailroom", x0: 8, x1: 15, wall: "#8fa68a", floor: "#6f6a5e" },
      { name: "Lobby", x0: 15, x1: 27, wall: "#e2d2b6", floor: "#c9b9a2" },
      { name: "Elevator", x0: ELEV_X0, x1: ELEV_X1, wall: "#a99c8a", floor: "#3a3346" },
      { name: "Leasing lounge", x0: 30, x1: 38, wall: "#4f7b86", floor: "#b89a74" },
    ],
  },
  {
    name: "Amenity floor",
    rooms: [
      { name: "Laundry room", x0: 0, x1: 9, wall: "#b9c6cf", floor: "#9aa7b0" },
      { name: "Gym", x0: 9, x1: 18, wall: "#d9a55b", floor: "#40434a" },
      { name: "Closet hall", x0: 18, x1: 27, wall: "#7d5a78", floor: "#c9b49a" },
      { name: "Elevator", x0: ELEV_X0, x1: ELEV_X1, wall: "#a99c8a", floor: "#3a3346" },
      { name: "Dog spa", x0: 30, x1: 38, wall: "#d9a9a0", floor: "#b9a596" },
    ],
  },
  {
    name: "Roof",
    rooms: [
      { name: "Pool deck", x0: 0, x1: 27, wall: "#5f6f52", floor: "#d6c4a6", open: true },
      { name: "Elevator", x0: ELEV_X0, x1: ELEV_X1, wall: "#a99c8a", floor: "#3a3346" },
      { name: "Sky lounge", x0: 30, x1: 38, wall: "#3e3550", floor: "#8a6a52" },
    ],
  },
];
const fy = (floor: number) => floor * FLOOR_H;

/** the eight errands: who asks (a building character), what's lost, and where it is */
export const ERRAND_SLOTS: { floor: number; x: number; z: number; item: ItemKind; itemFloor: number; itemX: number; itemZ: number }[] = [
  { floor: 0, x: 19, z: -2.2, item: "robot_vacuum", itemFloor: 1, itemX: 13.5, itemZ: -2.6 },
  { floor: 1, x: 5.5, z: -1.8, item: "garment_bag", itemFloor: 2, itemX: 22, itemZ: -3.6 },
  { floor: 1, x: 34, z: -2.6, item: "leash", itemFloor: 2, itemX: 8, itemZ: -1.6 },
  { floor: 0, x: 33.5, z: -2.0, item: "suitcase", itemFloor: 1, itemX: 21.2, itemZ: -1.6 },
  { floor: 2, x: 13, z: -1.4, item: "package", itemFloor: 0, itemX: 3, itemZ: -2.4 },
  { floor: 1, x: 15.5, z: -1.6, item: "yoga_mat", itemFloor: 2, itemX: 16, itemZ: -1.2 },
  { floor: 2, x: 33, z: -2.4, item: "cake", itemFloor: 0, itemX: 22.5, itemZ: -3.2 },
  { floor: 0, x: 5, z: -1.6, item: "spare_key", itemFloor: 2, itemX: 35.5, itemZ: -3.3 },
];

/** twelve quiet residents: scenery with a line each, never customers */
const QUIET_SLOTS: { floor: number; x: number; z: number; anim: string; base: number }[] = [
  { floor: 0, x: 24.5, z: -3.6, anim: "Idle_TalkingPhone_Loop", base: 1 },
  { floor: 0, x: 16.5, z: -3.8, anim: "Idle_Loop", base: 1 },
  { floor: 0, x: 36, z: -3.4, anim: "Idle_FoldArms_Loop", base: 3 },
  { floor: 0, x: 11, z: -3.6, anim: "Idle_Talking_Loop", base: 0 },
  { floor: 1, x: 2.5, z: -3.6, anim: "Idle_TalkingPhone_Loop", base: 1 },
  { floor: 1, x: 11.2, z: -3.8, anim: "Jog_Fwd_Loop", base: 3 },
  { floor: 1, x: 31.5, z: -3.8, anim: "Idle_Loop", base: 1 },
  { floor: 1, x: 24, z: -1.2, anim: "Idle_FoldArms_Loop", base: 0 },
  { floor: 2, x: 4, z: -3.6, anim: "Dance_Loop", base: 1 },
  { floor: 2, x: 19.5, z: -3.7, anim: "Idle_Loop", base: 1 },
  { floor: 2, x: 36.5, z: -2.0, anim: "Idle_TalkingPhone_Loop", base: 3 },
  { floor: 2, x: 25, z: -1.4, anim: "Idle_Talking_Loop", base: 0 },
];

const ZOMBIE_SPAWNS: { floor: number; x: number; z: number; base: number }[] = [
  { floor: 0, x: 35, z: -2.4, base: 2 },
  { floor: 0, x: 4, z: -3.0, base: 2 },
  { floor: 1, x: 3.5, z: -2.6, base: 2 },
  { floor: 1, x: 22.5, z: -2.0, base: 3 },
  { floor: 1, x: 14.5, z: -3.2, base: 2 },
  { floor: 2, x: 17, z: -2.4, base: 2 },
  { floor: 2, x: 6, z: -3.0, base: 0 },
];

const CLOSETS: { floor: number; x: number }[] = [
  { floor: 0, x: 1.6 },
  { floor: 1, x: 19.6 },
  { floor: 1, x: 22.8 },
  { floor: 1, x: 26.0 },
  { floor: 2, x: 24.8 },
];
/**
 * Fire-station holes: a round hole in the ceiling with a knotted rope hanging through it, one per floor that has a
 * floor above. Climbing is a struggle (mash to climb, stop and you slip); sliding down is quick.
 */
export const ROPES: { floor: number; x: number; z: number }[] = [
  { floor: 0, x: 13.2, z: -1.6 }, // the mailroom, up to the gym
  { floor: 1, x: 6.6, z: -1.7 }, // the laundry room, up to the pool deck
];
const CLIMB_PER_PRESS = 0.42;
const CLIMB_SLIP = 0.55; // metres a second, while she isn't pulling
const CLOSET_HW = 1.0;
const CLOSET_Z = -3.3; // the closet's door plane; inside is z < CLOSET_Z

const EXTINGUISHERS: { floor: number; x: number }[] = [
  { floor: 0, x: 15.6 },
  { floor: 1, x: 9.6 },
  { floor: 2, x: 26.3 },
];
const PUMP = { floor: 1, x: 17.2, z: -4.2 };

type Breed = { name: string; coat: number; accent: number; size: number; fluff: number; legs: number; long: number; ears: "flop" | "point" | "bat"; snout: number };
const BREEDS: Breed[] = [
  { name: "Poodle", coat: 0xf6efe6, accent: 0xff9ec4, size: 1.0, fluff: 1, legs: 1.25, long: 1, ears: "flop", snout: 1.2 },
  { name: "Pomeranian", coat: 0xf0a24a, accent: 0xffffff, size: 0.75, fluff: 1.4, legs: 0.6, long: 0.9, ears: "point", snout: 0.6 },
  { name: "Corgi", coat: 0xe39a4b, accent: 0xffffff, size: 0.95, fluff: 0, legs: 0.5, long: 1.35, ears: "point", snout: 1 },
  { name: "Afghan Hound", coat: 0xe9d6b0, accent: 0x6b4a2e, size: 1.2, fluff: 0.6, legs: 1.5, long: 1.2, ears: "flop", snout: 1.5 },
  { name: "French Bulldog", coat: 0x8f939c, accent: 0xff7aa8, size: 0.85, fluff: 0, legs: 0.7, long: 1, ears: "bat", snout: 0.4 },
  { name: "Dachshund", coat: 0x7a4a2a, accent: 0xd9a548, size: 0.85, fluff: 0, legs: 0.45, long: 1.8, ears: "flop", snout: 1.3 },
  { name: "Shiba Inu", coat: 0xd9893c, accent: 0xfff2e0, size: 0.95, fluff: 0.3, legs: 0.9, long: 1, ears: "point", snout: 0.9 },
  { name: "Maltese", coat: 0xffffff, accent: 0x9ad3ff, size: 0.7, fluff: 1.2, legs: 0.6, long: 0.95, ears: "flop", snout: 0.6 },
  { name: "Samoyed", coat: 0xfbf8f2, accent: 0x3a3346, size: 1.15, fluff: 1.3, legs: 1, long: 1.1, ears: "point", snout: 0.9 },
  { name: "Cavalier", coat: 0xb4552a, accent: 0xffffff, size: 0.85, fluff: 0.5, legs: 0.8, long: 1, ears: "flop", snout: 0.7 },
  { name: "Chihuahua", coat: 0xe7c08f, accent: 0xff6fa0, size: 0.6, fluff: 0, legs: 0.8, long: 0.85, ears: "bat", snout: 0.5 },
  { name: "Golden Doodle", coat: 0xf2c27a, accent: 0x7cc7a4, size: 1.1, fluff: 1.1, legs: 1.1, long: 1.05, ears: "flop", snout: 1 },
];
const DOG_SPOTS: { floor: number; x: number; z: number }[] = [
  { floor: 0, x: 6.5, z: -4.2 }, // behind the parcels
  { floor: 0, x: 12.5, z: -1.0 },
  { floor: 0, x: 26, z: -4.2 }, // under the concierge desk's plant
  { floor: 0, x: 37, z: -1.0 },
  { floor: 1, x: 1.2, z: -1.0 }, // in a laundry basket
  { floor: 1, x: 7.6, z: -4.2 },
  { floor: 1, x: 12, z: -1.0 }, // on a treadmill
  { floor: 1, x: 25.8, z: -1.0 },
  { floor: 2, x: 2, z: -1.2 },
  { floor: 2, x: 10.5, z: -4.1 }, // on a pool float (edge)
  { floor: 2, x: 21, z: -4.2 },
  { floor: 2, x: 37, z: -4.0 },
];
const SPA = { floor: 1, x0: 30.4, x1: 38 };

// ------------------------------------------------------------------ helpers
function skylineTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 512;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, "#2a2350");
  sky.addColorStop(0.45, "#7a4f86");
  sky.addColorStop(0.75, "#e88f7a");
  sky.addColorStop(1, "#ffcf98");
  g.fillStyle = sky;
  g.fillRect(0, 0, 2048, 512);
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const w = 40 + r() * 90, h = 120 + r() * 360, x = r() * 2048;
    g.fillStyle = `rgba(${40 + r() * 20}, ${30 + r() * 15}, ${70 + r() * 25}, 0.96)`;
    g.fillRect(x, 512 - h, w, h);
    for (let wy = 512 - h + 10; wy < 500; wy += 14)
      for (let wx = x + 6; wx < x + w - 6; wx += 11) if (r() < 0.35) {
        g.fillStyle = r() < 0.8 ? "rgba(255, 214, 150, 0.9)" : "rgba(180, 220, 255, 0.8)";
        g.fillRect(wx, wy, 5, 7);
      }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function labelTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = fg;
  let size = 54;
  g.font = `600 ${size}px Georgia, serif`;
  while (size > 18 && g.measureText(text).width > 480) {
    size -= 2;
    g.font = `600 ${size}px Georgia, serif`;
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const mats = new Map<string, THREE.MeshLambertMaterial>();
function lam(color: string | number, emissive = 0): THREE.MeshLambertMaterial {
  const key = `${color}|${emissive}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive });
    mats.set(key, m);
  }
  return m;
}

type Box = { floor: number; x0: number; x1: number; z0: number; z1: number };

export async function createCenturyParkEast(container: HTMLElement, castBase: string, callbacks: CpeCallbacks = {}): Promise<CpeHandle> {
  const disposers: (() => void)[] = [];
  let disposed = false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.domElement.setAttribute("data-testid", "century-park-east-canvas");
  renderer.domElement.style.touchAction = "none";
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
  disposers.push(() => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.domElement.remove();
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1d1830");
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);

  // ---------------------------------------------------------------- loading
  const loader = new GLTFLoader();
  const progress = new Map<string, number>();
  const load = (file: string) =>
    loader.loadAsync(castBase + file, e => {
      if (e.total) progress.set(file, e.loaded / e.total);
      callbacks.onProgress?.([...progress.values()].reduce((a, b) => a + b, 0) / 7);
    });
  const [heroG, baseA, baseB, baseC, baseD, conciergeG, animsG] = await Promise.all([
    load("heroine.glb"),
    load("influencer_a.glb"),
    load("influencer_b.glb"),
    load("influencer_c.glb"),
    load("barista.glb"),
    load("sterling.glb"),
    load("anims.glb"),
  ]);
  if (disposed) throw new Error("disposed");
  const bases = [baseA, baseB, baseC, baseD];
  const clips = animsG.animations;

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0xfff0dc, 0x4a3a58, 1.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0dc, 1.6);
  key.position.set(-8, 30, 30);
  scene.add(key);
  const roomLights: THREE.PointLight[] = [];
  for (let i = 0; i < (softwareGl ? 2 : 5); i++) {
    const l = new THREE.PointLight(0xffc27a, 9, 11, 1.6);
    scene.add(l);
    roomLights.push(l);
  }

  // ---------------------------------------------------------------- the building
  const world = new THREE.Group();
  scene.add(world);
  const solids: Box[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: THREE.Material, parent: THREE.Object3D = world) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    parent.add(m);
    return m;
  };
  const solid = (floor: number, x0: number, x1: number, z0: number, z1: number) => solids.push({ floor, x0, x1, z0, z1 });

  const skyTex = skylineTexture();
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(260, 65), new THREE.MeshBasicMaterial({ map: skyTex, fog: false }));
  sky.position.set(WIDTH / 2, 12, -60);
  scene.add(sky);
  // the street and the sidewalk in front of the building
  box(-30, 70, -1.2, -0.3, 0.3, 14, lam("#3a3346"));
  box(-120, 160, -40, -1.2, -70, 14, new THREE.MeshBasicMaterial({ color: 0x141022 }));
  box(-30, 70, -0.3, -0.12, 0.3, 3.2, lam("#8f8a9c"));

  const lamps: { mesh: THREE.Mesh; floor: number; x: number; base: number; phase: number }[] = [];
  const windows: THREE.Mesh[] = [];
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x6a5f9a, transparent: true, opacity: 0.25 });
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xffe2b0, emissive: 0xffc27a, emissiveIntensity: 2.4 });
  const emergencyMat = new THREE.MeshLambertMaterial({ color: 0xff3b3b, emissive: 0xff2020, emissiveIntensity: 2.2 });
  const emergency: THREE.Mesh[] = [];
  const shell = lam("#4b4258");
  const band = lam("#3a3346");

  FLOORS.forEach((fl, f) => {
    const y = fy(f);
    // slab under the floor, and the facade frame down each side
    box(-0.6, WIDTH + 0.6, y - 0.42, y, -DEPTH - 0.4, 0.35, band);
    box(-0.9, 0, y, y + FLOOR_H - 0.42, -DEPTH - 0.4, 0.35, shell);
    box(WIDTH, WIDTH + 0.9, y, y + FLOOR_H - 0.42, -DEPTH - 0.4, 0.35, shell);
    solid(f, -5, 0.25, -10, 10);
    solid(f, WIDTH - 0.25, WIDTH + 5, -10, 10);
    for (const r of fl.rooms) {
      box(r.x0, r.x1, y, y + 0.04, -DEPTH, 0.3, lam(r.floor));
      if (!r.open) {
        // back wall with a band of windows onto the dusk
        box(r.x0, r.x1, y, y + WALL_H, -DEPTH - 0.25, -DEPTH, lam(r.wall));
        const ww = r.x1 - r.x0;
        const n = Math.max(1, Math.floor(ww / 3.2));
        for (let i = 0; i < n; i++) {
          if (r.name === "Elevator") break;
          const cx = r.x0 + (ww * (i + 0.5)) / n;
          const view = skyTex.clone();
          view.repeat.set(0.07, 0.62);
          view.offset.set(((cx + f * 9) / 60) % 0.93, 0.36);
          view.needsUpdate = true;
          const win = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(2.2, ww / n - 0.6), 1.7), new THREE.MeshBasicMaterial({ map: view, color: 0xffffff }));
          win.position.set(cx, y + 1.95, -DEPTH + 0.02);
          world.add(win);
          windows.push(win);
        }
        // ceiling lamp
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 0.18, 14), lampMat.clone());
        lamp.position.set((r.x0 + r.x1) / 2, y + WALL_H - 0.12, -2.4);
        world.add(lamp);
        lamps.push({ mesh: lamp, floor: f, x: (r.x0 + r.x1) / 2, base: 2.4, phase: Math.random() * 10 });
        // the emergency strip that only shows on zombie night
        const strip = new THREE.Mesh(new THREE.BoxGeometry(r.x1 - r.x0 - 0.4, 0.06, 0.06), emergencyMat);
        strip.position.set((r.x0 + r.x1) / 2, y + WALL_H - 0.05, -DEPTH + 0.1);
        world.add(strip);
        emergency.push(strip);
      } else {
        // roof: a glass balustrade at the back and a string of bulbs
        const rail = new THREE.Mesh(new THREE.BoxGeometry(r.x1 - r.x0, 1.1, 0.06), glassMat);
        rail.position.set((r.x0 + r.x1) / 2, y + 0.55, -DEPTH);
        world.add(rail);
        for (let x = r.x0 + 0.8; x < r.x1; x += 1.4) {
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), lampMat.clone());
          bulb.position.set(x, y + 3.0 + Math.sin(x * 0.9) * 0.15, -3.8);
          world.add(bulb);
          lamps.push({ mesh: bulb, floor: f, x, base: 2.0, phase: Math.random() * 10 });
        }
      }
      // partition at the room's right edge, with a doorway (the elevator has sliding doors instead)
      if (r.x1 < WIDTH) {
        const wallMat = lam(r.wall);
        box(r.x1 - 0.12, r.x1 + 0.12, y, y + WALL_H, -DEPTH, DOOR_Z0, wallMat);
        box(r.x1 - 0.12, r.x1 + 0.12, y, y + WALL_H, DOOR_Z1, -0.2, wallMat);
        box(r.x1 - 0.12, r.x1 + 0.12, y + 2.6, y + WALL_H, DOOR_Z0, DOOR_Z1, wallMat);
        solid(f, r.x1 - 0.15, r.x1 + 0.15, -DEPTH - 1, DOOR_Z0);
        solid(f, r.x1 - 0.15, r.x1 + 0.15, DOOR_Z1, 2);
      }
    }
    // elevator car: brushed doors and a floor indicator
    box(ELEV_X0 + 0.3, ELEV_X1 - 0.3, y, y + 2.7, -DEPTH + 0.05, -DEPTH + 0.3, lam("#c9c4cf"));
    const ind = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({ map: labelTexture(["G", "A", "R"][f], "#1b1626", "#ffcf7a") }));
    ind.position.set((ELEV_X0 + ELEV_X1) / 2, y + 2.95, -DEPTH + 0.32);
    world.add(ind);
  });
  // the building's name over the lobby
  const nameplate = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.8), new THREE.MeshBasicMaterial({ map: labelTexture("CENTURY PARK EAST", "#2b2238", "#ffcf7a") }));
  nameplate.position.set(21, 3.05, -DEPTH + 0.03);
  world.add(nameplate);

  // ---------------------------------------------------------------- furniture (scenery with colliders where it matters)
  const furn = (f: number, x0: number, x1: number, h: number, z0: number, z1: number, color: string, collide = true) => {
    const m = box(x0, x1, fy(f), fy(f) + h, z0, z1, lam(color));
    if (collide) solid(f, x0, x1, z0, z1);
    return m;
  };
  // ground floor
  for (let i = 0; i < 5; i++) furn(0, 0.6 + i * 1.2, 1.5 + i * 1.2, 0.6 + (i % 3) * 0.35, -4.9, -4.1, ["#c69a6b", "#a97e55", "#d8b384"][i % 3], false); // parcel stacks
  furn(0, 2.4, 7.2, 0.9, -4.9, -4.2, "#7a5a3e");
  furn(0, 8.4, 14.6, 2.2, -4.9, -4.5, "#a79f8c"); // mailbox wall
  furn(0, 19.5, 24.5, 1.05, -3.9, -3.0, "#8a5a36"); // the concierge desk
  box(19.4, 24.6, 1.05, 1.12, -3.95, -2.95, new THREE.MeshLambertMaterial({ color: 0xd9a548, emissive: 0x6a4a10, emissiveIntensity: 0.4 }));
  furn(0, 30.6, 33.2, 0.75, -4.6, -3.4, "#d98f6b"); // sofa
  furn(0, 34.4, 37.4, 0.75, -4.6, -3.4, "#d98f6b");
  furn(0, 32.6, 34.6, 0.45, -2.6, -1.6, "#3e3550"); // coffee table
  // the barricade in the mailroom (zombie night): boxes piled at the mailroom door
  const barricade = new THREE.Group();
  for (let i = 0; i < 9; i++) box(9 + (i % 3) * 0.9, 9.85 + (i % 3) * 0.9, Math.floor(i / 3) * 0.7, 0.68 + Math.floor(i / 3) * 0.7, -2.6 + (i % 2) * 0.3, -1.6 + (i % 2) * 0.3, lam(["#c69a6b", "#a97e55", "#d8b384"][i % 3]), barricade);
  world.add(barricade);
  // amenity floor
  for (let i = 0; i < 4; i++) {
    furn(1, 0.6 + i * 1.6, 1.9 + i * 1.6, 1.1, -4.9, -4.0, "#e8edf2"); // washers
    const drum = new THREE.Mesh(new THREE.CircleGeometry(0.38, 20), new THREE.MeshLambertMaterial({ color: 0x5d7f9a, emissive: 0x29425a, emissiveIntensity: 0.6 }));
    drum.position.set(1.25 + i * 1.6, fy(1) + 0.6, -3.99);
    world.add(drum);
  }
  furn(1, 10.2, 12.4, 0.5, -4.6, -3.6, "#2b2f36"); // treadmills
  furn(1, 13.2, 15.4, 0.5, -4.6, -3.6, "#2b2f36");
  furn(1, 16.2, 17.6, 1.4, -4.9, -4.3, "#5a5f6a"); // weight rack
  for (let x = 31; x < 37.5; x += 2.2) furn(1, x, x + 1.6, 0.35, -4.6, -3.6, "#9ad3e8", false); // grooming tubs
  // roof: the pool, loungers and a cabana
  const pool = new THREE.Mesh(new THREE.BoxGeometry(12, 0.08, 2.6), new THREE.MeshLambertMaterial({ color: 0x48c6e8, emissive: 0x1a7fa8, emissiveIntensity: 0.55 }));
  pool.position.set(12, fy(2) + 0.06, -3.3);
  world.add(pool);
  solid(2, 6, 18, -4.6, -2.0);
  for (let x = 2; x < 6; x += 1.6) furn(2, x, x + 0.8, 0.35, -4.6, -3.0, "#f4efe6", false);
  furn(2, 30.6, 33.6, 0.75, -4.6, -3.4, "#7cc7a4");
  furn(2, 34.6, 37.4, 1.0, -4.8, -4.0, "#2b2f36"); // the bar

  // closets: a cupboard against the back wall with a door that swings, and a broom leaning beside it
  const closets = CLOSETS.map(c => {
    const y = fy(c.floor);
    const g = new THREE.Group();
    world.add(g);
    box(c.x - CLOSET_HW - 0.12, c.x - CLOSET_HW, y, y + 2.6, -DEPTH, CLOSET_Z, lam("#efe4d2"), g);
    box(c.x + CLOSET_HW, c.x + CLOSET_HW + 0.12, y, y + 2.6, -DEPTH, CLOSET_Z, lam("#efe4d2"), g);
    box(c.x - CLOSET_HW - 0.12, c.x + CLOSET_HW + 0.12, y + 2.6, y + 2.75, -DEPTH, CLOSET_Z, lam("#efe4d2"), g);
    solid(c.floor, c.x - CLOSET_HW - 0.14, c.x - CLOSET_HW + 0.02, -DEPTH - 1, CLOSET_Z);
    solid(c.floor, c.x + CLOSET_HW - 0.02, c.x + CLOSET_HW + 0.14, -DEPTH - 1, CLOSET_Z);
    const hinge = new THREE.Group();
    hinge.position.set(c.x - CLOSET_HW, y, CLOSET_Z);
    const door = box(0, CLOSET_HW * 2, 0, 2.55, -0.06, 0, lam("#b07a4a"), hinge);
    door.position.x = CLOSET_HW;
    hinge.rotation.y = -1.9; // open
    g.add(hinge);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), new THREE.MeshBasicMaterial({ map: labelTexture("STORAGE", "#efe4d2", "#3a3346") }));
    sign.position.set(c.x, y + 2.95, CLOSET_Z + 0.02);
    g.add(sign);
    const broom = new THREE.Group();
    box(-0.025, 0.025, 0, 1.5, -0.025, 0.025, lam("#c99a5b"), broom);
    box(-0.16, 0.16, -0.05, 0.22, -0.06, 0.06, lam("#e2c46a"), broom);
    broom.position.set(c.x + CLOSET_HW + 0.35, y, CLOSET_Z + 0.25);
    broom.rotation.z = -0.25;
    g.add(broom);
    return { ...c, hinge, broom, locked: false, zombie: -1 as number, shake: 0 };
  });

  // the fire-station holes and their ropes
  const ropeMat = lam("#b88a52");
  const knotMat = lam("#8a6236");
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x120e1c });
  const rimMat = new THREE.MeshLambertMaterial({ color: 0xd9a548, emissive: 0x5a3c08, emissiveIntensity: 0.35 });
  const ropes = ROPES.map(r => {
    const top = fy(r.floor + 1);
    const g = new THREE.Group();
    const len = top - fy(r.floor) + 0.6;
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, len, 8), ropeMat);
    rope.position.y = len / 2;
    g.add(rope);
    for (let y = 0.5; y < len - 0.3; y += 0.55) {
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), knotMat);
      knot.position.y = y;
      g.add(knot);
    }
    g.position.set(r.x, fy(r.floor), r.z);
    world.add(g);
    // the hole: dark from below (ceiling) and from above (the floor), with a brass rim upstairs
    const under = new THREE.Mesh(new THREE.CircleGeometry(0.62, 28), holeMat);
    under.rotation.x = Math.PI / 2;
    under.position.set(r.x, top - 0.43, r.z);
    const above = new THREE.Mesh(new THREE.CircleGeometry(0.62, 28), holeMat);
    above.rotation.x = -Math.PI / 2;
    above.position.set(r.x, top + 0.05, r.z);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.05, 8, 32), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(r.x, top + 0.06, r.z);
    world.add(under, above, rim);
    return { ...r, g };
  });

  // extinguishers on the wall, the bike pump in the gym
  const extinguishers = EXTINGUISHERS.map(e => {
    const g = new THREE.Group();
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.55, 14), new THREE.MeshLambertMaterial({ color: 0xd8262e, emissive: 0x5a0000, emissiveIntensity: 0.5 }));
    can.position.y = 0.28;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.12, 10), lam("#2b2f36"));
    top.position.y = 0.61;
    g.add(can, top);
    g.position.set(e.x, fy(e.floor) + 1.0, -DEPTH + 0.25);
    world.add(g);
    return { ...e, g, taken: false };
  });
  const pump = (() => {
    const g = new THREE.Group();
    box(-0.04, 0.04, 0, 0.8, -0.04, 0.04, lam("#3d8bd9"), g);
    box(-0.2, 0.2, 0, 0.05, -0.08, 0.08, lam("#2b2f36"), g);
    box(-0.18, 0.18, 0.78, 0.84, -0.03, 0.03, lam("#2b2f36"), g);
    g.position.set(PUMP.x, fy(PUMP.floor), PUMP.z);
    world.add(g);
    return g;
  })();

  // ---------------------------------------------------------------- items for the errands
  function itemMesh(kind: ItemKind): THREE.Group {
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, emissive = 0) => {
      const m = new THREE.Mesh(geo, lam(color, emissive));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    switch (kind) {
      case "robot_vacuum":
        add(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 24), "#2b2f36", 0, 0.05);
        add(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10), "#56f0a0", 0, 0.11, 0.12, 1.5);
        break;
      case "garment_bag":
        add(new THREE.BoxGeometry(0.55, 0.95, 0.12), "#3e3550", 0, 0.6);
        add(new THREE.TorusGeometry(0.08, 0.015, 6, 12, Math.PI), "#c9c4cf", 0, 1.12);
        break;
      case "leash":
        add(new THREE.TorusGeometry(0.22, 0.03, 8, 20), "#ff6fa0", 0, 0.24);
        add(new THREE.SphereGeometry(0.06, 10, 8), "#ffd34a", 0.22, 0.24, 0, 0.8);
        break;
      case "suitcase":
        add(new THREE.BoxGeometry(0.5, 0.7, 0.25), "#e2c46a", 0, 0.4);
        add(new THREE.BoxGeometry(0.2, 0.05, 0.05), "#2b2f36", 0, 0.8);
        break;
      case "package":
        add(new THREE.BoxGeometry(0.5, 0.4, 0.4), "#c69a6b", 0, 0.2);
        add(new THREE.BoxGeometry(0.52, 0.06, 0.42), "#e9dcc3", 0, 0.3);
        break;
      case "yoga_mat":
        add(new THREE.CylinderGeometry(0.11, 0.11, 0.7, 16), "#7cc7a4", 0, 0.12).rotation.z = Math.PI / 2;
        break;
      case "cake":
        add(new THREE.CylinderGeometry(0.25, 0.25, 0.22, 20), "#fbe3ef", 0, 0.11);
        add(new THREE.CylinderGeometry(0.17, 0.17, 0.16, 20), "#ff9ec4", 0, 0.3);
        add(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6), "#ffe08a", 0, 0.44, 0, 2);
        break;
      case "spare_key":
        add(new THREE.TorusGeometry(0.08, 0.02, 8, 16), "#ffd34a", 0, 0.12, 0, 0.6);
        add(new THREE.BoxGeometry(0.2, 0.04, 0.02), "#ffd34a", 0.16, 0.12, 0, 0.6);
        break;
    }
    return g;
  }
  const items = ERRAND_SLOTS.map((s, i) => {
    const g = itemMesh(s.item);
    g.position.set(s.itemX, fy(s.itemFloor), s.itemZ);
    g.visible = false;
    world.add(g);
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 28), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8 }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(s.itemX, fy(s.itemFloor) + 0.03, s.itemZ);
    glow.visible = false;
    world.add(glow);
    return { slot: i, g, glow, held: false };
  });

  // ---------------------------------------------------------------- people
  type Person = { root: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; current: string; play(name: string, fade?: number, once?: boolean): void; tint(c: THREE.Color | null): void };
  function person(g: GLTF, clone: boolean): Person {
    const root = clone ? SkeletonUtils.clone(g.scene) : g.scene;
    const own: THREE.MeshStandardMaterial[] = [];
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.roughness = 0.8;
      m.material = mat;
      own.push(mat);
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
      tint(c) {
        for (const mat of own) mat.color.copy(c ?? new THREE.Color(1, 1, 1));
      },
    };
    world.add(root);
    return p;
  }
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
  const blob = (r = 0.42) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), shadowMat);
    m.rotation.x = -Math.PI / 2;
    world.add(m);
    return m;
  };

  // the manager (her), inside a group that can be squashed flat in world space for paper mode
  const paper = new THREE.Group();
  world.add(paper);
  const hero = person(heroG, false);
  paper.add(hero.root);
  const heroShadow = blob();
  const head = hero.root.getObjectByName("head");
  const handR = hero.root.getObjectByName("hand_r");
  hero.play("Idle_Loop");

  // the concierge (Sterling's suit): barricaded in the mailroom on zombie night, away on vacation on a cozy one
  const concierge = person(conciergeG, false);
  concierge.root.position.set(11.5, 0, -3.8);
  concierge.play("Idle_Talking_Loop");

  const needy = ERRAND_SLOTS.map((s, i) => {
    const p = person(bases[[0, 1, 3][i % 3]], true);
    p.root.position.set(s.x, fy(s.floor), s.z);
    p.root.rotation.y = 0.2;
    p.play("Idle_Loop");
    p.tint(new THREE.Color().setHSL((i * 0.13) % 1, 0.18, 0.92));
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: labelTexture("!", "#ffcf4a", "#3a2a10"), transparent: true }));
    mark.position.set(s.x, fy(s.floor) + 2.3, s.z);
    world.add(mark);
    blob().position.set(s.x, fy(s.floor) + 0.02, s.z);
    return { p, mark, phase: "locked" as ErrandPhase };
  });
  const quiet = QUIET_SLOTS.map((s, i) => {
    const p = person(bases[s.base], true);
    p.root.position.set(s.x, fy(s.floor), s.z);
    p.root.rotation.y = s.anim === "Jog_Fwd_Loop" ? Math.PI / 2 : (i % 2 ? 0.4 : -0.4);
    p.play(s.anim);
    p.tint(new THREE.Color().setHSL((0.55 + i * 0.07) % 1, 0.12, 0.88));
    blob().position.set(s.x, fy(s.floor) + 0.02, s.z);
    return p;
  });

  type ZState = "wander" | "chase" | "dazed" | "lured" | "trapped" | "dance";
  const zombies = ZOMBIE_SPAWNS.map((s, i) => {
    const p = person(bases[s.base], true);
    p.root.position.set(s.x, fy(s.floor), s.z);
    p.play("Walk_Loop");
    const act = p.actions.get("Walk_Loop");
    if (act) act.timeScale = 0.55;
    const stars = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
      st.position.set(Math.cos((k / 3) * Math.PI * 2) * 0.3, 0, Math.sin((k / 3) * Math.PI * 2) * 0.3);
      stars.add(st);
    }
    stars.visible = false;
    world.add(stars);
    const shadow = blob(0.38);
    // zombie night: two glowing eyes; cozy night: a lavender sleep mask
    const face = new THREE.Group();
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xd8ff6a });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeMat);
      eye.position.set(sx * 0.045, 0, 0.1);
      eye.name = "eye";
      face.add(eye);
    }
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), new THREE.MeshLambertMaterial({ color: 0xb48ad8 }));
    mask.position.set(0, 0, 0.09);
    mask.name = "mask";
    face.add(mask);
    world.add(face);
    return {
      face,
      headBone: p.root.getObjectByName("head"),
      p,
      spawn: s,
      floor: s.floor,
      pos: new THREE.Vector3(s.x, fy(s.floor), s.z),
      dir: i % 2 ? 1 : -1,
      state: "wander" as ZState,
      t: 0,
      sprayed: false,
      stars,
      shadow,
      phase: Math.random() * 6,
      upL: p.root.getObjectByName("upperarm_l"),
      upR: p.root.getObjectByName("upperarm_r"),
      spine: p.root.getObjectByName("spine_02"),
    };
  });

  // ---------------------------------------------------------------- dogs
  function makeDog(b: Breed) {
    const coat = lam(b.coat);
    const accent = lam(b.accent);
    const dark = lam("#2b211c");
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const s = 0.16 * b.size;
    const torso = new THREE.Mesh(new THREE.SphereGeometry(s, 16, 12), coat);
    torso.scale.set(0.95, 0.85, 1.3 * b.long);
    torso.position.y = s * 0.9 + 0.12 * b.legs;
    body.add(torso);
    const headG = new THREE.Group();
    headG.position.set(0, torso.position.y + s * 0.75, s * 1.15 * b.long);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(s * 0.75, 16, 12), coat);
    const snout = new THREE.Mesh(new THREE.SphereGeometry(s * 0.35, 12, 10), b.fluff > 1 ? coat : coat);
    snout.scale.set(1, 0.85, 1 + b.snout * 0.6);
    snout.position.set(0, -s * 0.15, s * 0.6);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(s * 0.12, 8, 6), dark);
    nose.position.set(0, -s * 0.08, s * (0.85 + b.snout * 0.22));
    headG.add(skull, snout, nose);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(s * 0.11, 8, 6), dark);
      eye.position.set(sx * s * 0.3, s * 0.12, s * 0.62);
      headG.add(eye);
      const ear = new THREE.Mesh(new THREE.SphereGeometry(s * 0.32, 10, 8), b.ears === "flop" && b.name !== "Poodle" ? accent.color.getHex() === 0xffffff ? coat : coat : coat);
      if (b.ears === "flop") {
        ear.scale.set(0.5, 1.2, 0.6);
        ear.position.set(sx * s * 0.7, -s * 0.15, 0);
      } else if (b.ears === "bat") {
        ear.scale.set(0.55, 1.1, 0.25);
        ear.position.set(sx * s * 0.45, s * 0.75, -s * 0.05);
      } else {
        ear.scale.set(0.45, 0.9, 0.25);
        ear.position.set(sx * s * 0.4, s * 0.7, 0);
        ear.rotation.z = sx * -0.25;
      }
      headG.add(ear);
    }
    if (b.fluff > 0) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(s * 0.55 * b.fluff, 12, 10), coat);
      tuft.position.set(0, s * 0.6, -s * 0.05);
      headG.add(tuft);
      const ruff = new THREE.Mesh(new THREE.SphereGeometry(s * 0.7 * b.fluff, 12, 10), coat);
      ruff.position.set(0, torso.position.y + s * 0.3, s * 0.7 * b.long);
      body.add(ruff);
    }
    body.add(headG);
    // the expensive part: a collar with a little jewel, or a bow
    const collar = new THREE.Mesh(new THREE.TorusGeometry(s * 0.55, s * 0.09, 6, 16), accent);
    collar.position.set(0, torso.position.y + s * 0.55, s * 0.95 * b.long);
    collar.rotation.x = Math.PI / 2.3;
    body.add(collar);
    const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(s * 0.12), new THREE.MeshLambertMaterial({ color: 0xbfe8ff, emissive: 0x6fb8ff, emissiveIntensity: 1.2 }));
    jewel.position.set(0, torso.position.y + s * 0.15, s * 1.35 * b.long);
    body.add(jewel);
    const legs: THREE.Mesh[] = [];
    for (const [lx, lz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.2, s * 0.17, 0.12 * b.legs + s * 0.5, 8), coat);
      leg.geometry.translate(0, -(0.12 * b.legs + s * 0.5) / 2, 0);
      leg.position.set(lx * s * 0.5, torso.position.y, lz * s * 0.8 * b.long);
      body.add(leg);
      legs.push(leg);
      if (b.name === "Poodle") {
        const pom = new THREE.Mesh(new THREE.SphereGeometry(s * 0.3, 10, 8), coat);
        pom.position.set(lx * s * 0.5, 0.05, lz * s * 0.8 * b.long);
        body.add(pom);
      }
    }
    const tail = new THREE.Mesh(b.fluff > 0.9 ? new THREE.SphereGeometry(s * 0.45, 10, 8) : new THREE.CylinderGeometry(s * 0.1, s * 0.06, s * 1.1, 8), coat);
    tail.position.set(0, torso.position.y + s * 0.5, -s * 1.3 * b.long);
    tail.rotation.x = -0.8;
    body.add(tail);
    const height = torso.position.y + s * 1.6;
    return { root, body, headG, legs, tail, height };
  }
  const dogs = BREEDS.map((b, i) => {
    const d = makeDog(b);
    const spot = DOG_SPOTS[i];
    d.root.position.set(spot.x, fy(spot.floor), spot.z);
    d.root.rotation.y = i % 2 ? 0.6 : -0.6;
    world.add(d.root);
    return { ...d, breed: b, floor: spot.floor, home: spot, state: "hiding" as "hiding" | "carried" | "saved" | "fleeing", vel: new THREE.Vector3(), phase: Math.random() * 6, target: new THREE.Vector3(), stackIndex: -1 };
  });
  let carriedDogs: number[] = [];
  let savedDogs = 0;
  const spaBeds = Array.from({ length: BREEDS.length }, (_, i) => new THREE.Vector3(30.9 + (i % 6) * 1.15, fy(SPA.floor), -1.0 - Math.floor(i / 6) * 0.9));
  const reportDogs = () => callbacks.onDogs?.({ carried: carriedDogs.length, saved: savedDogs, total: dogs.length });
  reportDogs();

  // ---------------------------------------------------------------- particles: foam/mist, confetti
  const PCOUNT = 260;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(PCOUNT * 3);
  const pVel = new Float32Array(PCOUNT * 3);
  const pLife = new Float32Array(PCOUNT);
  const pCol = new Float32Array(PCOUNT * 3);
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  world.add(points);
  let pNext = 0;
  function emit(at: THREE.Vector3, v: THREE.Vector3, spread: number, color: THREE.Color, life = 1.2) {
    const i = pNext++ % PCOUNT;
    pPos[i * 3] = at.x; pPos[i * 3 + 1] = at.y; pPos[i * 3 + 2] = at.z;
    pVel[i * 3] = v.x + (Math.random() - 0.5) * spread;
    pVel[i * 3 + 1] = v.y + (Math.random() - 0.5) * spread;
    pVel[i * 3 + 2] = v.z + (Math.random() - 0.5) * spread;
    pCol[i * 3] = color.r; pCol[i * 3 + 1] = color.g; pCol[i * 3 + 2] = color.b;
    pLife[i] = life;
  }

  // ---------------------------------------------------------------- state
  let vibe: Vibe = "cozy";
  let paused = false;
  let floor = 0;
  const pos = new THREE.Vector3(18.2, 0, -1.4);
  let vy = 0;
  let facing = 1; // +x
  let heading = Math.PI / 2;
  let bites = 0;
  let invuln = 4; // a grace period on arrival (no blinking: she's just walked in)
  let blink = 0;
  let flat = 0; // 0 = 3D, 1 = paper
  let flatTarget = 0;
  let flip = 1;
  let charges = 3; // she arrives with a few sprays; the wall extinguishers refill
  // on a rope: which one, and how far up (metres above its floor)
  let climb: { rope: number; h: number } | null = null;
  let sprintHeld = false;
  let ridingUntil = 0;
  let finaleAt = 0;
  let calmUntil = 0;
  // nobody chases her until she's started playing (or has stood in the lobby reading for half a minute)
  let armedAt = performance.now() + 30_000;
  const keys = new Set<string>();
  const stick = { x: 0, y: 0 };
  const errandPhase: ErrandPhase[] = ERRAND_SLOTS.map(() => "locked");

  function applyVibe() {
    const zombieNight = vibe === "zombie";
    const green = new THREE.Color("#86c06e");
    const lavender = new THREE.Color("#e3cdf5");
    for (const z of zombies) z.p.tint(zombieNight ? green : lavender);
    for (const s of emergency) s.visible = zombieNight;
    barricade.visible = zombieNight;
    concierge.root.visible = zombieNight;
    hemi.intensity = zombieNight ? 1.25 : 1.9;
    hemi.color.set(zombieNight ? 0xcfe0ff : 0xfff0dc);
    scene.background = new THREE.Color(zombieNight ? "#141022" : "#1d1830");
    pMat.size = 0.16;
  }
  applyVibe();

  // ---------------------------------------------------------------- input
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("input, textarea, [contenteditable]")) return;
    keys.add(e.code);
    if (e.code === "KeyE" || e.code === "Enter") interact();
    if (climb && !e.repeat && (e.code === "KeyW" || e.code === "ArrowUp")) climbPress();
    if (e.code === "KeyF") spray();
    if (e.code === "Space") {
      e.preventDefault();
      jump();
    }
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
  // touch: a floating stick anywhere on the screen
  const stickEl = document.createElement("div");
  stickEl.className = "cpe-stick";
  const knob = document.createElement("div");
  stickEl.appendChild(knob);
  container.appendChild(stickEl);
  let stickId: number | null = null;
  const origin = { x: 0, y: 0 };
  const el = renderer.domElement;
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    stickId = e.pointerId;
    origin.x = e.clientX;
    origin.y = e.clientY;
    const r = container.getBoundingClientRect();
    stickEl.style.left = `${e.clientX - r.left}px`;
    stickEl.style.top = `${e.clientY - r.top}px`;
    stickEl.classList.add("is-on");
    el.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    const dx = e.clientX - origin.x, dy = e.clientY - origin.y;
    const d = Math.hypot(dx, dy), max = 56, k = d > max ? max / d : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const mag = Math.min(1, d / max);
    stick.x = d ? (dx / d) * mag : 0;
    stick.y = d ? (-dy / d) * mag : 0;
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    stick.x = stick.y = 0;
    knob.style.transform = "";
    stickEl.classList.remove("is-on");
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
    stickEl.remove();
  });

  // ---------------------------------------------------------------- collisions
  function blocked(f: number, x: number, z: number, r = 0.3): boolean {
    if (z > -0.35 || z < -DEPTH + 0.35) return true;
    for (const b of solids) if (b.floor === f && x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) return true;
    for (const c of closets) if (c.floor === f && c.locked && Math.abs(x - c.x) < CLOSET_HW + r && z < CLOSET_Z + r) return true;
    return false;
  }
  function moveTo(p: THREE.Vector3, f: number, nx: number, nz: number, r = 0.3) {
    if (!blocked(f, nx, p.z, r)) p.x = nx;
    if (!blocked(f, p.x, nz, r)) p.z = nz;
  }

  // ---------------------------------------------------------------- prompts and interaction
  let prompt: { id: PromptId; label: string; act: () => void } | null = null;
  let promptKey = "";
  function setPrompt(next: typeof prompt) {
    const k = next ? `${next.id}|${next.label}` : "";
    prompt = next;
    if (k === promptKey) return;
    promptKey = k;
    callbacks.onPrompt?.(next ? { id: next.id, label: next.label } : null);
  }
  const near = (f: number, x: number, z: number, d: number) => f === floor && Math.hypot(pos.x - x, pos.z - z) < d;
  function findPrompt(): typeof prompt {
    if (performance.now() < ridingUntil || finaleAt) return null;
    if (climb) return { id: "climb", label: "Climb! Keep tapping", act: () => climbPress() };
    // the ropes come first, so a neighbour standing nearby never hides the way up or down
    for (let i = 0; i < ropes.length; i++) {
      const r = ropes[i];
      if (near(r.floor, r.x, r.z, 1.15)) return { id: "rope_up", label: `Climb the rope to the ${FLOORS[r.floor + 1].name.toLowerCase()}`, act: () => startClimb(i) };
      if (near(r.floor + 1, r.x, r.z, 1.15)) return { id: "rope_down", label: `Slide down to the ${FLOORS[r.floor].name.toLowerCase()}`, act: () => slideDown(i) };
    }
    // the errand that's open: talk to its giver, pick up its item
    for (let i = 0; i < ERRAND_SLOTS.length; i++) {
      const s = ERRAND_SLOTS[i];
      const ph = errandPhase[i];
      if ((ph === "need" || ph === "carrying" || ph === "waiting") && near(s.floor, s.x, s.z, 1.7))
        return { id: "talk", label: ph === "carrying" ? "Hand it over" : "Talk", act: () => callbacks.onInteract?.({ kind: "talk", slot: i }) };
      if (ph === "locked" && near(s.floor, s.x, s.z, 1.4)) return { id: "talk", label: "Talk", act: () => callbacks.onInteract?.({ kind: "talk", slot: i }) };
      if (ph === "need" && !items[i].held && near(s.itemFloor, s.itemX, s.itemZ, 1.3))
        return { id: "item", label: "Pick it up", act: () => pickUpItem(i) };
    }
    for (const c of closets) {
      if (c.locked || c.floor !== floor) continue;
      const lured = zombies.findIndex(z => z.floor === c.floor && (z.state === "lured" || z.state === "dazed") && Math.abs(z.pos.x - c.x) < CLOSET_HW - 0.15 && z.pos.z < CLOSET_Z - 0.2);
      if (lured >= 0 && near(c.floor, c.x, CLOSET_Z + 0.9, 2.6))
        return { id: "closet", label: vibe === "zombie" ? "Lock it with the broom" : "Tuck them in (broom the door)", act: () => lockCloset(c, lured) };
    }
    for (const e of extinguishers) if (!e.taken && near(e.floor, e.x, -DEPTH + 0.6, 1.5))
      return { id: "extinguisher", label: vibe === "zombie" ? "Grab the extinguisher" : "Grab the lavender mist", act: () => takeExtinguisher(e) };
    if (flat > 0.5 && near(PUMP.floor, PUMP.x, PUMP.z, 1.5)) return { id: "pump", label: "Pump yourself back up", act: () => reinflate() };
    if (pos.x > ELEV_X0 + 0.3 && pos.x < ELEV_X1 - 0.3) {
      const next = (floor + 1) % FLOORS.length;
      return { id: "elevator", label: `Elevator to the ${FLOORS[next].name.toLowerCase()}`, act: () => ride(next) };
    }
    for (let i = 0; i < QUIET_SLOTS.length; i++) {
      const s = QUIET_SLOTS[i];
      if (near(s.floor, s.x, s.z, 1.5)) return { id: "quiet", label: "Say hi", act: () => callbacks.onInteract?.({ kind: "quiet", index: i }) };
    }
    if (vibe === "zombie" && near(0, 11.5, -3.6, 2.4)) return { id: "concierge", label: "Check on the concierge", act: () => callbacks.onInteract?.({ kind: "concierge" }) };
    return null;
  }
  function interact() {
    if (paused) return;
    if (climb) return climbPress();
    if (prompt) prompt.act();
  }
  function pickUpItem(i: number) {
    items[i].held = true;
    items[i].glow.visible = false;
    if (handR) {
      handR.add(items[i].g);
      items[i].g.position.set(0, -0.05, 0.08);
      items[i].g.scale.setScalar(0.85);
    }
    hero.play("PickUp_Table", 0.12, true);
    setTimeout(() => hero.current === "PickUp_Table" && hero.play("Idle_Loop"), 900);
    callbacks.onInteract?.({ kind: "pickup_item", slot: i });
  }
  function lockCloset(c: (typeof closets)[number], zi: number) {
    const z = zombies[zi];
    c.locked = true;
    c.zombie = zi;
    z.state = "trapped";
    z.pos.set(c.x, fy(c.floor), -DEPTH + 0.9);
    z.stars.visible = false;
    c.broom.position.set(c.x, fy(c.floor) + 1.2, CLOSET_Z + 0.12);
    c.broom.rotation.set(0, 0, Math.PI / 2);
    hero.play("Interact", 0.1, true);
    setTimeout(() => hero.current === "Interact" && hero.play("Idle_Loop"), 900);
    callbacks.onInteract?.({ kind: "lock_closet", trapped: closets.filter(k => k.locked).length });
  }
  function takeExtinguisher(e: (typeof extinguishers)[number]) {
    e.taken = true;
    e.g.visible = false;
    charges = Math.min(6, charges + 3);
    callbacks.onCharges?.(charges);
    callbacks.onInteract?.({ kind: "extinguisher", charges });
  }
  function reinflate() {
    flatTarget = 0;
    callbacks.onInteract?.({ kind: "pump" });
  }
  function startClimb(i: number) {
    const r = ropes[i];
    climb = { rope: i, h: 0.15 };
    armedAt = Math.min(armedAt, performance.now());
    pos.set(r.x, fy(r.floor) + 0.15, r.z + 0.18);
    vy = 0;
    heading = Math.PI; // facing the rope, back to us
    hero.play("ClimbUp_1m", 0.12);
    callbacks.onClimb?.(climb.h / FLOOR_H);
  }
  function climbPress() {
    if (!climb || paused) return;
    climb.h += CLIMB_PER_PRESS;
    const act = hero.actions.get("ClimbUp_1m");
    if (act) act.timeScale = 1.6;
  }
  function slideDown(i: number) {
    const r = ropes[i];
    // fire-station style: grab the rope and drop; gravity does the rest
    floor = r.floor;
    pos.set(r.x, fy(r.floor + 1), r.z + 0.18);
    vy = -1;
    hero.play("Jump_Loop", 0.1);
    for (const d of carriedDogs) dogs[d].floor = r.floor;
    callbacks.onFloor?.(r.floor);
  }
  function ride(next: number) {
    ridingUntil = performance.now() + 1400;
    floor = next;
    pos.set((ELEV_X0 + ELEV_X1) / 2, fy(next), -2.4);
    for (const i of carriedDogs) dogs[i].floor = next;
    callbacks.onFloor?.(next);
    callbacks.onInteract?.({ kind: "elevator", floor: next });
  }
  function spray() {
    if (paused || finaleAt || climb) return;
    if (charges <= 0) {
      callbacks.onInteract?.({ kind: "out_of_foam" });
      return;
    }
    charges -= 1;
    callbacks.onCharges?.(charges);
    const col = vibe === "zombie" ? new THREE.Color("#f4f7ff") : new THREE.Color("#d9b8ff");
    const from = new THREE.Vector3(pos.x + facing * 0.5, pos.y + 1.1, pos.z);
    for (let k = 0; k < 70; k++) emit(from, new THREE.Vector3(facing * (4 + Math.random() * 3), 0.6, 0), 1.6, col, 0.9);
    hero.play("Interact", 0.1, true);
    setTimeout(() => hero.current === "Interact" && hero.play("Idle_Loop"), 600);
    for (const z of zombies) {
      if (z.floor !== floor || z.state === "trapped") continue;
      const dx = z.pos.x - pos.x;
      if (Math.sign(dx) === facing && Math.abs(dx) < 4.2 && Math.abs(z.pos.z - pos.z) < 1.8) {
        z.state = "dazed";
        z.t = 2.2;
        z.sprayed = true;
      }
    }
  }
  function jump() {
    if (climb) return climbPress();
    if (paused || pos.y > fy(floor) + 0.02) return;
    vy = 4.6;
  }
  function bite(z: (typeof zombies)[number]) {
    if (climb) {
      // grabbed by the ankle: she lets go of the rope
      climb = null;
      callbacks.onClimb?.(null);
      callbacks.onInteract?.({ kind: "rope_fell" });
    }
    bites += 1;
    invuln = 5;
    blink = 2.4;
    // knocked back, and every dog on her shoulders bolts
    const away = Math.sign(pos.x - z.pos.x) || 1;
    moveTo(pos, floor, pos.x + away * 1.4, pos.z, 0.3);
    vy = 3;
    hero.play("Hit_Knockback", 0.08, true);
    setTimeout(() => hero.current === "Hit_Knockback" && hero.play("Idle_Loop"), 700);
    for (const i of carriedDogs) {
      const d = dogs[i];
      d.state = "fleeing";
      d.floor = floor;
      d.root.position.set(pos.x, pos.y + 1.8, pos.z);
      d.vel.set((Math.random() - 0.5) * 6, 4 + Math.random() * 2, (Math.random() - 0.5) * 2);
      d.target.set(THREE.MathUtils.clamp(pos.x + (Math.random() - 0.5) * 9, 1, WIDTH - 1), fy(floor), -1 - Math.random() * 3.4);
    }
    carriedDogs = [];
    reportDogs();
    if (bites === 1) flatTarget = 1;
    callbacks.onBite?.(bites);
  }

  // ---------------------------------------------------------------- post
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = softwareGl ? null : new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.45, 0.96);
  if (bloom) composer.addPass(bloom);
  composer.addPass(new OutputPass());
  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    if (softwareGl) {
      const pr = Math.min(1, Math.sqrt(400_000 / Math.max(1, w * h)));
      renderer.setPixelRatio(pr);
      composer.setPixelRatio(pr);
    }
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w < h ? 46 : 30;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  disposers.push(() => ro.disconnect());

  // ---------------------------------------------------------------- the loop
  const clock = new THREE.Clock();
  const camPos = new THREE.Vector3(pos.x, 4, 22);
  const camLook = new THREE.Vector3(pos.x, 1.6, -2.5);
  let elapsed = 0;
  let lastBubble = 0;
  function frame() {
    const dt = Math.min(0.05, clock.getDelta());
    elapsed += dt;
    const now = performance.now();
    const frozen = paused;

    // ---- her
    if (climb && !frozen) {
      const r = ropes[climb.rope];
      climb.h = Math.max(0.15, climb.h - CLIMB_SLIP * dt);
      const act = hero.actions.get("ClimbUp_1m");
      if (act) act.timeScale = Math.max(0.15, act.timeScale - dt * 2.5);
      if (keys.has("KeyS") || keys.has("ArrowDown")) {
        climb = null; // let go
        callbacks.onClimb?.(null);
      } else if (climb.h >= FLOOR_H - 0.35) {
        // up through the hole and onto the floor above
        floor = r.floor + 1;
        pos.set(r.x + 0.9, fy(floor), r.z);
        climb = null;
        vy = 0;
        hero.play("Idle_Loop", 0.2);
        for (const d of carriedDogs) dogs[d].floor = floor;
        callbacks.onClimb?.(null);
        callbacks.onFloor?.(floor);
        callbacks.onInteract?.({ kind: "rope_top", floor });
      } else {
        pos.set(r.x + Math.sin(elapsed * 2.2) * 0.04, fy(r.floor) + climb.h, r.z + 0.18);
        heading = Math.PI;
        callbacks.onClimb?.(climb.h / FLOOR_H);
      }
    }
    if (!climb && !frozen && !finaleAt && now >= ridingUntil) {
      let ix = 0, iz = 0;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) ix -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) ix += 1;
      if (keys.has("KeyW") || keys.has("ArrowUp")) iz -= 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) iz += 1;
      ix += stick.x;
      iz -= stick.y;
      const mag = Math.min(1, Math.hypot(ix, iz));
      const sprint = sprintHeld || keys.has("ShiftLeft") || keys.has("ShiftRight");
      const speed = (sprint ? 5.4 : 3.1) * (flat > 0.5 ? 1.12 : 1); // paper is light
      if (mag > 0.05) {
        armedAt = Math.min(armedAt, now);
        const nx = pos.x + (ix / Math.max(1, Math.hypot(ix, iz))) * speed * dt;
        const nz = pos.z + (iz / Math.max(1, Math.hypot(ix, iz))) * speed * 0.8 * dt;
        moveTo(pos, floor, nx, nz);
        if (Math.abs(ix) > 0.15) {
          const nf = Math.sign(ix);
          if (nf !== facing) {
            facing = nf;
            flip = -1; // paper flips like a card
          }
        }
        const want = flat > 0.5 ? (facing > 0 ? Math.PI / 2 : -Math.PI / 2) : Math.atan2(ix, iz);
        let d = want - heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        heading += d * Math.min(1, dt * 12);
        if (!["PickUp_Table", "Interact", "Hit_Knockback"].includes(hero.current)) hero.play(sprint ? "Sprint_Loop" : "Walk_Loop", 0.15);
      } else if (["Walk_Loop", "Sprint_Loop", "Jog_Fwd_Loop"].includes(hero.current)) hero.play("Idle_Loop", 0.2);
    }
    // gravity (not while she's on a rope)
    if (!climb) {
      vy -= 12 * dt;
      pos.y += vy * dt;
      if (pos.y <= fy(floor)) {
        if (hero.current === "Jump_Loop") hero.play("Idle_Loop", 0.15);
        pos.y = fy(floor);
        vy = 0;
      }
    }
    invuln = Math.max(0, invuln - dt);
    blink = Math.max(0, blink - dt);
    flat += (flatTarget - flat) * Math.min(1, dt * 7);
    flip = Math.min(1, flip + dt * 9);
    paper.position.copy(pos);
    paper.scale.set(1, 1, THREE.MathUtils.lerp(1, 0.05, flat));
    paper.rotation.z = flat > 0.5 && ["Walk_Loop", "Sprint_Loop"].includes(hero.current) ? Math.sin(elapsed * 11) * 0.06 : 0;
    hero.root.position.set(0, 0, 0);
    hero.root.rotation.y = heading;
    hero.root.scale.set(flat > 0.5 ? Math.abs(flip) : 1, 1, 1);
    hero.root.visible = !(blink > 0 && Math.floor(elapsed * 14) % 2 === 0);
    heroShadow.position.set(pos.x, fy(floor) + 0.02, pos.z);
    heroShadow.scale.setScalar(THREE.MathUtils.lerp(1, 0.6, flat));
    hero.mixer.update(frozen ? 0 : dt);

    // ---- errand markers and items
    needy.forEach((n, i) => {
      const ph = errandPhase[i];
      n.mark.visible = ph === "need" || ph === "carrying" || ph === "waiting";
      n.mark.position.y = fy(ERRAND_SLOTS[i].floor) + 2.3 + Math.sin(elapsed * 3 + i) * 0.08;
      n.mark.lookAt(camera.position);
      n.p.mixer.update(dt);
      if (finaleAt) n.p.play("Dance_Loop");
      else n.p.play(ph === "done" ? "Yes" : ph === "need" || ph === "carrying" ? "Idle_Talking_Loop" : "Idle_Loop", 0.3, ph === "done");
      const it = items[i];
      if (!it.held) {
        it.g.visible = ph === "need";
        it.glow.visible = ph === "need";
        it.g.rotation.y += dt * 1.2;
        (it.glow.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(elapsed * 4) * 0.3;
      }
    });
    for (const q of quiet) {
      q.mixer.update(dt);
      if (finaleAt) q.play("Dance_Loop");
    }
    concierge.mixer.update(dt);

    // ---- zombies (or sleepwalkers)
    for (const z of zombies) {
      z.t -= dt;
      const sameFloor = z.floor === floor;
      const dx = pos.x - z.pos.x, dz = pos.z - z.pos.z;
      const dist = Math.hypot(dx, dz);
      if (finaleAt) {
        z.state = "dance";
        z.p.play("Dance_Loop");
      } else if (!frozen) {
        if (z.state === "wander") {
          const nx = z.pos.x + z.dir * 0.7 * dt;
          if (blocked(z.floor, nx, z.pos.z, 0.3) || (z.floor === SPA.floor && nx > SPA.x0 - 0.5) || nx < 1 || nx > WIDTH - 1) z.dir *= -1;
          else z.pos.x = nx;
          z.pos.z += Math.sin(elapsed * 0.7 + z.phase) * 0.25 * dt;
          z.pos.z = THREE.MathUtils.clamp(z.pos.z, -DEPTH + 0.6, -0.6);
          if (sameFloor && dist < 6 && now >= ridingUntil && now >= calmUntil && now >= armedAt && !(floor === SPA.floor && pos.x > SPA.x0)) z.state = "chase";
        } else if (z.state === "chase") {
          if (!sameFloor || dist > 9 || (floor === SPA.floor && pos.x > SPA.x0)) z.state = "wander";
          else if (dist > 0.05) {
            const sp = 1.65;
            const nx = z.pos.x + (dx / dist) * sp * dt, nz = z.pos.z + (dz / dist) * sp * dt;
            if (!(z.floor === SPA.floor && nx > SPA.x0 - 0.3)) moveTo(z.pos, z.floor, nx, nz, 0.3);
          }
          if (sameFloor && dist < 0.75 && invuln <= 0 && now >= ridingUntil && pos.y - fy(floor) < (climb ? 1.0 : 0.6)) {
            bite(z);
            // a satisfied chew: it stands there for a moment, which is your moment
            z.state = "dazed";
            z.t = 3;
          }
        } else if (z.state === "dazed") {
          if (z.t <= 0) {
            z.state = z.sprayed ? "lured" : "wander";
            z.t = 10;
            z.sprayed = false;
          }
        } else if (z.state === "lured") {
          // shuffles after her, harmless, stopping a step behind
          if (sameFloor && dist > 1.2) {
            const nx = z.pos.x + (dx / dist) * 1.25 * dt, nz = z.pos.z + (dz / dist) * 1.25 * dt;
            // closets are walls to everyone except a lured shuffler who walks into the open door
            if (!blocked(z.floor, nx, z.pos.z, 0.25) || closets.some(c => c.floor === z.floor && !c.locked && Math.abs(nx - c.x) < CLOSET_HW - 0.2)) z.pos.x = nx;
            const inClosetColumn = closets.some(c => c.floor === z.floor && !c.locked && Math.abs(z.pos.x - c.x) < CLOSET_HW - 0.2);
            if (inClosetColumn ? nz > -DEPTH + 0.4 : !blocked(z.floor, z.pos.x, nz, 0.25)) z.pos.z = nz;
          }
          // wander into the cupboard on its own when the door is right there
          const c = closets.find(k => k.floor === z.floor && !k.locked && Math.abs(z.pos.x - k.x) < CLOSET_HW - 0.2);
          if (c && z.pos.z < CLOSET_Z + 0.6) z.pos.z = Math.max(-DEPTH + 0.6, z.pos.z - 0.9 * dt);
          if (z.t <= 0) z.state = sameFloor ? "chase" : "wander";
        } else if (z.state === "trapped") {
          const c = closets.find(k => k.zombie === zombies.indexOf(z));
          if (c) {
            c.hinge.rotation.y = Math.sin(elapsed * 22) * 0.04 * (Math.sin(elapsed * 1.7 + z.phase) > 0.3 ? 1 : 0);
          }
        }
      }
      // pose: a slow shuffle with arms out (or a sleepwalker's drift)
      const moving = z.state === "wander" || z.state === "chase" || z.state === "lured";
      z.p.play(z.state === "dance" ? "Dance_Loop" : z.state === "dazed" ? "Idle_No_Loop" : moving ? "Walk_Loop" : "Idle_Loop", 0.3);
      const act = z.p.actions.get("Walk_Loop");
      if (act) act.timeScale = z.state === "chase" ? 0.85 : 0.5;
      z.p.root.position.copy(z.pos);
      const face = z.state === "wander" ? (z.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : Math.atan2(dx, dz);
      if (z.state !== "trapped" && z.state !== "dance") z.p.root.rotation.y += (face - z.p.root.rotation.y) * Math.min(1, dt * 4);
      z.p.root.visible = z.state !== "trapped" || (z.floor === floor && Math.sin(elapsed * 3 + z.phase) > 0.6);
      z.p.mixer.update(frozen ? 0 : dt);
      if (z.state !== "dance") {
        if (z.upL) z.upL.rotation.x -= 1.15;
        if (z.upR) z.upR.rotation.x -= 1.15;
        if (z.spine) z.spine.rotation.x += 0.22;
      }
      if (z.headBone) {
        z.headBone.getWorldPosition(z.face.position);
        z.face.position.y += 0.06;
        z.face.rotation.y = z.p.root.rotation.y;
        z.face.visible = z.p.root.visible;
        for (const c of z.face.children) c.visible = (c.name === "eye") === (vibe === "zombie");
      }
      z.stars.visible = z.state === "dazed";
      z.stars.position.set(z.pos.x, z.pos.y + 2.05, z.pos.z);
      z.stars.rotation.y += dt * 5;
      z.shadow.position.set(z.pos.x, z.pos.y + 0.02, z.pos.z);
      z.shadow.visible = z.state !== "trapped";
    }

    // ---- dogs
    const headPos = new THREE.Vector3();
    if (head) head.getWorldPosition(headPos);
    else headPos.set(pos.x, pos.y + 1.7, pos.z);
    dogs.forEach((d, i) => {
      d.body.position.y = 0;
      if (d.state === "hiding") {
        d.body.rotation.z = Math.sin(elapsed * 2 + d.phase) * 0.05;
        d.legs.forEach((l, k) => (l.rotation.x = 0 * k));
        if (!frozen && d.floor === floor && Math.hypot(pos.x - d.root.position.x, pos.z - d.root.position.z) < 0.95 && !finaleAt) {
          d.state = "carried";
          carriedDogs.push(i);
          reportDogs();
          callbacks.onBubble?.({ who: d.breed.name, text: carriedDogs.length > 2 ? `Dog tower: ${carriedDogs.length} tall.` : `${d.breed.name} climbs onto your shoulder.` });
          lastBubble = now;
        }
      } else if (d.state === "carried") {
        const k = carriedDogs.indexOf(i);
        const sway = Math.sin(elapsed * 3.2 + k * 0.6) * 0.06 * (k + 1);
        const lean = (sprintHeld || keys.has("ShiftLeft") ? 0.08 : 0.03) * -facing * (k + 1);
        const stackY = carriedDogs.slice(0, k).reduce((h, j) => h + dogs[j].height * 0.72, 0);
        d.root.position.set(headPos.x + sway + lean, headPos.y + 0.12 + stackY, headPos.z + 0.02);
        d.root.rotation.y = facing > 0 ? Math.PI / 2 : -Math.PI / 2;
        d.root.scale.set(1, 1, THREE.MathUtils.lerp(1, 0.08, flat));
        d.tail.rotation.y = Math.sin(elapsed * 14) * 0.6;
        if (floor === SPA.floor && pos.x > SPA.x0 + 0.4) {
          d.state = "saved";
          savedDogs += 1;
          d.target.copy(spaBeds[savedDogs - 1] ?? spaBeds[0]);
          d.root.scale.set(1, 1, 1);
        }
      } else if (d.state === "fleeing") {
        d.vel.y -= 12 * dt;
        d.root.position.addScaledVector(d.vel, dt);
        if (d.root.position.y <= fy(d.floor)) {
          d.root.position.y = fy(d.floor);
          d.vel.set(0, 0, 0);
          const to = d.target.clone().sub(d.root.position);
          to.y = 0;
          const len = to.length();
          if (len > 0.2) {
            d.root.position.addScaledVector(to.normalize(), Math.min(len, 3.5 * dt));
            d.root.rotation.y = Math.atan2(to.x, to.z);
            d.legs.forEach((l, kk) => (l.rotation.x = Math.sin(elapsed * 18 + kk * Math.PI) * 0.7));
          } else {
            d.state = "hiding";
            d.legs.forEach(l => (l.rotation.x = 0));
          }
        }
        d.root.scale.set(1, 1, 1);
      } else if (d.state === "saved") {
        d.floor = SPA.floor;
        d.root.position.lerp(d.target, Math.min(1, dt * 3));
        d.root.rotation.y = 0.3;
        d.tail.rotation.y = Math.sin(elapsed * 12 + d.phase) * 0.6;
        d.body.position.y = Math.abs(Math.sin(elapsed * 4 + d.phase)) * 0.05;
      }
    });
    if (carriedDogs.some(i => dogs[i].state === "saved")) {
      carriedDogs = carriedDogs.filter(i => dogs[i].state === "carried");
      reportDogs();
      callbacks.onBubble?.({ who: "Dog spa", text: `${savedDogs} of ${dogs.length} dogs safe. Somebody give them a cucumber facial.` });
      lastBubble = now;
    }
    if (lastBubble && now - lastBubble > 2600) {
      lastBubble = 0;
      callbacks.onBubble?.(null);
    }

    // ---- closets swing
    for (const c of closets) {
      if (c.locked) continue;
      c.hinge.rotation.y = -1.9;
    }

    // ---- particles
    for (let i = 0; i < PCOUNT; i++) {
      if (pLife[i] <= 0) {
        pPos[i * 3 + 1] = -999;
        continue;
      }
      pLife[i] -= dt;
      pVel[i * 3 + 1] -= 3 * dt;
      pPos[i * 3] += pVel[i * 3] * dt;
      pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
    if (finaleAt) {
      for (let k = 0; k < 6; k++)
        emit(
          new THREE.Vector3(Math.random() * WIDTH, fy(3) + 2, -2.5 + (Math.random() - 0.5) * 3),
          new THREE.Vector3((Math.random() - 0.5) * 2, -2, 0),
          1,
          new THREE.Color().setHSL(Math.random(), 0.8, 0.65),
          5
        );
    }

    // ---- lamps: steady and warm, or flickering on zombie night; at the party, they pulse to the beat
    for (const l of lamps) {
      const m = l.mesh.material as THREE.MeshLambertMaterial;
      let k = l.base;
      if (finaleAt) k = l.base * (0.6 + 0.8 * Math.max(0, Math.sin(elapsed * 8.4 + l.x * 0.4)));
      else if (vibe === "zombie") k = l.base * (Math.sin(elapsed * 23 + l.phase * 7) > 0.93 || Math.sin(elapsed * 1.3 + l.phase) > 0.97 ? 0.15 : 0.85);
      m.emissiveIntensity = k;
      if (finaleAt) m.emissive.setHSL((elapsed * 0.2 + l.x * 0.03) % 1, 0.8, 0.55);
    }
    for (const w of windows) (w.material as THREE.MeshBasicMaterial).color.set(vibe === "zombie" ? 0x9fb0d8 : 0xffffff);
    // the room lights follow her floor
    const myRooms = FLOORS[floor].rooms.map(r => (r.x0 + r.x1) / 2).sort((a, b) => Math.abs(a - pos.x) - Math.abs(b - pos.x));
    roomLights.forEach((l, i) => {
      const x = finaleAt ? (i + 0.5) * (WIDTH / roomLights.length) : myRooms[i] ?? pos.x;
      l.position.set(x, (finaleAt ? fy(i % 3) : fy(floor)) + 3, -1.8);
      l.intensity = vibe === "zombie" && !finaleAt ? 6 * (Math.sin(elapsed * 17 + i) > 0.9 ? 0.3 : 1) : 9;
      l.color.set(vibe === "zombie" && !finaleAt ? 0xc8d8ff : 0xffc27a);
    });

    // ---- prompt
    if (!frozen) setPrompt(findPrompt());

    // ---- camera: a dollhouse shot of her floor; the party pulls back to the whole building
    const goal = finaleAt
      ? new THREE.Vector3(WIDTH / 2, fy(1.6), 62)
      : camera.aspect < 1
        ? new THREE.Vector3(THREE.MathUtils.clamp(pos.x, 2, WIDTH - 2), Math.max(fy(floor), pos.y - 1.2) + 3.9, 10.5)
        : new THREE.Vector3(THREE.MathUtils.clamp(pos.x, 5, WIDTH - 5), Math.max(fy(floor), pos.y - 1.2) + 3.9, 13.5);
    // on a phone the card covers the top third: aim above her so the floor sits in the open middle
    const look = finaleAt
      ? new THREE.Vector3(WIDTH / 2, fy(1.5), -2.5)
      : new THREE.Vector3(goal.x, Math.max(fy(floor), pos.y - 1.2) + (camera.aspect < 1 ? 2.3 : 1.45), -2.6);
    camPos.lerp(goal, Math.min(1, dt * (finaleAt ? 0.8 : 4)));
    camLook.lerp(look, Math.min(1, dt * (finaleAt ? 0.8 : 4)));
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    composer.render();
  }
  renderer.setAnimationLoop(frame);

  function finale() {
    if (finaleAt) return;
    finaleAt = performance.now();
    barricade.visible = false;
    concierge.root.visible = true;
    concierge.root.position.set(21.5, 0, -3.4);
    concierge.play("Dance_Loop");
    hero.play("Dance_Loop");
    setPrompt(null);
  }

  // ---------------------------------------------------------------- test hook
  callbacks.onCharges?.(charges);
  const hook = {
    ready: true,
    ropes: ROPES,
    state: () => ({
      climbing: climb ? climb.h / FLOOR_H : null,
      floor,
      x: pos.x,
      z: pos.z,
      bites,
      flat: flatTarget,
      charges,
      prompt: prompt?.id ?? null,
      carried: carriedDogs.length,
      saved: savedDogs,
      trapped: closets.filter(c => c.locked).length,
      zombies: zombies.map(z => ({ floor: z.floor, x: z.pos.x, z: z.pos.z, state: z.state })),
      vibe,
    }),
    teleport(f: number, x: number, z: number) {
      floor = f;
      pos.set(x, fy(f), z);
      callbacks.onFloor?.(f);
    },
    /** park every zombie far from her so a test walks undisturbed */
    calm() {
      calmUntil = performance.now() + 10 * 60_000;
      for (const z of zombies) if (z.state === "chase") z.state = "wander";
    },
    bite() {
      const z = zombies[0];
      invuln = 0;
      bite(z);
    },
    interact,
    spray,
    errand: (slot: number) => ({ ...ERRAND_SLOTS[slot] }),
    finale,
    lureInto(closet: number) {
      const c = closets[closet];
      const z = zombies.find(k => k.floor === c.floor && k.state !== "trapped") ?? zombies[0];
      z.floor = c.floor;
      z.state = "lured";
      z.t = 10;
      z.pos.set(c.x, fy(c.floor), -DEPTH + 0.8);
      floor = c.floor;
      pos.set(c.x, fy(c.floor), CLOSET_Z + 1.2);
      callbacks.onFloor?.(c.floor);
    },
    closets: CLOSETS,
    dogs: DOG_SPOTS,
  };
  (window as unknown as { __centuryParkEast?: typeof hook }).__centuryParkEast = hook;
  disposers.push(() => {
    const w = window as unknown as { __centuryParkEast?: unknown };
    if (w.__centuryParkEast === hook) delete w.__centuryParkEast;
  });

  return {
    setVibe(v) {
      vibe = v;
      applyVibe();
    },
    setErrands(list) {
      for (const e of list) {
        const was = errandPhase[e.slot];
        errandPhase[e.slot] = e.phase;
        const it = items[e.slot];
        if (was === "carrying" && e.phase !== "carrying" && it.held) {
          // handed over: the item leaves her hand
          it.held = false;
          handR?.remove(it.g);
          world.add(it.g);
          it.g.visible = false;
          it.g.scale.setScalar(1);
          const s = ERRAND_SLOTS[e.slot];
          it.g.position.set(s.itemX, fy(s.itemFloor), s.itemZ);
        }
      }
    },
    setPaused(p) {
      paused = p;
      if (p) {
        keys.clear();
        stick.x = stick.y = 0;
      }
    },
    interact,
    spray,
    jump,
    setSprint(on) {
      sprintHeld = on;
    },
    respawn() {
      climb = null;
      callbacks.onClimb?.(null);
      bites = 0;
      flatTarget = 0;
      flat = 0;
      invuln = 3;
      floor = 0;
      pos.set(18.2, 0, -1.4);
      callbacks.onFloor?.(0);
      for (const z of zombies) {
        if (z.state === "trapped") continue;
        z.state = "wander";
        z.floor = z.spawn.floor;
        z.pos.set(z.spawn.x, fy(z.spawn.floor), z.spawn.z);
      }
      // a dropped errand item goes back where it was found
      items.forEach((it, i) => {
        if (!it.held) return;
        it.held = false;
        handR?.remove(it.g);
        world.add(it.g);
        it.g.scale.setScalar(1);
        const s = ERRAND_SLOTS[i];
        it.g.position.set(s.itemX, fy(s.itemFloor), s.itemZ);
      });
      callbacks.onBite?.(0);
    },
    finale,
    dispose() {
      disposed = true;
      for (const d of disposers.splice(0)) d();
      composer.dispose();
    },
  };
}
