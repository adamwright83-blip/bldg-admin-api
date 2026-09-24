/** Frame-rate independent smoothing helpers. */

/** Exponential approach: fraction of the gap closed in `dt` for time constant `tau`. */
export function dampFactor(tau: number, dt: number): number {
  return tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
}

export function damp(current: number, target: number, tau: number, dt: number): number {
  return current + (target - current) * dampFactor(tau, dt);
}

export function wrapAngle(a: number): number {
  let x = (a + Math.PI) % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x - Math.PI;
}

export function dampAngle(current: number, target: number, tau: number, dt: number): number {
  return current + wrapAngle(target - current) * dampFactor(tau, dt);
}

/** Critically damped spring (position + velocity), for turning and secondary motion. */
export class Spring {
  value: number;
  velocity = 0;
  constructor(value = 0) {
    this.value = value;
  }
  /** `omega` ~ 2 / settle-time. */
  step(target: number, omega: number, dt: number, angular = false): number {
    const x = angular ? -wrapAngle(target - this.value) : this.value - target;
    const exp = Math.exp(-omega * dt);
    const temp = (this.velocity + omega * x) * dt;
    const nextX = (x + temp) * exp;
    this.velocity = (this.velocity - omega * temp) * exp;
    this.value = angular ? wrapAngle(target + nextX) : target + nextX;
    return this.value;
  }
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
