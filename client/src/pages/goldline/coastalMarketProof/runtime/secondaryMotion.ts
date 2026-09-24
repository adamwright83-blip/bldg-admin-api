import * as THREE from "three";

/**
 * Secondary motion for the satchel and the bandana chain. With the ponytail gone
 * (approved change 2) this is what moves on her back and hips from the gameplay
 * camera. Each bone is a damped pendulum driven by the hips' acceleration and the
 * shared wind, applied on top of its rest pose after the animation mixer runs.
 */
type Pendulum = {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  /** swing angles about the parent's local X (forward/back) and Z (sideways) */
  ax: number;
  az: number;
  vx: number;
  vz: number;
  stiffness: number;
  damping: number;
  gain: number;
  wind: number;
};

const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const worldAcc = new THREE.Vector3();
const localAcc = new THREE.Vector3();
const invQ = new THREE.Quaternion();

export class SecondaryMotion {
  private readonly chains: Pendulum[] = [];
  private readonly lastPos = new THREE.Vector3();
  private readonly lastVel = new THREE.Vector3();
  private readonly pelvis: THREE.Object3D | null;
  private primed = false;

  constructor(root: THREE.Object3D) {
    this.pelvis = root.getObjectByName("pelvis") ?? null;
    const add = (name: string, stiffness: number, damping: number, gain: number, wind: number) => {
      const bone = root.getObjectByName(name) as THREE.Bone | undefined;
      if (!bone) return;
      this.chains.push({ bone, rest: bone.quaternion.clone(), ax: 0, az: 0, vx: 0, vz: 0, stiffness, damping, gain, wind });
    };
    add("satchel", 60, 7, 0.9, 0.15);
    add("bandana_1", 38, 4.5, 1.1, 0.55);
    add("bandana_2", 30, 3.5, 1.2, 0.8);
    add("bandana_3", 24, 3.0, 1.3, 1.0);
  }

  get active() {
    return this.chains.length > 0;
  }

  update(dt: number, time: number, wind: THREE.Vector3) {
    if (!this.pelvis || !this.chains.length || dt <= 0) return;
    const p = this.pelvis.getWorldPosition(new THREE.Vector3());
    if (!this.primed) {
      this.lastPos.copy(p);
      this.primed = true;
    }
    const vel = p.clone().sub(this.lastPos).divideScalar(dt);
    worldAcc.copy(vel).sub(this.lastVel).divideScalar(dt).clampLength(0, 25);
    this.lastPos.copy(p);
    this.lastVel.copy(vel);
    const gust = 0.5 + 0.5 * Math.sin(time * 0.7) * Math.sin(time * 0.23 + 1.3);
    for (const c of this.chains) {
      const parent = c.bone.parent;
      if (!parent) continue;
      parent.getWorldQuaternion(invQ).invert();
      // the hanging part lags behind the hips: push opposite to acceleration, plus wind
      localAcc.copy(worldAcc).multiplyScalar(-0.03 * c.gain).addScaledVector(wind, c.wind * gust * (0.8 + 0.4 * Math.sin(time * 5.1 + c.stiffness)));
      localAcc.applyQuaternion(invQ);
      const ax = c.ax, az = c.az;
      c.vx += (-c.stiffness * ax - c.damping * c.vx + localAcc.z * c.stiffness) * dt;
      c.vz += (-c.stiffness * az - c.damping * c.vz - localAcc.x * c.stiffness) * dt;
      c.ax = THREE.MathUtils.clamp(ax + c.vx * dt, -0.7, 0.7);
      c.az = THREE.MathUtils.clamp(az + c.vz * dt, -0.6, 0.6);
      tmpQ.setFromEuler(tmpE.set(c.ax, 0, c.az));
      c.bone.quaternion.copy(c.rest).premultiply(tmpQ);
    }
  }
}
