import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { makeBag } from "./props.js";

// CC0 Quaternius townsfolk (one skinned mesh, per-vertex palette slot in _slot):
// 0 skin, 1 top, 2 legs, 3 boots, 4 hair, 5 headwear, 6 apron/belt.
function paletteMaterial(palette) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0 });
  const uniform = { value: palette };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPalette = uniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float _slot;\nuniform vec3 uPalette[7];\nvarying vec3 vPal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPal = uPalette[ int( clamp( _slot + 0.5, 0.0, 6.0 ) ) ];");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPal;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vPal;");
  };
  mat.customProgramCacheKey = () => "worker-palette";
  return mat;
}

const CLIP = {
  idle: "Idle_Loop",
  talk: "Idle_Talking_Loop",
  folded: "Idle_FoldArms_Loop",
  walk: "Walk_Loop",
  carry: "Walk_Carry_Loop",
  kneel: "Fixing_Kneeling",
};

const SHIRT = "#17181c";
export async function loadWorkers(parent, defs) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [f, m, a, b] = await Promise.all(
    ["townsfolk_f", "townsfolk_m", "anims_a", "anims_b"].map((n) => loader.loadAsync(new URL(`./assets/${n}.glb`, import.meta.url).href)),
  );
  const clips = new Map([...a.animations, ...b.animations].map((c) => [c.name, c]));
  const box = new THREE.Box3().setFromObject(m.scene);
  const baseH = box.max.y - box.min.y;
  const workers = defs.map((d, i) => {
    const body = SkeletonUtils.clone((d.model === "f" ? f : m).scene);
    const pal = [d.skin, SHIRT, d.legs || "#2b2f38", "#1a1a1c", d.hair || "#16110d", d.head || d.hair || "#16110d", d.apron || SHIRT].map((c) => new THREE.Color(c));
    body.traverse((o) => {
      if (!o.isMesh) return;
      o.material = paletteMaterial(pal);
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    });
    const root = new THREE.Group();
    root.add(body);
    root.scale.setScalar((d.h || 1.74) / baseH);
    root.position.set(d.x, 0, d.z);
    root.rotation.y = d.yaw;
    parent.add(root);
    const mixer = new THREE.AnimationMixer(body);
    const action = mixer.clipAction(clips.get(CLIP[d.act]));
    action.play();
    const w = { d, root, body, mixer, action, offset: d.phase ?? i * 0.37, blend: 0 };
    if (d.act2) {
      w.action2 = mixer.clipAction(clips.get(CLIP[d.act2]));
      w.action2.play();
      w.action2.setEffectiveWeight(0);
    }
    if (d.act === "carry") {
      w.bag = makeBag(d.bag || 0xf1efe9, 40 + i, 0.5, 0.42, 0.42);
      parent.add(w.bag);
      w.hands = [body.getObjectByName("hand_l"), body.getObjectByName("hand_r")];
    }
    return w;
  });
  const a1 = new THREE.Vector3(),
    a2 = new THREE.Vector3();
  return {
    workers,
    update(t) {
      for (const w of workers) {
        if (w.action2) {
          w.action.setEffectiveWeight(1 - w.blend);
          w.action2.setEffectiveWeight(w.blend);
        }
        w.mixer.setTime(t + w.offset);
        if (w.d.path) {
          const [x0, z0, x1, z1, speed] = w.d.path;
          const len = Math.hypot(x1 - x0, z1 - z0);
          const k = ((t * speed) % len) / len;
          w.root.position.set(x0 + (x1 - x0) * k, 0, z0 + (z1 - z0) * k);
        }
        if (w.bag && w.hands[0]) {
          w.root.updateMatrixWorld(true);
          w.hands[0].getWorldPosition(a1);
          w.hands[1].getWorldPosition(a2);
          w.bag.position.copy(a1).add(a2).multiplyScalar(0.5);
          w.bag.position.y -= 0.02;
          w.bag.rotation.y = w.root.rotation.y;
        }
      }
    },
  };
}
