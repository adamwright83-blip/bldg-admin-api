import type { GuestId } from "./content";
import { guestHasTrait } from "./content";

/**
 * The proprietor's side of the hotel: scavenge one oversized piece of human junk,
 * haul it home, turn it into a fixture, and see a resident change their routine.
 * Everything here is data + pure functions so it can be fuzzed without a renderer.
 */

export type ShelfObjectId = "brass_button" | "thread_spool" | "thimble";
export type FixtureId = "signal_mirror" | "spool_stool" | "thimble_stove";
export type Affordance = "signal" | "perch" | "warmth";
export type RoutineId = "signals_trains" | "perches_by_window" | "warms_hands" | "has_tea" | "ignores_it";
export const ROUTINE_IDS: readonly RoutineId[] = ["signals_trains", "perches_by_window", "warms_hands", "has_tea", "ignores_it"];
export type HaulStyle = "carry" | "roll";

export interface ShelfObjectDef {
  id: ShelfObjectId;
  label: string;
  /** how it moves: lifted overhead, or pushed along the desk */
  haul: HaulStyle;
  /** speed multiplier while hauling (heavier = slower) */
  hauledSpeed: number;
  fixture: FixtureId;
  /** where it sits on the lost-property shelf, desk coordinates */
  spot: { x: number; z: number };
  /** line shown when the proprietor first inspects it */
  inspect: string;
}

export interface FixtureDef {
  id: FixtureId;
  label: string;
  affordance: Affordance;
  /** where it is installed inside the suitcase (room coordinates) */
  home: { x: number; z: number };
  /** where a resident uses it from (room coordinates); y is the seat height */
  stand: { x: number; z: number; y: number };
  built: string;
}

export const SHELF_OBJECTS: Record<ShelfObjectId, ShelfObjectDef> = {
  brass_button: {
    id: "brass_button",
    label: "Brass coat button",
    haul: "carry",
    hauledSpeed: 0.6,
    fixture: "signal_mirror",
    spot: { x: -7.2, z: 1.2 },
    inspect: "A coat button the size of a dinner plate. It throws the light back.",
  },
  thread_spool: {
    id: "thread_spool",
    label: "Spool of red thread",
    haul: "roll",
    hauledSpeed: 0.85,
    fixture: "spool_stool",
    spot: { x: 6.8, z: 5.4 },
    inspect: "A spool, taller than you. It rolls if you lean on it right.",
  },
  thimble: {
    id: "thimble",
    label: "Silver thimble",
    haul: "carry",
    hauledSpeed: 0.55,
    fixture: "thimble_stove",
    spot: { x: -1.6, z: 5.6 },
    inspect: "A thimble. Dented, hollow, and still warm from somebody's finger.",
  },
};

export const FIXTURES: Record<FixtureId, FixtureDef> = {
  signal_mirror: {
    id: "signal_mirror",
    label: "Signal mirror",
    affordance: "signal",
    home: { x: 2.05, z: -1.75 },
    stand: { x: 1.25, z: -1.05, y: 0 },
    built: "You wedge the button fast, exactly where it caught the light. It catches every train.",
  },
  spool_stool: {
    id: "spool_stool",
    label: "Spool stool",
    affordance: "perch",
    home: { x: -2.15, z: -1.05 },
    stand: { x: -2.15, z: -1.05, y: 0.62 },
    built: "You stand the spool on its end. It is exactly a stool.",
  },
  thimble_stove: {
    id: "thimble_stove",
    label: "Thimble stove",
    affordance: "warmth",
    home: { x: -0.2, z: -1.5 },
    stand: { x: 0.55, z: -1.0, y: 0 },
    built: "You turn the thimble over and light a tea-candle under it. A small hearth.",
  },
};

export const SHELF_ORDER: ShelfObjectId[] = ["brass_button", "thread_spool", "thimble"];

/** objects still on the shelf = those whose fixture has not been built */
export function remainingObjects(fixtures: readonly FixtureId[]): ShelfObjectId[] {
  const built = new Set(fixtures);
  return SHELF_ORDER.filter(id => !built.has(SHELF_OBJECTS[id].fixture));
}

export interface Haul {
  carrying: ShelfObjectId | null;
}

export type PickResult =
  | { ok: true; haul: Haul }
  | { ok: false; reason: "hands_full" | "already_built" };

/** the single rule the whole spike is testing: you can carry only one thing */
export function pickUp(haul: Haul, id: ShelfObjectId, fixtures: readonly FixtureId[]): PickResult {
  if (fixtures.includes(SHELF_OBJECTS[id].fixture)) return { ok: false, reason: "already_built" };
  if (haul.carrying) return { ok: false, reason: "hands_full" };
  return { ok: true, haul: { carrying: id } };
}

export function drop(haul: Haul): { haul: Haul; dropped: ShelfObjectId | null } {
  return { haul: { carrying: null }, dropped: haul.carrying };
}

export interface RoutineChange {
  routine: RoutineId;
  /** what the resident does, said once, in the story line */
  line: string;
}

/**
 * Who uses a fixture, and how, comes from the guest's traits: no per-guest branches.
 * Returns ignores_it when the resident has no use for it, so a fixture can miss.
 */
export function resolveRoutine(guest: GuestId, fixture: FixtureId): RoutineChange {
  const def = FIXTURES[fixture];
  const name = (g: GuestId) => ({ conductor: "The Conductor", baker: "The Baker", reader: "The Reader" })[g];

  if (def.affordance === "signal" && guestHasTrait(guest, "train_attuned")) {
    return { routine: "signals_trains", line: `${name(guest)} polishes the button, then flashes it at every train that passes. They have started to flash back.` };
  }
  if (def.affordance === "perch") {
    return { routine: "perches_by_window", line: `${name(guest)} climbs onto the spool and stays there. It is the best seat in the suitcase.` };
  }
  if (def.affordance === "warmth") {
    if (guestHasTrait(guest, "cold_natured") || guestHasTrait(guest, "draft_sensitive")) {
      return { routine: "warms_hands", line: `${name(guest)} holds out both hands to the thimble and does not move for an hour.` };
    }
    return { routine: "has_tea", line: `${name(guest)} pulls up beside it and brews a thimble of tea. He checks his watch twice, then stops checking.` };
  }
  return { routine: "ignores_it", line: `${name(guest)} looks at it, nods politely, and goes back to what they were doing.` };
}

// -------------------------------------------------------------------- walking on the shelf

export interface Box { x0: number; x1: number; z0: number; z1: number }

/** keep a circle of `radius` out of every box; pure so the walker can never tunnel into the suitcase */
export function pushOut(p: { x: number; z: number }, radius: number, boxes: readonly Box[]): { x: number; z: number } {
  let { x, z } = p;
  for (const b of boxes) {
    const nx = Math.max(b.x0, Math.min(x, b.x1));
    const nz = Math.max(b.z0, Math.min(z, b.z1));
    const dx = x - nx, dz = z - nz;
    const d = Math.hypot(dx, dz);
    if (d >= radius) continue;
    if (d > 1e-6) { x = nx + (dx / d) * radius; z = nz + (dz / d) * radius; continue; }
    // centre is inside the box: leave by the nearest side
    const left = x - b.x0, right = b.x1 - x, up = z - b.z0, down = b.z1 - z;
    const m = Math.min(left, right, up, down);
    if (m === left) x = b.x0 - radius; else if (m === right) x = b.x1 + radius; else if (m === up) z = b.z0 - radius; else z = b.z1 + radius;
  }
  return { x, z };
}

export const SHELF_BOUNDS: Box = { x0: -11, x1: 11, z0: -4.2, z1: 9.5 };

export function clampToShelf(p: { x: number; z: number }): { x: number; z: number } {
  return {
    x: Math.max(SHELF_BOUNDS.x0, Math.min(SHELF_BOUNDS.x1, p.x)),
    z: Math.max(SHELF_BOUNDS.z0, Math.min(SHELF_BOUNDS.z1, p.z)),
  };
}

/** one walking step toward a target, honouring obstacles */
export function stepToward(
  pos: { x: number; z: number },
  target: { x: number; z: number },
  dist: number,
  radius: number,
  boxes: readonly Box[],
): { pos: { x: number; z: number }; arrived: boolean; yaw: number } {
  const dx = target.x - pos.x, dz = target.z - pos.z;
  const d = Math.hypot(dx, dz);
  if (d <= dist) return { pos: pushOut(clampToShelf(target), radius, boxes), arrived: true, yaw: Math.atan2(dx, dz) };
  const next = pushOut(clampToShelf({ x: pos.x + (dx / d) * dist, z: pos.z + (dz / d) * dist }), radius, boxes);
  // if an obstacle ate the whole step, count that as arrived rather than walking in place forever
  const moved = Math.hypot(next.x - pos.x, next.z - pos.z);
  return { pos: next, arrived: moved < dist * 0.2, yaw: Math.atan2(dx, dz) };
}

/** what is in the way on the desk: the suitcase, a mug, and the sealed tin can */
export const SHELF_OBSTACLES: Box[] = [
  { x0: -3.55, x1: 3.55, z0: -2.5, z1: 2.4 }, // the suitcase
  { x0: 4.8, x1: 5.9, z0: 1.3, z1: 2.3 },      // the tea mug
  { x0: 6.3, x1: 9.1, z0: -4.2, z1: -1.6 },    // the tin can, not yet
];

/** the mouth of the suitcase: where the proprietor steps over the lip */
export const LIP = { x: -2.5, z: 2.7 };
export const TIN_CAN = { x: 7.7, z: -2.9 };
