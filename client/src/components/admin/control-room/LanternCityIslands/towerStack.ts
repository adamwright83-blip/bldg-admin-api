/**
 * The tower stack: our two residential towers as floors and units, so a customer's home can be
 * lit in its real window. Pure data, no rendering (towerCutaway.ts draws it).
 *
 * Floor counts and units per floor are the building facts Adam supplied (2026-09-28):
 * - OPUS LA: south tower on Wilshire, 22 storeys; north tower on 6th Street, 14 storeys.
 *   18 units a floor in the south tower. The north tower's count is not known; it is assumed
 *   the same and flagged `unitsAssumed` so the drawing can say so.
 * - Century Park East: two 21-storey towers, 2160 and 2170, 12 units a floor.
 *
 * A unit string only places a customer when it reads unambiguously: "1507" is floor 15, unit 7;
 * "12A" is floor 12, unit A; "PH3" is the top floor. Anything else stays in the tower's
 * `unplaced` list rather than being guessed into a window.
 */
import type { CanonicalGeographyId } from "@shared/canonicalGeography";

export type TowerSpec = {
  id: string;
  label: string;
  address: RegExp;
  floors: number;
  unitsPerFloor: number;
  unitsAssumed?: boolean;
};
export type BuildingSpec = { id: CanonicalGeographyId; name: string; towers: TowerSpec[] };

export const TOWER_BUILDINGS: BuildingSpec[] = [
  {
    id: "opus_la",
    name: "OPUS LA",
    towers: [
      { id: "south", label: "South tower · 3545 Wilshire", address: /\b3545\s+wilshire\b/i, floors: 22, unitsPerFloor: 18 },
      { id: "north", label: "North tower · 3650 W 6th", address: /\b3650\s+(?:w\.?|west)?\s*6th\b/i, floors: 14, unitsPerFloor: 18, unitsAssumed: true },
    ],
  },
  {
    id: "century_park_east",
    name: "Century Park East",
    towers: [
      { id: "2160", label: "2160 Century Park East", address: /\b2160\s+century\s+(?:park|pk)\b/i, floors: 21, unitsPerFloor: 12 },
      { id: "2170", label: "2170 Century Park East", address: /\b2170\s+century\s+(?:park|pk)\b/i, floors: 21, unitsPerFloor: 12 },
    ],
  },
];

export type Resident = { key: string; name: string; address: string; unit: string | null };
/** where a unit string lands: floor 1..floors, slot 1..unitsPerFloor (null when the floor is known but the door isn't) */
export type UnitSpot = { floor: number; slot: number | null };

export function parseUnit(unit: string | null, t: Pick<TowerSpec, "floors" | "unitsPerFloor">): UnitSpot | null {
  if (!unit) return null;
  const u = unit.trim().toUpperCase().replace(/^(?:APT|APARTMENT|UNIT|STE|SUITE|#)\.?\s*#?\s*/, "");
  let m = /^PH\s*-?\s*(\d{1,2})?$/.exec(u);
  if (m) {
    const slot = m[1] ? Number(m[1]) : null;
    return { floor: t.floors, slot: slot && slot <= t.unitsPerFloor ? slot : null };
  }
  m = /^(\d{1,2})\s*-?\s*([A-Z])$/.exec(u);
  if (m) {
    const floor = Number(m[1]), slot = m[2].charCodeAt(0) - 64;
    if (floor < 1 || floor > t.floors) return null;
    return { floor, slot: slot <= t.unitsPerFloor ? slot : null };
  }
  m = /^(\d{3,4})$/.exec(u);
  if (m) {
    const n = Number(m[1]), floor = Math.floor(n / 100), slot = n % 100;
    if (floor < 1 || floor > t.floors) return null;
    return { floor, slot: slot >= 1 && slot <= t.unitsPerFloor ? slot : null };
  }
  return null;
}

export type TowerModel = {
  spec: TowerSpec;
  /** floors[f-1][s-1]: the residents in that unit */
  floors: Resident[][][];
  /** residents whose floor is known but not their door */
  floorOnly: Resident[][];
  /** in this tower, but the unit string doesn't place them */
  unplaced: Resident[];
  lit: number;
};
export type BuildingModel = { spec: BuildingSpec; towers: TowerModel[]; unmatched: Resident[] };

/** sort the building's residents into their towers, floors and units */
export function buildTowerModel(spec: BuildingSpec, residents: Resident[]): BuildingModel {
  const towers: TowerModel[] = spec.towers.map(t => ({
    spec: t,
    floors: Array.from({ length: t.floors }, () => Array.from({ length: t.unitsPerFloor }, () => [] as Resident[])),
    floorOnly: Array.from({ length: t.floors }, () => [] as Resident[]),
    unplaced: [],
    lit: 0,
  }));
  const unmatched: Resident[] = [];
  for (const r of residents) {
    const tw = towers.find(t => t.spec.address.test(r.address));
    if (!tw) { unmatched.push(r); continue; }
    const at = parseUnit(r.unit, tw.spec);
    if (!at) tw.unplaced.push(r);
    else if (at.slot === null) tw.floorOnly[at.floor - 1].push(r);
    else tw.floors[at.floor - 1][at.slot - 1].push(r);
  }
  for (const t of towers) t.lit = t.floors.reduce((n, f) => n + f.filter(u => u.length).length, 0) + t.floorOnly.filter(f => f.length).length;
  return { spec, towers, unmatched };
}

/** floors with no customer at all (the ones to knock on) */
export function darkFloors(t: TowerModel) {
  const out: number[] = [];
  t.floors.forEach((f, i) => { if (!f.some(u => u.length) && !t.floorOnly[i].length) out.push(i + 1); });
  return out;
}
