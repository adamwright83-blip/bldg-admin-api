/**
 * Brass button → signal mirror, as physics the player can read.
 * A window beam falls into the suitcase. The button lies on the floor with its back edge down;
 * you slide it along the lining and lift its front edge. Where the beam hits and where the
 * bounce goes are computed here, and drawn by the game, so a miss is legible without text.
 */

export interface V3 { x: number; y: number; z: number }
export interface MirrorPose { x: number; tiltDeg: number }

const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const add = (a: V3, b: V3) => v(a.x + b.x, a.y + b.y, a.z + b.z);
const mul = (a: V3, k: number) => v(a.x * k, a.y * k, a.z * k);
const sub = (a: V3, b: V3) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
const norm = (a: V3) => mul(a, 1 / (len(a) || 1));

/** where the cut lining opens onto the railway */
export const BEAM_ORIGIN_Y = 1.07;
export const BEAM_ORIGIN_Z = -1.95;
/** the beam fills the window: x in [BEAM_X0, BEAM_X1] */
export const BEAM_X0 = 0.05;
export const BEAM_X1 = 1.95;
export const BEAM_DIR: V3 = norm(v(0, -0.5, 0.866));

export const MIRROR = { z: -1.55, radius: 0.56, lift: 0.08, minTilt: 8, maxTilt: 80, minX: -2.5, maxX: 2.5 };
/** the lid's inner lining, high at the back: hitting this patch is "catching the light" */
export const LID_TARGET = { z: -2.6, y0: 1.9, y1: 5.0, x0: -1.2, x1: 3.2 };

const rad = (d: number) => (d * Math.PI) / 180;
export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function clampPose(p: MirrorPose): MirrorPose {
  return { x: clamp(p.x, MIRROR.minX, MIRROR.maxX), tiltDeg: clamp(p.tiltDeg, MIRROR.minTilt, MIRROR.maxTilt) };
}

/** pointer depth on the floor → how far the front edge is lifted */
export function tiltFromPointerZ(pz: number): number {
  return clamp(MIRROR.minTilt + (pz - (-1.7)) * 24, MIRROR.minTilt, MIRROR.maxTilt);
}

export function mirrorNormal(tiltDeg: number): V3 {
  const b = rad(tiltDeg);
  return v(0, Math.cos(b), -Math.sin(b));
}

export function mirrorCenter(p: MirrorPose): V3 {
  return v(p.x, MIRROR.radius * Math.sin(rad(p.tiltDeg)) + MIRROR.lift, MIRROR.z);
}

export type MirrorOutcome = "miss" | "glance" | "aligned";

export interface MirrorTrace {
  outcome: MirrorOutcome;
  /** where the beam strikes the button, if it does */
  hit?: V3;
  /** unit direction of the bounce */
  reflected?: V3;
  /** where the bounce ends: on the lid lining when aligned, otherwise the wall, floor or open air */
  end?: V3;
}

export function traceMirror(raw: MirrorPose): MirrorTrace {
  const p = clampPose(raw);
  // the beam is a sheet across the window; the part of it that can reach the button is the slice at its x
  if (p.x < BEAM_X0 || p.x > BEAM_X1) return { outcome: "miss" };
  const origin = v(p.x, BEAM_ORIGIN_Y, BEAM_ORIGIN_Z);
  const n = mirrorNormal(p.tiltDeg);
  const c = mirrorCenter(p);
  const dn = dot(BEAM_DIR, n);
  if (Math.abs(dn) < 1e-6) return { outcome: "miss" };
  const t = dot(sub(c, origin), n) / dn;
  if (t <= 0) return { outcome: "miss" };
  const hit = add(origin, mul(BEAM_DIR, t));
  if (len(sub(hit, c)) > MIRROR.radius) return { outcome: "miss" };

  const r = norm(sub(BEAM_DIR, mul(n, 2 * dot(BEAM_DIR, n))));
  // does the bounce reach the lid lining?
  if (r.z < -1e-6) {
    const t2 = (LID_TARGET.z - hit.z) / r.z;
    const end = add(hit, mul(r, t2));
    if (t2 > 0 && end.y >= LID_TARGET.y0 && end.y <= LID_TARGET.y1 && end.x >= LID_TARGET.x0 && end.x <= LID_TARGET.x1) {
      return { outcome: "aligned", hit, reflected: r, end };
    }
  }
  // glancing: follow the bounce to the first surface it meets (floor, back wall, or open air)
  let tEnd = 6;
  if (r.y < -1e-6) tEnd = Math.min(tEnd, -hit.y / r.y);
  if (r.z < -1e-6) tEnd = Math.min(tEnd, (-2.0 - hit.z) / r.z);
  return { outcome: "glance", hit, reflected: r, end: add(hit, mul(r, Math.max(0.3, tEnd))) };
}

/** the centre of the aligned tilt window at this x, or null if there is none */
export function alignedTiltRange(x: number): { lo: number; hi: number; mid: number } | null {
  let lo = Infinity, hi = -Infinity;
  for (let d = MIRROR.minTilt; d <= MIRROR.maxTilt; d += 0.25) {
    if (traceMirror({ x, tiltDeg: d }).outcome === "aligned") { lo = Math.min(lo, d); hi = Math.max(hi, d); }
  }
  return Number.isFinite(lo) ? { lo, hi, mid: (lo + hi) / 2 } : null;
}

/** beam floor patch (for drawing the light shaft where nothing is in the way) */
export function beamFloorPoint(x: number): V3 {
  const t = -BEAM_ORIGIN_Y / BEAM_DIR.y;
  return v(x, 0, BEAM_ORIGIN_Z + BEAM_DIR.z * t);
}
