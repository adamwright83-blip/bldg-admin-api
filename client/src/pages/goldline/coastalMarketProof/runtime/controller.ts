import * as THREE from "three";
import type { MeshBVH } from "three-mesh-bvh";
import type { Colliders, Route } from "./level";
import { Spring, clamp, dampFactor, wrapAngle } from "./motion";
import type { MoveVector } from "./input";

/**
 * Run / jump / mantle controller. Movement follows her facing (no sideways
 * skating); the facing turns on a critically damped spring. Walls are a
 * capsule shapecast against COL_wall; the floor is a downward ray on COL_walk.
 *
 * - Walking into a gap in the floor is refused: gaps are jumped.
 * - A rise between a stair riser and MANTLE_HEIGHT, met at a run, is climbed
 *   (the root rises through the climb clip, it never snaps).
 * - Stepping off a ledge falls under gravity; a fall into the gorge puts her
 *   back at the last floor she stood on.
 * - Shutdown gates are route blockers the chase set switches on.
 * - `hang` / `release` hand her to a rig (a hook on a loaded line) and back:
 *   the rig moves her, and on release she flies on the velocity it gave her.
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
  private mantle: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null = null;
  /** true while a rig carries her (the rig sets her position every frame) */
  hanging = false;
  /** shutdown gates: movement into an active range is refused */
  readonly blockers: { s0: number; s1: number; on: boolean }[] = [];
  private lastSafeS = 0;
  private airborneSeconds = 0;
  /** seconds since the last landing (0 while airborne) */
  landedSeconds = 1;
  lastLandingSpeed = 0;
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

  hang(p: THREE.Vector3, heading: number) {
    this.hanging = true;
    this.frozen = true;
    this.grounded = false;
    this.mantle = null;
    this.verticalRate = (p.y - this.position.y) / (1 / 60);
    this.position.copy(p);
    this.turn.value = heading;
    this.turn.velocity = 0;
    this.heading = heading;
    this.speed = 0;
    this.verticalVelocity = 0;
    this.locomotion = "hook";
    this.routeIndex = this.route.nearest(this.position, this.routeIndex);
    this.progress = this.route.samples[this.routeIndex].s;
  }

  release(v: THREE.Vector3) {
    this.hanging = false;
    this.frozen = false;
    const h = Math.hypot(v.x, v.z);
    if (h > 0.2) {
      this.heading = Math.atan2(v.x, v.z);
      this.turn.value = this.heading;
    }
    this.speed = h;
    this.verticalVelocity = v.y;
    this.grounded = false;
  }

  /** turn on the spot toward `yaw` (the reveal: she squares up to the cage door) */
  faceToward(yaw: number, dt: number) {
    this.turn.step(yaw, 6, dt, true);
    this.heading = this.turn.value;
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
    this.grounded = true;
    this.verticalVelocity = 0;
    this.lastSafeS = this.progress;
  }

  /** `move` is camera-relative (x right, y forward); `cameraYaw` is the camera's heading. */
  update(move: MoveVector, cameraYaw: number, dt: number, jump = false, forceSprint = false) {
    if (this.hanging) {
      this.routeIndex = this.route.nearest(this.position, this.routeIndex);
      this.progress = this.route.samples[this.routeIndex].s;
      return;
    }
    if (this.mantle) {
      this.stepMantle(dt);
      return;
    }
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
    // on the ground speed follows the stick quickly; in the air she keeps what she jumped or was thrown with
    const tau = this.grounded ? ACCEL_TAU * (targetSpeed < this.speed ? 0.8 : 1) : targetSpeed > this.speed ? 0.45 : 1.6;
    this.speed += (targetSpeed - this.speed) * dampFactor(tau, dt);
    if (this.speed < 0.01 && targetSpeed === 0) this.speed = 0;

    if (jump && this.grounded && !this.frozen) {
      this.verticalVelocity = JUMP_VELOCITY;
      this.grounded = false;
    }
    const step = this.speed * dt;
    const prevY = this.position.y;
    if (step > 0) this.moveHorizontal(Math.sin(this.heading) * step, Math.cos(this.heading) * step);
    if (this.mantle) {
      this.verticalRate = 0;
      this.locomotion = "mantle";
      return;
    }
    if (!this.grounded) {
      this.airborneSeconds += dt;
      this.landedSeconds = 0;
      this.verticalVelocity -= GRAVITY * dt;
      this.position.y += this.verticalVelocity * dt;
      const ground = this.groundAt(this.position.x, this.position.z, this.position.y + 2.2);
      if (ground !== null && this.verticalVelocity <= 0 && this.position.y <= ground) {
        this.lastLandingSpeed = -this.verticalVelocity;
        this.position.y = ground;
        this.verticalVelocity = 0;
        this.grounded = true;
        this.airborneSeconds = 0;
      }
    } else {
      this.landedSeconds += dt;
    }
    this.verticalRate = (this.position.y - prevY) / Math.max(dt, 1e-4);
    this.locomotion = !this.grounded ? "jump" : this.speed > 6.4 ? "sprint" : this.speed > 0.25 ? "jog" : "idle";

    this.routeIndex = this.route.nearest(this.position, this.routeIndex);
    const smp = this.route.samples[this.routeIndex];
    this.progress = smp.s;
    this.surface = this.surfaceByKind[smp.kind] ?? "stone";
    if (this.grounded) {
      this.lastSafeS = this.progress;
    } else if (this.position.y < smp.p.y - 6) {
      // into the gorge or the harbour: back to the last floor she stood on
      this.placeAt(Math.max(0, this.lastSafeS - 1.2));
      this.respawns++;
    }
  }

  respawns = 0;

  private stepMantle(dt: number) {
    const m = this.mantle!;
    m.t += dt;
    const u = Math.min(1, m.t / m.dur);
    const prevY = this.position.y;
    // hands on the top first, then the body rolls over the lip
    const up = THREE.MathUtils.smoothstep(u, 0.05, 0.6);
    const fwd = THREE.MathUtils.smoothstep(u, 0.3, 1.0);
    this.position.set(
      THREE.MathUtils.lerp(m.from.x, m.to.x, fwd),
      THREE.MathUtils.lerp(m.from.y, m.to.y, up),
      THREE.MathUtils.lerp(m.from.z, m.to.z, fwd)
    );
    this.verticalRate = (this.position.y - prevY) / Math.max(dt, 1e-4);
    this.locomotion = "mantle";
    if (u >= 1) {
      this.mantle = null;
      this.grounded = true;
      this.speed = Math.max(this.speed, WALK_SPEED * 0.7);
    }
    this.routeIndex = this.route.nearest(this.position, this.routeIndex);
    this.progress = this.route.samples[this.routeIndex].s;
  }

  get mantling() {
    return this.mantle !== null;
  }

  private blocked(p: THREE.Vector3): boolean {
    if (!this.blockers.some(b => b.on)) return false;
    const i = this.route.nearest(p, this.routeIndex);
    const s = this.route.samples[i].s;
    return this.blockers.some(b => b.on && s >= b.s0 && s <= b.s1 + 0.4 && this.progress < b.s1);
  }

  private moveHorizontal(dx: number, dz: number) {
    const start = this.position.clone();
    const target = start.clone();
    target.x += dx;
    target.z += dz;
    this.resolveWalls(target);
    if (this.blocked(target)) {
      this.speed *= 0.5;
      return;
    }
    if (!this.grounded) {
      // in the air: carry on; a rise above the feet is a wall (the floor ray finds it on landing)
      const g = this.groundAt(target.x, target.z, start.y + 1.4);
      if (g !== null && g > start.y + 0.25 && g - start.y <= MANTLE_HEIGHT && this.verticalVelocity < 2) {
        this.startMantle(start, target, g);
        return;
      }
      this.position.set(target.x, start.y, target.z);
      return;
    }
    const g = this.groundAt(target.x, target.z, start.y + MANTLE_HEIGHT + 0.35);
    if (g !== null && g - start.y > MAX_STEP_UP && g - start.y <= MANTLE_HEIGHT && this.speed > 3.2) {
      this.startMantle(start, target, g);
      return;
    }
    if (g !== null && g < start.y - 0.6) {
      // walked off a ledge (the far side of a climbed obstacle): fall, don't snap
      this.position.set(target.x, start.y, target.z);
      this.grounded = false;
      this.verticalVelocity = 0;
      return;
    }
    if (g === null || g - start.y > MAX_STEP_UP) {
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
    this.position.set(target.x, g, target.z);
  }

  private startMantle(start: THREE.Vector3, target: THREE.Vector3, top: number) {
    const dir = new THREE.Vector3(target.x - start.x, 0, target.z - start.z);
    if (dir.lengthSq() < 1e-8) dir.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    dir.normalize();
    const to = new THREE.Vector3(target.x, top, target.z).addScaledVector(dir, 0.45);
    // land the climb on the top: step back if 0.45 m further is off the edge
    const g = this.groundAt(to.x, to.z, top + 0.5);
    if (g === null || Math.abs(g - top) > 0.2) to.set(target.x, top, target.z);
    this.mantle = { from: start.clone(), to, t: 0, dur: 0.6 };
    this.grounded = true;
    this.verticalVelocity = 0;
    this.locomotion = "mantle";
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
