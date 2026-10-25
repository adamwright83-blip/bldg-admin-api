/**
 * The rope, modelled on Jusant: each hand is a button. Press one and that hand reaches up and pulls; alternate them
 * and she climbs. Pressing the same hand twice is a half pull. A press that comes too early in a pull is queued once,
 * so a rhythm keeps her moving and mashing does not. Gripping costs stamina, pulling costs more, hanging still rests
 * and refills it; with no stamina a press does nothing and she hangs until she has some back. A zombie at the ankle
 * drops her to the last knot she passed, never to the floor.
 *
 * Pure and deterministic: the runtime drives it, the animation reads `h`, and the tests walk it.
 */
export type Hand = "L" | "R";
export type Pull = { from: number; to: number; t: number; hand: Hand };
export type ClimbState = {
  /** metres above the floor she started from */
  h: number;
  /** where the current pull ends (the HUD and tests read this; the body eases toward it) */
  target: number;
  next: Hand;
  pull: Pull | null;
  queued: Hand | null;
  stamina: number;
  /** seconds since the last press */
  idle: number;
  /** total pulls made (the sound and the sway use it) */
  pulls: number;
};

export const PULL = 0.5; // metres per full pull
export const PULL_DUR = 0.34; // seconds a pull takes
export const KNOT = 0.55; // knots on the rope mesh are this far apart
export const EARLY = 0.55; // a press before this fraction of a pull is queued, not acted on
export const STAMINA_PULL = 0.075;
export const STAMINA_GRIP = 0.03; // per second, while holding on and not resting
export const STAMINA_REST = 0.22; // per second, after REST_AFTER seconds without a press
export const REST_AFTER = 0.45;
export const GRAB_PENALTY = 0.25;

export function startClimb(h = 0.15): ClimbState {
  return { h, target: h, next: "R", pull: null, queued: null, stamina: 1, idle: 0, pulls: 0 };
}

const other = (h: Hand): Hand => (h === "L" ? "R" : "L");

function beginPull(s: ClimbState, hand: Hand): ClimbState {
  const full = hand === s.next;
  const gain = full ? PULL : PULL * 0.5;
  const to = s.h + gain;
  return { ...s, pull: { from: s.h, to, t: 0, hand }, target: to, next: other(hand), stamina: Math.max(0, s.stamina - STAMINA_PULL * (full ? 1 : 0.7)), pulls: s.pulls + 1 };
}

/** a hand pulls: "next" means whichever hand is due (one-button play) */
export function press(s: ClimbState, hand: Hand | "next"): ClimbState {
  const h: Hand = hand === "next" ? s.next : hand;
  const idle0 = { ...s, idle: 0 };
  if (s.stamina <= 0.02) return idle0; // nothing left: she hangs
  if (!s.pull) return beginPull(idle0, h);
  if (s.pull.t / PULL_DUR >= EARLY) return { ...beginPull({ ...idle0, h: s.pull.to }, h) };
  return { ...idle0, queued: s.queued ?? h };
}

/** time passes: the pull eases, stamina drains or rests */
export function tick(s: ClimbState, dt: number): ClimbState {
  let n: ClimbState = { ...s, idle: s.idle + dt };
  if (n.pull) {
    const t = Math.min(PULL_DUR, n.pull.t + dt);
    const k = t / PULL_DUR;
    const eased = 1 - Math.pow(1 - k, 3);
    n = { ...n, h: n.pull.from + (n.pull.to - n.pull.from) * eased, pull: { ...n.pull, t } };
    if (t >= PULL_DUR) {
      n = { ...n, h: n.pull!.to, pull: null };
      if (n.queued) {
        const q = n.queued;
        n = beginPull({ ...n, queued: null }, q);
      }
    }
  }
  const resting = !n.pull && n.idle >= REST_AFTER;
  const stamina = resting ? Math.min(1, n.stamina + STAMINA_REST * dt) : Math.max(0, n.stamina - STAMINA_GRIP * dt);
  return { ...n, stamina };
}

/** grabbed at the ankle: down to the last knot, and it costs her */
export function grabbed(s: ClimbState): ClimbState {
  const knot = Math.max(0.15, Math.floor(s.h / KNOT) * KNOT);
  return { ...s, h: knot, target: knot, pull: null, queued: null, stamina: Math.max(0, s.stamina - GRAB_PENALTY), idle: 0 };
}

export const isResting = (s: ClimbState): boolean => !s.pull && s.idle >= REST_AFTER;
