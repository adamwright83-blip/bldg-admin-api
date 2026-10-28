/**
 * The monitor desk, as rules. One night shift at Century Park East's camera wall: the clock, the motion alerts that
 * teach the wall, the window when the indicator is lit, the figure's few seconds out of the lift, what makes a still,
 * how the night ends. Pure: the scene reports what the main monitor sees, this decides what that is worth.
 *
 * Everything the night is about (the hours, the floors, the figure's tint) arrives in the chapter's config; this file holds
 * neutral defaults and the mechanics only.
 */
import { ELEV_X0, ELEV_X1, FLOORS, ROOF_POOL } from "@/pages/goldline/centuryParkEast3d/cpeLayout";

// ------------------------------------------------------------------ settings

export type DeskSettings = {
  /** the clock when the shift starts, seconds after midnight */
  start: number;
  /** when the indicator lights, seconds after midnight */
  window: number;
  /** how long it stays lit, real seconds */
  windowSeconds: number;
  /** the floors the panel knows, and the one the indicator shows */
  panelFloors: number;
  litFloor: number;
  /** the figure's tint, a CSS colour */
  tint: string;
};

const DEFAULTS: DeskSettings = { start: 3600, window: 3600 + 16 * 60, windowSeconds: 90, panelFloors: 9, litFloor: 10, tint: "#6d6a66" };

/** "1:58" or "01:58:30" → seconds after midnight */
export function parseClock(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [h, min, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 23 || min > 59 || s > 59) return null;
  return h * 3600 + min * 60 + s;
}

const intIn = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);

/** Reads `config.desk`; anything missing or malformed falls back to the neutral default. */
export function readDeskSettings(config: Record<string, unknown>): DeskSettings {
  const desk = (config.desk && typeof config.desk === "object" ? config.desk : {}) as Record<string, unknown>;
  const start = parseClock(desk.clockStart) ?? DEFAULTS.start;
  let window = parseClock(desk.window) ?? DEFAULTS.window;
  // the shift needs time before the window: at least the approach
  if (window - start < APPROACH_S + 60) window = start + DEFAULTS.window - DEFAULTS.start;
  const panelFloors = intIn(desk.panelFloors, 1, 199) ?? DEFAULTS.panelFloors;
  const litFloor = intIn(desk.litFloor, 1, 200) ?? panelFloors + 1;
  const tint = typeof desk.tint === "string" && /^#[0-9a-f]{6}$/i.test(desk.tint) ? desk.tint : DEFAULTS.tint;
  return { start, window, windowSeconds: intIn(desk.windowSeconds, 40, 300) ?? DEFAULTS.windowSeconds, panelFloors, litFloor, tint };
}

export function formatClock(seconds: number, withSeconds = true): string {
  const s = Math.max(0, Math.floor(seconds)) % 86400;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return withSeconds ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}`;
}

// ------------------------------------------------------------------ the wall

export type DeskCam = {
  label: string;
  floor: number;
  /** what it can pan across */
  x0: number;
  x1: number;
  /** where it points before anyone pans it */
  home: number;
  /** where it hangs, along the cut */
  mount: number;
};

function room(kind: string): { floor: number; x0: number; x1: number; name: string } {
  for (const [floor, fl] of FLOORS.entries()) {
    const r = fl.rooms.find(rm => rm.kind === kind);
    if (r) return { floor, x0: r.x0, x1: r.x1, name: r.name };
  }
  throw new Error(`no ${kind} room`);
}
const cam = (kind: string, o: { home?: number; x1?: number; mount?: number } = {}): DeskCam => {
  const r = room(kind);
  const x1 = o.x1 ?? r.x1;
  return { label: r.name.toUpperCase(), floor: r.floor, x0: r.x0, x1, home: o.home ?? (r.x0 + x1) / 2, mount: o.mount ?? (r.x0 + x1) / 2 + 1 };
};

/** Six cameras. The lobby's frame runs on into the lift alcove (the scene opens the wall between them). */
export const CAMS: readonly DeskCam[] = [
  cam("lobby", { home: 24.5, x1: ELEV_X1, mount: 25.5 }),
  cam("mail"),
  cam("package"),
  cam("leasing"),
  cam("laundry"),
  cam("pool", { home: 9 }),
];
export const LOBBY = 0;
/** the lift doors' centre on the ground floor, and the plane they sit in */
export const DOOR_X = (ELEV_X0 + ELEV_X1) / 2;
export const DOOR_Z = -4.62;

// ------------------------------------------------------------------ the night's timeline

export const BOOT_S = 3.5;
/** the shift before the last half minute, on a first play */
export const ROUNDS_S = 186;
/** the last half minute before the window runs at the real pace */
export const APPROACH_S = 30;
/** how long the recorder takes to print one still */
export const PRINT_S = 1.1;

export type SubjectKind = "parcels" | "cart" | "resident_mail" | "float" | "vacuum" | "resident_lift";
export type Alert = { id: number; cam: number; kind: SubjectKind; at: number; until: number; decoy: boolean };
export type Timeline = {
  settings: DeskSettings;
  rehearsed: boolean;
  roundsStart: number;
  approachStart: number;
  windowStart: number;
  windowEnd: number;
  alerts: Alert[];
  /** the figure, in real seconds: the doors start to open, the figure is out, back in, the doors are shut */
  figure: { doorsOpen: number; out: number; back: number; doorsShut: number; path: number };
  /** moments the lobby feed loses its signal during the window */
  drops: { at: number; until: number }[];
};

export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The teaching order: a big subject first, then one to pan after, then one to zoom on, then both, then the lobby. */
const ROUNDS: { kind: SubjectKind; cam: number; at: number; dur: number }[] = [
  { kind: "parcels", cam: 2, at: 6, dur: 17 },
  { kind: "cart", cam: 4, at: 36, dur: 17 },
  { kind: "resident_mail", cam: 1, at: 66, dur: 15 },
  { kind: "float", cam: 5, at: 96, dur: 15 },
  { kind: "vacuum", cam: 3, at: 125, dur: 15 },
  { kind: "resident_lift", cam: LOBBY, at: 154, dur: 17 },
];

export function timeline(settings: DeskSettings, opts: { rehearsed: boolean; seed: number }): Timeline {
  const r = rng(opts.seed);
  const jitter = (n: number) => (r() * 2 - 1) * n;
  const roundsStart = BOOT_S;
  const approachStart = opts.rehearsed ? BOOT_S : BOOT_S + ROUNDS_S;
  const windowStart = approachStart + APPROACH_S;
  const windowEnd = windowStart + settings.windowSeconds;
  const alerts: Alert[] = [];
  if (!opts.rehearsed)
    ROUNDS.forEach((round, i) => {
      const at = roundsStart + round.at + (i === 0 ? 0 : jitter(3));
      alerts.push({ id: i + 1, cam: round.cam, kind: round.kind, at, until: at + round.dur, decoy: false });
    });
  // out somewhere in the first part of the window, never at the same second twice
  const openLatest = Math.max(8, Math.min(38, settings.windowSeconds - 34));
  const doorsOpen = windowStart + 12 + r() * (openLatest - 12);
  const out = doorsOpen + 1.4;
  const back = out + 13 + r() * 3;
  const doorsShut = back + 1.8;
  // two decoys: one early, one just before the doors
  const decoyCams = [1, 2, 3, 4, 5].sort(() => r() - 0.5);
  const early = windowStart + 3 + r() * 5;
  alerts.push({ id: 101, cam: decoyCams[0], kind: kindFor(decoyCams[0]), at: early, until: early + 14, decoy: true });
  const late = Math.max(early + 6, doorsOpen - 3 - r() * 4);
  alerts.push({ id: 102, cam: decoyCams[1], kind: kindFor(decoyCams[1]), at: late, until: late + 14, decoy: true });
  // the lobby feed drops for a moment every five to nine seconds while the indicator is lit
  const drops: Timeline["drops"] = [];
  for (let at = windowStart + 2 + r() * 3; at < windowEnd; at += 5 + r() * 4) drops.push({ at, until: at + 0.55 + r() * 0.35 });
  return { settings, rehearsed: opts.rehearsed, roundsStart, approachStart, windowStart, windowEnd, alerts, figure: { doorsOpen, out, back, doorsShut, path: Math.floor(r() * PATHS.length) }, drops };
}

function kindFor(camIndex: number): SubjectKind {
  return (["resident_lift", "resident_mail", "parcels", "vacuum", "cart", "float"] as const)[camIndex];
}

export type Phase = "boot" | "rounds" | "approach" | "window" | "over";

export function phaseAt(tl: Timeline, t: number): Phase {
  if (t < tl.roundsStart) return "boot";
  if (t < tl.approachStart) return "rounds";
  if (t < tl.windowStart) return "approach";
  if (t < tl.windowEnd) return "window";
  return "over";
}

/** the clock on the wall, seconds after midnight */
export function clockAt(tl: Timeline, t: number): number {
  const s = tl.settings;
  const approachClock = s.window - APPROACH_S;
  if (tl.rehearsed || t >= tl.approachStart) return approachClock + Math.max(0, t - tl.approachStart);
  const rate = (approachClock - s.start) / ROUNDS_S;
  return s.start + Math.max(0, t - tl.roundsStart) * rate;
}

export function liveAlerts(tl: Timeline, t: number): Alert[] {
  return tl.alerts.filter(a => t >= a.at && t < a.until);
}

export function signalAt(tl: Timeline, camIndex: number, t: number): boolean {
  if (camIndex !== LOBBY) return true;
  return !tl.drops.some(d => t >= d.at && t < d.until);
}

// ------------------------------------------------------------------ who is where

export type Pose = { visible: boolean; x: number; z: number; heading: number; anim: "walk" | "look" | "idle" | "interact" };
type Pt = [number, number];

/** Where the figure walks once out: three ways to look across the lobby. */
const PATHS: Pt[][] = [
  [[DOOR_X, DOOR_Z + 0.1], [27.2, -2.9], [25.3, -2.15]],
  [[DOOR_X, DOOR_Z + 0.1], [27.4, -2.4], [24.0, -1.65]],
  [[DOOR_X, DOOR_Z + 0.1], [27.9, -3.2], [26.6, -1.6]],
];

function along(points: Pt[], f: number): { x: number; z: number; heading: number } {
  const lens = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  const total = lens.reduce((a, b) => a + b, 0);
  let d = Math.min(1, Math.max(0, f)) * total;
  for (let i = 0; i < lens.length; i++) {
    const [a, b] = [points[i], points[i + 1]];
    if (d <= lens[i] || i === lens.length - 1) {
      const k = lens[i] ? Math.min(1, d / lens[i]) : 1;
      return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, heading: Math.atan2(b[0] - a[0], b[1] - a[1]) };
    }
    d -= lens[i];
  }
  const last = points[points.length - 1];
  return { x: last[0], z: last[1], heading: 0 };
}

const OUT_WALK = 3.4;

/** The figure: out of the lift, across the lobby, a long look round, and back in. */
export function figureAt(tl: Timeline, t: number): Pose {
  const { out, back } = tl.figure;
  const path = PATHS[tl.figure.path];
  const stepIn = 1.1;
  if (t < out - stepIn || t > back + stepIn) return { visible: false, x: DOOR_X, z: DOOR_Z, heading: 0, anim: "idle" };
  // inside the cab the figure is behind the doorway and no camera sees it
  if (t < out) {
    const z = DOOR_Z - 0.7 + 0.8 * ((t - (out - stepIn)) / stepIn);
    return { visible: z > DOOR_Z, x: DOOR_X, z, heading: 0, anim: "walk" };
  }
  if (t > back) {
    const z = DOOR_Z + 0.1 - 0.8 * ((t - back) / stepIn);
    return { visible: z > DOOR_Z, x: DOOR_X, z, heading: Math.PI, anim: "walk" };
  }
  const u = t - out;
  const looking = back - out - OUT_WALK * 2;
  if (u < OUT_WALK) {
    const p = along(path, u / OUT_WALK);
    return { visible: true, ...p, anim: "walk" };
  }
  if (u < OUT_WALK + looking) {
    const end = path[path.length - 1];
    const v = u - OUT_WALK;
    // looking one way, then the other, then towards the desk
    const heading = v < 1.4 ? Math.PI * 0.42 : v < 3.6 ? -Math.PI * 0.45 : v < 5.4 ? Math.PI * 0.08 : Math.PI * 0.62;
    return { visible: true, x: end[0], z: end[1], heading, anim: v < 5.4 ? "look" : "idle" };
  }
  const p = along([...path].reverse(), (u - OUT_WALK - looking) / OUT_WALK);
  return { visible: true, ...p, anim: "walk" };
}

/** A resident's pose for the two alerts that have one. */
export function residentAt(alert: Alert, t: number): Pose {
  const u = t - alert.at;
  const hidden: Pose = { visible: false, x: 0, z: 0, heading: 0, anim: "idle" };
  if (u < 0 || t >= alert.until) return hidden;
  if (alert.kind === "resident_mail") {
    const r = room("mail");
    const stop = r.x0 + 3.6 + ((alert.id * 1.7) % 1.4);
    if (u < 4) return { visible: true, ...along([[r.x0 + 0.2, -2.2], [stop, -3.85]], u / 4), anim: "walk" };
    if (u < 10) return { visible: true, x: stop, z: -3.85, heading: Math.PI, anim: "interact" };
    const p = along([[stop, -3.85], [r.x1 - 0.3, -2.0]], (u - 10) / 4.5);
    return { visible: u < 14.4, ...p, anim: "walk" };
  }
  if (alert.kind === "resident_lift") {
    if (u < 7) return { visible: true, ...along([[15.4, -1.8], [24.5, -2.0], [DOOR_X, -3.3]], u / 7), anim: "walk" };
    if (u < 8.4) return { visible: true, x: DOOR_X, z: -3.3, heading: Math.PI, anim: "idle" };
    const z = -3.3 - 1.9 * Math.min(1, (u - 8.4) / 1.6);
    return { visible: z > DOOR_Z, x: DOOR_X, z, heading: Math.PI, anim: "walk" };
  }
  return hidden;
}

/** how far open the lobby lift doors are, 0..1 */
export function doorsAt(tl: Timeline, t: number): number {
  const ramp = (open: number, shut: number) => {
    if (t < open || t > shut) return 0;
    return Math.min(1, (t - open) / 1.2, (shut - t) / 1.2);
  };
  let v = ramp(tl.figure.doorsOpen, tl.figure.doorsShut);
  for (const a of tl.alerts) if (a.kind === "resident_lift" && !a.decoy) v = Math.max(v, ramp(a.at + 7.6, a.at + 11.4));
  return v;
}

/** what the indicator over the lobby doors reads */
export function indicatorAt(tl: Timeline, t: number): { text: string; lit: boolean } {
  if (t >= tl.windowStart && t < tl.windowEnd) return { text: String(tl.settings.litFloor), lit: true };
  const ride = tl.alerts.find(a => a.kind === "resident_lift" && !a.decoy && t >= a.at + 11.4);
  if (ride && t < tl.approachStart) {
    // the car climbs a floor every 0.9 s to somewhere on the panel, then is called back down
    const top = Math.max(2, Math.min(tl.settings.panelFloors, 7));
    const up = Math.floor((t - ride.at - 11.4) / 0.9) + 2;
    const down = Math.floor((t - ride.at - 30) / 0.9);
    const floor = down > 0 ? top - down : Math.min(top, up);
    if (floor > 1) return { text: String(floor), lit: false };
  }
  return { text: "L", lit: false };
}

/** where an inanimate subject sits; the scene draws it there, and this is the box a still must hold */
export function objectAt(alert: Alert, t: number): { x: number; y: number; z: number; spin: number; fallen: number } {
  const u = Math.max(0, t - alert.at);
  const dur = alert.until - alert.at;
  const seedX = ((alert.id * 7.3) % 10) / 10;
  switch (alert.kind) {
    case "parcels":
      return { x: 2.6 + seedX * 3, y: 0, z: -3.4, spin: 0, fallen: Math.min(1, Math.max(0, (u - 0.6) / 1.1)) };
    case "cart": {
      const r = room("laundry");
      return { x: r.x0 + 1.3 + (r.x1 - r.x0 - 2.6) * Math.min(1, u / dur), y: 0, z: -2.3, spin: u * 2.2, fallen: 0 };
    }
    case "float": {
      const x = ROOF_POOL.x0 + 1 + (ROOF_POOL.x1 - ROOF_POOL.x0 - 2) * (0.5 + 0.5 * Math.sin(u * 0.32 + seedX * 6));
      return { x, y: Math.sin(u * 2.1) * 0.03, z: (ROOF_POOL.z0 + ROOF_POOL.z1) / 2 + Math.sin(u * 0.5) * 0.5, spin: u * 0.4, fallen: 0 };
    }
    case "vacuum": {
      const r = room("leasing");
      const cx = (r.x0 + r.x1) / 2;
      return { x: cx + Math.sin(u * 0.55) * 2.6, y: 0, z: -2.6 + Math.sin(u * 1.1) * 0.9, spin: u * 0.55, fallen: 0 };
    }
    default:
      return { x: 0, y: 0, z: 0, spin: 0, fallen: 0 };
  }
}

// ------------------------------------------------------------------ a still

/** A box on the main monitor, as fractions of the frame from the top-left (it may run off the edges). */
export type FrameBox = { x0: number; y0: number; x1: number; y1: number };
export type Framing = {
  cam: number;
  /** what the main monitor holds: the figure, a resident or an object, keyed "figure" or by alert id */
  boxes: Partial<Record<string, FrameBox>>;
  indicator: FrameBox | null;
};
export type Verdict = "logged" | "figure" | "nothing" | "cropped" | "too_wide" | "no_indicator" | "no_signal" | "printing" | "closed";

const MIN_SIZE: Record<SubjectKind | "figure", number> = {
  figure: 0.24,
  resident_lift: 0.22,
  resident_mail: 0.3,
  parcels: 0.16,
  cart: 0.2,
  float: 0.12,
  vacuum: 0.09,
};

const inside = (b: FrameBox, m = 0.02) => b.x0 >= m && b.y0 >= m && b.x1 <= 1 - m && b.y1 <= 1 - m;
const seen = (b: FrameBox) => b.x1 > 0 && b.x0 < 1 && b.y1 > 0 && b.y0 < 1;
const size = (b: FrameBox) => Math.max(b.y1 - b.y0, (b.x1 - b.x0) * 0.75);

export type DeskStatus = {
  phase: Phase;
  clock: number;
  alerts: Alert[];
  logged: number[];
  roundTotal: number;
  indicator: { text: string; lit: boolean };
  /** real seconds left while the indicator is lit */
  windowLeft: number | null;
  outcome: "win" | "lose" | null;
};

export type Desk = {
  tl: Timeline;
  status(t: number): DeskStatus;
  /** the player takes a still of the main monitor */
  capture(t: number, framing: Framing): Verdict;
};

export function createDesk(settings: DeskSettings, opts: { rehearsed: boolean; seed: number }): Desk {
  const tl = timeline(settings, opts);
  const logged = new Set<number>();
  let printingUntil = -1;
  let wonAt: number | null = null;
  const lostAt = tl.figure.doorsShut + 1.2;

  const outcome = (t: number): "win" | "lose" | null => (wonAt !== null ? "win" : t >= lostAt ? "lose" : null);

  return {
    tl,
    status(t) {
      return {
        phase: phaseAt(tl, t),
        clock: clockAt(tl, t),
        alerts: liveAlerts(tl, t).filter(a => !logged.has(a.id)),
        logged: [...logged],
        roundTotal: tl.alerts.filter(a => !a.decoy).length,
        indicator: indicatorAt(tl, t),
        windowLeft: t >= tl.windowStart && t < tl.windowEnd ? tl.windowEnd - t : null,
        outcome: outcome(t),
      };
    },
    capture(t, framing) {
      if (outcome(t) || t < tl.roundsStart) return "closed";
      if (t < printingUntil) return "printing";
      printingUntil = t + PRINT_S;
      if (!signalAt(tl, framing.cam, t)) return "no_signal";
      // tonight's figure, first: only the lobby camera, and only with the lit indicator in the same frame
      const fig = figureAt(tl, t);
      const figBox = framing.boxes.figure;
      let best: Verdict = "nothing";
      const rank: Verdict[] = ["nothing", "too_wide", "cropped", "no_indicator"];
      const better = (v: Verdict) => {
        if (rank.indexOf(v) > rank.indexOf(best)) best = v;
      };
      if (framing.cam === LOBBY && fig.visible && figBox && seen(figBox)) {
        if (!inside(figBox)) better("cropped");
        else if (size(figBox) < MIN_SIZE.figure) better("too_wide");
        // clear of the tube's curved edge, where the picture bends away
        else if (!framing.indicator || !inside(framing.indicator, 0.05)) better("no_indicator");
        else {
          wonAt = t;
          return "figure";
        }
      }
      for (const alert of liveAlerts(tl, t)) {
        if (alert.cam !== framing.cam || logged.has(alert.id)) continue;
        const box = framing.boxes[String(alert.id)];
        if (!box || !seen(box)) continue;
        if (!inside(box)) better("cropped");
        else if (size(box) < MIN_SIZE[alert.kind]) better("too_wide");
        else {
          logged.add(alert.id);
          return "logged";
        }
      }
      return best;
    },
  };
}
