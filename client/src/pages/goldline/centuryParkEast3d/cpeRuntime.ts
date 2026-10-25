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
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { DEPTH, ELEV_X0, ELEV_X1, FLOORS, FLOOR_H, ROPES, WIDTH, fy, hitsCollider, ropeLanding, staticColliders, type Collider } from "./cpeLayout";
export { ROPES };
import { buildSet, materialFor } from "./cpeSet";
import { INK_SETS, createPrintPass } from "./cpePrint";
import { createCctv, type Cctv } from "./cpeCctv";
import { PULL_DUR, grabbed as climbGrabbed, isResting, plannedHeight, press as climbPress2, startClimb as newClimb, tick as climbTick, type ClimbState, type Hand } from "./climbMachine";
import { createCpeSounds } from "./cpeSounds";
import { activeTrade, deviceName } from "./cpeTrade";
import { label as labelTexture } from "./cpeTextures";

export type Vibe = "cozy" | "zombie";
export type ItemKind = "robot_vacuum" | "garment_bag" | "leash" | "suitcase" | "package" | "yoga_mat" | "cake" | "spare_key";
export type ErrandPhase = "locked" | "need" | "carrying" | "waiting" | "done";
export type ErrandView = { slot: number; phase: ErrandPhase };
export type PromptId = "talk" | "quiet" | "item" | "elevator" | "closet" | "extinguisher" | "pump" | "concierge" | "rope_up" | "rope_down" | "climb" | "shotgun";
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
  | { kind: "out_of_foam" }
  /** zombie night: the dormant resident's zombie is stunned; thirty seconds to program the shotgun */
  | { kind: "tazed"; slot: number }
  | { kind: "shotgun"; slot: number }
  | { kind: "chipped"; slot: number; device: string }
  | { kind: "device_wrecked"; device: string; wrecked: number; total: number }
  | { kind: "room_wrecked" };

export type CpeCallbacks = {
  onProgress?: (p: number) => void;
  onPrompt?: (prompt: { id: PromptId; label: string } | null) => void;
  onInteract?: (i: Interaction) => void;
  onBite?: (bites: number) => void;
  onDogs?: (d: { carried: number; saved: number; total: number }) => void;
  onCharges?: (n: number) => void;
  onFloor?: (floor: number) => void;
  onBubble?: (b: { who: string; text: string } | null) => void;
  /** on a rope: how far up (0..1), how much grip she has left, whether she's resting; null when she's not on one */
  onClimb?: (c: { progress: number; stamina: number; resting: boolean } | null) => void;
  /** zombie night: which security camera the monitor is on, and the small feeds beside it; null on cozy night */
  onCamera?: (c: { id: string; label: string; floor: number; thumbs: { id: string; label: string }[] } | null) => void;
};

export type CpeHandle = {
  setVibe(v: Vibe): void;
  setErrands(errands: ErrandView[]): void;
  setPaused(p: boolean): void;
  interact(): void;
  spray(): void;
  jump(): void;
  /** on the rope: that hand pulls */
  climbHand(hand: Hand): void;
  /** the shotgun fired: that slot's zombie takes the chip and goes for the trade room */
  chip(slot: number): void;
  /** the operator put the gun down ("not now"): the zombie wakes dazed, nothing else happens */
  wake(slot: number): void;
  /** the fuse ran out with the gun still open: the zombie bites */
  fuseOut(slot: number): void;
  setSprint(on: boolean): void;
  /** after a knockout: wake up in the lobby, whole again */
  respawn(): void;
  finale(): void;
  dispose(): void;
};

// ------------------------------------------------------------------ the building (metres): see cpeLayout.ts

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

/** eight zombies, one per errand slot: on zombie night each is the dormant resident of that slot */
const ZOMBIE_SPAWNS: { floor: number; x: number; z: number; base: number }[] = [
  { floor: 0, x: 24, z: -2.4, base: 2 },
  { floor: 1, x: 3.5, z: -2.6, base: 2 },
  { floor: 1, x: 32, z: -2.0, base: 3 },
  { floor: 0, x: 35, z: -2.4, base: 2 },
  { floor: 2, x: 17, z: -2.4, base: 2 },
  { floor: 1, x: 14.5, z: -3.2, base: 2 },
  { floor: 2, x: 31, z: -2.6, base: 0 },
  { floor: 0, x: 4, z: -3.0, base: 2 },
];

const CLOSETS: { floor: number; x: number }[] = [
  { floor: 0, x: 1.6 },
  { floor: 1, x: 19.6 },
  { floor: 1, x: 22.8 },
  { floor: 1, x: 26.0 },
  { floor: 2, x: 24.8 },
];
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
  { floor: 2, x: 10.5, z: -1.5 }, // on a pool float, at the near edge where she can reach it
  { floor: 2, x: 21, z: -4.2 },
  { floor: 2, x: 37, z: -4.0 },
];
const SPA = { floor: 1, x0: 30.4, x1: 38 };

// ------------------------------------------------------------------ helpers
/** a lit, slightly matte surface for the small things the game moves (items, dogs, the closet doors, the ropes) */
const mats = new Map<string, THREE.MeshStandardMaterial>();
function lam(color: string | number, emissive = 0): THREE.MeshStandardMaterial {
  const key = `${color}|${emissive}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive, roughness: 0.78, metalness: 0 });
    mats.set(key, m);
  }
  return m;
}

type Box = Collider;

export async function createCenturyParkEast(container: HTMLElement, castBase: string, callbacks: CpeCallbacks = {}): Promise<CpeHandle> {
  const disposers: (() => void)[] = [];
  let disposed = false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
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
  // three tiers: software GL (CI) draws flat and small; a phone gets shadows; a desktop GPU gets a sharper shadow map.
  // Contact darkening in the corners is painted into the set (see cpeSet.ts) instead of a screen-space pass: an
  // occlusion pass cost more than the whole rest of the frame on an M1.
  // `?cpeTier=phone|flat` forces a lower tier so a capture script can price each effect on the same machine.
  const forcedTier = new URLSearchParams(window.location.search).get("cpeTier");
  const highQuality = !softwareGl && !coarse && forcedTier !== "phone" && forcedTier !== "flat";
  const shadows = !softwareGl && forcedTier !== "flat";
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  disposers.push(() => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.domElement.remove();
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1d1830");
  scene.fog = new THREE.Fog(0x2a2350, 40, 170);
  // a soft studio environment so painted surfaces and brass pick up a little reflected light
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.28;
  disposers.push(() => envRT.dispose());
  const camera = new THREE.PerspectiveCamera(27, 1, 0.5, 400);

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
  const hemi = new THREE.HemisphereLight(0xfff0dc, 0x4a3a58, 0.85);
  scene.add(hemi);
  // the key light comes in over the cut like a lamp held up to a dollhouse; it follows her floor so the shadow map
  // only ever covers one storey and stays sharp
  const key = new THREE.DirectionalLight(0xfff0dc, 1.6);
  key.castShadow = shadows;
  key.shadow.mapSize.set(highQuality ? 2048 : 1024, highQuality ? 2048 : 1024);
  const kc = key.shadow.camera as THREE.OrthographicCamera;
  kc.left = -24;
  kc.right = 24;
  kc.top = 9;
  kc.bottom = -7;
  kc.near = 2;
  kc.far = 70;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 2.5;
  scene.add(key);
  scene.add(key.target);
  const fill = new THREE.DirectionalLight(0xa9b8ff, 0.35);
  fill.position.set(30, 14, 26);
  scene.add(fill);
  const roomLights: THREE.PointLight[] = [];
  for (let i = 0; i < (softwareGl ? 2 : 5); i++) {
    const l = new THREE.PointLight(0xffc27a, 7, 11, 1.6);
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

  // the set: the cut tower, every room dressed, the street and the city (cpeSet.ts); gameplay only keeps the colliders
  const set = buildSet(world, scene, { softwareGl, shadows });
  disposers.push(() => set.dispose());
  const { lamps, windows, emergency } = set;
  set.waterMat.map?.repeat.set(5, 1.2);
  // walls, partitions and furniture block movement; the list is pure data (cpeLayout.ts) so a unit test can walk it
  solids.push(...staticColliders());
  FLOORS.forEach((fl, f) => {
    // the elevator's floor indicator: lit, over the doors
    const ind = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({ map: labelTexture(["G", "A", "R"][f], "#1b1626", "#ffcf7a") }));
    ind.position.set((ELEV_X0 + ELEV_X1) / 2, fy(f) + 3.1, -DEPTH + 0.37);
    world.add(ind);
  });

  // ---------------------------------------------------------------- the barricade and the gameplay props
  // the barricade in the mailroom (zombie night): parcels piled at the mailroom door, a plank nailed across
  const barricade = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const m = box(9 + (i % 3) * 0.9, 9.85 + (i % 3) * 0.9, Math.floor(i / 3) * 0.7, 0.68 + Math.floor(i / 3) * 0.7, -2.6 + (i % 2) * 0.3, -1.6 + (i % 2) * 0.3, materialFor(`parcel|${i % 3}`), barricade);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
  }
  const plank = box(8.7, 11.9, 1.3, 1.5, -1.45, -1.35, materialFor("wood|#9a6a44"), barricade);
  plank.rotation.z = -0.12;
  plank.castShadow = shadows;
  world.add(barricade);
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
    const door = box(0, CLOSET_HW * 2, 0, 2.55, -0.06, 0, materialFor("wood|#b07a4a"), hinge);
    door.position.x = CLOSET_HW;
    door.castShadow = shadows;
    door.receiveShadow = shadows;
    // a panel line and a brass handle so it reads as a door, not a plank
    box(0.12, CLOSET_HW * 2 - 0.12, 0.3, 2.25, -0.07, -0.06, materialFor("darkwood"), hinge).position.x = CLOSET_HW;
    box(CLOSET_HW * 2 - 0.3, CLOSET_HW * 2 - 0.18, 1.15, 1.35, -0.1, -0.06, materialFor("brass"), hinge).position.x = CLOSET_HW;
    hinge.rotation.y = -1.9; // open
    g.add(hinge);
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
    g.traverse(o => {
      (o as THREE.Mesh).castShadow = shadows;
    });
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
  type Person = { root: THREE.Object3D; meshes: THREE.Mesh[]; mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; current: string; play(name: string, fade?: number, once?: boolean): void; tint(c: THREE.Color | null): void };
  function person(g: GLTF, clone: boolean): Person {
    const root = clone ? SkeletonUtils.clone(g.scene) : g.scene;
    const own: THREE.MeshStandardMaterial[] = [];
    const meshes: THREE.Mesh[] = [];
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      m.castShadow = shadows;
      meshes.push(m);
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
      meshes,
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
  // a soft contact blob under everyone: the only shadow in software GL, a hint of one under real shadows
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: shadows ? 0.13 : 0.28, depthWrite: false });
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
    // their own clothes, their own height; a tint over the whole texture used to wash the skin out too
    p.root.scale.setScalar(0.96 + ((i * 7) % 5) * 0.025);
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
    p.root.scale.setScalar(0.94 + ((i * 5) % 6) * 0.025);
    blob().position.set(s.x, fy(s.floor) + 0.02, s.z);
    return p;
  });

  type ZState = "wander" | "chase" | "dazed" | "lured" | "trapped" | "dance" | "stunned" | "chipped" | "riding" | "wrecking" | "harmless";
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
      eyeMat,
      /** the device a chipped zombie is heading for */
      device: -1,
    };
  });

  // ---------------------------------------------------------------- the trade room's devices (what the chipped zombies destroy)
  const pack = activeTrade();
  const roomY = fy(pack.room.floor);
  const deviceMeshes = pack.devices.map((d, i) => {
    const g = new THREE.Group();
    const body = new THREE.Group();
    g.add(body);
    if (pack.device.kind === "washer") {
      const faces = [materialFor("white"), materialFor("white"), materialFor("solid|#d8dde3"), materialFor("white"), materialFor("washer"), materialFor("white")];
      const m = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.h, d.d), faces);
      m.position.y = d.h / 2;
      body.add(m);
      const top = new THREE.Mesh(new THREE.BoxGeometry(d.w + 0.02, 0.06, d.d + 0.02), materialFor("solid|#d8dde3"));
      top.position.y = d.h + 0.03;
      body.add(top);
    } else if (pack.device.kind === "toilet") {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.42, 16), materialFor("white"));
      bowl.position.set(0, 0.21, 0.15);
      const tank = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.2), materialFor("white"));
      tank.position.set(0, 0.6, -0.25);
      const seat = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 8, 20), materialFor("white"));
      seat.rotation.x = Math.PI / 2;
      seat.position.set(0, 0.44, 0.15);
      body.add(bowl, tank, seat);
    } else {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.04), materialFor("white"));
      plate.position.set(0, 1.0, 0);
      const holes = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.05), materialFor("solid|#2b2f36"));
      holes.position.set(0, 1.0, 0.01);
      body.add(plate, holes);
    }
    body.traverse(o => {
      (o as THREE.Mesh).castShadow = shadows;
      (o as THREE.Mesh).receiveShadow = shadows;
    });
    g.position.set(d.x, roomY, d.z);
    world.add(g);
    return { g, body, i, wrecked: false, shake: 0, claimed: false, name: deviceName(pack, i) };
  });
  const wreckedCount = () => deviceMeshes.filter(d => d.wrecked).length;
  let zombieHaste = 1;
  let roomWreckedTold = false;

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
    d.root.traverse(o => {
      (o as THREE.Mesh).castShadow = shadows;
    });
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
  // on a rope: which one, the climb itself (climbMachine.ts), the sway she has, and the mantle over the lip at the top
  type Mantle = { t: number; from: THREE.Vector3; to: THREE.Vector3 };
  let climb: { rope: number; s: ClimbState; sway: number; swayV: number; pulls: number; mantle: Mantle | null } | null = null;
  let landSquash = 0;
  const sounds = createCpeSounds();
  disposers.push(() => sounds.dispose());
  const clipLength = (name: string) => heroG.animations.find(a => a.name === name)?.duration ?? 1;
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
    hemi.intensity = zombieNight ? 0.55 : 0.85;
    hemi.color.set(zombieNight ? 0xcfe0ff : 0xfff0dc);
    key.color.set(zombieNight ? 0xd8e4ff : 0xfff0dc);
    key.intensity = zombieNight ? 1.15 : 1.6;
    scene.background = new THREE.Color(zombieNight ? "#141022" : "#1d1830");
    (scene.fog as THREE.Fog).color.set(zombieNight ? 0x1a2238 : 0x2a2350);
    gradeWarm = zombieNight ? 0 : 1;
    inks = zombieNight ? INK_SETS.zombie : INK_SETS.cozy;
    printRef?.setInks(inks);
    if (cctvRef) {
      if (zombieNight) {
        cctvRef.follow(floor, pos.x);
        cctvRef.boot();
        const a = cctvRef.active;
        callbacks.onCamera?.({ id: a.id, label: a.label, floor: a.floor, thumbs: cctvRef.thumbs.map(t => ({ id: t.id, label: t.label })) });
      } else callbacks.onCamera?.(null);
    }
    for (const p of set.pools) (p.material as THREE.MeshBasicMaterial).color.set(zombieNight ? 0x8fa8d8 : 0xffffff);
    pMat.size = 0.16;
  }
  let gradeWarm = 1;
  let inks = INK_SETS.cozy;
  let printRef: ReturnType<typeof createPrintPass> | null = null;
  let cctvRef: Cctv | null = null;
  applyVibe();

  // ---------------------------------------------------------------- input
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.("input, textarea, [contenteditable]")) return;
    keys.add(e.code);
    if (climb && !e.repeat) {
      // on the rope the keys are hands: A/left is the left hand, D/right the right, anything else the next one due
      if (e.code === "KeyA" || e.code === "ArrowLeft") return climbHand("L");
      if (e.code === "KeyD" || e.code === "ArrowRight") return climbHand("R");
      if (e.code === "KeyW" || e.code === "ArrowUp" || e.code === "KeyE" || e.code === "Space") {
        e.preventDefault();
        return climbHand("next");
      }
    }
    if (e.code === "KeyE" || e.code === "Enter") interact();
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
    for (const b of solids) if (b.floor === f && hitsCollider(b, x, z, r)) return true;
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
    if (climb) return { id: "climb", label: "Hand over hand: A, D (or tap)", act: () => climbHand("next") };
    // the ropes come first, so a neighbour standing nearby never hides the way up or down
    for (let i = 0; i < ropes.length; i++) {
      const r = ropes[i];
      if (near(r.floor, r.x, r.z, 1.15)) return { id: "rope_up", label: `Climb the rope to the ${FLOORS[r.floor + 1].name.toLowerCase()}`, act: () => startClimb(i) };
      if (near(r.floor + 1, r.x, r.z, 1.15)) return { id: "rope_down", label: `Slide down to the ${FLOORS[r.floor].name.toLowerCase()}`, act: () => slideDown(i) };
    }
    // zombie night: a stunned dormant resident within reach is the shotgun's moment
    if (vibe === "zombie")
      for (let i = 0; i < ERRAND_SLOTS.length; i++) {
        const z = zombies[i];
        if (z && z.state === "stunned" && isHot(i) && z.floor === floor && Math.hypot(pos.x - z.pos.x, pos.z - z.pos.z) < 2.0)
          return { id: "shotgun", label: "Program the shotgun", act: () => callbacks.onInteract?.({ kind: "shotgun", slot: i }) };
      }
    // the errand that's open: talk to its giver, pick up its item (cozy night; on zombie night the residents are the zombies)
    for (let i = 0; vibe !== "zombie" && i < ERRAND_SLOTS.length; i++) {
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
    if (climb) return climbHand("next");
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
  const reportClimb = () => {
    if (!climb) return callbacks.onClimb?.(null);
    callbacks.onClimb?.({ progress: plannedHeight(climb.s) / FLOOR_H, stamina: climb.s.stamina, resting: isResting(climb.s) });
  };
  function startClimb(i: number) {
    const r = ropes[i];
    climb = { rope: i, s: newClimb(0.15), sway: 0, swayV: 0, pulls: 0, mantle: null };
    armedAt = Math.min(armedAt, performance.now());
    pos.set(r.x, fy(r.floor) + 0.15, r.z + 0.18);
    vy = 0;
    heading = Math.PI; // facing the rope, back to us
    // the clip is one metre of hand-over-hand; it is scrubbed by how far she has climbed, never played on its own
    hero.play("ClimbUp_1m", 0.12);
    const act = hero.actions.get("ClimbUp_1m");
    if (act) act.paused = true;
    sounds.creak(0.3);
    reportClimb();
  }
  function climbHand(hand: Hand | "next") {
    if (!climb || paused || climb.mantle) return;
    const before = climb.s.pulls;
    climb.s = climbPress2(climb.s, hand);
    if (climb.s.pulls > before) {
      const h = climb.s.pull?.hand ?? "R";
      climb.swayV += (h === "L" ? 1 : -1) * 1.1;
      sounds.creak(0.4 + (1 - climb.s.stamina) * 0.6);
      if (climb.s.stamina < 0.35) sounds.grunt();
    }
    reportClimb();
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
  /** zombie night: the zombie whose dormant resident is the open slot is the one the shotgun can chip */
  const isHot = (i: number) => vibe === "zombie" && i < ERRAND_SLOTS.length && (errandPhase[i] === "need" || errandPhase[i] === "carrying" || errandPhase[i] === "waiting");
  const settled = (z: (typeof zombies)[number]) => z.state === "chipped" || z.state === "riding" || z.state === "wrecking" || z.state === "harmless" || z.state === "trapped";
  function spray() {
    if (paused || finaleAt || climb) return;
    if (charges <= 0) {
      callbacks.onInteract?.({ kind: "out_of_foam" });
      return;
    }
    charges -= 1;
    callbacks.onCharges?.(charges);
    const zombieNight = vibe === "zombie";
    const col = zombieNight ? new THREE.Color("#bfe8ff") : new THREE.Color("#d9b8ff");
    const from = new THREE.Vector3(pos.x + facing * 0.5, pos.y + 1.1, pos.z);
    // the tazer is a short bright arc; the mist is a cloud
    for (let k = 0; k < (zombieNight ? 40 : 70); k++) emit(from, new THREE.Vector3(facing * (zombieNight ? 9 + Math.random() * 4 : 4 + Math.random() * 3), zombieNight ? 0.2 : 0.6, 0), zombieNight ? 0.5 : 1.6, col, zombieNight ? 0.35 : 0.9);
    hero.play("Interact", 0.1, true);
    setTimeout(() => hero.current === "Interact" && hero.play("Idle_Loop"), 600);
    zombies.forEach((z, i) => {
      if (z.floor !== floor || settled(z)) return;
      const dx = z.pos.x - pos.x;
      if (Math.sign(dx) !== facing || Math.abs(dx) > 4.2 || Math.abs(z.pos.z - pos.z) > 1.8) return;
      if (zombieNight && isHot(i)) {
        // stunned: thirty seconds on the ground, the shotgun's window
        z.state = "stunned";
        z.t = 30;
        z.sprayed = false;
        callbacks.onInteract?.({ kind: "tazed", slot: i });
      } else {
        z.state = "dazed";
        z.t = 2.2;
        z.sprayed = true;
      }
    });
  }
  function chip(slot: number) {
    const z = zombies[slot];
    if (!z || settled(z)) return;
    const device = deviceMeshes.find(d => !d.wrecked && !d.claimed) ?? deviceMeshes.find(d => !d.wrecked);
    if (!device) return;
    device.claimed = true;
    z.device = device.i;
    z.state = "chipped";
    z.t = 0;
    z.stars.visible = false;
    z.eyeMat.color.set(0x6fd0ff);
    callbacks.onInteract?.({ kind: "chipped", slot, device: device.name });
  }
  function wake(slot: number) {
    const z = zombies[slot];
    if (!z || z.state !== "stunned") return;
    z.state = "dazed";
    z.t = 3;
  }
  function fuseOut(slot: number) {
    const z = zombies[slot];
    if (!z || z.state !== "stunned") return;
    invuln = 0;
    bite(z);
    z.state = "dazed";
    z.t = 3;
  }
  function jump() {
    if (climb) return climbHand("next");
    if (paused || pos.y > fy(floor) + 0.02) return;
    vy = 4.6;
  }
  function bite(z: (typeof zombies)[number]) {
    if (climb) {
      // grabbed by the ankle: she drops to the last knot and keeps hold; it costs her grip, not a life
      climb.s = climbGrabbed(climb.s);
      climb.swayV += 2.2;
      invuln = 2.5;
      sounds.slide();
      reportClimb();
      callbacks.onInteract?.({ kind: "rope_fell" });
      z.state = "dazed";
      z.t = 2.5;
      return;
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
  const composerTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: softwareGl ? 0 : 4 });
  const composer = new EffectComposer(renderer, composerTarget);
  composer.addPass(new RenderPass(scene, camera));
  // bloom only on what's actually a light (lamps, the sign), never on a white sofa in a bright room
  const bloom = softwareGl ? null : new UnrealBloomPass(new THREE.Vector2(1, 1), 0.34, 0.5, 1.3);
  if (bloom) composer.addPass(bloom);
  // the grade: a warm storybook night, or a cool green-tinged one; the runtime eases between them when the vibe flips
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uWarm: { value: 1 }, uVig: { value: 0.3 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uWarm; uniform float uVig; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        float l = dot(c.rgb, vec3(0.299,0.587,0.114));
        vec3 warm = c.rgb;
        warm = mix(vec3(l), warm, 1.12);
        warm = mix(warm, warm * vec3(1.05, 0.98, 0.9), smoothstep(0.4, 1.2, l));
        warm += vec3(0.02, 0.0, 0.035) * (1.0 - smoothstep(0.0, 0.35, l));
        vec3 cool = c.rgb;
        cool = mix(vec3(l), cool, 0.82);
        cool = mix(cool, cool * vec3(0.9, 1.02, 1.04), smoothstep(0.3, 1.2, l));
        cool += vec3(0.0, 0.03, 0.025) * (1.0 - smoothstep(0.0, 0.4, l));
        c.rgb = mix(cool, warm, uWarm);
        vec2 d = vUv - 0.5;
        c.rgb *= 1.0 - uVig * dot(d, d) * 1.7;
        gl_FragColor = c;
      }`,
  });
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  // the brochure: the finished frame is separated into ink plates and screened onto paper (cpePrint.ts)
  const print = createPrintPass(renderer.getPixelRatio());
  print.setInks(inks);
  printRef = print;
  composer.addPass(print);
  // zombie night is watched on the concierge's monitors (cpeCctv.ts); software GL keeps the plain dollhouse
  const cctv: Cctv | null = softwareGl ? null : createCctv(renderer, scene, renderer.getPixelRatio());
  cctvRef = cctv;
  disposers.push(() => cctv?.dispose());
  const reportCamera = () => {
    if (!cctv || vibe !== "zombie") return callbacks.onCamera?.(null);
    const a = cctv.active;
    callbacks.onCamera?.({ id: a.id, label: a.label, floor: a.floor, thumbs: cctv.thumbs.map(t => ({ id: t.id, label: t.label })) });
  };

  disposers.push(() => composerTarget.dispose());
  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    if (softwareGl) {
      const pr = Math.min(1, Math.sqrt(160_000 / Math.max(1, w * h)));
      renderer.setPixelRatio(pr);
      composer.setPixelRatio(pr);
    }
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    cctvRef?.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w < h ? 46 : 27;
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
  // twenty skinned people cost more than the whole building: only the ones the camera can see are skinned and
  // drawn, and only the ones on her floor cast a shadow. The party shows everyone.
  const viewHalf = () => (camera.aspect < 1 ? 9 : 12);
  const inView = (x: number, f: number) => !!finaleAt || (Math.abs(x - camLook.x) < viewHalf() && Math.abs(f - floor) <= 1);
  const present = (p: Person, x: number, f: number, step: number) => {
    const on = inView(x, f);
    p.root.visible = on;
    if (!on) return;
    p.mixer.update(step);
    const cast = shadows && f === floor;
    for (const m of p.meshes) m.castShadow = cast;
  };
  renderer.info.autoReset = false;
  function frame() {
    renderer.info.reset();
    const dt = Math.min(0.05, clock.getDelta());
    // A React overlay pauses play. Rendering a costly software-WebGL scene behind the opaque shotgun desk
    // starves its real-time buttons and fuse; preserve the last frame instead until play resumes.
    if (paused) return;
    elapsed += dt;
    const now = performance.now();
    const frozen = paused;

    // ---- her, on the rope
    if (climb && !frozen) {
      const r = ropes[climb.rope];
      const top = fy(r.floor + 1);
      if (climb.mantle) {
        // over the lip: an arc from the hole to the landing, a land, a squash
        const m = climb.mantle;
        m.t = Math.min(1, m.t + dt / 0.55);
        const k = m.t;
        const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        pos.lerpVectors(m.from, m.to, ease);
        pos.y += Math.sin(k * Math.PI) * 0.45;
        heading = Math.PI / 2;
        if (m.t >= 1) {
          floor = r.floor + 1;
          pos.copy(m.to);
          climb = null;
          vy = 0;
          landSquash = 1;
          sounds.thud();
          hero.play("Idle_Loop", 0.25);
          for (const d of carriedDogs) dogs[d].floor = floor;
          callbacks.onClimb?.(null);
          callbacks.onFloor?.(floor);
          callbacks.onInteract?.({ kind: "rope_top", floor });
        }
      } else {
        climb.s = climbTick(climb.s, dt);
        if (keys.has("KeyS") || keys.has("ArrowDown")) {
          climb = null; // let go
          callbacks.onClimb?.(null);
        } else if (climb.s.h >= FLOOR_H - 0.45) {
          const landing = ropeLanding(r);
          climb.mantle = { t: 0, from: new THREE.Vector3(r.x, fy(r.floor) + climb.s.h, r.z + 0.18), to: new THREE.Vector3(landing.x, top, landing.z) };
          hero.play("Jump_Land", 0.1, true);
          sounds.creak(0.8);
        } else {
          // the body hangs off the rope and swings with each pull; the clip is scrubbed by the metres climbed
          climb.swayV -= climb.sway * 22 * dt + climb.swayV * 4.5 * dt;
          climb.sway += climb.swayV * dt;
          pos.set(r.x + climb.sway * 0.05, fy(r.floor) + climb.s.h, r.z + 0.18);
          heading = Math.PI;
          const act = hero.actions.get("ClimbUp_1m");
          if (act) {
            const len = clipLength("ClimbUp_1m");
            act.time = (((climb.s.h - 0.15) % 1) + 1) % 1 * len;
          }
          if (Math.floor(elapsed * 4) !== Math.floor((elapsed - dt) * 4)) reportClimb();
        }
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
    landSquash = Math.max(0, landSquash - dt * 4.5);
    const squash = Math.sin(Math.min(1, landSquash) * Math.PI) * 0.12;
    const pullK = climb?.s.pull ? climb.s.pull.t / PULL_DUR : 0;
    const stretch = climb && !climb.mantle ? Math.sin(pullK * Math.PI) * 0.05 : 0;
    paper.scale.set(1 + squash * 0.6, 1 - squash + stretch, THREE.MathUtils.lerp(1, 0.05, flat));
    paper.rotation.z = climb && !climb.mantle ? climb.sway * 0.14 : flat > 0.5 && ["Walk_Loop", "Sprint_Loop"].includes(hero.current) ? Math.sin(elapsed * 11) * 0.06 : 0;
    hero.root.position.set(0, 0, 0);
    hero.root.rotation.y = heading;
    hero.root.scale.set(flat > 0.5 ? Math.abs(flip) : 1, 1, 1);
    hero.root.visible = !(blink > 0 && Math.floor(elapsed * 14) % 2 === 0);
    heroShadow.position.set(pos.x, fy(floor) + 0.02, pos.z);
    heroShadow.scale.setScalar(THREE.MathUtils.lerp(1, 0.6, flat));
    hero.mixer.update(frozen ? 0 : dt);

    // ---- which picture: the printed dollhouse, or the monitors on zombie night (the party is always the dollhouse)
    const onMonitors = vibe === "zombie" && !finaleAt && !!cctv;
    const liveCamera = onMonitors && cctv ? cctv.active.cam : camera;

    // ---- errand markers and items
    needy.forEach((n, i) => {
      const ph = errandPhase[i];
      n.mark.visible = ph === "need" || ph === "carrying" || ph === "waiting";
      if (vibe === "zombie" && zombies[i]) {
        n.mark.position.set(zombies[i].pos.x, zombies[i].pos.y + 2.3 + Math.sin(elapsed * 3 + i) * 0.08, zombies[i].pos.z);
        n.mark.visible = n.mark.visible && !settled(zombies[i]);
      } else n.mark.position.set(ERRAND_SLOTS[i].x, fy(ERRAND_SLOTS[i].floor) + 2.3 + Math.sin(elapsed * 3 + i) * 0.08, ERRAND_SLOTS[i].z);
      n.mark.lookAt(liveCamera.position);
      present(n.p, ERRAND_SLOTS[i].x, ERRAND_SLOTS[i].floor, dt);
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
    quiet.forEach((q, i) => {
      present(q, QUIET_SLOTS[i].x, QUIET_SLOTS[i].floor, dt);
      if (finaleAt) q.play("Dance_Loop");
    });
    if (concierge.root.visible || vibe === "zombie" || finaleAt) {
      concierge.mixer.update(dt);
      for (const m of concierge.meshes) m.castShadow = shadows && floor === 0;
    }

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
        if (z.state === "stunned") {
          // on the ground, twitching; when the thirty seconds are up it gets up angry
          if (z.t <= 0) {
            z.state = "chase";
            z.t = 0;
          }
        } else if (z.state === "chipped" || z.state === "riding") {
          const device = deviceMeshes[z.device];
          const roomFloor = pack.room.floor;
          if (!device || device.wrecked) {
            const next = deviceMeshes.find(d => !d.wrecked && !d.claimed);
            if (next) {
              next.claimed = true;
              z.device = next.i;
            } else z.state = "harmless";
          } else if (z.state === "riding") {
            z.t -= dt * (zombieHaste - 1);
            if (z.t <= 0) {
              z.floor = roomFloor;
              z.pos.set((ELEV_X0 + ELEV_X1) / 2, fy(roomFloor), -2.4);
              z.state = "chipped";
            }
          } else if (z.floor !== roomFloor) {
            // to the elevator on its own floor, then ride
            const ex = (ELEV_X0 + ELEV_X1) / 2;
            const ddx = ex - z.pos.x;
            if (Math.abs(ddx) < 0.4) {
              z.state = "riding";
              z.t = 1.4;
            } else {
              const nz = THREE.MathUtils.lerp(z.pos.z, -2.4, Math.min(1, dt * 2));
              moveTo(z.pos, z.floor, z.pos.x + Math.sign(ddx) * 2.2 * zombieHaste * dt, nz, 0.25);
            }
          } else {
            // on the room's floor: to the front of the device
            const tx = device.g.position.x, tz = device.g.position.z + 1.05;
            const ddx = tx - z.pos.x, ddz = tz - z.pos.z;
            if (Math.hypot(ddx, ddz) < 0.35) {
              z.state = "wrecking";
              z.t = 3.2;
            } else {
              const len = Math.hypot(ddx, ddz) || 1;
              moveTo(z.pos, z.floor, z.pos.x + (ddx / len) * 2.2 * zombieHaste * dt, z.pos.z + (ddz / len) * 2.2 * zombieHaste * dt, 0.25);
            }
          }
        } else if (z.state === "wrecking") {
          const device = deviceMeshes[z.device];
          if (device) {
            device.shake = 1;
            if (Math.random() < 0.5) emit(new THREE.Vector3(device.g.position.x + (Math.random() - 0.5) * 0.8, device.g.position.y + 0.6 + Math.random() * 0.6, device.g.position.z + 0.5), new THREE.Vector3((Math.random() - 0.5) * 2, 1.5 + Math.random(), 0.6), 0.8, new THREE.Color("#f4f7ff"), 1.1);
            if (z.t <= 0 && !device.wrecked) {
              device.wrecked = true;
              device.body.rotation.z = (device.i % 2 ? 1 : -1) * 0.22;
              device.body.position.y = -0.1;
              device.body.traverse(o => {
                const m = o as THREE.Mesh;
                if (m.isMesh) m.material = Array.isArray(m.material) ? m.material.map(() => materialFor("solid|#6a6670|0.9")) : materialFor("solid|#6a6670|0.9");
              });
              for (let k = 0; k < 40; k++) emit(new THREE.Vector3(device.g.position.x, device.g.position.y + 0.8, device.g.position.z + 0.4), new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, 1), 1.2, new THREE.Color("#ffe08a"), 1.4);
              z.state = "harmless";
              callbacks.onInteract?.({ kind: "device_wrecked", device: device.name, wrecked: wreckedCount(), total: deviceMeshes.length });
              if (wreckedCount() === deviceMeshes.length && !roomWreckedTold) {
                roomWreckedTold = true;
                callbacks.onInteract?.({ kind: "room_wrecked" });
              }
            }
          } else z.state = "harmless";
        } else if (z.state === "harmless") {
          // chipped and spent: it wanders and never chases again
          const nx = z.pos.x + z.dir * 0.5 * dt;
          if (blocked(z.floor, nx, z.pos.z, 0.3) || nx < 1 || nx > WIDTH - 1) z.dir *= -1;
          else z.pos.x = nx;
        } else if (z.state === "wander") {
          const nx = z.pos.x + z.dir * 0.7 * dt;
          if (blocked(z.floor, nx, z.pos.z, 0.3) || (z.floor === SPA.floor && nx > SPA.x0 - 0.5) || nx < 1 || nx > WIDTH - 1) z.dir *= -1;
          else z.pos.x = nx;
          z.pos.z += Math.sin(elapsed * 0.7 + z.phase) * 0.25 * dt;
          z.pos.z = THREE.MathUtils.clamp(z.pos.z, -DEPTH + 0.6, -0.6);
          if (sameFloor && dist < 6 && now >= ridingUntil && now >= calmUntil && now >= armedAt && !(floor === SPA.floor && pos.x > SPA.x0)) z.state = "chase";
          if (vibe === "zombie" && !isHot(zombies.indexOf(z)) && zombies.indexOf(z) < ERRAND_SLOTS.length && errandPhase[zombies.indexOf(z)] === "done") z.state = "harmless";
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
      const moving = z.state === "wander" || z.state === "chase" || z.state === "lured" || z.state === "chipped" || z.state === "harmless";
      z.p.play(z.state === "dance" ? "Dance_Loop" : z.state === "dazed" || z.state === "stunned" ? "Idle_No_Loop" : z.state === "wrecking" ? "Interact" : moving ? "Walk_Loop" : "Idle_Loop", 0.3);
      const act = z.p.actions.get("Walk_Loop");
      if (act) act.timeScale = z.state === "chase" ? 0.85 : z.state === "chipped" ? 1.3 : 0.5;
      z.p.root.position.copy(z.pos);
      // stunned: flat out on its back, twitching
      z.p.root.rotation.x = z.state === "stunned" ? -Math.PI / 2 + Math.sin(elapsed * 30) * 0.03 : 0;
      z.p.root.position.y = z.state === "stunned" ? z.pos.y + 0.12 : z.pos.y;
      const devX = z.device >= 0 ? deviceMeshes[z.device]?.g.position.x ?? z.pos.x : z.pos.x;
      const face = z.state === "wander" || z.state === "harmless" ? (z.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : z.state === "chipped" ? (devX >= z.pos.x ? Math.PI / 2 : -Math.PI / 2) : z.state === "wrecking" ? Math.PI : Math.atan2(dx, dz);
      if (z.state !== "trapped" && z.state !== "dance") z.p.root.rotation.y += (face - z.p.root.rotation.y) * Math.min(1, dt * 4);
      const shown = z.state !== "trapped" || (z.floor === floor && Math.sin(elapsed * 3 + z.phase) > 0.6);
      present(z.p, z.pos.x, z.floor, frozen ? 0 : dt);
      z.p.root.visible = z.p.root.visible && shown;
      if (z.p.root.visible && z.state !== "dance" && z.state !== "harmless" && z.state !== "chipped" && z.state !== "wrecking") {
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
      z.stars.visible = z.state === "dazed" || z.state === "stunned";
      if (z.state === "stunned") z.stars.visible = Math.sin(elapsed * 40) > -0.2;
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

    // ---- the devices: shaking while chewed, smoking once wrecked
    for (const d of deviceMeshes) {
      d.shake = Math.max(0, d.shake - dt * 2);
      d.g.rotation.z = d.shake > 0 ? Math.sin(elapsed * 40) * 0.05 * d.shake : 0;
      if (d.wrecked && Math.random() < 0.12) emit(new THREE.Vector3(d.g.position.x + (Math.random() - 0.5) * 0.4, d.g.position.y + 0.9, d.g.position.z), new THREE.Vector3(0, 0.6 + Math.random() * 0.4, 0.1), 0.25, new THREE.Color("#8a8a90"), 1.6);
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
      const m = l.mesh.material as THREE.MeshStandardMaterial;
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

    // ---- the key light follows her floor; the water moves; the city slides; the grade eases toward the vibe
    key.position.set(pos.x - 9, fy(floor) + 11, 16);
    key.target.position.set(pos.x, fy(floor) + 1.2, -2.6);
    set.waterMat.map?.offset.set(elapsed * 0.014, elapsed * 0.009);
    set.parallax(camPos.x);
    grade.uniforms.uWarm.value += (gradeWarm - grade.uniforms.uWarm.value) * Math.min(1, dt * 2.5);

    // ---- prompt
    if (!frozen) setPrompt(findPrompt());

    // ---- camera: a dollhouse shot of her floor; the party pulls back to the whole building
    // on the rope the camera comes in and looks up with her (gesture focus); the dollhouse shot returns at the top
    const onRope = !!climb && !finaleAt;
    const wantFov = finaleAt ? (camera.aspect < 1 ? 46 : 27) : onRope ? (camera.aspect < 1 ? 40 : 23) : camera.aspect < 1 ? 46 : 27;
    if (Math.abs(camera.fov - wantFov) > 0.05) {
      camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 3);
      camera.updateProjectionMatrix();
    }
    const goal = finaleAt
      ? new THREE.Vector3(WIDTH / 2, fy(1.6), 62)
      : onRope
        ? new THREE.Vector3(ropes[climb!.rope].x + 0.4, pos.y + 1.5, camera.aspect < 1 ? 7.8 : 8.4)
        : camera.aspect < 1
        ? new THREE.Vector3(THREE.MathUtils.clamp(pos.x, 2, WIDTH - 2), Math.max(fy(floor), pos.y - 1.2) + 3.9, 10.5)
        : new THREE.Vector3(THREE.MathUtils.clamp(pos.x, 5, WIDTH - 5), Math.max(fy(floor), pos.y - 1.2) + 3.5, 12.4);
    // on a phone the card covers the top third: aim above her so the floor sits in the open middle
    const look = finaleAt
      ? new THREE.Vector3(WIDTH / 2, fy(1.5), -2.5)
      : onRope
        ? new THREE.Vector3(ropes[climb!.rope].x, pos.y + 0.9, -2.0)
        : new THREE.Vector3(goal.x, Math.max(fy(floor), pos.y - 1.2) + (camera.aspect < 1 ? 2.3 : 1.35), -2.6);
    camPos.lerp(goal, Math.min(1, dt * (finaleAt ? 0.8 : 4)));
    camLook.lerp(look, Math.min(1, dt * (finaleAt ? 0.8 : 4)));
    camera.position.copy(camPos);
    camera.lookAt(camLook);

    if (softwareGl) {
      // SwiftShader has no GPU: avoid four full-screen post passes so simulation and input stay responsive.
      renderer.render(scene, camera);
    } else if (onMonitors && cctv) {
      if (cctv.follow(floor, pos.x)) reportCamera();
      cctv.render(elapsed, dt);
    } else {
      print.tick(elapsed);
      composer.render();
    }
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
      climbing: climb ? plannedHeight(climb.s) / FLOOR_H : null,
      stamina: climb ? climb.s.stamina : null,
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
      devices: deviceMeshes.map(d => ({ name: d.name, wrecked: d.wrecked })),
      wrecked: wreckedCount(),
      /** zombie night is on the monitors only with a real GPU */
      monitors: vibe === "zombie" && !!cctv && !finaleAt,
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
    /** zombie night, for a test: stand her by that slot's zombie and taze it */
    taze(slot: number) {
      const z = zombies[slot];
      if (!z) return;
      floor = z.floor;
      pos.set(z.pos.x - 1.2, fy(z.floor), z.pos.z);
      facing = 1;
      charges = Math.max(charges, 1);
      spray();
    },
    chip,
    wake,
    fuseOut,
    /** for a test on a slow renderer: chipped zombies walk and ride four times faster; the wreck itself is unchanged */
    hurry() {
      zombieHaste = 4;
    },
    /** what one frame costs: draw calls and triangles, plus which quality tier this device landed in */
    perf: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, programs: renderer.info.programs?.length ?? 0, softwareGl, highQuality, shadows }),
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
    climbHand(hand) {
      climbHand(hand);
    },
    chip,
    wake,
    fuseOut,
    setSprint(on) {
      sprintHeld = on;
    },
    respawn() {
      climb = null;
      callbacks.onClimb?.(null);
      landSquash = 0;
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
