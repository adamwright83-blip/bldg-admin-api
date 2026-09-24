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

export type LocomotionClips = { idle: THREE.AnimationClip; walk: THREE.AnimationClip };

/**
 * Blends idle and the brisk walk by speed, lets her step while turning on the
 * spot, and leans her into turns.
 */
export class Locomotion {
  readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction;
  private readonly walk: THREE.AnimationAction;
  readonly walkGroundSpeed: number;
  private lean = 0;
  private pitch = 0;
  private walkWeight = 0;
  private lastSpeed = 0;
  /** normalized walk phase 0..1, for footstep timing */
  phase = 0;
  private readonly body: THREE.Object3D;

  constructor(body: THREE.Object3D, root: THREE.Object3D, clips: LocomotionClips, groundSpeed: number) {
    this.body = body;
    this.body.rotation.order = "YXZ";
    this.mixer = new THREE.AnimationMixer(root);
    this.idle = this.mixer.clipAction(clips.idle);
    this.walk = this.mixer.clipAction(clips.walk);
    this.walkGroundSpeed = groundSpeed;
    for (const a of [this.idle, this.walk]) {
      a.play();
      a.setEffectiveWeight(0);
    }
    this.idle.setEffectiveWeight(1);
  }

  update(dt: number, speed: number, angularVelocity: number) {
    const turning = Math.abs(angularVelocity) > 1.2 && speed < 0.5;
    const target = Math.max(smoothstep(0.04, 0.55, speed), turning ? 0.55 : 0);
    this.walkWeight = damp(this.walkWeight, target, 0.09, dt);
    const rate = speed > 0.1 ? speed / this.walkGroundSpeed : turning ? 0.75 : 0.6;
    this.walk.timeScale = clamp(rate, 0.45, 2.2);
    this.walk.setEffectiveWeight(this.walkWeight);
    this.idle.setEffectiveWeight(1 - this.walkWeight);
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
