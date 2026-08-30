/**
 * FACADE SCARS — settled history rendered on the architecture itself.
 *
 * A completed business day does not stay damaged. It gets REPAIRED, and the
 * repair is what remains visible: patched masonry, a replacement panel, a
 * seam where glass was reset. The tower reads as repaired-but-changed rather
 * than perpetually broken, which is the difference between a building with a
 * history and a building stuck at "critical" forever.
 *
 * WHAT IS TRUTH AND WHAT IS PRESENTATION
 *
 * Truth, taken only from `settlement.strata` and never invented:
 *   - how many scars exist        -> that day's `incomingAttacks`
 *   - how severe each one reads   -> that day's `damageAtSettlement`
 *   - which day each belongs to   -> `businessDate`
 *   - their relative age          -> position within the settled sequence
 *
 * Presentation, decided here:
 *   - WHERE on the facade a scar sits, and its rotation.
 *
 * Each tower gets its OWN silhouette bounds, read off the art itself: the
 * pieces are isometric renders that occupy quite different parts of their
 * 800x1200 frame (OPUS leaves the upper right to its driver; CPE sits wider
 * and taller). A single shared band scatters scars into empty sky.
 *
 * Placement is derived by hashing `businessDate` and the scar's index, so a
 * given real day always lands in exactly the same place on the facade. It is
 * stable across reloads and re-renders, and no scar exists that does not
 * correspond to a real settled strike. Nothing here can add a mark: the count
 * comes from the data and the loop cannot run longer than it.
 */
import type { TowerDamageState } from "@shared/towerWars";

export type ScarKind = "patch" | "seam" | "panel" | "graft";

export type FacadeScar = {
  key: string;
  businessDate: string;
  kind: ScarKind;
  /** Percent of the facade box. Deterministic presentation, not data. */
  xPercent: number;
  yPercent: number;
  rotation: number;
  /** 0 = oldest settled day, 1 = most recent. Older reads more integrated. */
  recency: number;
};

/** Where a tower's masonry actually is, as percentages of the 800x1200 art. */
export type FacadeBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

/**
 * Measured from the rendered art with a calibration grid, not guessed. OPUS
 * keeps clear of the golf driver that fills its upper right; CPE spans wider
 * and starts higher.
 */
export const FACADE_BOUNDS: Record<string, FacadeBounds> = {
  opus_la: { minX: 13, maxX: 45, minY: 23, maxY: 75 },
  century_park_east: { minX: 20, maxX: 58, minY: 22, maxY: 78 },
};

export const DEFAULT_FACADE_BOUNDS: FacadeBounds = {
  minX: 20,
  maxX: 80,
  minY: 25,
  maxY: 80,
};

export function boundsForBuilding(buildingId: string): FacadeBounds {
  return FACADE_BOUNDS[buildingId] ?? DEFAULT_FACADE_BOUNDS;
}

export type SettledStratum = {
  businessDate: string;
  incomingAttacks: number;
  damageAtSettlement: TowerDamageState;
};

/**
 * How many scars a facade will draw before it stops adding marks.
 *
 * This is an omission, never an invention: the complete record always remains
 * readable in the BuildingStrata panel. Beyond this density the marks overlap
 * into noise and stop being architecture, so the most recent are kept.
 */
export const MAX_RENDERED_SCARS = 72;

/** A settled day's severity decides what kind of repair is visible. */
export function scarKindFor(damage: TowerDamageState): ScarKind {
  switch (damage) {
    case "critical":
      return "graft";
    case "heavily-damaged":
      return "panel";
    case "cracked":
      return "seam";
    case "chipped":
    case "pristine":
    default:
      return "patch";
  }
}

/** FNV-1a. Deterministic on every platform; never a source of randomness. */
function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Spread a hash into a bounded band, avoiding the extreme facade edges. */
function band(hash: number, min: number, max: number): number {
  return min + ((hash % 1000) / 1000) * (max - min);
}

/**
 * Project settled strata onto positioned facade scars.
 *
 * `strata` is expected oldest-first, matching the settlement's own ordering.
 */
export function projectFacadeScars(
  strata: readonly SettledStratum[],
  bounds: FacadeBounds = DEFAULT_FACADE_BOUNDS
): FacadeScar[] {
  const settled = strata.filter(stratum => stratum.incomingAttacks > 0);
  if (!settled.length) return [];

  const lastIndex = Math.max(1, settled.length - 1);
  const all: FacadeScar[] = [];

  settled.forEach((stratum, dayIndex) => {
    const kind = scarKindFor(stratum.damageAtSettlement);
    const recency = settled.length === 1 ? 1 : dayIndex / lastIndex;
    for (let mark = 0; mark < stratum.incomingAttacks; mark += 1) {
      const seed = stableHash(`${stratum.businessDate}:${mark}`);
      const spread = stableHash(`${stratum.businessDate}:${mark}:y`);
      const tilt = stableHash(`${stratum.businessDate}:${mark}:r`);
      all.push({
        key: `${stratum.businessDate}:${mark}`,
        businessDate: stratum.businessDate,
        kind,
        xPercent: band(seed, bounds.minX, bounds.maxX),
        yPercent: band(spread, bounds.minY, bounds.maxY),
        rotation: band(tilt, -8, 8),
        recency,
      });
    }
  });

  // Keep the most recent when a facade has more history than it can draw.
  return all.length <= MAX_RENDERED_SCARS
    ? all
    : all.slice(all.length - MAX_RENDERED_SCARS);
}

/** True when the facade is showing less than the full settled record. */
export function scarsWereTruncated(
  strata: readonly SettledStratum[]
): boolean {
  const total = strata.reduce(
    (sum, stratum) => sum + Math.max(0, stratum.incomingAttacks),
    0
  );
  return total > MAX_RENDERED_SCARS;
}
