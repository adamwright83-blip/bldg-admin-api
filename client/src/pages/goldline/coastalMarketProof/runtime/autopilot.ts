import * as THREE from "three";
import type { Route } from "./level";
import type { MoveVector } from "./input";

/**
 * ?autowalk=1: steers the real controller along the route spline by feeding
 * the same camera-relative stick vector a thumb would, so timing, collision
 * and camera behaviour are all exercised end to end.
 */
export class Autopilot {
  private readonly route: Route;
  startedAt = -1;
  finishedAt = -1;
  private readonly target = new THREE.Vector3();

  constructor(route: Route) {
    this.route = route;
  }

  steer(now: number, position: THREE.Vector3, progress: number, cameraYaw: number): MoveVector | null {
    if (this.startedAt < 0) this.startedAt = now;
    if (progress >= this.route.length - 1.2) {
      if (this.finishedAt < 0) this.finishedAt = now;
      return { x: 0, y: 0 };
    }
    this.route.at(Math.min(this.route.length, progress + 2.6), this.target);
    const dx = this.target.x - position.x;
    const dz = this.target.z - position.z;
    const len = Math.hypot(dx, dz) || 1;
    const wx = dx / len;
    const wz = dz / len;
    // world -> camera-relative stick (inverse of PlayerController's mapping)
    const fx = Math.sin(cameraYaw);
    const fz = Math.cos(cameraYaw);
    return { x: -fz * wx + fx * wz, y: fx * wx + fz * wz };
  }

  get elapsedSeconds(): number {
    if (this.startedAt < 0) return 0;
    const end = this.finishedAt >= 0 ? this.finishedAt : performance.now();
    return (end - this.startedAt) / 1000;
  }
}
