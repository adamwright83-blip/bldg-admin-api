/**
 * The Lost Creek, the simulation. Pure, deterministic, no DOM: the renderer reads it, the tests walk it.
 *
 * One place, two eras, always both present: the 2026 courtyard on the left of a static paper seam, the 1890s ranch on
 * the right, and she walks through the seam freely. One rule to discover: water that leaves 2026 arrives in the
 * 1890s, and it comes back if you let it. Drain the fountain with the hose and the lost creek runs out of the culvert,
 * floods the ford, and (if the sluice is open) fills the old channel and the hole where a calf is stranded on a ledge.
 *
 * One playable animal, the terrier. The boxer is not yours to steer; his habits are the puzzle grammar: he takes what
 * she carries, he chases what is thrown and settles where he catches it, he naps wherever he last settled, and he will
 * not put a paw in deep water. The calf comes down onto the floating trough when someone it trusts waits at the
 * landing: the boxer (it chose him), or the terrier once she has earned it by being still. Nobody speaks; feelings are
 * reaction portraits (`inserts`), and every verb has its own sound (`cues`, drained by the renderer).
 *
 * The stage has depth: every actor stands on a ground band at a depth d in [0, 1] (0 at the back of the painting,
 * 1 at its front edge). Depth sets the draw order and the scale.
 */
import type { Mood } from "./cells";

export type Chapter = "creek" | "home";
export type Item = "ball";
export type Side = "now" | "then";
export type Actor = { x: number; d: number; face: 1 | -1; jump: number; vy: number; moving: boolean };
export type BoxerState = "nap" | "follow" | "chase" | "carry" | "settle" | "refuse";
export type Insert = { who: "terrier" | "boxer" | "calf"; mood: Mood; t: number; id: number };
export type Cue =
  | "splash"
  | "pop"
  | "hose"
  | "fill"
  | "creak"
  | "knock"
  | "moo"
  | "huff"
  | "sigh"
  | "chime"
  | "chord"
  | "rustle"
  | "lap"
  | "toss"
  | "pick"
  | "thunk"
  | "sniff"
  | "bleat"
  | "ding";
export type Toy = {
  kind: Item;
  x: number;
  d: number;
  /** thrown by her (only a thrown ball wakes a napping boxer); stays true until someone picks it up */
  thrown: boolean;
  wet: boolean;
  /** rest on the ground, in the air, rolling, drifting to a bank, or down the storm drain */
  phase: "rest" | "flight" | "roll" | "drift" | "drain";
  from: { x: number; d: number };
  to: { x: number; d: number };
  t: number;
  dur: number;
  /** height above the ground while in flight (the shadow stays on the ground) */
  lift: number;
};

export type Adventure = {
  version: 3;
  chapter: Chapter;
  time: number;
  player: Actor & { item: Item | null; wet: number; run: number; speed: number; perch: boolean; charge: number | null; hops: number[]; lap: number };
  boxer: Actor & { state: BoxerState; item: Item | null; t: number; goal: "ball" | "her"; trot: number; yields: boolean };
  calf: Actor & { ledge: boolean; trust: number; still: number; ballSeen: boolean; near: boolean; sawBoxer: boolean; back: number; step: number | null; stepFrom: number; lift: number };
  toy: Toy | null;
  can: { x: number; d: number; roll: number; dir: 1 | -1; cool: number };
  /** the water, all levels 0..1: fountain, creek, ford, channel, hole; trend is -1 while the fountain drains */
  water: { F: number; C: number; ford: number; channel: number; hw: number; trend: -1 | 0 | 1 };
  hose: boolean;
  sluice: boolean;
  flags: { crossed: boolean; rescued: boolean; yielded: boolean; followed: boolean; ended: boolean };
  home: { lying: number | null; ride: number };
  inserts: Insert[];
  nextInsert: number;
  /** a line of place, shown once: "Two times, one courtyard" */
  card: { text: string; t: number } | null;
  /** the paper tear into the ending */
  tear: { from: Chapter; t: number } | null;
  /** sounds this tick asked for; the renderer plays and clears them */
  cues: Cue[];
  /** private timers for repeating sounds and edge detection */
  beat: { hose: number; fill: number; knockArmed: boolean; side: Side; homeward: boolean };
};

export const WIDTH = 3800;
export const SEAM = 1900;
export const VIEW = 1280;
/** ranch-local x is world x minus this */
export const R = SEAM;
/** the ground band on screen (canvas y), per painting */
export const GROUND = {
  courtyard: [608, 776] as [number, number],
  pasture: [556, 772] as [number, number],
  home: [700, 760] as [number, number],
};
/** the band under world x: courtyard, ranch, lerped across the seam so the ground has no step */
export function groundBand(x: number, chapter: Chapter = "creek"): [number, number] {
  if (chapter === "home") return GROUND.home;
  const k = Math.max(0, Math.min(1, (x - (SEAM - 60)) / 120));
  return [GROUND.courtyard[0] + (GROUND.pasture[0] - GROUND.courtyard[0]) * k, GROUND.courtyard[1] + (GROUND.pasture[1] - GROUND.courtyard[1]) * k];
}
export const PLACES = {
  now: "Beverly Hills · the courtyard",
  then: "Rancho Rodeo de las Aguas · 1890s",
  home: "Beverly Hills · then, and now",
};
export const side = (x: number): Side => (x < SEAM ? "now" : "then");
export const placeOf = (s: Adventure) => (s.chapter === "home" ? PLACES.home : PLACES[side(s.player.x)]);

// where things are (world x; depth d)
export const SPOTS = {
  ball: { x: 470, d: 0.62 },
  fountain: { x: 850, d: 0.3 },
  hose: { x: 960, d: 0.46 },
  /** in front of the stairs, so the grate is never hidden behind them */
  drain: { x: 1500, d: 0.62 },
  hedge: { x: 120, d: 0.15 },
  pots: { x: 1180, d: 0.2 },
  stairs: { x: 1660, d: 0.42 },
  boxerSleep: { x: 1600, d: 0.58 },
  culvert: { x: R + 130, d: 0.2 },
  hole: { x: R + 1620, d: 0.18 },
  ledge: { x: R + 1620, d: 0.18 },
  trough: { x: R + 1690, d: 0.18 },
  rim: { x: R + 1745, d: 0.3 },
  landing: { x: R + 1800, d: 0.3 },
  sluice: { x: R + 1790, d: 0.42 },
  cow: { x: R + 1240, d: 0.04 },
  hay: { x: R + 480, d: 0.62 },
  can: { x: R + 1420, d: 0.7 },
  /** the oak limb that falls across the courtyard doorway after the rescue */
  branch: { x: 930, d: 0.35 },
  /** the overlap painting, fitted to the screen as it always was: the pool, the oak, the elevator */
  home: { pool: 300, oak: 640, elevator: 1080 },
} as const;

/** the painted creek bed (the herd's CREEK diagonal), the old channel, and the hole the pasture fell into */
export const fordEdges = (d: number): [number, number] => [R + 1090 + 600 * d, R + 1270 + 600 * d];
export const inFord = (x: number, d: number) => x > fordEdges(d)[0] && x < fordEdges(d)[1];
export const inChannel = (x: number, d: number) => x > R + 1560 && x < R + 1700 && d < 0.45 && d >= 0.3;
export const inPit = (x: number, d: number) => Math.abs(x - SPOTS.hole.x) < 120 && d < 0.3;
export const LEDGE_RANGE: [number, number] = [R + 1560, R + 1660];
/** how far below the rim the ledge stands (the hole's floor is this much lower again) */
export const LEDGE_DROP = 92;
export const DEEP = 0.35;
export const STEPPABLE = 0.85;
/** the trough's deck, in px relative to the rim: on the floor when the hole is dry, level with the ledge when full */
export const troughDeck = (hw: number) => -2 * LEDGE_DROP + LEDGE_DROP * hw;

/** the water under a point: which body and how high */
export function waterAt(s: Adventure, x: number, d: number): { kind: "ford" | "channel" | null; level: number } {
  if (s.chapter !== "creek") return { kind: null, level: 0 };
  if (inChannel(x, d)) return { kind: "channel", level: s.water.channel };
  if (inFord(x, d)) return { kind: "ford", level: s.water.ford };
  return { kind: null, level: 0 };
}
export const deepAt = (s: Adventure, x: number, d: number) => waterAt(s, x, d).level > DEEP;
/** kept for the painter's drips */
export const inWater = (s: Adventure, x: number, d = s.player.d) => waterAt(s, x, d).level > 0.05;

const actor = (x: number, d: number, face: 1 | -1 = 1): Actor => ({ x, d, face, jump: 0, vy: 0, moving: false });
const restingBall = (x: number, d: number): Toy => ({ kind: "ball", x, d, thrown: false, wet: false, phase: "rest", from: { x, d }, to: { x, d }, t: 0, dur: 0, lift: 0 });

export function freshAdventure(): Adventure {
  return {
    version: 3,
    chapter: "creek",
    time: 0,
    player: { ...actor(220, 0.6), item: null, wet: 0, run: 0, speed: 0, perch: false, charge: null, hops: [], lap: 0 },
    boxer: { ...actor(SPOTS.boxerSleep.x, SPOTS.boxerSleep.d, -1), state: "nap", item: null, t: 0, goal: "her", trot: 0, yields: false },
    calf: { ...actor(SPOTS.ledge.x, SPOTS.ledge.d, -1), ledge: true, trust: 0, still: 0, ballSeen: false, near: false, sawBoxer: false, back: 0, step: null, stepFrom: SPOTS.ledge.x, lift: -LEDGE_DROP },
    toy: restingBall(SPOTS.ball.x, SPOTS.ball.d),
    can: { x: SPOTS.can.x, d: SPOTS.can.d, roll: 0, dir: 1, cool: 0 },
    water: { F: 1, C: 0, ford: 0, channel: 0, hw: 0, trend: 0 },
    hose: false,
    sluice: false,
    flags: { crossed: false, rescued: false, yielded: false, followed: false, ended: false },
    home: { lying: null, ride: 0 },
    inserts: [],
    nextInsert: 1,
    card: null,
    tear: null,
    cues: [],
    beat: { hose: 0, fill: 0, knockArmed: true, side: "now", homeward: false },
  };
}

const BOXER_STATES: BoxerState[] = ["nap", "follow", "chase", "carry", "settle", "refuse"];

/** a saved afternoon comes back whole; anything odd (or an older adventure) starts a fresh one */
export function restoreAdventure(raw: string | null): Adventure {
  try {
    const r = JSON.parse(raw ?? "null");
    if (!r || r.version !== 3 || (r.chapter !== "creek" && r.chapter !== "home")) return freshAdventure();
    const s = freshAdventure();
    s.chapter = r.chapter;
    const F = Number(r.water?.F);
    if (Number.isFinite(F)) s.water.F = clamp01(F);
    s.hose = r.hose === true;
    s.sluice = r.sluice === true;
    const trust = Number(r.calf?.trust);
    if (Number.isFinite(trust)) s.calf.trust = Math.max(0, Math.min(3, Math.round(trust)));
    s.flags.rescued = r.flags?.rescued === true;
    s.flags.yielded = r.flags?.yielded === true;
    s.flags.crossed = r.flags?.crossed === true;
    s.flags.followed = r.flags?.followed === true;
    s.flags.ended = s.chapter === "home" && r.flags?.ended === true;
    if (Number.isFinite(r.player?.x)) s.player.x = clampX(r.player.x);
    if (Number.isFinite(r.player?.d)) s.player.d = clamp01(r.player.d);
    if (Number.isFinite(r.boxer?.x)) s.boxer.x = clampX(r.boxer.x);
    if (Number.isFinite(r.boxer?.d)) s.boxer.d = clamp01(r.boxer.d);
    // a dog mid-errand comes back napping where he was
    const state = BOXER_STATES.includes(r.boxer?.state) ? (r.boxer.state as BoxerState) : "nap";
    s.boxer.state = state === "follow" ? "follow" : "nap";
    // the water settles where it was left
    const w = s.water;
    w.C = 1 - w.F;
    w.ford = s.sluice ? 0.35 * w.C : w.C;
    w.channel = s.sluice ? w.C : 0;
    w.hw = w.channel;
    s.beat.knockArmed = w.hw < STEPPABLE;
    s.beat.side = side(s.player.x);
    if (s.flags.rescued) {
      s.calf.ledge = false;
      s.calf.lift = 0;
      s.calf.trust = 3;
      s.calf.x = s.player.x + 70;
      s.calf.d = s.player.d;
      s.boxer.yields = true;
    }
    if (s.chapter === "home") {
      s.player.x = Math.min(s.player.x, HOME_WIDTH - 70);
      placeHome(s);
    }
    return s;
  } catch {
    return freshAdventure();
  }
}

export const HOME_WIDTH = VIEW;
const clampX = (x: number) => Math.max(70, Math.min(WIDTH - 70, x));
const clamp01 = (d: number) => Math.max(0, Math.min(1, d));
const approach = (n: number, target: number, step: number) => n + Math.sign(target - n) * Math.min(Math.abs(target - n), step);
export const dist = (a: { x: number; d: number }, b: { x: number; d: number }) => Math.hypot(a.x - b.x, (a.d - b.d) * 240);

function insert(s: Adventure, who: Insert["who"], mood: Mood) {
  if (s.inserts.some(i => i.who === who && i.mood === mood && i.t < 0.6)) return;
  s.inserts.push({ who, mood, t: 0, id: s.nextInsert++ });
  if (s.inserts.length > 3) s.inserts.shift();
}
const cue = (s: Adventure, c: Cue) => {
  if (!s.cues.includes(c)) s.cues.push(c);
};
const card = (s: Adventure, text: string) => {
  s.card = { text, t: 0 };
};

function placeHome(s: Adventure) {
  const p = s.player;
  p.d = 0.6;
  p.item = null;
  p.charge = null;
  p.jump = 0;
  p.vy = 0;
  p.perch = false;
  s.toy = null;
  s.calf.ledge = false;
  s.calf.lift = 0;
  s.calf.step = null;
  s.calf.x = Math.min(HOME_WIDTH - 70, p.x + 70);
  s.calf.d = 0.62;
  s.boxer.x = Math.max(70, p.x - 110);
  s.boxer.d = 0.56;
  s.boxer.state = "follow";
  s.boxer.item = null;
  if (s.flags.ended) layDown(s, 1);
}

/** the three settle under the oak, k from 0 (where they stand) to 1 (lying in the painted poses) */
function layDown(s: Adventure, k: number) {
  const oak = SPOTS.home.oak;
  const spots: [Actor, number][] = [
    [s.player, oak - 150],
    [s.calf, oak - 10],
    [s.boxer, oak + 150],
  ];
  for (const [a, x] of spots) {
    a.x = k >= 1 ? x : approach(a.x, x, 400 * k);
    a.d = k >= 1 ? 0.5 : approach(a.d, 0.5, k);
  }
}

// ------------------------------------------------------------------ what she can do here
export type Prompt = { label: string; action: string } | null;
export function prompt(s: Adventure): Prompt {
  if (s.tear) return null;
  const p = s.player;
  if (s.chapter === "home") {
    if (s.home.lying !== null || s.flags.ended || p.lap > 0) return null;
    if (Math.abs(p.x - SPOTS.home.oak) < 140) return { label: "Lie down with them", action: "lie" };
    if (Math.abs(p.x - SPOTS.home.pool) < 140) return { label: "Drink with the cows", action: "drink" };
    if (Math.abs(p.x - SPOTS.home.elevator) < 140) return { label: "Ride down to the beans", action: "ride" };
    return null;
  }
  // whatever is nearest her, so a ball dropped by the sluice never hides the sluice
  const toy = s.toy;
  const options: [number, NonNullable<Prompt>][] = [];
  if (toy && !p.item && (toy.phase === "rest" || toy.phase === "roll") && dist(p, toy) < 90) options.push([dist(p, toy), { label: "Pick up the ball", action: "pickup" }]);
  if (dist(p, SPOTS.hose) < 120) options.push([dist(p, SPOTS.hose), { label: s.hose ? "Shut the hose" : "Open the hose", action: "hose" }]);
  if (dist(p, SPOTS.sluice) < 130) options.push([dist(p, SPOTS.sluice), { label: s.sluice ? "Close the sluice" : "Open the sluice", action: "sluice" }]);
  if (dist(p, SPOTS.fountain) < 130) options.push([dist(p, SPOTS.fountain) + 40, { label: "Sniff the fountain", action: "sniff" }]);
  options.sort((m, n) => m[0] - n[0]);
  return options[0]?.[1] ?? null;
}

export function interact(s: Adventure): boolean {
  const pr = prompt(s);
  if (!pr) return false;
  const p = s.player;
  switch (pr.action) {
    case "pickup":
      if (s.toy) {
        p.item = s.toy.kind;
        s.toy = null;
        cue(s, "pick");
      }
      break;
    case "hose":
      s.hose = !s.hose;
      cue(s, s.hose ? "hose" : "fill");
      s.beat.hose = 0;
      s.beat.fill = 0;
      break;
    case "sluice":
      s.sluice = !s.sluice;
      cue(s, "creak");
      break;
    case "sniff":
      insert(s, "terrier", s.water.F > 0.3 ? "confused" : "suspicious");
      cue(s, "sniff");
      break;
    case "drink":
      p.lap = 2;
      cue(s, "lap");
      cue(s, "moo");
      break;
    case "ride":
      s.home.ride = 1.6;
      cue(s, "ding");
      card(s, "the beans are coming up");
      break;
    case "lie":
      s.home.lying = 0;
      cue(s, "sigh");
      break;
  }
  return true;
}

/** hold to charge: power climbs 0→1 over 0.9 s while she holds F (or the throw button) */
export function chargeThrow(s: Adventure): boolean {
  if (s.chapter !== "creek" || s.tear || !s.player.item || s.player.charge !== null) return false;
  s.player.charge = 0;
  return true;
}
export function releaseThrow(s: Adventure): boolean {
  const power = s.player.charge;
  if (power === null) return false;
  s.player.charge = null;
  return throwToy(s, power);
}

export const throwDistance = (power: number) => 160 + 520 * (power < 0.15 ? 0 : Math.min(1, power));
export const FLIGHT = 0.7;
export const ROLL = 40;

/** she throws what she carries the way she faces: a parabola, then a short roll; it never leaves the world */
export function throwToy(s: Adventure, power = 0): boolean {
  const p = s.player;
  if (s.chapter !== "creek" || !p.item) return false;
  const tx = clampX(p.x + p.face * throwDistance(power));
  let td = Math.max(0.05, Math.min(0.95, p.d));
  // a ball that would land in the hole bounces off its far wall onto the front rim
  if (inPit(tx, td)) td = 0.32;
  s.toy = { kind: p.item, x: p.x, d: p.d, thrown: true, wet: false, phase: "flight", from: { x: p.x, d: p.d }, to: { x: tx, d: td }, t: 0, dur: FLIGHT, lift: 0 };
  p.item = null;
  p.charge = null;
  cue(s, "toss");
  // a thrown ball is the one thing more interesting than a nap
  const b = s.boxer;
  if (b.state !== "carry" && b.state !== "settle") {
    b.state = "chase";
    b.goal = "ball";
    b.t = 0;
  }
  return true;
}

export function hop(s: Adventure) {
  const p = s.player;
  if (s.tear || (p.jump !== 0 && !p.perch) || p.lap > 0 || s.home.lying !== null || s.flags.ended) return;
  p.vy = 430;
  p.perch = false;
  p.hops = [...p.hops.filter(t => s.time - t < 1.5), s.time];
  const b = s.boxer;
  // two hops right beside him wake him up, and then he tags along
  if (s.chapter === "creek" && b.state === "nap" && dist(p, b) < 60 && p.hops.length >= 2) {
    b.state = "follow";
    b.goal = "her";
    b.t = 0;
    insert(s, "boxer", "startled");
  }
  if (s.chapter === "creek" && s.calf.ledge && dist(p, s.calf) < 220) insert(s, "calf", "startled");
}

// ------------------------------------------------------------------ time passes
export type Input = { dx: number; dy: number };
export function tick(s: Adventure, delta: number, input: Input) {
  if (s.chapter === "home" && s.flags.ended) return;
  const dt = Math.min(delta, 0.05);
  s.time += dt;
  for (const i of s.inserts) i.t += dt;
  s.inserts = s.inserts.filter(i => i.t < 1.6);
  if (s.card) {
    s.card.t += dt;
    if (s.card.t > 2.8) s.card = null;
  }
  if (s.tear) {
    s.tear.t += dt / 1.25;
    if (s.tear.t >= 1) s.tear = null;
    return;
  }
  if (s.chapter === "home") return tickHome(s, dt, input);
  flow(s, dt);
  movePlayer(s, dt, input);
  moveToy(s, dt);
  moveBoxer(s, dt);
  moveCalf(s, dt);
  moveCan(s, dt);
  seam(s, input);
}

/** the water: a fountain in 2026 and the creek it used to be, joined at the seam */
function flow(s: Adventure, dt: number) {
  const w = s.water;
  const before = w.F;
  w.F = clamp01(w.F + (s.hose ? -0.12 : 0.08) * dt);
  w.trend = w.F < before ? -1 : w.F > before ? 1 : 0;
  // the creek follows what the fountain lost with a half-second lag that reads as flow
  w.C += (1 - w.F - w.C) * (1 - Math.exp(-2 * dt));
  const fordTarget = s.sluice ? 0.35 * w.C : w.C;
  w.ford += (fordTarget - w.ford) * (1 - Math.exp(-2 * dt));
  if (s.sluice) w.channel += (w.C - w.channel) * (1 - Math.exp(-2 * dt));
  else w.channel = Math.max(0, w.channel - 0.3 * dt);
  w.hw = approach(w.hw, w.channel, 0.25 * dt);
  // the trough knocks against the ledge when it comes level
  if (w.hw >= STEPPABLE && s.beat.knockArmed) {
    s.beat.knockArmed = false;
    cue(s, "knock");
  } else if (w.hw < STEPPABLE - 0.1) s.beat.knockArmed = true;
  // the hose gurgles while it runs; the fountain's pump hums while it refills
  if (s.hose && w.F > 0) {
    s.beat.hose += dt;
    if (s.beat.hose > 1.2) {
      s.beat.hose = 0;
      cue(s, "hose");
    }
  }
  if (!s.hose && w.F < 1) {
    s.beat.fill += dt;
    if (s.beat.fill > 1.1) {
      s.beat.fill = 0;
      cue(s, "fill");
    }
  }
}

const HAY_TOP = 46;
const onHay = (x: number, d: number) => Math.abs(x - SPOTS.hay.x) < 62 && Math.abs(d - SPOTS.hay.d) < 0.08;

function movePlayer(s: Adventure, dt: number, input: Input) {
  const p = s.player;
  if (p.charge !== null) p.charge = Math.min(1, p.charge + dt / 0.9);
  const was = { x: p.x, d: p.d };
  const wading = waterAt(s, p.x, p.d).level > 0.05;
  // a trot builds up: a tap is a creep, a held key a run; water slows her whatever she does
  const trying = input.dx !== 0 || input.dy !== 0;
  p.run = trying ? Math.min(1, p.run + dt / 0.6) : 0;
  const speed = wading ? 130 : 120 + 130 * p.run;
  if (input.dx) p.face = input.dx > 0 ? 1 : -1;
  let nx = clampX(p.x + input.dx * dt * speed);
  let nd = clamp01(p.d + input.dy * dt * 0.55 * (wading ? 0.6 : 1));
  // the hole is a hole: she walks around its rim
  if (inPit(nx, nd)) {
    if (!inPit(nx, p.d)) nd = p.d;
    else if (!inPit(p.x, nd)) nx = p.x;
    else {
      nx = p.x;
      nd = p.d;
    }
  }
  p.x = nx;
  p.d = nd;
  p.speed = dist(was, p) / Math.max(dt, 1e-6);
  p.moving = p.speed > 1;
  // hop physics; the hay bale is something to stand on
  p.jump += p.vy * dt;
  p.vy -= dt * 1150;
  const floor = onHay(p.x, p.d) && (p.perch || p.jump >= HAY_TOP - 6) ? HAY_TOP : 0;
  if (p.perch && floor === 0) p.perch = false;
  if (p.jump <= floor && (p.vy <= 0 || floor === 0)) {
    p.jump = floor;
    p.vy = 0;
    p.perch = floor > 0;
  }
  const inW = waterAt(s, p.x, p.d).level > 0.05 && p.jump === 0;
  if (inW && p.wet < 0.5) cue(s, "splash");
  p.wet = inW ? Math.min(1, p.wet + dt * 3) : Math.max(0, p.wet - dt * 0.6);
  // the boxer takes what she carries when he can reach her (his first habit), until the afternoon he doesn't
  const b = s.boxer;
  if (p.item && (b.state === "follow" || b.state === "refuse" || b.state === "chase") && dist(p, b) < 95 && b.t > 1.2) {
    if (b.yields) {
      if (!s.flags.yielded) {
        s.flags.yielded = true;
        insert(s, "boxer", "tender");
        insert(s, "terrier", "delighted");
        b.state = "settle";
        b.t = 0;
        cue(s, "sigh");
      }
    } else {
      b.item = p.item;
      p.item = null;
      p.charge = null;
      startCarry(s);
      insert(s, "boxer", "delighted");
      insert(s, "terrier", "irritated");
    }
  }
}

/** the nearest dry place to stand beside a body of water */
function bank(s: Adventure, x: number, d: number): { x: number; d: number } {
  const w = waterAt(s, x, d);
  if (w.kind === "ford") {
    const [a, b] = fordEdges(d);
    return x - a < b - x ? { x: a - 24, d } : { x: b + 24, d };
  }
  if (w.kind === "channel") {
    const opts = [
      { x: R + 1536, d },
      { x: R + 1724, d },
      { x, d: 0.48 },
    ].filter(o => !inPit(o.x, o.d) && !inFord(o.x, o.d));
    return opts.reduce((m, o) => (dist(o, { x, d }) < dist(m, { x, d }) ? o : m), opts[0] ?? { x, d: 0.48 });
  }
  return { x, d };
}

function land(s: Adventure, toy: Toy) {
  toy.lift = 0;
  // the storm drain swallows it, and the lost creek gives it back
  if (dist(toy, SPOTS.drain) < 60) {
    toy.phase = "drain";
    toy.t = 0;
    toy.dur = 0.6;
    toy.x = SPOTS.drain.x;
    toy.d = SPOTS.drain.d;
    cue(s, "splash");
    return;
  }
  const w = waterAt(s, toy.x, toy.d);
  if (w.level > 0.05) {
    cue(s, "splash");
    toy.wet = true;
  }
  if (w.level > DEEP) return drift(s, toy);
  // a short roll on, stopping at the edge of the hole or of deep water
  const face = Math.sign(toy.to.x - toy.from.x) || 1;
  let rx = clampX(toy.x + face * ROLL);
  if (inPit(rx, toy.d)) rx = toy.x;
  toy.phase = "roll";
  toy.from = { x: toy.x, d: toy.d };
  toy.to = { x: rx, d: toy.d };
  toy.t = 0;
  toy.dur = 0.35;
}

function drift(s: Adventure, toy: Toy) {
  toy.phase = "drift";
  toy.wet = true;
  toy.from = { x: toy.x, d: toy.d };
  toy.to = bank(s, toy.x, toy.d);
  toy.t = 0;
  toy.dur = 3;
}

function moveToy(s: Adventure, dt: number) {
  const toy = s.toy;
  if (!toy) return;
  if (toy.phase === "rest") {
    // a ball left in the creek bed floats off when the water comes up
    if (deepAt(s, toy.x, toy.d)) drift(s, toy);
    return;
  }
  toy.t += dt;
  const k = Math.min(1, toy.t / toy.dur);
  if (toy.phase === "flight") {
    toy.x = toy.from.x + (toy.to.x - toy.from.x) * k;
    toy.d = toy.from.d + (toy.to.d - toy.from.d) * k;
    toy.lift = 4 * 120 * k * (1 - k);
    if (k >= 1) land(s, toy);
  } else if (toy.phase === "roll" || toy.phase === "drift") {
    const e = toy.phase === "roll" ? 1 - (1 - k) * (1 - k) : k;
    toy.x = toy.from.x + (toy.to.x - toy.from.x) * e;
    toy.d = toy.from.d + (toy.to.d - toy.from.d) * e;
    if (k >= 1) toy.phase = "rest";
  } else if (toy.phase === "drain" && k >= 1) {
    // out of the culvert, wet, with a little hop
    toy.x = SPOTS.culvert.x + 40;
    toy.d = SPOTS.culvert.d + 0.04;
    toy.wet = true;
    toy.phase = "flight";
    toy.from = { x: toy.x, d: toy.d };
    toy.to = { x: toy.x + 90, d: toy.d + 0.04 };
    toy.t = 0;
    toy.dur = 0.45;
    cue(s, "pop");
  }
}

/** one step toward a goal; he goes around the channel and the hole, and stops dead at the bank of a deep ford */
function boxerStep(s: Adventure, gx: number, gd: number, speed: number, dt: number): "moved" | "arrived" | "blocked" {
  const b = s.boxer;
  if (Math.abs(gx - b.x) < 4 && Math.abs(gd - b.d) < 0.01) return "arrived";
  const nx = approach(b.x, gx, dt * speed);
  const nd = approach(b.d, gd, dt * 0.5);
  if (Math.abs(gx - b.x) > 2) b.face = gx > b.x ? 1 : -1;
  const ok = (x: number, d: number) => !inPit(x, d) && (!deepAt(s, x, d) || deepAt(s, b.x, b.d));
  if (ok(nx, nd)) {
    b.x = nx;
    b.d = nd;
    return "moved";
  }
  const body = waterAt(s, nx, nd).kind;
  if (body === "ford" && deepAt(s, nx, nd)) return "blocked";
  // around the channel or the hole: walk out to the front of it, then on
  const fd = approach(b.d, 0.5, dt * 0.5);
  if (ok(b.x, fd) && fd !== b.d) {
    b.d = fd;
    return "moved";
  }
  return "blocked";
}

function startCarry(s: Adventure) {
  const b = s.boxer;
  b.state = "carry";
  b.t = 0;
  // he trots 120–260 px on before he lies down; how far depends on where he caught it
  b.trot = clampX(b.x + b.face * (120 + ((Math.round(Math.abs(b.x)) * 7919) % 141)));
}

function refuse(s: Adventure) {
  const b = s.boxer;
  if (b.state === "refuse") return;
  b.state = "refuse";
  b.t = 0;
  insert(s, "boxer", "confused");
  cue(s, "huff");
}

/** whether he could walk from where he is to there without a paw in deep water */
function reachable(s: Adventure, x: number, d: number) {
  const b = s.boxer;
  if (deepAt(s, x, d)) return false;
  if (s.water.ford <= DEEP) return true;
  const sideOf = (px: number, pd: number) => (px < R ? -1 : px <= fordEdges(pd)[0] ? -1 : px >= fordEdges(pd)[1] ? 1 : 0);
  return sideOf(b.x, b.d) === sideOf(x, d);
}

function moveBoxer(s: Adventure, dt: number) {
  const b = s.boxer, p = s.player, toy = s.toy;
  b.t += dt;
  const was = { x: b.x, d: b.d };
  const herSpot = () => {
    const gx = clampX(p.x - 150 * p.face);
    return { x: gx, d: inPit(gx, p.d) ? 0.32 : p.d };
  };
  switch (b.state) {
    case "nap":
      break;
    case "chase": {
      if (!toy) {
        // she picked it up first: he tags along (and will take it off her)
        b.state = "follow";
        b.goal = "her";
        break;
      }
      // down the drain: he waits at the grate, baffled, until it turns up somewhere else; out in deep water: he
      // goes to the bank and will not go further
      const target = toy.phase === "drain" ? SPOTS.drain : toy.phase === "flight" ? toy.to : toy;
      const deep = deepAt(s, target.x, target.d);
      const goal = deep ? bank(s, target.x, target.d) : target;
      if (!reachable(s, goal.x, goal.d)) {
        if (boxerStep(s, goal.x, goal.d, 330, dt) === "blocked") refuse(s);
        break;
      }
      if (deep && dist(b, goal) < 30) {
        refuse(s);
        break;
      }
      boxerStep(s, goal.x, goal.d, 330, dt);
      if (toy.phase !== "flight" && toy.phase !== "drain" && toy.phase !== "drift" && dist(b, toy) < 40) {
        b.item = toy.kind;
        s.toy = null;
        startCarry(s);
        insert(s, "boxer", "delighted");
      }
      break;
    }
    case "carry": {
      const st = boxerStep(s, b.trot, b.d, 240, dt);
      if (st !== "moved") {
        b.state = "settle";
        b.t = 0;
        cue(s, "sigh");
      }
      break;
    }
    case "settle":
      // lies down where he is, chews it, drops it; then naps right there (the place, not a fixed bed)
      if (b.t > 2.2 && b.item) {
        let dx = clampX(b.x + b.face * 60);
        if (inPit(dx, b.d) || deepAt(s, dx, b.d)) dx = b.x;
        s.toy = restingBall(dx, b.d);
        b.item = null;
      }
      if (b.t > 3.4) {
        b.t = 0;
        b.state = b.yields ? "follow" : "nap";
        b.goal = "her";
      }
      break;
    case "follow": {
      const goal = herSpot();
      if (!reachable(s, goal.x, goal.d)) {
        if (boxerStep(s, goal.x, goal.d, 220, dt) === "blocked") refuse(s);
        break;
      }
      const far = dist(b, goal) > 420;
      if (dist(b, goal) > 30) boxerStep(s, goal.x, goal.d, far ? 300 : 220, dt);
      break;
    }
    case "refuse": {
      // at the bank, paws dry, baffled: back to it once the water drops or the thing comes to his side
      const target = b.goal === "ball" && toy ? (toy.phase === "flight" ? toy.to : toy.phase === "drain" ? null : toy) : herSpot();
      if (b.goal === "ball" && !toy) {
        b.state = "follow";
        b.goal = "her";
        b.t = 0;
        break;
      }
      if (target) {
        b.face = target.x > b.x ? 1 : -1;
        if (reachable(s, target.x, target.d) && b.t > 0.8) {
          b.state = b.goal === "ball" ? "chase" : "follow";
          b.t = 0;
        }
      } else if (b.goal === "ball") b.state = "chase";
      break;
    }
  }
  b.moving = dist(was, b) > 0.3;
}

function moveCalf(s: Adventure, dt: number) {
  const c = s.calf, p = s.player, b = s.boxer;
  const was = { x: c.x, d: c.d };
  if (c.ledge && c.step === null) {
    // it faces whichever dog is nearer
    const nearer = dist(p, c) < dist(b, c) ? p : b;
    c.face = nearer.x > c.x ? 1 : -1;
    const dT = dist(p, c);
    const near = dT < 220;
    // arriving at a run frightens it back along the ledge
    if (near && !c.near && p.speed > 200) {
      c.trust = Math.max(0, c.trust - 1);
      c.back = 40 * (c.x >= p.x ? 1 : -1);
      c.still = 0;
      insert(s, "calf", "scared");
      cue(s, "bleat");
    }
    c.near = near;
    // stillness earns it; the ball, held still, delights it once
    const still = dT < 160 && !p.moving && p.jump === 0;
    c.still = still ? c.still + dt : 0;
    if (still && p.item === "ball" && !c.ballSeen && c.still > 0.5) {
      c.ballSeen = true;
      c.trust = Math.min(3, c.trust + 1);
      insert(s, "calf", "delighted");
      cue(s, "chime");
    }
    if (c.still >= 2.5) {
      c.still = 0;
      insert(s, "calf", "curious");
      if (c.trust < 3) {
        c.trust += 1;
        cue(s, "chime");
      }
    }
    // the boxer at the landing: it chose him, as before
    const boxerNear = dist(b, SPOTS.landing) < 260;
    if (boxerNear && !c.sawBoxer) {
      c.face = b.x > c.x ? 1 : -1;
      insert(s, "calf", "delighted");
      cue(s, "moo");
    }
    c.sawBoxer = boxerNear;
    c.back = approach(c.back, 0, dt * 8);
    c.x = Math.max(LEDGE_RANGE[0], Math.min(LEDGE_RANGE[1], approach(c.x, SPOTS.ledge.x + c.back, dt * 90)));
    // down it comes, when the trough is level and someone it trusts is waiting at the landing
    const trusted = c.trust >= 3 && dist(p, SPOTS.landing) < 200;
    if (s.water.hw >= STEPPABLE && (boxerNear || trusted)) {
      c.step = 0;
      c.stepFrom = c.x;
      cue(s, "moo");
    }
  } else if (c.step !== null) {
    // ledge → trough (0.8 s) → rim → landing
    c.step += dt;
    const legs: [{ x: number; d: number; lift: number }, { x: number; d: number; lift: number }, number][] = [
      [{ x: c.stepFrom, d: SPOTS.ledge.d, lift: -LEDGE_DROP }, { x: SPOTS.trough.x, d: SPOTS.trough.d, lift: troughDeck(s.water.hw) }, 0.8],
      [{ x: SPOTS.trough.x, d: SPOTS.trough.d, lift: troughDeck(s.water.hw) }, { x: SPOTS.rim.x, d: SPOTS.rim.d, lift: 0 }, 0.8],
      [{ x: SPOTS.rim.x, d: SPOTS.rim.d, lift: 0 }, { x: SPOTS.landing.x, d: SPOTS.landing.d, lift: 0 }, 0.8],
    ];
    let t = c.step;
    let leg = 0;
    while (leg < legs.length - 1 && t > legs[leg][2]) t -= legs[leg++][2];
    const [a, z, dur] = legs[leg];
    const k = Math.min(1, t / dur);
    c.face = 1;
    c.x = a.x + (z.x - a.x) * k;
    c.d = a.d + (z.d - a.d) * k;
    c.lift = a.lift + (z.lift - a.lift) * k + Math.sin(k * Math.PI) * 26;
    if (c.step >= 2.4) {
      c.step = null;
      c.ledge = false;
      c.lift = 0;
      c.x = SPOTS.landing.x;
      c.d = SPOTS.landing.d;
      s.flags.rescued = true;
      c.trust = 3;
      insert(s, "calf", "trusting");
      cue(s, "chord");
      // the friendship: he wakes, and from now on he lets her keep the ball
      b.yields = true;
      if (b.state === "nap" || b.state === "refuse") {
        b.state = "follow";
        b.goal = "her";
        b.t = 0;
      }
    }
  } else {
    // rescued: it follows her now, not him
    const gx = Math.min(WIDTH - 70, p.x + 70), gd = clamp01(p.d - 0.03);
    const far = dist(c, { x: gx, d: gd }) > 300;
    let nx = approach(c.x, gx, dt * (far ? 260 : 150));
    let nd = approach(c.d, gd, dt * 0.4);
    if (inPit(nx, nd)) {
      nd = Math.max(nd, 0.31);
      if (inPit(nx, nd)) nx = c.x;
    }
    c.x = nx;
    c.d = nd;
    if (Math.abs(gx - c.x) > 3) c.face = gx > c.x ? 1 : -1;
    if (c.x < SEAM && !s.flags.followed) {
      s.flags.followed = true;
      card(s, "Beverly Hills · something followed you back");
    }
  }
  c.moving = dist(was, c) > 0.3;
}

function moveCan(s: Adventure, dt: number) {
  const k = s.can, p = s.player;
  k.cool = Math.max(0, k.cool - dt);
  if (k.roll > 0) {
    const step = Math.min(k.roll, dt * 75);
    k.x += step * k.dir;
    k.roll -= step;
  } else if (k.cool === 0 && p.moving && p.jump === 0 && dist(p, k) < 40) {
    // she knocks the milk can: one thunk, and it rolls 30 px
    k.dir = p.x < k.x ? 1 : -1;
    k.roll = 30;
    k.cool = 1;
    cue(s, "thunk");
  }
}

/** the seam between 2026 and the 1890s: a rustle every time, a card the first time, and the way home after */
function seam(s: Adventure, input: Input) {
  const now = side(s.player.x);
  const before = s.beat.side;
  s.beat.side = now;
  if (before !== now) {
    cue(s, "rustle");
    if (!s.flags.crossed) {
      s.flags.crossed = true;
      card(s, "Two times, one courtyard");
    }
    // after the rescue, walking through is the way home; it waits for the two to catch up
    s.beat.homeward = s.flags.rescued && input.dx !== 0;
  }
  // the three walk through together: into the overlap
  if (s.beat.homeward && dist(s.calf, s.player) < 320 && dist(s.boxer, s.player) < 360) goHome(s);
}

function goHome(s: Adventure) {
  s.tear = { from: s.chapter, t: 0 };
  s.chapter = "home";
  s.beat.homeward = false;
  s.player.x = 200;
  s.card = null;
  placeHome(s);
}

function tickHome(s: Adventure, dt: number, input: Input) {
  const p = s.player, c = s.calf, b = s.boxer;
  if (s.home.ride > 0) s.home.ride = Math.max(0, s.home.ride - dt);
  if (s.home.lying !== null) {
    s.home.lying += dt;
    layDown(s, Math.min(1, dt * 1.6));
    p.moving = c.moving = b.moving = false;
    if (s.home.lying >= 2.5) {
      layDown(s, 1);
      s.flags.ended = true;
    }
    return;
  }
  if (p.lap > 0) {
    p.lap = Math.max(0, p.lap - dt);
    p.moving = false;
  } else {
    const speed = 200;
    if (input.dx) p.face = input.dx > 0 ? 1 : -1;
    const nx = Math.max(70, Math.min(HOME_WIDTH - 70, p.x + input.dx * dt * speed));
    const nd = clamp01(p.d + input.dy * dt * 0.55);
    p.moving = Math.abs(nx - p.x) > 0.01 || nd !== p.d;
    p.x = nx;
    p.d = nd;
  }
  p.jump = Math.max(0, p.jump + p.vy * dt);
  p.vy -= dt * 1150;
  if (p.jump === 0) p.vy = Math.max(0, p.vy);
  // they follow her: the calf just behind, the boxer a little way off
  const cw = { x: c.x, d: c.d }, bw = { x: b.x, d: b.d };
  const cx = Math.max(70, Math.min(HOME_WIDTH - 70, p.x + 70)), bx = Math.max(70, p.x - 110);
  c.x = approach(c.x, cx, dt * 160);
  c.d = approach(c.d, clamp01(p.d + 0.02), dt * 0.4);
  b.x = approach(b.x, bx, dt * 190);
  b.d = approach(b.d, clamp01(p.d - 0.04), dt * 0.4);
  if (Math.abs(cx - c.x) > 3) c.face = cx > c.x ? 1 : -1;
  if (Math.abs(bx - b.x) > 3) b.face = bx > b.x ? 1 : -1;
  c.moving = dist(cw, c) > 0.3;
  b.moving = dist(bw, b) > 0.3;
}
