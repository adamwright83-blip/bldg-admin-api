import * as THREE from "three";
import type { MeshBVH } from "three-mesh-bvh";
import type { Colliders, Route } from "./level";
import { Spring, clamp, dampFactor, wrapAngle } from "./motion";
import type { MoveVector } from "./input";

/**
 * Walking controller. Movement follows her facing (no sideways skating); the
 * facing turns on a critically damped spring. Walls are a capsule shapecast
 * against COL_wall; the floor is a downward ray on COL_walk. A step that
 * would leave the walkable floor, or climb more than a stair riser at once,
 * is refused, so she cannot fall off the route or scale a wall.
 */
export const WALK_SPEED = 5.3;
export const SPRINT_SPEED = 8.25;
const ACCEL_TAU = 0.075;
const TURN_OMEGA = 16; // ~0.12 s settle
const CAPSULE_RADIUS = 0.3;
const CAPSULE_LOW = 0.55;
const CAPSULE_HIGH = 1.45;
const MAX_STEP_UP = 0.48;
const MANTLE_HEIGHT = 1.15;
const GRAVITY = 22;
const JUMP_VELOCITY = 8.2;

const tmpSeg = new THREE.Line3();
const tmpBox = new THREE.Box3();
const triPoint = new THREE.Vector3();
const capPoint = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);

export class PlayerController {
  readonly position = new THREE.Vector3();
  heading = 0;
  speed = 0;
  angularVelocity = 0;
  routeIndex = 0;
  progress = 0;
  surface: "stone" | "wood" = "stone";
  /** vertical speed of the feet; negative while descending */
  verticalRate = 0;
  grounded = true;
  locomotion: "idle" | "jog" | "sprint" | "jump" | "mantle" | "hook" = "idle";
  private verticalVelocity = 0;
  private fullTiltSeconds = 0;
  private mantleSeconds = 0;
  private readonly turn = new Spring(0);
  private readonly colliders: Colliders;
  private readonly route: Route;
  private readonly surfaceByKind: Record<string, "stone" | "wood">;
  frozen = false;

  constructor(colliders: Colliders, route: Route, surfaceByKind: Record<string, "stone" | "wood">) {
    this.colliders = colliders;
    this.route = route;
    this.surfaceByKind = surfaceByKind;
  }

  placeAt(s: number) {
    const p = this.route.at(s);
    const d = this.route.dirAt(s);
    this.position.copy(p);
    this.heading = Math.atan2(d.x, d.z);
    this.turn.value = this.heading;
    this.turn.velocity = 0;
    this.speed = 0;
    const g = this.groundAt(p.x, p.z, p.y + 1);
    if (g !== null) this.position.y = g;
    this.routeIndex = this.route.nearest(this.position);
    this.progress = this.route.samples[this.routeIndex].s;
  }

  /** `move` is camera-relative (x right, y forward); `cameraYaw` is the camera's heading. */
  update(move: MoveVector, cameraYaw: number, dt: number, jump = false, forceSprint = false) {
    const mag = this.frozen ? 0 : Math.min(1, Math.hypot(move.x, move.y));
    let targetSpeed = 0;
    if (mag > 0) {
      // camera forward = (sin yaw, cos yaw); right = (cos yaw, -sin yaw) in xz
      const fx = Math.sin(cameraYaw);
      const fz = Math.cos(cameraYaw);
      const wx = fx * move.y + -fz * move.x;
      const wz = fz * move.y + fx * move.x;
      const desired = Math.atan2(wx, wz);
      const before = this.turn.value;
      this.turn.step(desired, TURN_OMEGA, dt, true);
      this.angularVelocity = wrapAngle(this.turn.value - before) / Math.max(dt, 1e-4);
      // a sharp reversal pivots before striding off
      const misalign = Math.abs(wrapAngle(desired - this.turn.value));
      this.fullTiltSeconds = mag > 0.92 ? this.fullTiltSeconds + dt : 0;
      const sprint = forceSprint || this.fullTiltSeconds > 0.75;
      targetSpeed = (sprint ? SPRINT_SPEED : WALK_SPEED) * mag * clamp(1.15 - misalign / 1.9, 0.15, 1);
    } else {
      this.angularVelocity *= 1 - dampFactor(0.08, dt);
      this.turn.velocity = 0;
      this.fullTiltSeconds = 0;
    }
    this.heading = this.turn.value;
    this.speed += (targetSpeed - this.speed) * dampFactor(ACCEL_TAU * (targetSpeed < this.speed ? 0.8 : 1), dt);
    if (this.speed < 0.01 && targetSpeed === 0) this.speed = 0;

    if (jump && this.grounded && !this.frozen) {
      this.verticalVelocity = JUMP_VELOCITY;
      this.grounded = false;
    }
    const step = this.speed * dt;
    const prevY = this.position.y;
    if (step > 0) this.moveHorizontal(Math.sin(this.heading) * step, Math.cos(this.heading) * step);
    if (!this.grounded) {
      this.verticalVelocity -= GRAVITY * dt;
      this.position.y += this.verticalVelocity * dt;
      const ground = this.groundAt(this.position.x, this.position.z, this.position.y + 2.2);
      if (ground !== null && this.verticalVelocity <= 0 && this.position.y <= ground) {
        this.position.y = ground;
        this.verticalVelocity = 0;
        this.grounded = true;
      }
    }
    this.mantleSeconds = Math.max(0, this.mantleSeconds - dt);
    this.verticalRate = (this.position.y - prevY) / Math.max(dt, 1e-4);
    this.locomotion = this.mantleSeconds > 0 ? "mantle" : !this.grounded ? "jump" : this.speed > 6.4 ? "sprint" : this.speed > 0.25 ? "jog" : "idle";

    this.routeIndex = this.route.nearest(this.position, this.routeIndex);
    const smp = this.route.samples[this.routeIndex];
    this.progress = smp.s;
    this.surface = this.surfaceByKind[smp.kind] ?? "stone";
  }

  private moveHorizontal(dx: number, dz: number) {
    const start = this.position.clone();
    const target = start.clone();
    target.x += dx;
    target.z += dz;
    this.resolveWalls(target);
    const g = this.groundAt(target.x, target.z, start.y + MANTLE_HEIGHT + 0.35);
    if (g !== null && this.grounded && g - start.y > MAX_STEP_UP && g - start.y <= MANTLE_HEIGHT && this.speed > 3.5) {
      this.position.set(target.x, g, target.z);
      this.mantleSeconds = 0.42;
      return;
    }
    if (this.grounded && (g === null || g - start.y > MAX_STEP_UP)) {
      // slide along the edge: try each axis on its own before refusing
      for (const [ax, az] of [[dx, 0], [0, dz]] as const) {
        const t2 = start.clone();
        t2.x += ax;
        t2.z += az;
        this.resolveWalls(t2);
        const g2 = this.groundAt(t2.x, t2.z, start.y + MAX_STEP_UP + 0.3);
        if (g2 !== null && g2 - start.y <= MAX_STEP_UP) {
          this.position.set(t2.x, g2, t2.z);
          return;
        }
      }
      return;
    }
    if (this.grounded && g !== null) this.position.set(target.x, g, target.z);
    else this.position.set(target.x, this.position.y, target.z);
  }

  /** Authored tension beats feed the same controller rather than teleporting the camera. */
  pullToward(target: THREE.Vector3, strength: number, dt: number) {
    this.frozen = true;
    this.locomotion = "hook";
    this.position.lerp(target, 1 - Math.exp(-strength * dt));
    this.verticalRate = (target.y - this.position.y) * strength;
  }

  private resolveWalls(p: THREE.Vector3) {
    const bvh: MeshBVH = this.colliders.wall;
    for (let iter = 0; iter < 3; iter++) {
      tmpSeg.start.set(p.x, p.y + CAPSULE_LOW, p.z);
      tmpSeg.end.set(p.x, p.y + CAPSULE_HIGH, p.z);
      tmpBox.makeEmpty();
      tmpBox.expandByPoint(tmpSeg.start);
      tmpBox.expandByPoint(tmpSeg.end);
      tmpBox.min.addScalar(-CAPSULE_RADIUS);
      tmpBox.max.addScalar(CAPSULE_RADIUS);
      let pushed = false;
      bvh.shapecast({
        intersectsBounds: box => box.intersectsBox(tmpBox),
        intersectsTriangle: tri => {
          const distance = tri.closestPointToSegment(tmpSeg, triPoint, capPoint);
          if (distance < CAPSULE_RADIUS) {
            const depth = CAPSULE_RADIUS - distance;
            tmpVec.subVectors(capPoint, triPoint);
            tmpVec.y = 0;
            if (tmpVec.lengthSq() < 1e-10) {
              tri.getNormal(tmpVec);
              tmpVec.y = 0;
            }
            if (tmpVec.lengthSq() < 1e-10) return false;
            tmpVec.normalize();
            tmpSeg.start.addScaledVector(tmpVec, depth);
            tmpSeg.end.addScaledVector(tmpVec, depth);
            pushed = true;
          }
          return false;
        },
      });
      p.x = tmpSeg.start.x;
      p.z = tmpSeg.start.z;
      if (!pushed) break;
    }
  }

  /** Floor height under (x, z) searching down from `fromY`, or null if there is no walkable floor. */
  groundAt(x: number, z: number, fromY: number): number | null {
    ray.set(tmpVec.set(x, fromY, z), down);
    const hit = this.colliders.walk.raycastFirst(ray.ray, THREE.DoubleSide, 0, 3.5);
    if (!hit || !hit.face) return null;
    if (Math.abs(hit.face.normal.y) < 0.55) return null;
    return hit.point.y;
  }
}
