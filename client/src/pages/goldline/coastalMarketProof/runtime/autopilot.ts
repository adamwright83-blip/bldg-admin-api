import * as THREE from "three";
import type { Route } from "./level";
import type { MoveVector } from "./input";
import type { AutopilotHint } from "./phase2World";

/**
 * ?autowalk=1: plays the chase with the same camera-relative stick a thumb
 * would give the real controller, so timing, collision, the rigs and the
 * camera are all exercised end to end.
 *
 * It runs at a player's pace: a jog, a full-tilt sprint on the long straights
 * (the controller only sprints after holding full tilt), steering to a hook
 * when one is in reach, waiting at the parapet for a ropeway carrier, and
 * jumping the boardwalk gap. It stops at the cage door.
 */
const SPRINTS: [number, number][] = [[1.5, 15], [46, 57], [86, 100], [113, 124], [131, 138]];

export class Autopilot {
  private readonly route: Route;
  startedAt = -1;
  finishedAt = -1;
  /** chase metres where the run ends (in front of the cage door) */
  endAt: number;
  private readonly target = new THREE.Vector3();

  constructor(route: Route, endAt = route.length - 1.2) {
    this.route = route;
    this.endAt = endAt;
  }

  steer(now: number, position: THREE.Vector3, progress: number, cameraYaw: number, hint: AutopilotHint | null): { move: MoveVector; jump: boolean } {
    if (this.startedAt < 0) this.startedAt = now;
    if (progress >= this.endAt) {
      if (this.finishedAt < 0) this.finishedAt = now;
      return { move: { x: 0, y: 0 }, jump: false };
    }
    if (hint?.stop) return { move: { x: 0, y: 0 }, jump: false };
    if (hint?.target) this.target.copy(hint.target);
    else this.route.at(Math.min(this.route.length, progress + 2.6), this.target);
    const dx = this.target.x - position.x;
    const dz = this.target.z - position.z;
    const len = Math.hypot(dx, dz) || 1;
    const wx = dx / len;
    const wz = dz / len;
    // world -> camera-relative stick (inverse of PlayerController's mapping)
    const fx = Math.sin(cameraYaw);
    const fz = Math.cos(cameraYaw);
    const sprint = SPRINTS.some(([a, b]) => progress >= a && progress < b);
    const mag = hint?.mag ?? (sprint ? 1 : 0.88);
    return { move: { x: (-fz * wx + fx * wz) * mag, y: (fx * wx + fz * wz) * mag }, jump: !!hint?.jump };
  }

  get elapsedSeconds(): number {
    if (this.startedAt < 0) return 0;
    const end = this.finishedAt >= 0 ? this.finishedAt : performance.now();
    return (end - this.startedAt) / 1000;
  }
}
