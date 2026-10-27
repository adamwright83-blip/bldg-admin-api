/**
 * The Other Rodeo, the simulation. Pure, deterministic, no DOM: the renderer reads it, the tests walk it.
 *
 * One playable animal, the terrier. The boxer is not yours to steer; it has four habits you learn by watching and
 * then use against it: it takes whatever the terrier is carrying, it chases whatever the terrier runs from, it lies
 * down across whichever doorway the terrier wants until something more interesting happens elsewhere, and it will not
 * put a paw in water. Every puzzle is one of those habits turned to your advantage. Nobody speaks; feelings are shown
 * as reaction portraits (`inserts`) the renderer draws from the approved sheets.
 *
 * The stage has depth: every actor stands on a ground band at a depth d in [0, 1] (0 at the back of the painting,
 * 1 at its front edge). Depth sets the draw order and the scale, which is what puts the animals in the painting
 * instead of on it.
 */
import type { Mood } from "./cells";

export type Chapter = "courtyard" | "pasture" | "distortion" | "home";
export type Item = "ball" | "stick" | "rope";
export type Actor = { x: number; d: number; face: 1 | -1; jump: number; vy: number; moving: boolean };
export type BoxerState = "sleep" | "follow" | "chase" | "carry" | "settle" | "refuse" | "charge" | "anchor" | "rest";
export type Insert = { who: "terrier" | "boxer" | "calf"; mood: Mood; t: number; id: number };

export type Adventure = {
  version: 2;
  chapter: Chapter;
  time: number;
  player: Actor & { item: Item | null; wet: number };
  boxer: Actor & { state: BoxerState; item: Item | null; t: number; goalX: number; goalD: number; restX: number; restD: number };
  calf: Actor & { met: boolean; ledge: boolean };
  coyote: { x: number; d: number; state: "hidden" | "stalk" | "flee" | "gone"; face: 1 | -1 };
  /** thrown: in the air or just landed from her throw (only a thrown toy wakes a sleeping boxer) */
  toy: { kind: Item; x: number; d: number; thrown?: boolean } | null;
  flags: { stairs: boolean; gate: boolean; water: boolean; tether: boolean; rescued: boolean; dragged: number };
  inserts: Insert[];
  nextInsert: number;
  /** the paper tear between scenes: which scene is being torn away, and how far along (0..1) */
  tear: { from: Chapter; t: number } | null;
  /** seconds until the chapter advances by itself (the ending) */
  epilogue: number;
};

export const WIDTH = 1900;
export const VIEW = 1280;
/** the ground band on screen (canvas y), per chapter: the painted ground the animals stand on */
export const GROUND: Record<Chapter, [number, number]> = {
  courtyard: [608, 776],
  pasture: [556, 772],
  distortion: [556, 772],
  home: [700, 760],
};
export const CHAPTERS: Record<Chapter, { place: string }> = {
  courtyard: { place: "Beverly Hills · the courtyard" },
  pasture: { place: "Rancho Rodeo de las Aguas · 1890s" },
  distortion: { place: "Two times, one field" },
  home: { place: "Beverly Hills · then, and now" },
};

// where things are, per chapter (world x; depth d)
export const SPOTS = {
  courtyard: { ball: { x: 470, d: 0.62 }, fountain: { x: 850, d: 0.3 }, stairs: { x: 1660, d: 0.42 }, boxerSleep: { x: 1600, d: 0.58 }, hedge: { x: 120, d: 0.15 }, pots: { x: 1180, d: 0.2 } },
  pasture: { calf: { x: 1040, d: 0.48 }, gate: { x: 1470, d: 0.5 }, rope: { x: 1330, d: 0.66 }, waterX0: 1540, waterX1: 1730, sluice: { x: 1790, d: 0.42 }, rift: { x: 1850, d: 0.6 }, tunnel: { x: 130, d: 0.2 } },
  distortion: { rope: { x: 380, d: 0.6 }, sluice: { x: 1030, d: 0.38 }, hole: { x: 1480, d: 0.5 }, ledge: { x: 1500, d: 0.5 }, coyoteEnter: 1880 },
} as const;

const actor = (x: number, d: number, face: 1 | -1 = 1): Actor => ({ x, d, face, jump: 0, vy: 0, moving: false });

export function freshAdventure(): Adventure {
  const s: Adventure = {
    version: 2,
    chapter: "courtyard",
    time: 0,
    player: { ...actor(220, 0.6), item: null, wet: 0 },
    boxer: { ...actor(SPOTS.courtyard.boxerSleep.x, SPOTS.courtyard.boxerSleep.d, -1), state: "sleep", item: null, t: 0, goalX: SPOTS.courtyard.boxerSleep.x, goalD: SPOTS.courtyard.boxerSleep.d, restX: SPOTS.courtyard.boxerSleep.x, restD: SPOTS.courtyard.boxerSleep.d },
    calf: { ...actor(SPOTS.pasture.calf.x, SPOTS.pasture.calf.d, -1), met: false, ledge: false },
    coyote: { x: SPOTS.distortion.coyoteEnter, d: 0.55, state: "hidden", face: -1 },
    toy: null,
    flags: { stairs: false, gate: false, water: false, tether: false, rescued: false, dragged: 0 },
    inserts: [],
    nextInsert: 1,
    tear: null,
    epilogue: 0,
  };
  placeForChapter(s);
  return s;
}

/** a saved adventure comes back whole; anything odd starts a fresh afternoon */
export function restoreAdventure(raw: string | null): Adventure {
  try {
    const r = JSON.parse(raw ?? "null");
    if (!r || r.version !== 2 || !(r.chapter in CHAPTERS)) return freshAdventure();
    const s = freshAdventure();
    s.chapter = r.chapter;
    const f = r.flags ?? {};
    for (const k of ["stairs", "gate", "water", "tether", "rescued"] as const) s.flags[k] = f[k] === true;
    s.calf.met = r.calf?.met === true;
    if (Number.isFinite(r.player?.x)) s.player.x = clampX(r.player.x);
    if (Number.isFinite(r.player?.d)) s.player.d = clamp01(r.player.d);
    placeForChapter(s);
    return s;
  } catch {
    return freshAdventure();
  }
}

const clampX = (x: number) => Math.max(70, Math.min(WIDTH - 70, x));
const clamp01 = (d: number) => Math.max(0, Math.min(1, d));
const approach = (n: number, target: number, step: number) => n + Math.sign(target - n) * Math.min(Math.abs(target - n), step);
const dist = (a: { x: number; d: number }, b: { x: number; d: number }) => Math.hypot(a.x - b.x, (a.d - b.d) * 240);

/** stands everyone where the chapter opens (also used after a restore) */
function placeForChapter(s: Adventure) {
  const b = s.boxer, c = s.calf;
  s.toy = null;
  s.player.item = null;
  s.player.jump = 0;
  if (s.chapter === "courtyard") {
    s.player.x = Math.min(s.player.x, s.flags.stairs ? WIDTH - 70 : 1450);
    if (!s.flags.stairs) {
      b.state = "sleep";
      b.x = SPOTS.courtyard.boxerSleep.x;
      b.d = SPOTS.courtyard.boxerSleep.d;
      s.toy = { kind: "ball", ...SPOTS.courtyard.ball };
    } else {
      b.state = "follow";
      b.x = s.player.x - 160;
      b.d = 0.55;
    }
  } else if (s.chapter === "pasture") {
    b.state = "follow";
    b.x = Math.max(120, s.player.x - 170);
    b.d = 0.55;
    c.ledge = false;
    if (!c.met) {
      c.x = SPOTS.pasture.calf.x;
      c.d = SPOTS.pasture.calf.d;
    } else {
      c.x = b.x - 130;
      c.d = 0.5;
    }
    if (!s.flags.gate) {
      s.player.x = Math.min(s.player.x, 1380);
      b.x = Math.min(b.x, 1300);
      c.x = Math.min(c.x, 1250);
      s.toy = { kind: "rope", ...SPOTS.pasture.rope };
    }
  } else if (s.chapter === "distortion") {
    s.player.x = Math.min(s.player.x, 900);
    s.player.d = 0.6;
    b.state = s.flags.tether ? "anchor" : "follow";
    b.x = s.flags.tether ? 760 : Math.max(120, s.player.x - 170);
    b.d = 0.55;
    c.met = true;
    c.ledge = true;
    c.x = SPOTS.distortion.ledge.x;
    c.d = SPOTS.distortion.ledge.d;
    s.coyote.state = s.flags.tether ? "gone" : "hidden";
    s.coyote.x = SPOTS.distortion.coyoteEnter;
    if (!s.flags.tether && !s.boxer.item) s.toy = { kind: "rope", ...SPOTS.distortion.rope };
    s.flags.water = false;
  } else {
    s.player.x = 640;
  }
}

function insert(s: Adventure, who: Insert["who"], mood: Mood) {
  if (s.inserts.some(i => i.who === who && i.mood === mood && i.t < 0.6)) return;
  s.inserts.push({ who, mood, t: 0, id: s.nextInsert++ });
  if (s.inserts.length > 3) s.inserts.shift();
}

function goTo(s: Adventure, next: Chapter) {
  s.tear = { from: s.chapter, t: 0 };
  s.chapter = next;
  s.player.x = 200;
  s.player.d = 0.6;
  placeForChapter(s);
}

// ------------------------------------------------------------------ what she can do here
export type Prompt = { label: string; action: string } | null;
export function prompt(s: Adventure): Prompt {
  if (s.tear || s.chapter === "home") return null;
  const p = s.player;
  const near = (x: number, d: number, r = 120) => dist(p, { x, d }) < r;
  if (s.toy && !p.item && near(s.toy.x, s.toy.d, 90)) return { label: `Pick up the ${s.toy.kind === "rope" ? "rope" : s.toy.kind}`, action: "pickup" };
  if (s.chapter === "courtyard") {
    if (near(SPOTS.courtyard.stairs.x, SPOTS.courtyard.stairs.d, 140)) return s.flags.stairs ? { label: "Follow the cool air down", action: "passage" } : { label: "Sniff the stairs", action: "sniff" };
    if (near(SPOTS.courtyard.fountain.x, SPOTS.courtyard.fountain.d, 130)) return { label: "Sniff the fountain", action: "sniff" };
  }
  if (s.chapter === "pasture") {
    if (!s.calf.met && near(SPOTS.pasture.calf.x, SPOTS.pasture.calf.d, 170)) return { label: "Say hello, quietly", action: "meet" };
    if (s.flags.gate && !s.flags.water && near(SPOTS.pasture.sluice.x, SPOTS.pasture.sluice.d, 130)) return { label: "Pull the sluice", action: "sluice" };
    if (s.flags.water && near(SPOTS.pasture.rift.x, SPOTS.pasture.rift.d, 150)) return { label: "Follow the calf", action: "rift" };
  }
  if (s.chapter === "distortion") {
    if (p.item === "rope" && s.boxer.state !== "anchor" && dist(p, s.boxer) < 150) return { label: "Let him have the rope", action: "tether" };
    if (s.flags.tether && !s.flags.water && near(SPOTS.distortion.sluice.x, SPOTS.distortion.sluice.d, 130)) return { label: "Release the old waterway", action: "lift" };
    if (s.flags.water && !s.flags.rescued && near(SPOTS.distortion.ledge.x, SPOTS.distortion.ledge.d, 160)) return { label: "Stay beside the calf", action: "rescue" };
  }
  return null;
}

export function interact(s: Adventure): boolean {
  const p = prompt(s);
  if (!p) return false;
  switch (p.action) {
    case "pickup":
      if (s.toy) {
        s.player.item = s.toy.kind;
        s.toy = null;
      }
      break;
    case "sniff":
      insert(s, "terrier", "suspicious");
      break;
    case "passage":
      goTo(s, "pasture");
      break;
    case "meet":
      s.calf.met = true;
      // the calf goes straight past the terrier to the boxer; that is the whole story
      insert(s, "calf", "delighted");
      insert(s, "boxer", "delighted");
      insert(s, "terrier", "jealous");
      break;
    case "sluice":
      s.flags.water = true;
      insert(s, "boxer", "confused");
      break;
    case "rift":
      goTo(s, "distortion");
      break;
    case "tether":
      s.player.item = null;
      s.boxer.item = "rope";
      s.boxer.state = "anchor";
      s.boxer.goalX = 760;
      s.flags.tether = true;
      insert(s, "boxer", "guilty");
      insert(s, "terrier", "tender");
      break;
    case "lift":
      s.flags.water = true;
      break;
    case "rescue":
      s.flags.rescued = true;
      s.calf.ledge = false;
      insert(s, "calf", "trusting");
      insert(s, "boxer", "tender");
      insert(s, "terrier", "tender");
      s.epilogue = 6;
      break;
  }
  return true;
}

/** the terrier throws what it carries, in the direction it faces */
export function throwToy(s: Adventure): boolean {
  const p = s.player;
  if (!p.item || p.item === "rope") return false;
  const x = clampX(p.x + p.face * 420);
  s.toy = { kind: p.item, x, d: Math.max(0.2, Math.min(0.9, p.d)), thrown: true };
  p.item = null;
  if (s.boxer.state !== "anchor") {
    s.boxer.state = "chase";
    s.boxer.t = 0;
  }
  return true;
}

export function hop(s: Adventure) {
  if (s.player.jump === 0 && !s.tear) s.player.vy = 430;
}

export const inWater = (s: Adventure, x: number) => s.chapter === "pasture" && !s.flags.water && x > SPOTS.pasture.waterX0 && x < SPOTS.pasture.waterX1;

// ------------------------------------------------------------------ time passes
export function tick(s: Adventure, delta: number, input: { dx: number; dy: number }) {
  const dt = Math.min(delta, 0.05);
  s.time += dt;
  for (const i of s.inserts) i.t += dt;
  s.inserts = s.inserts.filter(i => i.t < 1.6);
  if (s.tear) {
    s.tear.t += dt / 1.25;
    if (s.tear.t >= 1) s.tear = null;
    return;
  }
  if (s.chapter === "home") return;
  if (s.epilogue > 0) {
    s.epilogue -= dt;
    // the three walk off together
    s.calf.x = approach(s.calf.x, s.player.x + 70, dt * 80);
    s.boxer.x = approach(s.boxer.x, s.player.x - 110, dt * 120);
    s.boxer.moving = Math.abs(s.boxer.x - (s.player.x - 110)) > 4;
    s.calf.moving = Math.abs(s.calf.x - (s.player.x + 70)) > 4;
    if (s.epilogue <= 0) goTo(s, "home");
    return;
  }
  movePlayer(s, dt, input);
  moveBoxer(s, dt);
  moveCalf(s, dt);
  moveCoyote(s, dt);
}

function movePlayer(s: Adventure, dt: number, input: { dx: number; dy: number }) {
  const p = s.player;
  const speed = inWater(s, p.x) ? 130 : 250;
  if (input.dx) p.face = input.dx > 0 ? 1 : -1;
  let nx = p.x + input.dx * dt * speed;
  p.d = clamp01(p.d + input.dy * dt * 0.55);
  p.jump = Math.max(0, p.jump + p.vy * dt);
  p.vy -= dt * 1150;
  if (p.jump === 0) p.vy = Math.max(0, p.vy);
  // what blocks her
  if (s.chapter === "courtyard" && !s.flags.stairs && nx > 1470) nx = 1470;
  if (s.chapter === "pasture" && !s.flags.gate && nx > 1395) nx = 1395;
  if (s.chapter === "distortion" && !s.flags.tether && nx > 900) nx = 900;
  if (s.chapter === "distortion" && !s.flags.water && nx > 1250) nx = 1250;
  p.moving = Math.abs(nx - p.x) > 0.01 || input.dy !== 0;
  p.x = clampX(nx);
  p.wet = inWater(s, p.x) ? Math.min(1, p.wet + dt * 3) : Math.max(0, p.wet - dt * 0.6);
  // the boxer takes what she carries when it can reach her (its first habit)
  const b = s.boxer;
  if (p.item && p.item !== "rope" && b.state !== "sleep" && b.state !== "anchor" && dist(p, b) < 95 && b.t > 1.2) {
    b.item = p.item;
    p.item = null;
    b.state = "carry";
    b.t = 0;
    insert(s, "boxer", "delighted");
    insert(s, "terrier", "irritated");
  }
  // the rope at the gate: she picks it up, he takes it, he drags the gate open (the first habit again)
  if (s.chapter === "pasture" && p.item === "rope" && b.state !== "sleep" && dist(p, b) < 95 && b.t > 1.2) {
    b.item = "rope";
    p.item = null;
    b.state = "carry";
    b.t = 0;
    insert(s, "boxer", "delighted");
    insert(s, "terrier", "suspicious");
  }
  // the coyote: the terrier runs from it (its second habit: the boxer chases whatever she runs from)
  if (s.chapter === "distortion" && s.coyote.state === "stalk" && input.dx < 0 && p.x < s.coyote.x && b.state !== "anchor" && b.state !== "charge") {
    if (dist(p, s.coyote) < 1100) {
      b.state = "charge";
      b.t = 0;
      insert(s, "boxer", "startled");
    }
  }
}

function moveBoxer(s: Adventure, dt: number) {
  const b = s.boxer, p = s.player;
  b.t += dt;
  const was = b.x;
  const walk = (gx: number, gd: number, speed: number) => {
    const nx = approach(b.x, gx, dt * speed);
    // he will not step into water (he will step out of it)
    b.x = inWater(s, nx) && !inWater(s, b.x) ? b.x : nx;
    b.d = approach(b.d, gd, dt * 0.5);
    if (Math.abs(gx - b.x) > 2) b.face = gx > b.x ? 1 : -1;
  };
  switch (b.state) {
    case "sleep":
      // across the stairs; only a thrown toy is more interesting than a nap
      if (s.toy?.thrown && s.toy.kind !== "rope" && s.chapter === "courtyard" && b.t > 0.4) {
        b.state = "chase";
        b.t = 0;
      }
      break;
    case "chase":
      if (!s.toy) {
        b.state = "follow";
        break;
      }
      walk(s.toy.x, s.toy.d, 330);
      if (dist(b, s.toy) < 40) {
        b.item = s.toy.kind;
        s.toy = null;
        b.state = "carry";
        b.t = 0;
        insert(s, "boxer", "delighted");
      }
      break;
    case "carry": {
      // off to lie down with it; the gate's latch rope comes with him, which is how the gate opens
      const restX = s.chapter === "courtyard" ? (b.x > 1250 ? SPOTS.courtyard.boxerSleep.x : Math.max(300, b.x - 260)) : s.chapter === "pasture" ? (s.flags.gate ? 1240 : 1000) : 760;
      walk(restX, 0.58, 240);
      if (s.chapter === "pasture" && b.item === "rope" && !s.flags.gate) {
        s.flags.dragged += Math.abs(b.x - was);
        if (s.flags.dragged > 140) {
          s.flags.gate = true;
          insert(s, "terrier", "delighted");
        }
      }
      if (Math.abs(b.x - restX) < 6) {
        b.state = "settle";
        b.t = 0;
      }
      break;
    }
    case "settle":
      // chews it, then drops it, then naps: the toy is back on the ground for her to try again
      if (b.t > 2.2 && b.item) {
        if (b.item !== "rope") s.toy = { kind: b.item, x: b.x + b.face * 60, d: b.d };
        b.item = null;
      }
      if (b.t > 3.4) {
        if (s.chapter === "courtyard" && !s.flags.stairs && b.x > 1250) {
          b.state = "sleep";
          b.x = SPOTS.courtyard.boxerSleep.x;
        } else if (s.chapter === "courtyard" && !s.flags.stairs) {
          s.flags.stairs = true;
          b.state = "rest";
          b.t = 0;
          insert(s, "terrier", "delighted");
        } else {
          b.state = "follow";
          b.t = 0;
        }
      }
      break;
    case "rest":
      if (b.t > 2.5) b.state = "follow";
      break;
    case "follow": {
      const gx = p.x - 150 * p.face;
      if (inWater(s, gx) || (s.chapter === "pasture" && !s.flags.water && gx > SPOTS.pasture.waterX0 - 40)) {
        walk(Math.min(gx, SPOTS.pasture.waterX0 - 60), 0.55, 220);
        if (p.x > SPOTS.pasture.waterX0 && b.state === "follow" && b.t > 1) {
          b.state = "refuse";
          b.t = 0;
          insert(s, "boxer", "confused");
        }
      } else if (dist(b, { x: gx, d: 0.55 }) > 30) walk(gx, 0.55, 220);
      break;
    }
    case "refuse":
      // at the bank, paws dry, baffled; back to following once the water drops or she comes back
      b.face = p.x > b.x ? 1 : -1;
      if (s.flags.water || p.x < SPOTS.pasture.waterX0 - 100) {
        b.state = "follow";
        b.t = 0;
      }
      break;
    case "charge": {
      const c = s.coyote;
      walk(c.x - 40, c.d, 420);
      if (c.state === "stalk" && dist(b, c) < 170) {
        c.state = "flee";
        insert(s, "terrier", "delighted");
      }
      if (c.state !== "stalk" && b.t > 2.6) {
        b.state = "follow";
        b.t = 0;
      }
      break;
    }
    case "anchor":
      b.face = 1;
      walk(b.goalX, 0.55, 160);
      break;
  }
  b.moving = Math.abs(b.x - was) > 0.3;
}

function moveCalf(s: Adventure, dt: number) {
  const c = s.calf, b = s.boxer, p = s.player;
  const was = c.x;
  if (s.chapter === "pasture") {
    if (!c.met) {
      c.moving = false;
      return;
    }
    // it follows the boxer, not the terrier, until the water: then it waits with him
    let gx = b.x - 120 * b.face;
    if (!s.flags.gate) gx = Math.min(gx, 1300);
    if (inWater(s, gx) || (!s.flags.water && gx > SPOTS.pasture.waterX0 - 100)) gx = Math.min(gx, SPOTS.pasture.waterX0 - 150);
    c.x = approach(c.x, gx, dt * 150);
    c.d = approach(c.d, 0.5, dt * 0.4);
    if (Math.abs(gx - c.x) > 3) c.face = gx > c.x ? 1 : -1;
  } else if (s.chapter === "distortion") {
    if (!s.flags.rescued) {
      c.moving = false;
      return;
    }
    c.x = approach(c.x, p.x + 70, dt * 90);
    c.face = p.face;
  }
  c.moving = Math.abs(c.x - was) > 0.3;
}

function moveCoyote(s: Adventure, dt: number) {
  const c = s.coyote;
  if (s.chapter !== "distortion") return;
  if (c.state === "hidden" && s.player.x > 560 && !s.flags.tether) c.state = "stalk";
  if (c.state === "stalk") {
    c.x = approach(c.x, SPOTS.distortion.ledge.x + 180, dt * 55);
    c.face = -1;
  }
  if (c.state === "flee") {
    c.x += dt * 520;
    c.face = 1;
    if (c.x > WIDTH + 200) c.state = "gone";
  }
}
