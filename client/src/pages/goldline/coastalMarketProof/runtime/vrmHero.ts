import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

/**
 * Trailblazer as a VRoid Studio character (VRM 1.0), worn over the proof's existing rig.
 *
 * The game still animates the Quaternius skeleton it always has: locomotion blends, the mantle,
 * the hang, the arm IK that closes her hands on a toggle, the spring bones. That skeleton is now
 * invisible. Every frame this copies its pose onto the VRM's normalized humanoid, bone by bone:
 * both rigs are bound in a T-pose facing +Z, so a bone's rotation away from its bind pose (in the
 * character's own space) is the same rotation on the other rig. The VRM then runs its own spring
 * bones (the ponytail, the holster) and expressions (a blink).
 */
const SIDES = [
  ["l", "left"],
  ["r", "right"],
] as const;
const FINGERS = [
  ["index", "Index"],
  ["middle", "Middle"],
  ["ring", "Ring"],
  ["pinky", "Little"],
] as const;

export function vrmBoneMap(): Array<[string, VRMHumanBoneName]> {
  const m: Array<[string, string]> = [
    ["pelvis", "hips"],
    ["spine_01", "spine"],
    ["spine_02", "chest"],
    ["spine_03", "upperChest"],
    ["neck_01", "neck"],
    ["Head", "head"],
  ];
  for (const [s, side] of SIDES) {
    m.push(
      [`clavicle_${s}`, `${side}Shoulder`],
      [`upperarm_${s}`, `${side}UpperArm`],
      [`lowerarm_${s}`, `${side}LowerArm`],
      [`hand_${s}`, `${side}Hand`],
      [`thigh_${s}`, `${side}UpperLeg`],
      [`calf_${s}`, `${side}LowerLeg`],
      [`foot_${s}`, `${side}Foot`],
      [`ball_${s}`, `${side}Toes`],
      [`thumb_01_${s}`, `${side}ThumbMetacarpal`],
      [`thumb_02_${s}`, `${side}ThumbProximal`],
      [`thumb_03_${s}`, `${side}ThumbDistal`]
    );
    for (const [q, v] of FINGERS) {
      m.push([`${q}_01_${s}`, `${side}${v}Proximal`], [`${q}_02_${s}`, `${side}${v}Intermediate`], [`${q}_03_${s}`, `${side}${v}Distal`]);
    }
  }
  return m as Array<[string, VRMHumanBoneName]>;
}

type Entry = {
  src: THREE.Bone;
  bindInv: THREE.Quaternion; // inverse of the source bone's bind rotation (mesh space)
  node: THREE.Object3D; // the VRM's normalized bone
  parent: number; // index of the nearest mapped ancestor, -1 for the hips
  delta: THREE.Quaternion;
};

export class VrmHero {
  readonly vrm: VRM;
  /** VRM units per rig unit is 1 / scale: the VRM is scaled so its hips sit where the rig's pelvis does. */
  readonly scale: number;
  private readonly source: THREE.SkinnedMesh;
  private readonly entries: Entry[] = [];
  private readonly hipsRest = new THREE.Vector3();
  private readonly pelvisBind = new THREE.Vector3();
  private readonly inv = new THREE.Matrix4();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private blinkIn = 2.5;
  private blinkT = -1;

  private readonly follow: THREE.Object3D;

  /**
   * source: a skinned mesh of the rig (for its bind pose); follow: the object whose world transform the
   * VRM takes each frame. The VRM stays out of the rig's hierarchy on purpose: the runtime refreshes
   * that hierarchy's matrices several times a frame (arm IK, the hang), and carrying the VRM's ~125
   * nodes and spring bones through each refresh cost more than the whole frame used to.
   */
  constructor(vrm: VRM, source: THREE.SkinnedMesh, follow: THREE.Object3D) {
    this.vrm = vrm;
    this.source = source;
    this.follow = follow;
    const humanoid = vrm.humanoid;
    const bindOf = (bone: THREE.Bone) => {
      const i = source.skeleton.bones.indexOf(bone);
      return this.m.copy(source.skeleton.boneInverses[i]).invert();
    };
    const byName = new Map(source.skeleton.bones.map(b => [b.name, b]));
    const nodes: THREE.Object3D[] = [];
    for (const [srcName, vrmName] of vrmBoneMap()) {
      const src = byName.get(srcName);
      const node = humanoid.getNormalizedBoneNode(vrmName);
      if (!src || !node) continue;
      bindOf(src).decompose(this.p, this.q, this.s);
      this.entries.push({ src, bindInv: this.q.clone().invert(), node, parent: -1, delta: new THREE.Quaternion() });
      nodes.push(node);
    }
    // parent = nearest mapped ancestor in the VRM hierarchy (entries are listed parents first)
    this.entries.forEach(e => {
      for (let a = e.node.parent; a; a = a.parent) {
        const i = nodes.indexOf(a);
        if (i >= 0) {
          e.parent = i;
          break;
        }
      }
    });
    const pelvis = byName.get("pelvis");
    const hips = humanoid.getNormalizedBoneNode("hips");
    if (!pelvis || !hips) throw new Error("VrmHero: no pelvis/hips");
    bindOf(pelvis).decompose(this.pelvisBind, this.q, this.s);
    this.hipsRest.copy(hips.position);
    vrm.scene.updateMatrixWorld(true);
    const hipsY = hips.getWorldPosition(this.p).y;
    this.scale = this.pelvisBind.y / hipsY;
    vrm.scene.scale.setScalar(this.scale);
  }

  /** Copy the rig's current pose onto the VRM, then run its springs and expressions. */
  update(dt: number) {
    const { entries } = this;
    this.follow.matrixWorld.decompose(this.vrm.scene.position, this.vrm.scene.quaternion, this.s);
    this.vrm.scene.updateMatrixWorld(true);
    this.inv.copy(this.source.matrixWorld).invert();
    for (const e of entries) {
      this.m.multiplyMatrices(this.inv, e.src.matrixWorld).decompose(this.p, this.q, this.s);
      e.delta.multiplyQuaternions(this.q, e.bindInv);
    }
    for (const e of entries) {
      if (e.parent < 0) e.node.quaternion.copy(e.delta);
      else e.node.quaternion.copy(entries[e.parent].delta).invert().multiply(e.delta);
    }
    // the hips also carry the rig's pelvis translation (bob, crouch, the mantle's climb)
    const hips = entries[0];
    this.m.multiplyMatrices(this.inv, hips.src.matrixWorld).decompose(this.p, this.q, this.s);
    hips.node.position.copy(this.hipsRest).addScaledVector(this.p.sub(this.pelvisBind), 1 / this.scale);
    this.blink(dt);
    this.vrm.update(dt);
  }

  /** Move her (without re-posing) by a world offset. */
  shift(offset: THREE.Vector3) {
    this.vrm.scene.position.add(offset);
    this.vrm.scene.updateMatrixWorld(true);
  }

  /** Midpoint of her middle-finger knuckles (world), where a held bar sits. */
  gripPoint(out: THREE.Vector3) {
    const h = this.vrm.humanoid;
    const l = h.getRawBoneNode("leftMiddleProximal");
    const r = h.getRawBoneNode("rightMiddleProximal");
    if (!l || !r) return out.set(0, 0, 0);
    this.vrm.scene.updateMatrixWorld(true);
    l.getWorldPosition(out);
    return out.add(r.getWorldPosition(this.p)).multiplyScalar(0.5);
  }

  private blink(dt: number) {
    const ex = this.vrm.expressionManager;
    if (!ex) return;
    if (this.blinkT < 0) {
      this.blinkIn -= dt;
      if (this.blinkIn <= 0) this.blinkT = 0;
      return;
    }
    this.blinkT += dt;
    const k = this.blinkT / 0.16;
    ex.setValue("blink", k < 1 ? Math.sin(k * Math.PI) : 0);
    if (k >= 1) {
      this.blinkT = -1;
      this.blinkIn = 1.8 + Math.random() * 3.5;
    }
  }
}
