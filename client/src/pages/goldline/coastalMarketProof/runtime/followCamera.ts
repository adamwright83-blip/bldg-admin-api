import * as THREE from "three";
import type { MeshBVH } from "three-mesh-bvh";
import { clamp, damp, dampAngle, dampFactor, smoothstep, wrapAngle } from "./motion";

/**
 * Third-person spring-arm camera.
 *
 * - The arm pivots on her upper back; the camera aims ahead of her and above,
 *   so in portrait she sits in the lower third and the vista fills the rest.
 * - Drag rotates the arm. After ~1.5 s without look input, while she walks,
 *   the arm swings back behind her heading.
 * - Descending (stairs, ramps) pitches the arm down so the next steps stay in view.
 * - The arm is ray-fanned against COL_cam (cliffs, buildings, the arch) and
 *   pulls in quickly, easing back out slowly.
 */
export type CameraTargetState = {
  position: THREE.Vector3;
  heading: number;
  speed: number;
  verticalRate: number;
};

const RECENTER_DELAY_MS = 1500;
const PIVOT_HEIGHT = 1.42;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const ray = new THREE.Ray();
const side = new THREE.Vector3();
const ARM_OFFSETS: readonly [number, number][] = [[0, 0], [0.22, 0], [-0.22, 0], [0, 0.18], [0, -0.18]];

export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  private pitch = 0.2;
  private userPitch = 0;
  private dist = 4.4;
  private readonly pivot = new THREE.Vector3();
  private readonly lead = new THREE.Vector3();
  private descentPitch = 0;
  private armLen = 4.4;
  private portrait = true;
  private readonly cam: MeshBVH;
  lastLookAt = -Infinity;
  /** QA only (?orbit=): hold the arm this far off her heading */
  orbit: number | null = null;

  constructor(camera: THREE.PerspectiveCamera, camCollider: MeshBVH) {
    this.camera = camera;
    this.cam = camCollider;
  }

  setViewport(width: number, height: number) {
    this.portrait = height >= width;
    this.camera.aspect = width / height;
    // portrait: 62 deg vertical; landscape: keep a comparable horizontal read
    this.camera.fov = this.portrait ? 62 : 50;
    this.dist = this.portrait ? 4.9 : 4.3;
    this.camera.updateProjectionMatrix();
  }

  snap(target: CameraTargetState) {
    this.yaw = target.heading;
    this.userPitch = 0;
    this.pivot.copy(target.position).add(tmp.set(0, PIVOT_HEIGHT, 0));
    this.lead.set(0, 0, 0);
    this.armLen = this.dist;
    for (let i = 0; i < 60; i++) this.update(target, { yaw: 0, pitch: 0 }, 1 / 30, -Infinity, true);
  }

  update(target: CameraTargetState, look: { yaw: number; pitch: number }, dt: number, now: number, settle = false) {
    // --- user look
    if (look.yaw !== 0 || look.pitch !== 0) {
      this.yaw = wrapAngle(this.yaw + look.yaw);
      this.userPitch = clamp(this.userPitch + look.pitch, -0.35, 0.55);
      this.lastLookAt = now;
    }
    // --- recenter behind her heading while she walks
    const idle = now - this.lastLookAt > RECENTER_DELAY_MS;
    if (this.orbit !== null) {
      this.yaw = target.heading + this.orbit;
    } else if (idle && target.speed > 0.3) {
      const k = smoothstep(0.3, 2.0, target.speed);
      this.yaw = dampAngle(this.yaw, target.heading, 1.1 / Math.max(0.25, k), dt);
      this.userPitch = damp(this.userPitch, 0, 1.6, dt);
    }
    // --- descent pitch (stairs / ramps)
    const descending = clamp(-target.verticalRate / 1.2, 0, 1);
    this.descentPitch = damp(this.descentPitch, descending * 0.16, 0.5, dt);
    this.pitch = 0.17 + this.descentPitch + this.userPitch;

    // --- pivot follows her with vertical lag (hides stair bob)
    const px = target.position.x;
    const pz = target.position.z;
    const py = target.position.y + PIVOT_HEIGHT;
    const hk = dampFactor(0.05, dt);
    this.pivot.x += (px - this.pivot.x) * hk;
    this.pivot.z += (pz - this.pivot.z) * hk;
    this.pivot.y = damp(this.pivot.y, py, 0.16, dt);
    // look-ahead in the direction of travel
    tmp.set(Math.sin(target.heading), 0, Math.cos(target.heading)).multiplyScalar(target.speed * 0.32);
    this.lead.lerp(tmp, dampFactor(0.35, dt));

    // --- desired arm
    const cp = Math.cos(this.pitch);
    const dir = tmp2.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const origin = tmp.copy(this.pivot).add(this.lead);
    const hitDist = this.castArm(origin, dir, this.dist);
    const wanted = Math.min(this.dist, hitDist);
    // pull in fast, ease out slow
    this.armLen = wanted < this.armLen ? damp(this.armLen, wanted, settle ? 0.001 : 0.04, dt) : damp(this.armLen, wanted, 0.45, dt);
    this.camera.position.copy(origin).addScaledVector(dir, this.armLen);
    if (this.camera.position.y < 0.6) this.camera.position.y = 0.6;

    // --- aim: ahead of her and above, so she lands in the lower third
    const aimAhead = this.portrait ? 5.0 : 3.8;
    const aimUp = this.portrait ? 0.95 : 0.45;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const aim = tmp2.copy(origin).add(tmp.set(fx * aimAhead, aimUp - aimAhead * Math.sin(this.pitch) * 0.45, fz * aimAhead));
    this.camera.lookAt(aim);
  }

  private castArm(origin: THREE.Vector3, dir: THREE.Vector3, len: number): number {
    let best = len;
    side.set(dir.z, 0, -dir.x).normalize();
    for (const [sx, sy] of ARM_OFFSETS) {
      ray.origin.copy(origin).addScaledVector(side, sx);
      ray.origin.y += sy;
      ray.direction.copy(dir);
      const hit = this.cam.raycastFirst(ray, THREE.DoubleSide, 0, len + 0.3);
      if (hit) best = Math.min(best, Math.max(0.6, hit.distance - 0.3));
    }
    return best;
  }
}
