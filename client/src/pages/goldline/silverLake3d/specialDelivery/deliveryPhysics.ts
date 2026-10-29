/**
 * Special Delivery: the paper glider's world, as a small deterministic 2.5D simulation.
 *
 * Everything here happens in the delivery plane: x runs right across the courtyard (metres), y is height above the
 * ground. No three.js, no clock, no randomness: the same course, launch and wing inputs always produce the same flight,
 * so a replay reproduces a flight exactly and tests can prove that a trick is possible without scripting it.
 *
 * The glider is a toy aerofoil: lift ∝ airspeed² perpendicular to the relative wind, drag ∝ airspeed², gravity. That
 * gives a real paper plane's swoop (climb, slow, nose over, speed up) for free. Wings open = more lift and more drag;
 * folded = a dart. Wind fields (the fan) change the relative airflow, so an updraft genuinely lifts an open glider.
 *
 * The world reports what physically happened as events. It never decides that something was clever; the director
 * and the courtyard memory only ever act on these observed facts.
 */

export type V2 = { x: number; y: number };

export type FanSetting = "up" | "forward" | "back";
export const FAN_SETTINGS: readonly FanSetting[] = ["up", "forward", "back"];
/** blowing direction, radians from straight up; positive leans toward the basket */
export const FAN_ANGLE: Record<FanSetting, number> = { up: 0, forward: 0.62, back: -0.62 };

export type CupDef = { anchor: V2; length: number; radius: number };

export type CourseDef = {
  gravity: number;
  launch: V2;
  bounds: { minX: number; maxX: number; maxY: number };
  fan: { x: number; y: number; width: number; reach: number; strength: number };
  line: { a: V2; b: V2; sag: number };
  sheets: { x0: number; x1: number; drop: number }[];
  cups: CupDef[];
  cat: {
    x: number;
    y: number;
    rx: number;
    ry: number;
    head: V2;
    headR: number;
    tailRoot: V2;
    tailLen: number;
    /** the tail's resting angle (radians from +x): stretched out behind her along the paving */
    rest: number;
    /** the startled lash: from `windup` (radians, pointing back along the ground) sweeping clockwise to `follow` */
    swat: { windup: number; follow: number; duration: number };
    /** a glider that lands on the resting tail is flicked off it: speed = fling x distance along the tail, at `flingAngle` */
    fling: number;
    flingAngle: number;
    /** the flick is steeper near her hip and flatter toward the tip (radians per unit of tail) */
    flingSpread: number;
    /** only a glider that comes down this gently stays on the tail; a harder one just bounces off it */
    rideMaxSpeed: number;
  };
  basket: { x: number; y: number; width: number; depth: number };
  balcony: { x0: number; x1: number; floor: number; rail: number };
  bella: { x: number; y: number; rx: number; ry: number };
  station: { x0: number; x1: number; top: number };
  rook: { x: number; reach: V2; radius: number };
  walls: { a: V2; b: V2 }[];
};

export type WorldEvent =
  | { kind: "launch"; t: number; speed: number; angle: number }
  | { kind: "wings"; t: number; open: boolean }
  | { kind: "fan_enter"; t: number }
  | { kind: "fan_exit"; t: number; rise: number }
  | { kind: "bell"; t: number; strength: number }
  | { kind: "line_bounce"; t: number; speed: number }
  | { kind: "line_skim_start"; t: number; x: number }
  | { kind: "line_skim_end"; t: number; x: number; off: "end" | "lift" | "slow" }
  | { kind: "sheet"; t: number; index: number; speed: number }
  | { kind: "sheet_caught"; t: number; index: number }
  | { kind: "cup"; t: number; index: number; speed: number }
  | { kind: "cat_near"; t: number }
  | { kind: "cat_bell"; t: number }
  | { kind: "cat_hit"; t: number; part: "body" | "head"; speed: number }
  | { kind: "cat_tail"; t: number; speed: number }
  | { kind: "cat_tail_land"; t: number; along: number }
  | { kind: "cat_fling"; t: number; speed: number }
  | { kind: "rook_reach"; t: number; toward: V2 }
  | { kind: "rook_catch"; t: number }
  | { kind: "rook_flick"; t: number }
  | { kind: "rook_miss"; t: number }
  | { kind: "wall"; t: number; speed: number }
  | { kind: "rim"; t: number; speed: number }
  | { kind: "basket"; t: number; speed: number; via: string[] }
  | { kind: "balcony"; t: number }
  | { kind: "bella"; t: number; speed: number }
  | { kind: "ground"; t: number; x: number; speed: number }
  | { kind: "away"; t: number; where: "roof" | "left" | "right" }
  | { kind: "rest"; t: number; where: "ground" | "sheet" | "line" | "balcony" | "station" | "rook" | "basket" };

export type Outcome = "delivered" | "missed" | "caught";

export type CatPhase = "asleep" | "startle" | "swat" | "grumpy";
export type RookPhase = "ready" | "reach" | "holding" | "flick" | "flail";

export type WorldState = {
  t: number;
  step: number;
  phase: "ready" | "flying" | "done";
  outcome: Outcome | null;
  restWhere: string | null;
  p: V2;
  v: V2;
  angle: number; // glider nose, radians (0 = pointing right)
  spin: number;
  wing: number; // 0 folded .. 1 open, eased
  wingOpen: boolean;
  tumble: number; // seconds of scrambled lift after a knock
  bellEnergy: number;
  fan: FanSetting;
  inFan: boolean;
  fanEnteredY: number;
  skim: { s: number; speed: number } | null; // position along the line (0 at a, 1 at b)
  lineSag: number; // dynamic extra sag (m) from impacts, springs back
  lineSagV: number;
  sheets: { push: number; pushV: number; hit: boolean }[];
  sheetHold: { index: number; t: number } | null;
  cups: { angle: number; omega: number; rungAt: number }[];
  cupSequence: number[];
  cat: { phase: CatPhase; since: number; tail: number; tailOmega: number; roll: number; nearAt: number; bellAt: number; hits: number; ride: number | null };
  rook: { phase: RookPhase; since: number; reach: V2; tried: boolean; eager: boolean };
  via: string[]; // observed contacts this flight, in order (for the memory: what physically happened)
  events: WorldEvent[];
  /** seconds the glider has barely moved while in flight (wedged) */
  stillFor?: number;
};

export const STEP = 1 / 240;
/** aerodynamic constants: acceleration per (m/s)² of airspeed */
export const LIFT_FOLDED = 0.06;
export const LIFT_OPEN = 0.42;
export const DRAG_FOLDED = 0.018;
export const DRAG_OPEN = 0.072;
const GLIDER_R = 0.16;
const MAX_FLIGHT = 14;

const add = (a: V2, b: V2): V2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: V2, b: V2): V2 => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: V2, k: number): V2 => ({ x: a.x * k, y: a.y * k });
const dot = (a: V2, b: V2) => a.x * b.x + a.y * b.y;
const len = (a: V2) => Math.hypot(a.x, a.y);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));


export function createWorld(course: CourseDef, fan: FanSetting = "up"): WorldState {
  return {
    t: 0,
    step: 0,
    phase: "ready",
    outcome: null,
    restWhere: null,
    p: { ...course.launch },
    v: { x: 0, y: 0 },
    angle: 0.35,
    spin: 0,
    wing: 0,
    wingOpen: false,
    tumble: 0,
    bellEnergy: 0,
    fan,
    inFan: false,
    fanEnteredY: 0,
    skim: null,
    lineSag: 0,
    lineSagV: 0,
    sheets: course.sheets.map(() => ({ push: 0, pushV: 0, hit: false })),
    sheetHold: null,
    cups: course.cups.map(() => ({ angle: 0, omega: 0, rungAt: -9 })),
    cupSequence: [],
    cat: { phase: "asleep", since: 0, tail: course.cat.rest, tailOmega: 0, roll: 0, nearAt: -9, bellAt: -9, hits: 0, ride: null },
    rook: { phase: "ready", since: 0, reach: { ...course.rook.reach }, tried: false, eager: true },
    via: [],
    events: [],
  };
}

/** Launch speed for a pull of `pull` metres (the elastic is stiff at first, then gives). */
export function launchVelocity(pull: V2): V2 {
  const d = len(pull);
  if (d < 1e-6) return { x: 0, y: 0 };
  const k = clamp(d, 0, MAX_PULL) / MAX_PULL;
  const speed = LAUNCH_MIN + (LAUNCH_MAX - LAUNCH_MIN) * Math.pow(k, 0.9);
  return mul({ x: pull.x / d, y: pull.y / d }, speed);
}
export const MAX_PULL = 1.35;
export const LAUNCH_MIN = 2.0;
export const LAUNCH_MAX = 11.5;
/** Releases shorter than this are a cancelled aim, never a launch (accidental taps). */
export const MIN_PULL = 0.16;

export function launch(world: WorldState, course: CourseDef, pull: V2): boolean {
  if (world.phase !== "ready") return false;
  if (len(pull) < MIN_PULL) return false;
  const v = launchVelocity(pull);
  world.phase = "flying";
  world.v = v;
  world.p = { ...course.launch };
  world.angle = Math.atan2(v.y, v.x);
  world.events.push({ kind: "launch", t: world.t, speed: len(v), angle: world.angle });
  world.bellEnergy = Math.max(world.bellEnergy, 0.35);
  return true;
}

export function setWings(world: WorldState, open: boolean) {
  if (world.wingOpen === open) return;
  world.wingOpen = open;
  if (world.phase === "flying") world.events.push({ kind: "wings", t: world.t, open });
}

// ---------------------------------------------------------------- course geometry helpers

/** The line's resting shape: a parabola between its anchors with `sag` metres of droop at the middle. */
export function linePoint(course: CourseDef, s: number, extraSag = 0): V2 {
  const { a, b, sag } = course.line;
  const x = a.x + (b.x - a.x) * s;
  const y = a.y + (b.y - a.y) * s - 4 * (sag + extraSag) * s * (1 - s);
  return { x, y };
}
function lineSlope(course: CourseDef, s: number, extraSag = 0): V2 {
  const { a, b, sag } = course.line;
  const dx = b.x - a.x;
  const dy = b.y - a.y - 4 * (sag + extraSag) * (1 - 2 * s);
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}
/** Line parameter whose x is the given x, or null off the ends. */
function lineSAt(course: CourseDef, x: number): number | null {
  const { a, b } = course.line;
  const s = (x - a.x) / (b.x - a.x);
  return s >= 0 && s <= 1 ? s : null;
}

export function fanWind(course: CourseDef, setting: FanSetting, p: V2, t: number): V2 {
  const { fan } = course;
  const ang = FAN_ANGLE[setting];
  // the column runs from the blades along the blowing direction
  const dir = { x: Math.sin(ang), y: Math.cos(ang) };
  const rel = sub(p, { x: fan.x, y: fan.y });
  const along = dot(rel, dir);
  if (along < -0.15 || along > fan.reach) return { x: 0, y: 0 };
  const across = Math.abs(rel.x * dir.y - rel.y * dir.x);
  const half = fan.width / 2 + along * 0.12; // the column widens a little as it rises
  if (across > half) return { x: 0, y: 0 };
  const edge = Math.cos((across / half) * (Math.PI / 2)); // soft edges
  const fall = Math.pow(clamp(1 - along / fan.reach, 0, 1), 0.65);
  // a little gusting, deterministic in time and height, so the bell chatters in the updraft
  const gust = 1 + 0.16 * Math.sin(t * 17.3 + p.y * 3.1) + 0.08 * Math.sin(t * 41.7 + p.x * 5.3);
  const w = fan.strength * edge * fall * gust;
  return { x: dir.x * w, y: dir.y * w };
}

function closestOnSegment(p: V2, a: V2, b: V2): { q: V2; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab) || 1;
  const t = clamp(dot(sub(p, a), ab) / l2, 0, 1);
  return { q: add(a, mul(ab, t)), t };
}

/** Cleo's tail as a straight segment from its root at the given angle (good enough for contact; drawn curled). */
export function tailSegment(course: CourseDef, angle: number): { a: V2; b: V2 } {
  const a = add({ x: course.cat.x, y: course.cat.y }, course.cat.tailRoot);
  const b = add(a, mul({ x: Math.cos(angle), y: Math.sin(angle) }, course.cat.tailLen));
  return { a, b };
}

export function cupPosition(course: CourseDef, world: WorldState, i: number): V2 {
  const c = course.cups[i];
  const ang = world.cups[i].angle;
  return { x: c.anchor.x + Math.sin(ang) * c.length, y: c.anchor.y - Math.cos(ang) * c.length };
}

// ---------------------------------------------------------------- the step

export function step(world: WorldState, course: CourseDef) {
  const dt = STEP;
  world.t += dt;
  world.step++;
  const t = world.t;
  stepEnvironment(world, course, dt);
  if (world.phase !== "flying") return;
  if (world.t > MAX_FLIGHT) return finish(world, "missed", "ground");

  // wings ease open and shut (a paper glider unfolds fast but not instantly)
  world.wing += ((world.wingOpen ? 1 : 0) - world.wing) * (1 - Math.exp(-dt / 0.07));
  world.tumble = Math.max(0, world.tumble - dt);
  world.bellEnergy = Math.max(0, world.bellEnergy - dt * 1.8);

  // held in a sheet: it slides down the fabric and drops out of the bottom
  if (world.sheetHold) {
    const sh = course.sheets[world.sheetHold.index];
    world.sheetHold.t += dt;
    world.p.y -= dt * 0.9;
    world.v = { x: 0, y: -0.9 };
    const top = linePoint(course, lineSAt(course, (sh.x0 + sh.x1) / 2) ?? 0.5, world.lineSag).y;
    if (world.p.y < top - sh.drop - 0.05) {
      world.sheetHold = null;
      world.v = { x: 0.15, y: -1.2 };
    }
    return integrateFree(world, course, dt, t, true);
  }

  if (world.skim) return stepSkim(world, course, dt, t);
  if (world.cat.ride !== null) return stepTailRide(world, course);
  integrateFree(world, course, dt, t, false);
  // wedged somewhere (against Bella, in a corner): a beat, then it drops where it is
  if (world.phase === "flying") {
    world.stillFor = Math.hypot(world.v.x, world.v.y) < 0.35 ? (world.stillFor ?? 0) + dt : 0;
    if (world.stillFor > 1.2) finish(world, "missed", "ground", { kind: "ground", t, x: world.p.x, speed: 0 });
  }
}

/** Sitting on Cleo's tail while she wakes: it goes where the tail goes, then leaves at the flick. */
function stepTailRide(world: WorldState, course: CourseDef) {
  const cs = world.cat;
  const r = cs.ride!;
  const seg = tailSegment(course, cs.tail);
  const at = add(seg.a, mul(sub(seg.b, seg.a), r));
  world.p = { x: at.x, y: at.y + GLIDER_R * 0.7 };
  world.v = { x: 0, y: 0 };
  const released = cs.phase === "swat" && cs.tail <= course.cat.swat.windup - 0.55;
  if (released) {
    const speed = course.cat.fling * r * course.cat.tailLen;
    const a = course.cat.flingAngle + (0.5 - r) * course.cat.flingSpread;
    world.v = { x: Math.cos(a) * speed, y: Math.sin(a) * speed };
    world.p.y += 0.06;
    cs.ride = null;
    world.events.push({ kind: "cat_fling", t: world.t, speed });
    world.via.push("tail");
    world.bellEnergy = 1;
    world.tumble = 0.1;
    world.spin = -9;
  }
}

function stepEnvironment(world: WorldState, course: CourseDef, dt: number) {
  // the line springs back after a knock
  const k = 70;
  const c = 7;
  const acc = -k * world.lineSag - c * world.lineSagV;
  world.lineSagV += acc * dt;
  world.lineSag += world.lineSagV * dt;
  if (world.skim) world.lineSag = Math.max(world.lineSag, 0.1 + 0.06 * Math.sin(world.t * 9));
  for (const sh of world.sheets) {
    const a = -38 * sh.push - 3.2 * sh.pushV;
    sh.pushV += a * dt;
    sh.push += sh.pushV * dt;
  }
  // cups are little pendulums
  course.cups.forEach((cup, i) => {
    const s = world.cups[i];
    const a = (-course.gravity / cup.length) * Math.sin(s.angle) - 0.9 * s.omega;
    s.omega += a * dt;
    s.angle += s.omega * dt;
  });
  stepCat(world, course, dt);
  stepRook(world, course, dt);
}

function integrateFree(world: WorldState, course: CourseDef, dt: number, t: number, sliding: boolean) {
  const prev = { ...world.p };
  if (!sliding) {
    const wind = fanWind(course, world.fan, world.p, t);
    const inFan = wind.x !== 0 || wind.y !== 0;
    if (inFan && !world.inFan) {
      world.inFan = true;
      world.fanEnteredY = world.p.y;
      world.events.push({ kind: "fan_enter", t });
      world.via.push("fan");
    } else if (!inFan && world.inFan) {
      world.inFan = false;
      world.events.push({ kind: "fan_exit", t, rise: world.p.y - world.fanEnteredY });
    }
    if (inFan) world.bellEnergy = Math.max(world.bellEnergy, 0.25 + 0.4 * Math.abs(Math.sin(t * 23)));
    const rel = sub(world.v, wind);
    const s = len(rel);
    const g = { x: 0, y: -course.gravity };
    let a = g;
    if (s > 1e-4) {
      const w = world.wing;
      const scramble = world.tumble > 0 ? 0.25 : 1;
      const kL = (LIFT_FOLDED + (LIFT_OPEN - LIFT_FOLDED) * w) * scramble;
      const kD = DRAG_FOLDED + (DRAG_OPEN - DRAG_FOLDED) * w + (world.tumble > 0 ? 0.03 : 0);
      // lift is perpendicular to the airflow, on the glider's "up" side whichever way it travels
      const side = rel.x >= 0 ? 1 : -1;
      const liftDir = { x: (-rel.y / s) * side, y: (rel.x / s) * side };
      const lift = Math.min(kL * s * s, course.gravity * (1.25 + 0.9 * w));
      a = add(a, mul(liftDir, lift));
      a = add(a, mul(rel, -kD * s));
    }
    world.v = add(world.v, mul(a, dt));
  }
  world.p = add(world.p, mul(world.v, dt));

  // the nose follows the airflow, with a little lag; a knocked glider tumbles
  const heading = Math.atan2(world.v.y, world.v.x);
  if (world.tumble > 0) {
    world.angle += world.spin * dt;
    world.spin *= Math.exp(-dt * 1.6);
  } else {
    const d = Math.atan2(Math.sin(heading - world.angle), Math.cos(heading - world.angle));
    world.angle += d * (1 - Math.exp(-dt * 11));
  }

  collide(world, course, prev, t);
}

function stepSkim(world: WorldState, course: CourseDef, dt: number, t: number) {
  const sk = world.skim!;
  const tan = lineSlope(course, sk.s, world.lineSag);
  // gravity along the line, rope friction, and the wings can lift it off
  const along = -course.gravity * tan.y;
  sk.speed += (along - Math.sign(sk.speed) * 1.1) * dt;
  sk.speed *= Math.exp(-dt * 0.35);
  const dxds = course.line.b.x - course.line.a.x;
  const ds = (sk.speed * tan.x) / dxds;
  sk.s += ds * dt;
  world.bellEnergy = Math.max(world.bellEnergy, 0.18);
  const p = linePoint(course, clamp(sk.s, 0, 1), world.lineSag);
  world.p = { x: p.x, y: p.y + GLIDER_R * 0.6 };
  world.v = mul(tan, sk.speed);
  world.angle = Math.atan2(tan.y, tan.x);
  const liftOff = world.wing > 0.6 && Math.abs(sk.speed) > 2.6;
  const off: "end" | "lift" | "slow" | null = sk.s >= 1 || sk.s <= 0 ? "end" : liftOff ? "lift" : Math.abs(sk.speed) < 0.05 && Math.abs(tan.y) < 0.05 ? "slow" : null;
  if (off) {
    world.events.push({ kind: "line_skim_end", t, x: world.p.x, off });
    world.skim = null;
    if (off === "lift") world.v = add(world.v, { x: 0, y: 1.4 });
    if (off === "slow") {
      // balanced on the line at the bottom of its droop: it teeters, then tips off the far side
      world.v = { x: 0.35, y: -0.4 };
      world.tumble = 0.6;
      world.spin = 4;
    }
    world.p.y += off === "end" ? 0 : 0.12;
  }
}

function bounce(world: WorldState, n: V2, restitution: number, friction: number) {
  const vn = dot(world.v, n);
  if (vn >= 0) return 0;
  const vt = sub(world.v, mul(n, vn));
  world.v = add(mul(n, -vn * restitution), mul(vt, friction));
  return -vn;
}

function knock(world: WorldState, strength: number) {
  world.tumble = Math.max(world.tumble, clamp(strength * 0.12, 0.15, 0.9));
  world.spin = strength * 3.2 * (world.v.x >= 0 ? -1 : 1);
  world.bellEnergy = Math.max(world.bellEnergy, clamp(0.3 + strength * 0.12, 0, 1));
  if (strength > 1.2) world.events.push({ kind: "bell", t: world.t, strength: clamp(strength / 6, 0.2, 1) });
}

function collide(world: WorldState, course: CourseDef, prev: V2, t: number) {
  const p = world.p;
  const speed = len(world.v);

  // ---- out of the courtyard
  if (p.y > course.bounds.maxY) return finish(world, "missed", "away", { kind: "away", t, where: "roof" });
  if (p.x < course.bounds.minX) return finish(world, "missed", "away", { kind: "away", t, where: "left" });
  if (p.x > course.bounds.maxX) return finish(world, "missed", "away", { kind: "away", t, where: "right" });

  // ---- static walls (building faces, the mast)
  for (const w of course.walls) {
    const { q } = closestOnSegment(p, w.a, w.b);
    const d = sub(p, q);
    const dl = len(d);
    if (dl < GLIDER_R && dl > 1e-6) {
      const n = mul(d, 1 / dl);
      world.p = add(q, mul(n, GLIDER_R));
      const hit = bounce(world, n, 0.35, 0.7);
      if (hit > 0.6) {
        world.events.push({ kind: "wall", t, speed: hit });
        knock(world, hit);
      }
    }
  }

  // ---- the basket: entering the mouth from above is a delivery; its sides and rim bounce
  const bk = course.basket;
  const bx0 = bk.x - bk.width / 2;
  const bx1 = bk.x + bk.width / 2;
  if (prev.y >= bk.y && p.y < bk.y && p.x > bx0 + 0.03 && p.x < bx1 - 0.03) {
    world.events.push({ kind: "basket", t, speed, via: [...world.via] });
    world.p = { x: clamp(p.x, bx0 + 0.12, bx1 - 0.12), y: bk.y - bk.depth * 0.45 };
    world.v = { x: 0, y: 0 };
    return finish(world, "delivered", "basket");
  }
  for (const corner of [{ x: bx0, y: bk.y }, { x: bx1, y: bk.y }]) {
    const d = sub(p, corner);
    const dl = len(d);
    if (dl < GLIDER_R * 0.9 && dl > 1e-6) {
      const n = mul(d, 1 / dl);
      world.p = add(corner, mul(n, GLIDER_R * 0.9));
      const hit = bounce(world, n, 0.45, 0.8);
      if (hit > 0.3) {
        world.events.push({ kind: "rim", t, speed: hit });
        world.via.push("rim");
        knock(world, hit * 0.7);
      }
    }
  }
  for (const [x, nx] of [[bx0, -1], [bx1, 1]] as const) {
    if (p.y < bk.y && p.y > bk.y - bk.depth && Math.abs(p.x - x) < GLIDER_R) {
      const outside = (p.x - x) * nx > 0;
      if (outside) {
        world.p.x = x + nx * GLIDER_R;
        const hit = bounce(world, { x: nx, y: 0 }, 0.3, 0.6);
        if (hit > 0.3) {
          world.events.push({ kind: "rim", t, speed: hit });
          knock(world, hit * 0.6);
        }
      }
    }
  }
  if (p.x > bx0 && p.x < bx1 && p.y < bk.y - bk.depth && p.y > bk.y - bk.depth - GLIDER_R) {
    world.p.y = bk.y - bk.depth - GLIDER_R;
    bounce(world, { x: 0, y: -1 }, 0.2, 0.6);
  }

  // ---- the balcony: railing and floor
  const bal = course.balcony;
  if (p.x > bal.x0 && p.x < bal.x1) {
    if (prev.y >= bal.floor && p.y < bal.floor) {
      world.p.y = bal.floor + 0.01;
      world.v = { x: world.v.x * 0.3, y: 0 };
      world.events.push({ kind: "balcony", t });
      return finish(world, "missed", "balcony");
    }
  }
  // the balcony slab is solid from underneath too
  if (p.x > bal.x0 - GLIDER_R * 0.5 && p.x < bal.x1 && prev.y <= bal.floor - 0.16 && p.y > bal.floor - 0.16 - GLIDER_R * 0.2) {
    world.p.y = bal.floor - 0.17 - GLIDER_R * 0.2;
    const hit = bounce(world, { x: 0, y: -1 }, 0.3, 0.7);
    if (hit > 0.4) {
      world.events.push({ kind: "wall", t, speed: hit });
      knock(world, hit);
    }
  }
  if (p.y > bal.floor - 0.15 && p.y < bal.rail && Math.abs(p.x - bal.x0) < GLIDER_R && prev.x < bal.x0) {
    world.p.x = bal.x0 - GLIDER_R;
    const hit = bounce(world, { x: -1, y: 0 }, 0.35, 0.7);
    if (hit > 0.4) {
      world.events.push({ kind: "wall", t, speed: hit });
      knock(world, hit);
    }
  }

  const railTop = { x: bal.x0, y: bal.rail };
  {
    const d = sub(p, railTop);
    const dl = len(d);
    if (dl < GLIDER_R * 0.9 && dl > 1e-6) {
      const n = mul(d, 1 / dl);
      world.p = add(railTop, mul(n, GLIDER_R * 0.9));
      const hit = bounce(world, n, 0.4, 0.8);
      if (hit > 0.3) {
        world.events.push({ kind: "rim", t, speed: hit });
        world.via.push("railing");
        knock(world, hit * 0.7);
      }
    }
  }
  // Bella: startled, soft, she does not catch
  {
    const be = course.bella;
    const e = { x: (p.x - be.x) / (be.rx + GLIDER_R), y: (p.y - be.y) / (be.ry + GLIDER_R) };
    const ed = Math.hypot(e.x, e.y);
    if (ed < 1 && ed > 1e-6) {
      world.p = { x: be.x + (e.x / ed) * (be.rx + GLIDER_R), y: be.y + (e.y / ed) * (be.ry + GLIDER_R) };
      const nn = { x: e.x / (be.rx + GLIDER_R), y: e.y / (be.ry + GLIDER_R) };
      const hit = bounce(world, mul(nn, 1 / (len(nn) || 1)), 0.25, 0.5);
      if (hit > 0.3 && !world.via.includes("bella")) {
        world.events.push({ kind: "bella", t, speed: hit });
        world.via.push("bella");
        knock(world, hit * 0.5);
      }
    }
  }

  // ---- the station table
  const st = course.station;
  if (world.t > 0.12 && p.x > st.x0 && p.x < st.x1 && prev.y >= st.top && p.y < st.top + 0.02) {
    world.p.y = st.top + 0.02;
    world.v = { x: world.v.x * 0.3, y: 0 };
    return finish(world, "missed", "station", { kind: "rest", t, where: "station" });
  }

  // ---- the laundry line: a gentle landing skims along it, a hard one bounces
  const sPrev = lineSAt(course, prev.x);
  const sNow = lineSAt(course, p.x);
  if (sPrev !== null && sNow !== null && !world.sheetHold) {
    const lp = linePoint(course, sPrev, world.lineSag).y + GLIDER_R * 0.5;
    const ln = linePoint(course, sNow, world.lineSag).y + GLIDER_R * 0.5;
    const wasAbove = prev.y >= lp;
    const isAbove = p.y >= ln;
    if (wasAbove !== isAbove) {
      const tan = lineSlope(course, sNow, world.lineSag);
      const normal = { x: -tan.y, y: tan.x };
      const vn = dot(world.v, normal);
      const vt = dot(world.v, tan);
      const fromAbove = wasAbove;
      const shallow = Math.abs(vn) < 2.4 && Math.abs(vt) > Math.abs(vn) * 0.7;
      if (fromAbove && shallow) {
        world.skim = { s: sNow, speed: vt };
        world.p = { x: p.x, y: ln };
        world.lineSagV += 0.8;
        world.events.push({ kind: "line_skim_start", t, x: p.x });
        world.via.push("line");
        return;
      }
      // bounce off the rope; it gives under the hit
      world.p.y = fromAbove ? ln + 0.02 : ln - GLIDER_R - 0.02;
      const n = fromAbove ? normal : mul(normal, -1);
      const hit = bounce(world, n, 0.42, 0.75);
      world.lineSagV += clamp(hit * 0.5, 0, 2.5) * (fromAbove ? 1 : -0.4);
      world.events.push({ kind: "line_bounce", t, speed: hit });
      world.via.push("line");
      knock(world, hit);
    }
  }

  // ---- sheets hanging from the line: soft, heavy drag, they can swallow a slow glider
  course.sheets.forEach((sh, i) => {
    const mid = lineSAt(course, (sh.x0 + sh.x1) / 2) ?? 0.5;
    const top = linePoint(course, mid, world.lineSag).y - 0.04;
    const bottom = top - sh.drop;
    const st = world.sheets[i];
    const inside = p.x > sh.x0 && p.x < sh.x1 && p.y < top && p.y > bottom;
    if (inside) {
      if (!st.hit) {
        st.hit = true;
        st.pushV += clamp(world.v.x, -6, 6) * 0.35;
        world.events.push({ kind: "sheet", t, index: i, speed });
        world.via.push(`sheet${i}`);
        world.bellEnergy = Math.max(world.bellEnergy, 0.3);
      }
      // the fabric drags hard and lets the glider through only if it is quick
      world.v = mul(world.v, Math.exp(-STEP * 5.5));
      world.v.y -= STEP * 2.0;
      if (speed < 1.1 && p.y < top - 0.2) {
        world.sheetHold = { index: i, t: 0 };
        world.events.push({ kind: "sheet_caught", t, index: i });
      }
    } else if (st.hit && !(p.x > sh.x0 - 0.3 && p.x < sh.x1 + 0.3)) {
      st.hit = false;
    }
  });

  // ---- the cups: each rings when struck and swings away
  course.cups.forEach((cup, i) => {
    const c = cupPosition(course, world, i);
    const d = sub(p, c);
    const dl = len(d);
    const r = cup.radius + GLIDER_R;
    if (dl < r) {
      const s = world.cups[i];
      if (t - s.rungAt > 0.35) {
        s.rungAt = t;
        world.events.push({ kind: "cup", t, index: i, speed });
        world.via.push(`cup${i}`);
        if (world.cupSequence[world.cupSequence.length - 1] !== i) world.cupSequence.push(i);
        s.omega += clamp(world.v.x, -7, 7) * 0.9 / cup.length;
        // the cup takes a little of the glider's way; it does not stop it
        world.v = mul(world.v, 0.9);
        world.v.y += 0.25;
        world.bellEnergy = Math.max(world.bellEnergy, 0.4);
      }
    }
  });

  // ---- Cleo: soft body, a head, and a tail that can move
  collideCat(world, course, prev, t, speed);

  // ---- Rook reaches for gliders that come back to the station
  collideRook(world, course, t, speed);

  if (world.phase !== "flying") return;

  // ---- the ground
  if (p.y < GLIDER_R * 0.4) {
    world.p.y = GLIDER_R * 0.4;
    if (speed > 2.5 && world.v.y < -1.5 && !world.via.includes("bounced_ground")) {
      // a fast dart skips once, the way paper does on paving
      world.v = { x: world.v.x * 0.45, y: -world.v.y * 0.22 };
      world.via.push("bounced_ground");
      knock(world, speed * 0.4);
      return;
    }
    return finish(world, "missed", "ground", { kind: "ground", t, x: p.x, speed });
  }
}

function collideCat(world: WorldState, course: CourseDef, prev: V2, t: number, speed: number) {
  const cat = course.cat;
  const p = world.p;
  const body = { x: cat.x, y: cat.y + cat.ry };
  const head = add({ x: cat.x, y: cat.y }, cat.head);
  const cs = world.cat;

  // a glider whooshing past her ear
  if (len(sub(p, head)) < 1.25 && t - cs.nearAt > 1.2 && cs.phase === "asleep") {
    cs.nearAt = t;
    world.events.push({ kind: "cat_near", t });
  }
  if (world.bellEnergy > 0.45 && len(sub(p, head)) < 2.6 && t - cs.bellAt > 1.6 && cs.phase === "asleep") {
    cs.bellAt = t;
    world.events.push({ kind: "cat_bell", t });
  }

  // body: an ellipse, soft (fur), barely any bounce
  const e = { x: (p.x - body.x) / (cat.rx + GLIDER_R), y: (p.y - body.y) / (cat.ry + GLIDER_R) };
  const ed = Math.hypot(e.x, e.y);
  const hd = len(sub(p, head));
  const onHead = hd < cat.headR + GLIDER_R;
  if (ed < 1 || onHead) {
    const n = onHead
      ? mul(sub(p, head), 1 / (hd || 1))
      : (() => {
          const nn = { x: e.x / (cat.rx + GLIDER_R), y: e.y / (cat.ry + GLIDER_R) };
          const l = len(nn) || 1;
          return mul(nn, 1 / l);
        })();
    if (onHead) world.p = add(head, mul(n, cat.headR + GLIDER_R));
    else world.p = { x: body.x + (e.x / (ed || 1)) * (cat.rx + GLIDER_R), y: body.y + (e.y / (ed || 1)) * (cat.ry + GLIDER_R) };
    const hit = bounce(world, n, 0.18, 0.55);
    // she startles once per glider; after that it's just a soft cat to bounce off
    if (hit > 0.25 && (cs.phase === "asleep" || cs.phase === "grumpy") && !world.via.includes("cat")) {
      cs.hits++;
      world.events.push({ kind: "cat_hit", t, part: onHead ? "head" : "body", speed: hit });
      world.via.push("cat");
      knock(world, hit * 0.5);
      // a reflex: a beat, then the tail lashes and she rolls
      cs.phase = "startle";
      cs.since = t;
    }
  }

  // asleep, her tail lies along the paving: a glider that comes down on it stays there, and wakes her
  if ((cs.phase === "asleep" || cs.phase === "grumpy") && cs.ride === null && !world.via.includes("tail") && world.v.y <= 0.2 && speed < course.cat.rideMaxSpeed) {
    const seg = tailSegment(course, cs.tail);
    const { q, t: along } = closestOnSegment(p, seg.a, seg.b);
    if (len(sub(p, q)) < GLIDER_R + 0.07 && along > 0.08) {
      cs.ride = along;
      cs.hits++;
      cs.phase = "startle";
      cs.since = t;
      world.v = { x: 0, y: 0 };
      world.events.push({ kind: "cat_tail_land", t, along });
      world.via.push("cat");
      world.bellEnergy = Math.max(world.bellEnergy, 0.5);
      return;
    }
  }

  // the tail is solid while it swats; a glider in its path takes its speed
  if (cs.phase === "swat" && cs.ride === null) {
    const seg = tailSegment(course, cs.tail);
    const { q, t: along } = closestOnSegment(p, seg.a, seg.b);
    const d = sub(p, q);
    const dl = len(d);
    if (dl < GLIDER_R + 0.07 && !world.via.includes("tail")) {
      // a whip: the outer half of the tail carries nearly the tip's speed
      const r = Math.max(along, 0.6) * course.cat.tailLen;
      // surface velocity of the tail at the contact point (rotation about the root)
      const vTail = mul({ x: -Math.sin(cs.tail), y: Math.cos(cs.tail) }, cs.tailOmega * r);
      world.v = add(mul(vTail, 1.05), mul(world.v, 0.15));
      world.p = add(q, mul(d, (GLIDER_R + 0.08) / (dl || 1)));
      world.events.push({ kind: "cat_tail", t, speed: len(vTail) });
      world.via.push("tail");
      knock(world, len(vTail) * 0.3);
      world.tumble = Math.min(world.tumble, 0.2);
    }
  }
  void prev;
  void speed;
}

function stepCat(world: WorldState, course: CourseDef, dt: number) {
  const cs = world.cat;
  const t = world.t;
  if (cs.phase === "startle") {
    // wind up: the tail pulls back and down
    cs.tail += (course.cat.swat.windup - cs.tail) * (1 - Math.exp(-dt / 0.03));
    cs.tailOmega = 0;
    if (t - cs.since > 0.09) {
      cs.phase = "swat";
      cs.since = t;
    }
  } else if (cs.phase === "swat") {
    // the lash: a fast sweep up and over, clockwise
    const prevTail = cs.tail;
    const { windup, follow, duration } = course.cat.swat;
    // a lash is all speed: near-constant angular velocity, easing only at the very end
    const u = clamp((t - cs.since) / duration, 0, 1);
    const ease = u < 0.85 ? u / 0.925 : 1 - Math.pow(1 - u, 2) / (2 * 0.15 * 0.925);
    cs.tail = windup + (follow - windup) * clamp(ease, 0, 1);
    cs.tailOmega = (cs.tail - prevTail) / dt;
    cs.roll = Math.min(1, cs.roll + dt * 4);
    if (u >= 1) {
      cs.phase = "grumpy";
      cs.since = t;
      cs.tailOmega = 0;
    }
  } else if (cs.phase === "grumpy") {
    cs.tail += (course.cat.rest - 0.15 * Math.sin(t * 6) - cs.tail) * (1 - Math.exp(-dt / 0.25));
    cs.roll = Math.max(0, cs.roll - dt * 0.8);
    if (t - cs.since > 3.2) {
      cs.phase = "asleep";
      cs.since = t;
    }
  } else {
    cs.tail = course.cat.rest + 0.03 * Math.sin(t * 1.1);
  }
}

function collideRook(world: WorldState, course: CourseDef, t: number, speed: number) {
  const rk = world.rook;
  const p = world.p;
  if (rk.phase === "ready" && rk.eager && !rk.tried && world.t > 0.35) {
    const toward = sub(course.rook.reach, p);
    const d = len(toward);
    // he only goes for a glider that is coming back down to him, never for one leaving on its launch
    const coming = dot(world.v, toward) > 0 && world.v.y < 0;
    if (d < 1.6 && coming && world.t > 0.6 && p.x < course.launch.x + 0.9) {
      rk.phase = "reach";
      rk.since = t;
      rk.tried = true;
      world.events.push({ kind: "rook_reach", t, toward: { ...p } });
    }
  }
  if (rk.phase === "reach") {
    // he lunges toward where the glider is going to be
    const lead = add(p, mul(world.v, 0.12));
    const want = sub(lead, course.rook.reach);
    const wl = len(want);
    const limit = 0.75;
    const target = add(course.rook.reach, wl > limit ? mul(want, limit / wl) : want);
    rk.reach = add(rk.reach, mul(sub(target, rk.reach), 1 - Math.exp(-STEP / 0.06)));
    if (len(sub(p, rk.reach)) < course.rook.radius + GLIDER_R) {
      if (speed < 3.2) {
        world.events.push({ kind: "rook_catch", t });
        world.via.push("rook_catch");
        rk.phase = "holding";
        rk.since = t;
        world.v = { x: 0, y: 0 };
        return finish(world, "caught", "rook");
      }
      if (speed < 7.5) {
        // a backhand flick sends it out over the courtyard again: a real impulse, wherever that leads
        world.events.push({ kind: "rook_flick", t });
        world.via.push("rook_flick");
        rk.phase = "flick";
        rk.since = t;
        world.v = { x: 4.1 + speed * 0.12, y: 3.4 };
        world.tumble = 0.12;
        world.bellEnergy = 0.8;
        return;
      }
      world.events.push({ kind: "rook_miss", t });
      rk.phase = "flail";
      rk.since = t;
      return;
    }
    if (t - rk.since > 0.42) {
      world.events.push({ kind: "rook_miss", t });
      rk.phase = "flail";
      rk.since = t;
    }
  }
}

function stepRook(world: WorldState, course: CourseDef, dt: number) {
  const rk = world.rook;
  if (rk.phase === "flick" || rk.phase === "flail") {
    rk.reach = add(rk.reach, mul(sub(course.rook.reach, rk.reach), 1 - Math.exp(-dt / 0.2)));
  }
}

function finish(world: WorldState, outcome: Outcome, where: string, event?: WorldEvent) {
  if (event) world.events.push(event);
  if (where !== "away" && !event) world.events.push({ kind: "rest", t: world.t, where: where as "ground" });
  world.phase = "done";
  world.outcome = outcome;
  world.restWhere = where;
}

// ---------------------------------------------------------------- replays

export type FlightInput = { pull: V2; wings: { at: number; open: boolean }[] };

/** Fly a recorded input from a fresh world. `at` is in simulation steps after launch. */
export function simulate(
  course: CourseDef,
  input: FlightInput,
  fan: FanSetting = "up",
  opts: { maxSteps?: number; trace?: V2[]; traceEvery?: number } = {}
) {
  const maxSteps = opts.maxSteps ?? Math.ceil(MAX_FLIGHT / STEP) + 10;
  const w = createWorld(course, fan);
  if (!launch(w, course, input.pull)) return w;
  const wings = [...input.wings].sort((a, b) => a.at - b.at);
  let k = 0;
  for (let i = 0; i < maxSteps && w.phase === "flying"; i++) {
    while (k < wings.length && wings[k].at <= i) setWings(w, wings[k++].open);
    step(w, course);
    if (opts.trace && i % (opts.traceEvery ?? 6) === 0) opts.trace.push({ ...w.p });
  }
  if (opts.trace) opts.trace.push({ ...w.p });
  return w;
}

/** The first moments of a launch from this pull, for the aiming guide (no wind, no collisions). */
export function previewArc(course: CourseDef, pull: V2, seconds = 0.32, points = 7): V2[] {
  const v0 = launchVelocity(pull);
  const out: V2[] = [];
  let p = { ...course.launch };
  let v = { ...v0 };
  const n = Math.ceil(seconds / STEP);
  for (let i = 0; i <= n; i++) {
    if (i % Math.floor(n / (points - 1)) === 0) out.push({ ...p });
    const s = len(v);
    const kL = LIFT_FOLDED;
    const kD = DRAG_FOLDED;
    const liftDir = s > 0 ? { x: -v.y / s, y: v.x / s } : { x: 0, y: 0 };
    const a = add(add({ x: 0, y: -course.gravity }, mul(liftDir, kL * s * s)), mul(v, -kD * s));
    v = add(v, mul(a, STEP));
    p = add(p, mul(v, STEP));
  }
  return out.slice(0, points);
}
