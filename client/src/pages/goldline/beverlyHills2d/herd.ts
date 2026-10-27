/**
 * The Round-Up: the replayable heart of Beverly Hills. The herd has scattered across the old ranch; get every cow
 * into the pen before the sun goes down.
 *
 * You never push a cow. Cows drift away from the terrier, so you steer with where you stand (a sheepdog game). The
 * calf follows the boxer, and the herd follows the calf. The boxer is your loose cannon: run away from the herd and
 * he charges it, which moves cows fast and scatters them if your angle is wrong. He will not cross the creek. A tear
 * in the field swallows any cow that walks into it (it wanders back next round). At dusk a coyote comes for the herd;
 * bark it off, or run from it and let the boxer do the rest.
 *
 * Pure and seeded: the renderer reads it, the bot test plays it.
 */
export const HW = 1900; // world width
export const HZ = 240; // world depth (screen-ish px at the front)
export const PEN = { x0: 1600, gate0: 70, gate1: 170 };
/** the creek painted into the ranch: it runs from the back-left to the front-right, its banks shift with depth */
export const CREEK = { x0: 1090, x1: 1270, slope: 2.5 };
export const HOLE = { x: 780, z: 56, r: 46 };
export const DURATION = 150;

export type Vec = { x: number; z: number };
export type CowState = "graze" | "walk" | "run" | "penned" | "falling" | "lost";
export type Cow = Vec & { id: number; vx: number; vz: number; face: 1 | -1; calf: boolean; tint: number; size: number; state: CowState; startle: number; fall: number; hop: number; seed: number };
export type HerdEvent = { kind: "moo" | "bark" | "charge" | "penned" | "lost" | "combo" | "coyote" | "coyoteFlee" | "baffled" | "nap" | "wake"; x: number; z: number; n?: number };
export type Herd = {
  version: 1;
  time: number;
  rng: number;
  dog: Vec & { vx: number; vz: number; face: 1 | -1; sprint: boolean; bark: number; ring: number; idle: number };
  boxer: Vec & { vx: number; vz: number; face: 1 | -1; state: "follow" | "charge" | "nap" | "stop"; t: number; cool: number; aim: Vec };
  cows: Cow[];
  coyote: Vec & { face: 1 | -1; state: "away" | "stalk" | "flee" | "gone"; scared: number; lunge: number; dash: number };
  events: HerdEvent[];
  combo: { n: number; t: number };
  shake: number;
  over: null | { penned: number; lost: number; total: number; time: number; stars: number };
};
export type HerdInput = { dx: number; dz: number; sprint: boolean; bark: boolean };

function rand(h: Herd) {
  // mulberry32
  let t = (h.rng = (h.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const len = (x: number, z: number) => Math.hypot(x, z);
const dist = (a: Vec, b: Vec) => len(a.x - b.x, a.z - b.z);

/** a fresh round; extra cows come from real customers (one per new order at a visited building) */
export function newHerd(seed = Date.now() % 100000, extraCows = 0): Herd {
  const h: Herd = {
    version: 1,
    time: 0,
    rng: seed | 0,
    dog: { x: 120, z: 130, vx: 0, vz: 0, face: 1, sprint: false, bark: 0, ring: 0, idle: 0 },
    boxer: { x: 50, z: 170, vx: 0, vz: 0, face: 1, state: "follow", t: 0, cool: 3, aim: { x: 0, z: 0 } },
    cows: [],
    coyote: { x: -120, z: 120, face: 1, state: "away", scared: 0, lunge: 4, dash: 0 },
    events: [],
    combo: { n: 0, t: 0 },
    shake: 0,
    over: null,
  };
  const n = Math.min(12, 6 + Math.max(0, Math.floor(extraCows)));
  for (let i = 0; i < n; i++) {
    const calf = i === 0;
    // two loose groups and a straggler or two, never in the tear or the creek
    let x = 0, z = 0;
    do {
      const group = i % 3 === 2 ? 2 : i % 2;
      x = group === 0 ? 300 + rand(h) * 280 : group === 1 ? 640 + rand(h) * 360 : 980 + rand(h) * 120;
      z = 20 + rand(h) * 200;
    } while (dist({ x, z }, HOLE) < HOLE.r + 60 || (x > CREEK.x0 + CREEK.slope * z - 30 && x < CREEK.x1 + CREEK.slope * z + 30));
    h.cows.push({ id: i, x, z, vx: 0, vz: 0, face: rand(h) < 0.5 ? 1 : -1, calf, tint: Math.floor(rand(h) * 4), size: calf ? 0.95 : 1.25 + rand(h) * 0.12, state: "graze", startle: 0, fall: 0, hop: 0, seed: rand(h) * 100 });
  }
  return h;
}

const active = (c: Cow) => c.state !== "penned" && c.state !== "falling" && c.state !== "lost";
export const pennedCount = (h: Herd) => h.cows.filter(c => c.state === "penned").length;
/** the third star: every cow home inside this many seconds; a bigger herd gets longer */
export const par = (cows: number) => 36 + cows * 3;
export const lostCount = (h: Herd) => h.cows.filter(c => c.state === "lost" || c.state === "falling").length;

/** where the herd still out in the field is gathered */
export function centroid(h: Herd, near?: Vec, radius = Infinity): Vec | null {
  let x = 0, z = 0, n = 0;
  for (const c of h.cows) {
    if (!active(c)) continue;
    if (near && dist(c, near) > radius) continue;
    const w = c.calf ? 3 : 1;
    x += c.x * w;
    z += c.z * w;
    n += w;
  }
  return n ? { x: x / n, z: z / n } : null;
}

export const inCreek = (x: number, z: number) => x > CREEK.x0 + CREEK.slope * z && x < CREEK.x1 + CREEK.slope * z;

export function tickHerd(h: Herd, delta: number, input: HerdInput) {
  if (h.over) return;
  const dt = Math.min(delta, 0.05);
  h.time += dt;
  h.shake = Math.max(0, h.shake - dt * 2.2);
  h.combo.t = Math.max(0, h.combo.t - dt);
  if (h.combo.t === 0) h.combo.n = 0;
  moveDog(h, dt, input);
  moveBoxer(h, dt);
  moveCoyote(h, dt);
  moveCows(h, dt);
  const left = h.cows.filter(c => active(c) || c.state === "falling").length;
  if (left === 0 || h.time >= DURATION) {
    const penned = pennedCount(h), total = h.cows.length, lost = lostCount(h);
    const ratio = penned / total;
    const stars = penned === total ? (h.time <= par(total) ? 3 : 2) : ratio >= 0.5 ? 1 : 0;
    h.over = { penned, lost, total, time: h.time, stars };
  }
}

function moveDog(h: Herd, dt: number, input: HerdInput) {
  const d = h.dog;
  const m = Math.min(1, len(input.dx, input.dz));
  const speed = input.sprint ? 340 : 210;
  const tx = m ? (input.dx / len(input.dx, input.dz)) * speed * m : 0;
  const tz = m ? (input.dz / len(input.dx, input.dz)) * speed * 0.75 * m : 0;
  const k = Math.min(1, dt * 10);
  d.vx += (tx - d.vx) * k;
  d.vz += (tz - d.vz) * k;
  d.x = Math.max(20, Math.min(HW - 20, d.x + d.vx * dt));
  d.z = Math.max(0, Math.min(HZ, d.z + d.vz * dt));
  d.sprint = input.sprint && m > 0.1;
  if (Math.abs(d.vx) > 12) d.face = d.vx > 0 ? 1 : -1;
  d.idle = len(d.vx, d.vz) < 20 ? d.idle + dt : 0;
  d.bark = Math.max(0, d.bark - dt);
  d.ring = Math.max(0, d.ring - dt * 1.6);
  if (input.bark && d.bark === 0) {
    d.bark = 1.1;
    d.ring = 1;
    h.events.push({ kind: "bark", x: d.x, z: d.z });
    for (const c of h.cows) {
      if (!active(c)) continue;
      const r = dist(c, d);
      if (r > 290) continue;
      const ax = (c.x - d.x) / (r || 1), az = (c.z - d.z) / (r || 1);
      const push = 330 * (1 - r / 290) + 120;
      c.vx += ax * push;
      c.vz += az * push * 0.7;
      c.startle = 0.8;
      if (rand(h) < 0.35) h.events.push({ kind: "moo", x: c.x, z: c.z, n: c.calf ? 2 : 1 });
    }
    if (h.boxer.state === "nap") {
      h.boxer.state = "follow";
      h.events.push({ kind: "wake", x: h.boxer.x, z: h.boxer.z });
    }
    if (h.coyote.state === "stalk" && dist(h.coyote, d) < 320) {
      h.coyote.scared++;
      if (h.coyote.scared >= 2) scareCoyote(h);
    }
  }
}

function scareCoyote(h: Herd) {
  if (h.coyote.state !== "stalk") return;
  h.coyote.state = "flee";
  h.events.push({ kind: "coyoteFlee", x: h.coyote.x, z: h.coyote.z });
}

function moveBoxer(h: Herd, dt: number) {
  const b = h.boxer, d = h.dog;
  b.cool = Math.max(0, b.cool - dt);
  b.t = Math.max(0, b.t - dt);
  const speedDog = len(d.vx, d.vz);
  // the second habit: he charges whatever she runs from
  if (b.state === "follow" && b.cool === 0 && d.sprint && speedDog > 200) {
    const awayFrom = (p: Vec) => {
      const rx = d.x - p.x, rz = d.z - p.z;
      const r = len(rx, rz);
      return r > 1 && (d.vx * rx + d.vz * rz) / (speedDog * r) > 0.55;
    };
    let target: Vec | null = null;
    if (h.coyote.state === "stalk" && dist(d, h.coyote) < 360 && awayFrom(h.coyote)) target = h.coyote;
    else {
      const c = centroid(h, d, 420);
      if (c && awayFrom(c)) target = c;
    }
    if (target) {
      const rx = target.x - b.x, rz = target.z - b.z, r = len(rx, rz) || 1;
      // he overruns: the charge carries on through the target
      b.aim = { x: Math.max(30, Math.min(HW - 30, target.x + (rx / r) * 230)), z: Math.max(0, Math.min(HZ, target.z + (rz / r) * 160)) };
      b.state = "charge";
      b.t = 1.5;
      h.shake = 0.6;
      h.events.push({ kind: "charge", x: b.x, z: b.z });
    }
  }
  let tx = b.x, tz = b.z, sp = 0;
  if (b.state === "charge") {
    tx = b.aim.x;
    tz = b.aim.z;
    sp = 560;
    if (dist(b, b.aim) < 20 || b.t === 0) {
      b.state = "follow";
      b.cool = 2.2;
    }
    if (h.coyote.state === "stalk" && dist(b, h.coyote) < 130) scareCoyote(h);
  } else if (b.state === "follow") {
    tx = d.x - d.face * 110;
    tz = Math.min(HZ, d.z + 30);
    sp = dist(b, { x: tx, z: tz }) > 60 ? 250 : 90;
    // the fourth habit, in this meadow: left standing too long, he lies down where he is
    if (d.idle > 7) {
      b.state = "nap";
      h.events.push({ kind: "nap", x: b.x, z: b.z });
    }
  } else if (b.state === "stop") {
    if (b.t === 0) b.state = "follow";
  }
  if (sp) {
    const rx = tx - b.x, rz = tz - b.z, r = len(rx, rz);
    if (r > 2) {
      const step = Math.min(r, sp * dt);
      const nx = b.x + (rx / r) * step;
      // the third habit: no paw in the water
      const nz = Math.max(0, Math.min(HZ, b.z + (rz / r) * step * 0.8));
      if (inCreek(nx, nz) && !inCreek(b.x, b.z)) {
        if (b.state === "charge") {
          b.state = "stop";
          b.t = 0.9;
          b.cool = 1.5;
          h.events.push({ kind: "baffled", x: b.x, z: b.z });
        }
      } else {
        b.x = nx;
        b.z = nz;
      }
      b.vx = (rx / r) * sp;
      b.vz = (rz / r) * sp;
      if (Math.abs(rx) > 4) b.face = rx > 0 ? 1 : -1;
    } else {
      b.vx = b.vz = 0;
    }
  } else {
    b.vx = b.vz = 0;
  }
}

function moveCoyote(h: Herd, dt: number) {
  const c = h.coyote;
  if (c.state === "away" && h.time > DURATION * 0.5) {
    c.state = "stalk";
    c.x = -60;
    c.z = 40 + rand(h) * 160;
    c.scared = 0;
    h.events.push({ kind: "coyote", x: c.x, z: c.z });
  }
  if (c.state === "stalk") {
    let best: Cow | null = null;
    for (const cow of h.cows) if (active(cow) && (!best || dist(cow, c) < dist(best, c))) best = cow;
    if (!best) return scareCoyote(h);
    const rx = best.x - c.x, rz = best.z - c.z, r = len(rx, rz);
    // it shadows the nearest cow, then every few seconds it lunges and the cow bolts blind
    c.lunge -= dt;
    c.dash = Math.max(0, c.dash - dt);
    if (c.lunge <= 0 && r < 190) {
      c.lunge = 5 + rand(h) * 2;
      c.dash = 0.55;
      best.startle = 0.9;
      h.events.push({ kind: "moo", x: best.x, z: best.z, n: best.calf ? 2 : 1 });
    }
    const speed = c.dash > 0 ? 380 : 120;
    if (r > (c.dash > 0 ? 24 : 70)) {
      c.x += (rx / r) * speed * dt;
      c.z += (rz / r) * speed * dt * 0.8;
    }
    if (Math.abs(rx) > 4) c.face = rx > 0 ? 1 : -1;
  } else if (c.state === "flee") {
    c.x -= 420 * dt;
    c.face = -1;
    if (c.x < -140) c.state = "gone";
  }
}

function moveCows(h: Herd, dt: number) {
  const d = h.dog, b = h.boxer, co = h.coyote;
  const calf = h.cows.find(c => c.calf && active(c));
  for (const c of h.cows) {
    c.hop = Math.max(0, c.hop - dt * 2.5);
    c.startle = Math.max(0, c.startle - dt);
    if (c.state === "falling") {
      c.fall += dt;
      if (c.fall > 0.9) c.state = "lost";
      continue;
    }
    if (c.state === "lost") continue;
    if (c.state === "penned") {
      // home: a slow amble inside the fence
      c.vx += Math.sin(h.time * 0.4 + c.seed) * 6 * dt;
      c.vz += Math.cos(h.time * 0.33 + c.seed) * 6 * dt;
      c.vx *= 1 - dt * 1.5;
      c.vz *= 1 - dt * 1.5;
      c.x = Math.max(PEN.x0 + 30, Math.min(HW - 30, c.x + c.vx * dt));
      c.z = Math.max(4, Math.min(HZ - 4, c.z + c.vz * dt));
      if (Math.abs(c.vx) > 3) c.face = c.vx > 0 ? 1 : -1;
      continue;
    }
    let ax = 0, az = 0, threat = 0;
    const flee = (p: Vec, r: number, f: number) => {
      const rx = c.x - p.x, rz = c.z - p.z, dd = len(rx, rz);
      if (dd >= r || dd < 0.01) return;
      const k = Math.pow(1 - dd / r, 1.3) * f;
      ax += (rx / dd) * k;
      az += (rz / dd) * k;
      threat = Math.max(threat, k);
    };
    if (c.calf) {
      // the calf follows the boxer, and only half-minds the terrier
      flee(d, 120, 260);
      const rx = b.x - c.x, rz = b.z - c.z, r = len(rx, rz);
      if (r > 110 && b.state !== "charge") {
        ax += (rx / r) * 150;
        az += (rz / r) * 150;
      }
      if (b.state === "charge") flee(b, 140, 500);
    } else {
      flee(d, d.sprint ? 230 : 190, d.sprint ? 560 : 400);
      flee(b, b.state === "charge" ? 270 : 95, b.state === "charge" ? 1000 : 220);
    }
    if (co.state === "stalk") flee(co, 340, 640);
    // the herd: stay together (toward the calf most of all), don't crowd, run with the others when spooked
    let cx = 0, cz = 0, cw = 0, avx = 0, avz = 0, an = 0;
    for (const o of h.cows) {
      if (o === c || !active(o)) continue;
      const rx = o.x - c.x, rz = o.z - c.z, r = len(rx, rz);
      if (r < 50 && r > 0.01) {
        ax -= (rx / r) * 260 * (1 - r / 50);
        az -= (rz / r) * 260 * (1 - r / 50);
      }
      if (r < 280) {
        const w = o.calf ? 4 : 1;
        cx += o.x * w;
        cz += o.z * w;
        cw += w;
        avx += o.vx;
        avz += o.vz;
        an++;
      }
    }
    if (calf && calf !== c && dist(c, calf) >= 280) {
      // the calf's pull carries further than the herd's
      const rx = calf.x - c.x, rz = calf.z - c.z, r = len(rx, rz);
      ax += (rx / r) * 22;
      az += (rz / r) * 22;
    }
    if (cw) {
      const rx = cx / cw - c.x, rz = cz / cw - c.z, r = len(rx, rz) || 1;
      const k = threat > 40 ? 70 : 30;
      ax += (rx / r) * Math.min(k, r * 0.6);
      az += (rz / r) * Math.min(k, r * 0.6);
      if (threat > 40 && an) {
        ax += (avx / an - c.vx) * 0.9;
        az += (avz / an - c.vz) * 0.9;
      }
    }
    // left alone, a cow grazes and ambles
    if (threat < 20 && c.startle === 0) {
      ax += Math.sin(h.time * 0.5 + c.seed) * 18;
      az += Math.cos(h.time * 0.37 + c.seed * 1.7) * 14;
    }
    // the cold light in the tear frightens a calm cow off; one running blind does not see it
    {
      const rx = c.x - HOLE.x, rz = c.z - HOLE.z, dd = len(rx, rz) || 1;
      const calm = len(c.vx, c.vz) < 160;
      if (calm && dd < HOLE.r + 80) {
        const k = (1 - dd / (HOLE.r + 80)) * 260;
        ax += (rx / dd) * k;
        az += (rz / dd) * k;
      }
    }
    // the field's edges
    if (c.x < 40) ax += (40 - c.x) * 6;
    if (c.x > HW - 30) ax -= (c.x - HW + 30) * 6;
    if (c.z < 6) az += (6 - c.z) * 8;
    if (c.z > HZ - 6) az -= (c.z - HZ + 6) * 8;
    if (threat > 120 && c.startle < 0.2 && rand(h) < dt * 1.5) {
      c.startle = 0.6;
      h.events.push({ kind: "moo", x: c.x, z: c.z, n: c.calf ? 2 : 1 });
    }
    c.vx += ax * dt;
    c.vz += az * dt;
    const damp = threat > 20 || c.startle > 0 ? 1.4 : 3.2;
    c.vx *= 1 - Math.min(1, damp * dt);
    c.vz *= 1 - Math.min(1, damp * dt);
    let max = c.startle > 0 ? 330 : c.calf ? 250 : 230;
    if (inCreek(c.x, c.z)) max *= 0.5;
    const sp = len(c.vx, c.vz);
    if (sp > max) {
      c.vx *= max / sp;
      c.vz *= max / sp;
    }
    let nx = c.x + c.vx * dt;
    const nz = Math.max(0, Math.min(HZ, c.z + c.vz * dt));
    // the pen's fence: in only through the gate
    if (c.x < PEN.x0 && nx >= PEN.x0 && (nz < PEN.gate0 || nz > PEN.gate1)) {
      nx = PEN.x0 - 1;
      c.vx = -Math.abs(c.vx) * 0.3;
    }
    c.x = nx;
    c.z = nz;
    if (Math.abs(c.vx) > 8) c.face = c.vx > 0 ? 1 : -1;
    const s2 = len(c.vx, c.vz);
    c.state = s2 > 140 ? "run" : s2 > 22 ? "walk" : "graze";
    if (c.x > PEN.x0 + 26) {
      c.state = "penned";
      c.hop = 1;
      c.startle = 0;
      h.combo.n = h.combo.t > 0 ? h.combo.n + 1 : 1;
      h.combo.t = 2.5;
      h.events.push({ kind: "penned", x: c.x, z: c.z, n: pennedCount(h) });
      if (h.combo.n >= 2) h.events.push({ kind: "combo", x: c.x, z: c.z, n: h.combo.n });
    } else if (dist(c, HOLE) < HOLE.r) {
      c.state = "falling";
      c.fall = 0;
      h.shake = 0.4;
      h.events.push({ kind: "lost", x: c.x, z: c.z });
    }
  }
}

/** a simple sheepdog (Strömbom-style) for the tests: collect the straggler, else drive the herd at the gate */
export function shepherd(h: Herd): HerdInput {
  const gate = { x: PEN.x0 + 40, z: (PEN.gate0 + PEN.gate1) / 2 };
  const out = h.cows.filter(active);
  if (!out.length) return { dx: 0, dz: 0, sprint: false, bark: false };
  // a coyote at the herd comes first: go and bark it off
  const co = h.coyote;
  if (co.state === "stalk") {
    const dx = co.x - h.dog.x, dz = co.z - h.dog.z, r = len(dx, dz) || 1;
    return { dx: dx / r, dz: dz / r, sprint: r > 200, bark: r < 260 && h.dog.bark === 0 };
  }
  const c = centroid(h)!;
  let far = out[0];
  for (const cow of out) if (dist(cow, c) > dist(far, c)) far = cow;
  const spread = dist(far, c);
  let target: Vec;
  if (spread > 55 * Math.sqrt(out.length)) {
    const rx = far.x - c.x, rz = far.z - c.z, r = len(rx, rz) || 1;
    target = { x: far.x + (rx / r) * 60, z: far.z + (rz / r) * 45 };
  } else {
    const rx = c.x - gate.x, rz = c.z - gate.z, r = len(rx, rz) || 1;
    const back = Math.min(spread + 40, 130);
    target = { x: c.x + (rx / r) * back, z: c.z + (rz / r) * back };
  }
  target.z = Math.max(0, Math.min(HZ, target.z));
  const dx = target.x - h.dog.x, dz = target.z - h.dog.z, r = len(dx, dz) || 1;
  // keep moving like a working dog; a stall means bark
  const stalled = out.every(o => len(o.vx, o.vz) < 15) && dist(h.dog, c) < 220;
  return { dx: dx / r, dz: dz / r, sprint: r > 300, bark: stalled && h.dog.bark === 0 };
}
