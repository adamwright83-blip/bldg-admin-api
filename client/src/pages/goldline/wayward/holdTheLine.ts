/**
 * HOLD THE LINE — the broken-span crossing, as pure, deterministic rules.
 *
 * The physical question: the Wayward's broken end rolls, the tether ring sways
 * over the gap, and a loose crate swings on its boom across the gap and over
 * the deck's edge. Trailblazer has to put herself where the Linehook has a
 * clear, reachable line to the ring, and cast. A short cast from the crumbling
 * edge swings straight across. A long cast from safer planks first reels her
 * to the edge; it is slower, and the world keeps moving while she flies.
 *
 * Everything here is in the broken-span painting's coordinates (1536×658,
 * y down). Time is seconds since the crossing began. Nothing here draws.
 */

export type Vec = { x: number; y: number };

export const SPAN = {
  ringRest: { x: 770, y: 297 },
  leftPulley: { x: 452, y: 180 },
  rightPulley: { x: 1070, y: 184 },
  /** The ship's end rolls about a point far off to the left, inside the hull. */
  rollPivot: { x: -900, y: 520 },
  /** Linehook reach, hand to ring. */
  castRange: 470,
  /** Hook speed while it flies (units/s). */
  hookSpeed: 1350,
  /** How far the ring may drift from the aim point and still be bitten. */
  biteRadius: 46,
  /** A cast longer than this reels her to the edge before she swings. */
  swingRadius: 176,
  /** Where the ship's planks end (the crumbling edge), by depth. */
  leftEdgeX: 648,
  rightEdgeX: 968,
  /** A loose crate on a long boom line: it sweeps the deck's edge and dips through the cast line. */
  boom: { pivot: { x: 620, y: -260 }, length: 470, amplitude: 0.78, period: 4.2 },
  crateScale: 0.62,
  /** Crate body, relative to where its rope ends (the sprite hangs below the rope). */
  crateOffset: { x: 8, y: 50 },
  crateHalf: { x: 56, y: 50 },
} as const;

export function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}
export function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y };
}
export function len(a: Vec): number {
  return Math.hypot(a.x, a.y);
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Rotate p about c by angle (radians, clockwise on screen because y is down). */
export function rotateAbout(p: Vec, c: Vec, angle: number): Vec {
  const s = Math.sin(angle);
  const k = Math.cos(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * k - dy * s, y: c.y + dx * s + dy * k };
}

export type ShipRoll = {
  /** Radians; positive tips the broken end down toward the gap. */
  angle: number;
  /** 0..1 while the timbers groan before a heavy roll. */
  telegraph: number;
  /** True while a heavy roll is tipping the deck. */
  heavy: boolean;
  /** Index of the current heavy-roll cycle, so each one fires its events once. */
  cycle: number;
};

export const ROLL = {
  swell: 0.016,
  swellPeriod: 5.3,
  heavy: 0.04,
  cycle: 8.6,
  firstHeavyAt: 6.2,
  telegraph: 1.0,
  heavyLength: 2.1,
} as const;

/** The ship's end never sits still; every ~8.6s a heavy roll tips it toward the gap. */
export function shipRoll(t: number, calm = false): ShipRoll {
  const swell = Math.sin((t / ROLL.swellPeriod) * Math.PI * 2) * ROLL.swell * (calm ? 0.5 : 1);
  if (calm || t < ROLL.firstHeavyAt - ROLL.telegraph) {
    return { angle: swell, telegraph: 0, heavy: false, cycle: -1 };
  }
  const since = t - (ROLL.firstHeavyAt - ROLL.telegraph);
  const cycle = Math.floor(since / ROLL.cycle);
  const local = since - cycle * ROLL.cycle;
  const telegraph = local < ROLL.telegraph ? local / ROLL.telegraph : 0;
  const heavyT = local - ROLL.telegraph;
  const heavy = heavyT >= 0 && heavyT < ROLL.heavyLength;
  const tip = heavy ? Math.sin((heavyT / ROLL.heavyLength) * Math.PI) ** 1.4 * ROLL.heavy : 0;
  // A shiver in the timbers while it groans.
  const shiver = telegraph > 0 ? Math.sin(t * 38) * 0.0022 * telegraph : 0;
  return { angle: swell + tip + shiver, telegraph, heavy, cycle };
}

/** The broken end's plank point at (x, y) after the roll. */
export function onRolledDeck(p: Vec, angle: number): Vec {
  return rotateAbout(p, SPAN.rollPivot, angle);
}

/** The ring rides the tether between the rolling ship and the city's pulley. */
export function ringPosition(t: number, angle: number): Vec {
  const pulley = onRolledDeck(SPAN.leftPulley, angle);
  const lift = (pulley.y - SPAN.leftPulley.y) * 0.55;
  return {
    x: SPAN.ringRest.x + Math.sin(t * 1.83) * 26 + Math.sin(t * 0.71 + 1.3) * 12,
    y: SPAN.ringRest.y + lift + Math.sin(t * 2.4 + 0.6) * 9,
  };
}

export type BoomCrate = { pivot: Vec; ropeEnd: Vec; center: Vec; angle: number; angularVelocity: number };

/** A loose crate swinging on its boom line, over the gap and back over the deck's edge. */
export function boomCrate(t: number): BoomCrate {
  const { pivot, length, amplitude, period } = SPAN.boom;
  const w = (Math.PI * 2) / period;
  const angle = Math.sin(t * w - 0.9) * amplitude;
  const angularVelocity = Math.cos(t * w - 0.9) * amplitude * w;
  const ropeEnd = { x: pivot.x - Math.sin(angle) * length, y: pivot.y + Math.cos(angle) * length };
  return {
    pivot,
    ropeEnd,
    center: { x: ropeEnd.x + SPAN.crateOffset.x, y: ropeEnd.y + SPAN.crateOffset.y },
    angle,
    angularVelocity,
  };
}

/**
 * Whether the crate's body passes through a standing figure (feet at `feet`,
 * `height` tall). Returns the shove it gives, in its direction of travel.
 */
export function crateShove(t: number, feet: Vec, height: number): Vec | null {
  const crate = boomCrate(t);
  // Her torso, not the air over her head: a crate that only grazes her hat misses.
  const body = { x: feet.x, y: feet.y - height / 2 };
  const overlapX = Math.abs(body.x - crate.center.x) < SPAN.crateHalf.x + 14;
  const overlapY = Math.abs(body.y - crate.center.y) < SPAN.crateHalf.y + height * 0.42;
  if (!overlapX || !overlapY) return null;
  const vx = -Math.cos(crate.angle) * SPAN.boom.length * crate.angularVelocity;
  if (Math.abs(vx) < 60) return null;
  return { x: Math.sign(vx) * 430, y: 0 };
}

export type RiggingLine = { id: string; points: Vec[] };

/** Loose rigging hanging from the yard above, swaying across the gap. */
export function riggingLines(t: number): RiggingLine[] {
  const lines = [
    // Hangs in front of the safer planks: from far back it is usually in the way.
    { id: "rigging-a", pivot: { x: 560, y: -300 }, length: 640, amp: 0.28, period: 3.3, phase: 0.2 },
    // Drifts in front of the ring now and then, whatever she does.
    { id: "rigging-b", pivot: { x: 820, y: -300 }, length: 600, amp: 0.2, period: 4.1, phase: 1.7 },
  ];
  return lines.map(line => {
    const angle = Math.sin((t / line.period) * Math.PI * 2 + line.phase) * line.amp;
    const points: Vec[] = [];
    // A rope bends: the lower half lags the upper half.
    for (let i = 0; i <= 6; i += 1) {
      const f = i / 6;
      const a = angle * (0.6 + 0.4 * f) + Math.sin(t * 3.1 + line.phase + f) * 0.02 * f;
      points.push({ x: line.pivot.x - Math.sin(a) * line.length * f, y: line.pivot.y + Math.cos(a) * line.length * f });
    }
    return { id: line.id, points };
  });
}

export type Obstruction =
  | { kind: "rope"; id: string; points: Vec[]; radius: number }
  | { kind: "box"; id: string; center: Vec; half: Vec };

export function obstructionsAt(t: number): Obstruction[] {
  const crate = boomCrate(t);
  return [
    ...riggingLines(t).map(line => ({ kind: "rope" as const, id: line.id, points: line.points, radius: 5 })),
    { kind: "rope", id: "boom-line", points: [crate.pivot, crate.ropeEnd], radius: 4 },
    { kind: "box", id: "boom-crate", center: crate.center, half: SPAN.crateHalf },
  ];
}

/** Closest approach between segments ab and cd. */
export function segmentDistance(a: Vec, b: Vec, c: Vec, d: Vec): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b));
}

export function pointSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.y * ab.y;
  const t = l2 === 0 ? 0 : clamp(((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2, 0, 1);
  return len(sub(p, { x: a.x + ab.x * t, y: a.y + ab.y * t }));
}

function cross(o: Vec, a: Vec, b: Vec) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Where along a→b (0..1) the segment first enters an axis-aligned box, or null. */
export function segmentBoxEntry(a: Vec, b: Vec, center: Vec, half: Vec): number | null {
  let t0 = 0;
  let t1 = 1;
  const d = sub(b, a);
  for (const axis of ["x", "y"] as const) {
    const min = center[axis] - half[axis];
    const max = center[axis] + half[axis];
    if (Math.abs(d[axis]) < 1e-9) {
      if (a[axis] < min || a[axis] > max) return null;
      continue;
    }
    let ta = (min - a[axis]) / d[axis];
    let tb = (max - a[axis]) / d[axis];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

export type LineHit = { id: string; at: Vec; fraction: number };

/** The first obstruction the straight line a→b runs into, if any. */
export function firstObstruction(a: Vec, b: Vec, obstructions: Obstruction[]): LineHit | null {
  let best: LineHit | null = null;
  for (const o of obstructions) {
    if (o.kind === "box") {
      const f = segmentBoxEntry(a, b, o.center, o.half);
      if (f !== null && (!best || f < best.fraction)) best = { id: o.id, fraction: f, at: { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) } };
      continue;
    }
    for (let i = 1; i < o.points.length; i += 1) {
      const c = o.points[i - 1]!;
      const d = o.points[i]!;
      if (segmentDistance(a, b, c, d) > o.radius) continue;
      // Approximate the contact as the nearest sample along a→b.
      let bestF = 1;
      let bestDist = Infinity;
      for (let s = 0; s <= 40; s += 1) {
        const f = s / 40;
        const p = { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) };
        const dist = pointSegment(p, c, d);
        if (dist < bestDist) {
          bestDist = dist;
          bestF = f;
        }
      }
      if (!best || bestF < best.fraction) best = { id: o.id, fraction: bestF, at: { x: lerp(a.x, b.x, bestF), y: lerp(a.y, b.y, bestF) } };
    }
  }
  return best;
}

export type CastAim = {
  inRange: boolean;
  clear: boolean;
  distance: number;
  blockedBy: LineHit | null;
};

/** What the gold thread shows: can she reach the ring, and is the line clean? */
export function aimAt(hand: Vec, ring: Vec, obstructions: Obstruction[], range: number = SPAN.castRange): CastAim {
  const distance = len(sub(ring, hand));
  // The last stretch into the ring is the ring's own strapping, not a foul.
  const end = { x: lerp(hand.x, ring.x, 0.93), y: lerp(hand.y, ring.y, 0.93) };
  const blockedBy = firstObstruction(hand, end, obstructions);
  return { inRange: distance <= range, clear: blockedBy === null, distance, blockedBy };
}

export type CastOutcome =
  | { kind: "flying"; tip: Vec; progress: number }
  | { kind: "bite"; at: Vec }
  | { kind: "foul"; at: Vec; by: string }
  | { kind: "miss"; at: Vec };

/**
 * Advance a cast that left `hand` at `castAt`, aimed at `aim`, to time `t`.
 * The hook flies straight at where the ring was; the world keeps moving while
 * it flies. It bites if the ring is still there when it arrives, fouls on
 * whatever swings into its path first, and otherwise falls short.
 */
export function resolveCast(hand: Vec, aim: Vec, castAt: number, t: number, ringAt: (time: number) => Vec, obstaclesAt: (time: number) => Obstruction[]): CastOutcome {
  const total = len(sub(aim, hand)) / SPAN.hookSpeed;
  const elapsed = Math.max(0, t - castAt);
  const steps = Math.max(1, Math.ceil((Math.min(elapsed, total) / total) * 24));
  let previous = hand;
  for (let i = 1; i <= steps; i += 1) {
    const f = Math.min(elapsed, total) / total * (i / steps);
    const tip = { x: lerp(hand.x, aim.x, f), y: lerp(hand.y, aim.y, f) };
    const time = castAt + total * f;
    const hit = firstObstruction(previous, tip, obstaclesAt(time));
    // Never foul on the ring's own strapping in the last few units.
    if (hit && f < 0.94) return { kind: "foul", at: hit.at, by: hit.id };
    previous = tip;
  }
  if (elapsed < total) {
    const f = elapsed / total;
    return { kind: "flying", tip: { x: lerp(hand.x, aim.x, f), y: lerp(hand.y, aim.y, f) }, progress: f };
  }
  const ring = ringAt(castAt + total);
  if (len(sub(ring, aim)) <= SPAN.biteRadius) return { kind: "bite", at: ring };
  return { kind: "miss", at: aim };
}

export type SwingPlan = {
  /** Reel along the deck toward the edge first (long casts). */
  reelTo: Vec | null;
  reelSeconds: number;
  radius: number;
  startAngle: number;
  endAngle: number;
  swingSeconds: number;
  landing: Vec;
};

/**
 * Plan the crossing once the hook bites. Angles are measured from straight
 * down under the ring; negative is the ship's side.
 */
export function planSwing(feet: Vec, handHeight: number, ring: Vec, landing: Vec, towardRight = true, edgeX?: number): SwingPlan {
  const hand = { x: feet.x, y: feet.y - handHeight };
  const distance = len(sub(ring, hand));
  let reelTo: Vec | null = null;
  let start = hand;
  // A long line reels her all the way to the planks' end before she leaves them,
  // so the swing itself is always short and passes under the ring, not under the decks.
  const edge = edgeX ?? (towardRight ? SPAN.leftEdgeX - 14 : SPAN.rightEdgeX + 14);
  if (distance > SPAN.swingRadius && (towardRight ? feet.x < edge - 4 : feet.x > edge + 4)) {
    reelTo = { x: edge, y: feet.y };
    start = { x: edge, y: feet.y - handHeight };
  }
  const radius = clamp(len(sub(ring, start)), 110, 176);
  const startAngle = Math.atan2(start.x - ring.x, start.y - ring.y);
  const endAngle = -startAngle * 0.9;
  return {
    reelTo,
    reelSeconds: reelTo ? Math.max(0.22, Math.abs(reelTo.x - feet.x) / 560) : 0,
    radius,
    startAngle,
    endAngle,
    swingSeconds: 0.7 + radius / 700,
    landing,
  };
}

/** Hand position along the swing arc, 0..1. Eased like a real pendulum. */
export function swingPoint(plan: SwingPlan, ring: Vec, f: number): Vec {
  const e = 0.5 - Math.cos(clamp(f, 0, 1) * Math.PI) / 2;
  const angle = lerp(plan.startAngle, plan.endAngle, e);
  return { x: ring.x + Math.sin(angle) * plan.radius, y: ring.y + Math.cos(angle) * plan.radius };
}
