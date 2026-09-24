import * as THREE from "three";
import { clamp, damp, smoothstep } from "./motion";

/**
 * Locomotion for a Quaternius UE-skeleton character.
 *
 * The pack's Walk_Loop is a slow stroll (0.98 m/s measured at the planted
 * foot). `deriveBriskWalk` builds the proof's walk from it: every leg, arm and
 * trunk rotation keeps its mean pose and scales its swing by `stride`, then
 * the pelvis is lowered per key so the lowest foot stays exactly where the
 * original clip planted it. Playback rate is always actual speed / measured
 * clip ground speed, so the planted foot never skates.
 */

// thighs carry the stride; knees and feet follow partly so the swing leg does
// not high-step; the trunk is left alone (scaling it reads as a waddle)
const STRIDE_BONES: Record<string, number> = {
  thigh_l: 1, thigh_r: 1, calf_l: 0.45, calf_r: 0.45, foot_l: 0.55, foot_r: 0.55, ball_l: 0.4, ball_r: 0.4,
  upperarm_l: 0.85, upperarm_r: 0.85, lowerarm_l: 0.5, lowerarm_r: 0.5,
};
const FOOT_BONES = ["ball_l", "ball_r", "foot_l", "foot_r"];

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qm = new THREE.Quaternion();
const axis = new THREE.Vector3();
const v = new THREE.Vector3();

function meanQuaternion(values: ArrayLike<number>): THREE.Quaternion {
  const n = values.length / 4;
  const ref = new THREE.Quaternion(values[0], values[1], values[2], values[3]);
  let x = 0, y = 0, z = 0, w = 0;
  for (let i = 0; i < n; i++) {
    qa.set(values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3]);
    const s = qa.dot(ref) < 0 ? -1 : 1;
    x += qa.x * s; y += qa.y * s; z += qa.z * s; w += qa.w * s;
  }
  return new THREE.Quaternion(x, y, z, w).normalize();
}

function scaleSwing(values: Float32Array | number[], k: number) {
  const mean = meanQuaternion(values);
  const inv = mean.clone().invert();
  const n = values.length / 4;
  for (let i = 0; i < n; i++) {
    qa.set(values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3]);
    qb.multiplyQuaternions(inv, qa); // deviation from the mean pose
    if (qb.w < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w);
    const angle = 2 * Math.acos(clamp(qb.w, -1, 1));
    const s = Math.sqrt(Math.max(1e-12, 1 - qb.w * qb.w));
    axis.set(qb.x / s, qb.y / s, qb.z / s);
    qb.setFromAxisAngle(axis, angle * k);
    qm.multiplyQuaternions(mean, qb);
    values[i * 4] = qm.x;
    values[i * 4 + 1] = qm.y;
    values[i * 4 + 2] = qm.z;
    values[i * 4 + 3] = qm.w;
  }
}

function boneOf(track: THREE.KeyframeTrack): string {
  return track.name.slice(0, track.name.lastIndexOf("."));
}

/** Lowest foot height per sample time, evaluating `clip` on `root`. */
function footFloor(root: THREE.Object3D, clip: THREE.AnimationClip, times: ArrayLike<number>, feet: THREE.Object3D[]): number[] {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  const out: number[] = [];
  for (let i = 0; i < times.length; i++) {
    action.time = times[i];
    mixer.update(0);
    root.updateMatrixWorld(true);
    let lo = Infinity;
    for (const f of feet) lo = Math.min(lo, f.getWorldPosition(v).y);
    out.push(lo);
  }
  action.stop();
  mixer.uncacheRoot(root);
  return out;
}

/** Ground speed of a walk clip: median backward speed of a planted foot (m/s at timeScale 1). */
export function measureGroundSpeed(root: THREE.Object3D, clip: THREE.AnimationClip): number {
  const feet = ["ball_l", "ball_r"].map(n => root.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  const steps = 96;
  const speeds: number[] = [];
  for (const foot of feet) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      action.time = (clip.duration * i) / steps;
      mixer.update(0);
      root.updateMatrixWorld(true);
      pts.push(foot.getWorldPosition(new THREE.Vector3()));
    }
    const minY = Math.min(...pts.map(p => p.y));
    const dt = clip.duration / steps;
    for (let i = 0; i < steps; i++) {
      if (pts[i].y < minY + 0.02 && pts[i + 1].y < minY + 0.02) {
        speeds.push(Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z) / dt);
      }
    }
  }
  action.stop();
  mixer.uncacheRoot(root);
  speeds.sort((a, b) => a - b);
  return speeds.length ? speeds[Math.floor(speeds.length / 2)] : 1;
}

export function deriveBriskWalk(root: THREE.Object3D, walk: THREE.AnimationClip, stride: number): THREE.AnimationClip {
  const clip = walk.clone();
  clip.name = "Walk_Brisk";
  for (const track of clip.tracks) {
    const bone = boneOf(track);
    const w = STRIDE_BONES[bone];
    if (w !== undefined && track instanceof THREE.QuaternionKeyframeTrack) {
      scaleSwing(track.values as Float32Array, 1 + (stride - 1) * w);
    }
  }
  // re-plant: lower the pelvis so the lowest foot matches the original clip per key
  const pelvisTrack = clip.tracks.find(t => t.name === "pelvis.position") as THREE.VectorKeyframeTrack | undefined;
  const pelvis = root.getObjectByName("pelvis");
  const feet = FOOT_BONES.map(n => root.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
  if (pelvisTrack && pelvis && pelvis.parent && feet.length) {
    const times = pelvisTrack.times;
    const before = footFloor(root, walk, times, feet);
    const after = footFloor(root, clip, times, feet);
    const parent = pelvis.parent;
    const parentScale = parent.getWorldScale(new THREE.Vector3()).y || 1;
    const parentQuatInv = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (let i = 0; i < times.length; i++) {
      const dy = (after[i] - before[i]) / parentScale;
      v.set(0, -dy, 0).applyQuaternion(parentQuatInv);
      pelvisTrack.values[i * 3] += v.x;
      pelvisTrack.values[i * 3 + 1] += v.y;
      pelvisTrack.values[i * 3 + 2] += v.z;
    }
  }
  return clip;
}

/**
 * Brisk walk by leg IK instead of rotation scaling: per sample, each foot's
 * forward offset from the pelvis is stretched by `stride`, the pelvis drops
 * only where a leg could not reach, and thigh + calf are re-solved in the
 * original knee plane with the original foot orientation. The planted foot
 * therefore moves exactly `stride` times as fast relative to the pelvis as in
 * the source clip, so playback at speed / measured ground speed does not skate.
 */
export function deriveBriskWalkIK(root: THREE.Object3D, walk: THREE.AnimationClip, stride: number): THREE.AnimationClip {
  const get = (n: string) => root.getObjectByName(n);
  const pelvis = get("pelvis");
  const legs = (["l", "r"] as const).map(s => ({ s, thigh: get(`thigh_${s}`), calf: get(`calf_${s}`), foot: get(`foot_${s}`), ball: get(`ball_${s}`) }));
  if (!pelvis || !pelvis.parent || legs.some(l => !l.thigh || !l.calf || !l.foot || !l.ball)) return deriveBriskWalk(root, walk, stride);
  const N = 48;
  const times = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) times[i] = (walk.duration * i) / N;
  const out: Record<string, Float32Array> = {};
  for (const l of legs) for (const b of ["thigh", "calf", "foot"]) out[`${b}_${l.s}`] = new Float32Array((N + 1) * 4);
  const pelvisOut = new Float32Array((N + 1) * 3);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(walk);
  action.play();
  const W = () => new THREE.Vector3();
  const Q = () => new THREE.Quaternion();
  const P = W(), H = W(), K = W(), A = W(), B = W(), At = W(), Hn = W(), Kn = W(), u = W(), pole = W(), tmpV = W();
  const qPel = Q(), qThigh = Q(), qCalf = Q(), qFoot = Q(), qT = Q(), qC = Q(), qLocal = Q(), qInv = Q();
  let fwd: THREE.Vector3 | null = null;
  for (let i = 0; i <= N; i++) {
    action.time = times[i];
    mixer.update(0);
    root.updateMatrixWorld(true);
    pelvis.getWorldPosition(P);
    pelvis.getWorldQuaternion(qPel);
    if (!fwd) {
      // toes point forward: foot -> ball, flattened
      legs[0].foot!.getWorldPosition(A);
      legs[0].ball!.getWorldPosition(B);
      fwd = new THREE.Vector3(B.x - A.x, 0, B.z - A.z).normalize();
    }
    // pass 1: how far must the pelvis drop so both stretched feet stay reachable?
    let drop = 0;
    const solved: { H: THREE.Vector3; K: THREE.Vector3; A: THREE.Vector3; At: THREE.Vector3; L1: number; L2: number }[] = [];
    for (const l of legs) {
      l.thigh!.getWorldPosition(H);
      l.calf!.getWorldPosition(K);
      l.foot!.getWorldPosition(A);
      const L1 = H.distanceTo(K);
      const L2 = K.distanceTo(A);
      At.copy(A).addScaledVector(fwd, tmpV.subVectors(A, P).dot(fwd) * (stride - 1));
      const dh = Math.hypot(At.x - H.x, At.z - H.z);
      const reach = (L1 + L2) * 0.995;
      const dv = H.y - At.y;
      const dvMax = Math.sqrt(Math.max(0, reach * reach - dh * dh));
      drop = Math.max(drop, dv - dvMax);
      solved.push({ H: H.clone(), K: K.clone(), A: A.clone(), At: At.clone(), L1, L2 });
    }
    drop = Math.max(0, drop);
    const pNew = P.clone();
    pNew.y -= drop;
    pelvis.parent.worldToLocal(pNew);
    pelvisOut.set([pNew.x, pNew.y, pNew.z], i * 3);
    // pass 2: two-bone IK per leg
    legs.forEach((l, li) => {
      const { H: H0, K: K0, A: A0, At: At0, L1, L2 } = solved[li];
      Hn.copy(H0);
      Hn.y -= drop;
      u.subVectors(At0, Hn);
      const d = THREE.MathUtils.clamp(u.length(), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
      u.normalize();
      const cosA = THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
      const sinA = Math.sqrt(1 - cosA * cosA);
      pole.subVectors(K0, H0);
      pole.addScaledVector(u, -pole.dot(u));
      if (pole.lengthSq() < 1e-8) pole.copy(fwd!);
      pole.normalize();
      Kn.copy(Hn).addScaledVector(u, L1 * cosA).addScaledVector(pole, L1 * sinA);
      l.thigh!.getWorldQuaternion(qThigh);
      l.calf!.getWorldQuaternion(qCalf);
      l.foot!.getWorldQuaternion(qFoot);
      qT.setFromUnitVectors(tmpV.subVectors(K0, H0).normalize(), W().subVectors(Kn, Hn).normalize());
      const thighNew = qT.clone().multiply(qThigh);
      const calfDir = tmpV.subVectors(A0, K0).normalize().applyQuaternion(qT);
      qC.setFromUnitVectors(calfDir, W().subVectors(At0, Kn).normalize().normalize());
      const calfNew = qC.clone().multiply(qT).multiply(qCalf);
      qLocal.copy(qInv.copy(qPel).invert()).multiply(thighNew);
      out[`thigh_${l.s}`].set([qLocal.x, qLocal.y, qLocal.z, qLocal.w], i * 4);
      qLocal.copy(qInv.copy(thighNew).invert()).multiply(calfNew);
      out[`calf_${l.s}`].set([qLocal.x, qLocal.y, qLocal.z, qLocal.w], i * 4);
      qLocal.copy(qInv.copy(calfNew).invert()).multiply(qFoot);
      out[`foot_${l.s}`].set([qLocal.x, qLocal.y, qLocal.z, qLocal.w], i * 4);
    });
  }
  action.stop();
  mixer.uncacheRoot(root);
  const replaced = new Set([...Object.keys(out).map(n => `${n}.quaternion`), "pelvis.position"]);
  const clip = walk.clone();
  clip.name = "Walk_Brisk";
  clip.tracks = clip.tracks.filter(t => !replaced.has(t.name));
  for (const [bone, values] of Object.entries(out)) clip.tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  clip.tracks.push(new THREE.VectorKeyframeTrack("pelvis.position", times, pelvisOut));
  // arms swing a little wider to match the longer stride
  for (const track of clip.tracks) {
    const bone = boneOf(track);
    if (/^(upperarm|lowerarm)_/.test(bone) && track instanceof THREE.QuaternionKeyframeTrack) {
      scaleSwing(track.values as Float32Array, 1 + (stride - 1) * (bone.startsWith("upper") ? 0.85 : 0.5));
    }
  }
  return clip;
}

export type LocomotionClips = {
  idle: THREE.AnimationClip;
  walk: THREE.AnimationClip;
  jog?: THREE.AnimationClip;
  sprint?: THREE.AnimationClip;
  jump?: THREE.AnimationClip;
  mantle?: THREE.AnimationClip;
};

/**
 * Blends idle and the brisk walk by speed, lets her step while turning on the
 * spot, and leans her into turns.
 */
export class Locomotion {
  readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction;
  private readonly walk: THREE.AnimationAction;
  private readonly jog?: THREE.AnimationAction;
  private readonly sprint?: THREE.AnimationAction;
  private readonly jump?: THREE.AnimationAction;
  private readonly mantle?: THREE.AnimationAction;
  readonly walkGroundSpeed: number;
  private lean = 0;
  private pitch = 0;
  private walkWeight = 0;
  private lastSpeed = 0;
  /** normalized walk phase 0..1, for footstep timing */
  phase = 0;
  private readonly body: THREE.Object3D;

  /** measured ground speeds (m/s at timeScale 1) of the jog and sprint clips, so their feet plant */
  private jogSpeed = 5.3;
  private sprintSpeed = 8.25;

  constructor(body: THREE.Object3D, root: THREE.Object3D, clips: LocomotionClips, groundSpeed: number) {
    this.body = body;
    this.body.rotation.order = "YXZ";
    this.mixer = new THREE.AnimationMixer(root);
    this.idle = this.mixer.clipAction(clips.idle);
    this.walk = this.mixer.clipAction(clips.walk);
    this.jog = clips.jog ? this.mixer.clipAction(clips.jog) : undefined;
    this.sprint = clips.sprint ? this.mixer.clipAction(clips.sprint) : undefined;
    this.jump = clips.jump ? this.mixer.clipAction(clips.jump) : undefined;
    this.mantle = clips.mantle ? this.mixer.clipAction(clips.mantle) : undefined;
    this.walkGroundSpeed = groundSpeed;
    for (const a of [this.idle, this.walk, this.jog, this.sprint, this.jump, this.mantle].filter((a): a is THREE.AnimationAction => !!a)) {
      a.play();
      a.setEffectiveWeight(0);
    }
    this.idle.setEffectiveWeight(1);
    if (clips.jog) this.jogSpeed = measureGroundSpeed(root, clips.jog);
    if (clips.sprint) this.sprintSpeed = measureGroundSpeed(root, clips.sprint);
  }

  get clipSpeeds() {
    return { walk: this.walkGroundSpeed, jog: this.jogSpeed, sprint: this.sprintSpeed };
  }

  private lastState = "idle";

  update(dt: number, speed: number, angularVelocity: number, state: "idle" | "jog" | "sprint" | "jump" | "mantle" | "hook" = "jog") {
    if (state !== this.lastState) {
      // one-shot clips start from their first frame when their state begins
      if (state === "mantle" && this.mantle) {
        this.mantle.reset();
        this.mantle.timeScale = 1.08;
      }
      this.lastState = state;
    }
    const turning = Math.abs(angularVelocity) > 1.2 && speed < 0.5;
    const target = Math.max(smoothstep(0.04, 0.55, speed), turning ? 0.55 : 0);
    this.walkWeight = damp(this.walkWeight, target, 0.09, dt);
    const rate = speed > 0.1 ? speed / this.walkGroundSpeed : turning ? 0.75 : 0.6;
    this.walk.timeScale = clamp(rate, 0.45, 2.2);
    const airborne = state === "jump" || state === "hook";
    const mantling = state === "mantle";
    const ground = airborne || mantling ? 0 : 1;
    // gaits blend by speed (the controller's state only says whether she is on the ground)
    const jogW = this.jog ? smoothstep(2.3, 3.3, speed) : 0;
    const sprintW = this.sprint ? smoothstep(6.1, 7.4, speed) : 0;
    const moving = this.walkWeight;
    this.walk.setEffectiveWeight(ground * moving * (1 - jogW));
    this.jog?.setEffectiveWeight(ground * moving * jogW * (1 - sprintW));
    this.sprint?.setEffectiveWeight(ground * moving * jogW * sprintW);
    this.jump?.setEffectiveWeight(airborne ? 1 : 0);
    this.mantle?.setEffectiveWeight(mantling ? 1 : 0);
    this.idle.setEffectiveWeight(ground * Math.max(0, 1 - moving));
    // playback follows actual speed over each clip's measured ground speed, so planted feet stay planted
    if (this.jog) this.jog.timeScale = clamp(speed / this.jogSpeed, 0.6, 1.6);
    if (this.sprint) this.sprint.timeScale = clamp(speed / this.sprintSpeed, 0.6, 1.5);
    this.mixer.update(dt);
    this.phase = (this.walk.time / this.walk.getClip().duration) % 1;

    // lean into turns, a touch forward when accelerating
    const accel = (speed - this.lastSpeed) / Math.max(dt, 1e-4);
    this.lastSpeed = speed;
    this.lean = damp(this.lean, clamp(-angularVelocity * speed * 0.035, -0.14, 0.14), 0.12, dt);
    this.pitch = damp(this.pitch, clamp(accel * 0.012, -0.05, 0.06), 0.2, dt);
    this.body.rotation.z = this.lean;
    this.body.rotation.x = this.pitch;
  }
}

const aimA = new THREE.Vector3();
const aimB = new THREE.Vector3();
const aimC = new THREE.Vector3();
const qWorld = new THREE.Quaternion();
const qParent = new THREE.Quaternion();
const qDelta = new THREE.Quaternion();
const qOrig = new THREE.Quaternion();

/** Rotate `bone` (by weight w) so the direction to `child` points along `dir` (world). */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3, w: number) {
  bone.getWorldPosition(aimA);
  child.getWorldPosition(aimB);
  aimC.subVectors(aimB, aimA).normalize();
  qDelta.setFromUnitVectors(aimC, dir);
  bone.getWorldQuaternion(qWorld);
  bone.parent!.getWorldQuaternion(qParent);
  qOrig.copy(bone.quaternion);
  bone.quaternion.copy(qParent.invert().multiply(qDelta.multiply(qWorld)));
  bone.quaternion.copy(qOrig.slerp(bone.quaternion, w));
  bone.updateMatrixWorld(true);
}

/**
 * Her hands on a hook: both arms reach from the shoulders to `target` (world),
 * layered over whatever clip is playing. There is no hang clip in the CC0
 * library, so this is the pose; weight 0 leaves the animation untouched.
 */
type Finger = { bones: THREE.Object3D[]; thumb: boolean };

export class ArmReach {
  private readonly arms: { upper: THREE.Object3D; lower: THREE.Object3D; hand: THREE.Object3D; knuckle: THREE.Object3D; side: number; fingers: Finger[] }[] = [];
  private readonly root: THREE.Object3D;
  constructor(root: THREE.Object3D) {
    this.root = root;
    for (const [s, side] of [["l", 1], ["r", -1]] as const) {
      const upper = root.getObjectByName(`upperarm_${s}`);
      const lower = root.getObjectByName(`lowerarm_${s}`);
      const hand = root.getObjectByName(`hand_${s}`);
      const knuckle = root.getObjectByName(`middle_01_${s}`);
      const fingers: Finger[] = [];
      for (const f of ["index", "middle", "ring", "pinky", "thumb"]) {
        const bones = [1, 2, 3].map(k => root.getObjectByName(`${f}_0${k}_${s}`)).filter((b): b is THREE.Object3D => !!b);
        if (bones.length) fingers.push({ bones, thumb: f === "thumb" });
      }
      if (upper && lower && hand && knuckle) this.arms.push({ upper, lower, hand, knuckle, side, fingers });
    }
  }

  /** Midpoint of her two sets of knuckles (where a bar sits in a closed grip), world space. */
  gripPoint(out: THREE.Vector3) {
    out.set(0, 0, 0);
    const v = new THREE.Vector3();
    for (const arm of this.arms) out.add(arm.knuckle.getWorldPosition(v));
    return out.multiplyScalar(1 / Math.max(1, this.arms.length));
  }

  /** Close the fingers around a bar: each segment turns toward the palm about the knuckle line. */
  close(weight: number) {
    if (weight <= 0.001) return;
    const hw = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const t = new THREE.Vector3();
    for (const arm of this.arms) {
      const index = arm.fingers.find(f => !f.thumb && f.bones[0].name.startsWith("index"));
      const pinky = arm.fingers.find(f => f.bones[0].name.startsWith("pinky"));
      const thumb = arm.fingers.find(f => f.thumb);
      if (!index || !pinky) continue;
      arm.hand.getWorldPosition(hw);
      index.bones[0].getWorldPosition(a);
      pinky.bones[0].getWorldPosition(b);
      const across = new THREE.Vector3().subVectors(a, b).normalize();
      const along = new THREE.Vector3().subVectors(arm.knuckle.getWorldPosition(t), hw).normalize();
      // the palm faces the side the thumb sits on
      const palm = new THREE.Vector3().crossVectors(along, across).normalize();
      if (thumb && palm.dot(thumb.bones[0].getWorldPosition(t).sub(hw)) > 0) palm.negate();
      for (const f of arm.fingers) {
        if (f.thumb) continue;
        f.bones.forEach((bone, k) => {
          const angle = [1.15, 1.35, 0.9][k] * weight;
          // pick the turn that brings the fingertip toward the palm
          const q = new THREE.Quaternion().setFromAxisAngle(across, angle);
          const child = f.bones[k + 1] ?? null;
          const base = bone.getWorldPosition(new THREE.Vector3());
          const tipDir = child ? child.getWorldPosition(new THREE.Vector3()).sub(base) : along.clone();
          const turned = tipDir.clone().applyQuaternion(q);
          if (turned.dot(palm) < tipDir.dot(palm)) q.setFromAxisAngle(across, -angle);
          rotateWorld(bone, q);
        });
      }
      if (thumb) {
        const q = new THREE.Quaternion().setFromAxisAngle(along, 0.5 * weight * arm.side);
        rotateWorld(thumb.bones[0], q);
      }
    }
    this.root.updateMatrixWorld(true);
  }

  apply(target: THREE.Vector3, facing: number, weight: number) {
    if (weight <= 0.001) return;
    const right = new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing));
    for (const arm of this.arms) {
      // each hand takes its own side of the bar, a shoulder-ish width apart
      const grip = new THREE.Vector3().copy(target).addScaledVector(right, -arm.side * 0.085);
      const shoulder = arm.upper.getWorldPosition(new THREE.Vector3());
      const toGrip = grip.clone().sub(shoulder);
      const reach = toGrip.length();
      const dir = toGrip.normalize();
      // straight-armed hang when the hook is at full reach; a bent elbow when it is closer
      const bend = THREE.MathUtils.clamp(1 - reach / 0.62, 0, 0.8);
      const elbowDir = dir.clone().addScaledVector(right, -arm.side * 0.35 * bend).normalize();
      aimBone(arm.upper, arm.lower, elbowDir, weight);
      const elbow = arm.lower.getWorldPosition(new THREE.Vector3());
      aimBone(arm.lower, arm.hand, grip.clone().sub(elbow).normalize(), weight);
    }
  }
}

const rwQ = new THREE.Quaternion();
const rpQ = new THREE.Quaternion();
/** Apply a world-space rotation to a bone and refresh its subtree. */
function rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion) {
  bone.getWorldQuaternion(rwQ);
  bone.parent!.getWorldQuaternion(rpQ);
  bone.quaternion.copy(rpQ.invert().multiply(q.clone().multiply(rwQ)));
  bone.updateMatrixWorld(true);
}
