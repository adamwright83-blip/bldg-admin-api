import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { MeshBVH } from "three-mesh-bvh";
import { withSunFog } from "./env";
import type { Route } from "./level";
import { patchDynamicSunVis } from "./materials";

/**
 * A handful of townspeople to sell habitation. No AI, no schedules: each one
 * has a spot, a clip, and at most a short back-and-forth walk. Distant ones
 * animate at a lower rate; the player is gently pushed out of their space.
 */
type Behavior = "lean" | "talk" | "folded" | "walk" | "carry" | "kneel";

type NpcDef = {
  model: "f" | "m";
  behavior: Behavior;
  s: number;
  /** metres toward the land side (+) or the sea side (-) of the route centre */
  side: number;
  /** extra metres along the route */
  along?: number;
  /** yaw offset from facing along the route, radians */
  face?: number;
  /** walkers: route range */
  walk?: [number, number];
  palette: string[];
};

// skin, top, legs, boots, hair, headwear, apron
const DEFS: NpcDef[] = [
  { model: "f", behavior: "lean", s: 34, side: -1.35, face: -Math.PI / 2, palette: ["#c99a78", "#6d4b8a", "#5a4a3c", "#2e2019", "#1c1512", "#b33a2c", "#d8c8a6"] },
  { model: "f", behavior: "talk", s: 47, side: 1.4, along: -0.55, face: Math.PI / 2 + 0.25, palette: ["#8c5a3c", "#2f6b73", "#6b5a44", "#2a1d15", "#15100d", "#e2d3b0", "#9b3b2e"] },
  { model: "m", behavior: "folded", s: 47, side: 1.25, along: 0.6, face: -Math.PI / 2 - 0.3, palette: ["#e0b394", "#b8873a", "#3f4a56", "#2a1d15", "#2b1d14", "#2b1d14", "#5b3a24"] },
  { model: "m", behavior: "walk", s: 30, side: -0.9, walk: [28, 44], palette: ["#b07a57", "#8a3a2a", "#4a3a2c", "#20160f", "#16110d", "#16110d", "#c9b58f"] },
  { model: "m", behavior: "carry", s: 152, side: 2.4, walk: [150.5, 158], palette: ["#6e4631", "#d8c8a6", "#50433a", "#20160f", "#0f0b09", "#0f0b09", "#7a5234"] },
  { model: "m", behavior: "kneel", s: 146.5, side: 1.4, face: -Math.PI / 2, palette: ["#d2a07f", "#3d5f7d", "#5c4b3b", "#20160f", "#8a8a86", "#8a8a86", "#6b4a2e"] },
];

const CLIP: Record<Behavior, string> = {
  lean: "Idle_Rail_Loop",
  talk: "Idle_Talking_Loop",
  folded: "Idle_FoldArms_Loop",
  walk: "Walk_Loop",
  carry: "Walk_Carry_Loop",
  kneel: "Fixing_Kneeling",
};
const GROUND_SPEED: Partial<Record<Behavior, number>> = { walk: 0.98, carry: 0.65 };

function paletteMaterial(src: THREE.Material, palette: THREE.Color[]): THREE.MeshLambertMaterial {
  const mat = withSunFog(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const uniform = { value: palette };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uPalette = uniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float _slot;\nuniform vec3 uPalette[7];\nvarying vec3 vPal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPal = uPalette[ int( clamp( _slot + 0.5, 0.0, 6.0 ) ) ];");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPal;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vPal;");
  };
  mat.customProgramCacheKey = () => "npc-palette";
  src.dispose();
  return mat;
}

type Npc = {
  def: NpcDef;
  root: THREE.Group;
  body: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  action: THREE.AnimationAction;
  sunVis: { value: number };
  pos: THREE.Vector3;
  yaw: number;
  dir: 1 | -1;
  walkS: number;
  turning: number;
  sunTimer: number;
  frame: number;
  crate?: THREE.Mesh;
  hands?: [THREE.Object3D, THREE.Object3D];
};

export function createNpcs(opts: {
  scene: THREE.Scene;
  route: Route;
  models: { f: GLTF; m: GLTF };
  clips: THREE.AnimationClip[];
  sunDir: THREE.Vector3;
  camCollider: MeshBVH;
}) {
  const { scene, route, models, sunDir, camCollider } = opts;
  const clips = new Map(opts.clips.map(c => [c.name, c]));
  const group = new THREE.Group();
  group.name = "npcs";
  scene.add(group);
  const npcs: Npc[] = [];
  const disposables: { dispose(): void }[] = [];
  const crateMat = withSunFog(new THREE.MeshLambertMaterial({ color: "#7a5636" }));
  const crateGeo = new THREE.BoxGeometry(0.46, 0.34, 0.36);
  disposables.push(crateMat, crateGeo);

  const place = (s: number, side: number, along: number, out: THREE.Vector3) => {
    const p = route.at(s + along, out);
    const d = route.dirAt(s + along);
    // land side in three is (d.z, -d.x)
    p.x += d.z * side;
    p.z += -d.x * side;
    return d;
  };
  const ray = new THREE.Ray();
  const sunAt = (p: THREE.Vector3) => {
    ray.origin.copy(p).add(new THREE.Vector3(0, 1.3, 0));
    ray.direction.copy(sunDir);
    return camCollider.raycastFirst(ray, THREE.DoubleSide, 0.3, 250) ? 0.0 : 1.0;
  };

  for (const def of DEFS) {
    const clip = clips.get(CLIP[def.behavior]);
    if (!clip) continue;
    const body = SkeletonUtils.clone(models[def.model].scene);
    const palette = def.palette.map(c => new THREE.Color(c));
    const sunVis = { value: 1 };
    body.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.material = paletteMaterial(m.material as THREE.Material, palette);
      patchDynamicSunVis(m.material, sunVis);
      m.castShadow = false;
      m.receiveShadow = true;
      m.frustumCulled = false;
      disposables.push(m.material);
    });
    const root = new THREE.Group();
    root.add(body);
    group.add(root);
    const mixer = new THREE.AnimationMixer(body);
    const action = mixer.clipAction(clip);
    action.play();
    action.time = Math.random() * clip.duration;
    const pos = new THREE.Vector3();
    const d = place(def.s, def.side, def.along ?? 0, pos);
    const npc: Npc = {
      def, root, body, mixer, action, sunVis, pos,
      yaw: Math.atan2(d.x, d.z) + (def.face ?? 0),
      dir: 1, walkS: def.s, turning: 0, sunTimer: 0, frame: 0,
    };
    if (def.behavior === "carry") {
      npc.crate = new THREE.Mesh(crateGeo, crateMat);
      root.add(npc.crate);
      const hl = body.getObjectByName("hand_l");
      const hr = body.getObjectByName("hand_r");
      if (hl && hr) npc.hands = [hl, hr];
    }
    sunVis.value = sunAt(pos);
    npcs.push(npc);
  }

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  return {
    group,
    count: npcs.length,
    update(dt: number, camPos: THREE.Vector3) {
      for (const n of npcs) {
        const def = n.def;
        if (def.walk) {
          const speed = GROUND_SPEED[def.behavior] ?? 1;
          if (n.turning > 0) {
            n.turning -= dt;
            n.action.timeScale = 0.4;
          } else {
            n.walkS += n.dir * speed * dt;
            n.action.timeScale = 1;
            if (n.walkS > def.walk[1] || n.walkS < def.walk[0]) {
              n.walkS = THREE.MathUtils.clamp(n.walkS, def.walk[0], def.walk[1]);
              n.dir = n.dir === 1 ? -1 : 1;
              n.turning = 1.1;
            }
          }
          const d = place(n.walkS, def.side * n.dir, 0, n.pos);
          const target = Math.atan2(d.x * n.dir, d.z * n.dir);
          let diff = target - n.yaw;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          n.yaw += diff * Math.min(1, dt * (n.turning > 0 ? 3 : 8));
          n.sunTimer += dt;
          if (n.sunTimer > 0.5) {
            n.sunTimer = 0;
            n.sunVis.value = sunAt(n.pos);
          }
        }
        n.root.position.copy(n.pos);
        n.root.rotation.y = n.yaw;
        // animation LOD: full rate near the camera, a quarter of the updates far away
        const dist = n.pos.distanceTo(camPos);
        const rate = dist < 35 ? 1 : dist < 80 ? 2 : 4;
        n.frame = (n.frame + 1) % rate;
        if (n.frame === 0 && dist < 160) n.mixer.update(dt * rate);
        if (n.crate && n.hands) {
          n.root.updateMatrixWorld(true);
          n.hands[0].getWorldPosition(tmp);
          n.hands[1].getWorldPosition(tmp2);
          tmp.add(tmp2).multiplyScalar(0.5);
          n.root.worldToLocal(tmp);
          n.crate.position.copy(tmp).add(new THREE.Vector3(0, 0.12, 0.06));
        }
      }
    },
    /** keep the player out of their personal space */
    pushOut(p: THREE.Vector3) {
      for (const n of npcs) {
        const dx = p.x - n.pos.x;
        const dz = p.z - n.pos.z;
        const r = n.def.behavior === "kneel" ? 0.7 : 0.55;
        const dd = dx * dx + dz * dz;
        if (dd < r * r && dd > 1e-6) {
          const k = r / Math.sqrt(dd);
          p.x = n.pos.x + dx * k;
          p.z = n.pos.z + dz * k;
        }
      }
    },
    dispose() {
      for (const n of npcs) n.mixer.stopAllAction();
      disposables.forEach(d => d.dispose());
      scene.remove(group);
    },
  };
}
