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
 *   - which day a group of scars belongs to -> `businessDate`
 *   - how many scars that day produced      -> `incomingAttacks`
 *   - that day's aggregate end-of-day state -> `damageAtSettlement`
 *   - their relative age                    -> position in the settled sequence
 *
 * Presentation, decided here:
 *   - the MAPPING from a day's aggregate damage state to a repair kind. Note
 *     carefully: `damageAtSettlement` is a DAY-LEVEL aggregate, not a severity
 *     reading for any individual strike. Nothing in the data says one of a
 *     four-strike day's hits was worse than another. Rendering that day's
 *     marks as grafts is a deterministic presentation choice derived from the
 *     aggregate, and must never be described as per-strike truth.
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
 * How many individual scars a facade draws before older history CONSOLIDATES.
 *
 * History is never discarded. Beyond this density individual marks overlap
 * into noise, so the oldest days collapse into patina — broad consolidated
 * repair zones that still carry their real date range and real strike count.
 * A very old tower therefore reads as deeply weathered rather than as a
 * tower that forgot its first year. The exact record always remains in
 * "Reading the scars".
 */
export const MAX_RENDERED_SCARS = 72;

/** How many consolidated zones the compressed era collapses into. */
export const MAX_PATINA_ZONES = 4;

/**
 * Presentation mapping: a day's AGGREGATE end-of-day damage state chooses the
 * repair kind drawn for every mark of that day. Deterministic, but derived —
 * the underlying data carries no per-strike severity to read.
 */
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

/**
 * MurmurHash3 finalizer. FNV-1a alone has weak avalanche on sequential
 * suffixes -- `unit:104` through `unit:157`, or consecutive business dates,
 * hash almost monotonically, which turns a "scatter" into a contiguous clump.
 * This decorrelates the output so ordering by it is actually uniform.
 */
function mix32(value: number): number {
  let hash = value;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** FNV-1a. Deterministic on every platform; never a source of randomness. */
function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return mix32(hash >>> 0);
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

/**
 * A consolidated era of older history. Carries real dates and a real strike
 * total; only its position and extent on the facade are presentation.
 */
export type PatinaZone = {
  key: string;
  fromDate: string;
  toDate: string;
  absorbedStrikes: number;
  days: number;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  /** 0..1 relative weight within this facade's compressed era. */
  intensity: number;
};

export type FacadeProjection = {
  scars: FacadeScar[];
  patina: PatinaZone[];
  /** True when older history was consolidated rather than drawn individually. */
  compressed: boolean;
};

/**
 * Project settled strata into individually-drawn scars plus, when the record
 * is denser than the facade can draw, consolidated patina for the older era.
 *
 * Splitting is by whole days, oldest first, so a day is never half-drawn.
 */
export function projectFacade(
  strata: readonly SettledStratum[],
  bounds: FacadeBounds = DEFAULT_FACADE_BOUNDS
): FacadeProjection {
  const settled = strata.filter(stratum => stratum.incomingAttacks > 0);
  if (!settled.length) return { scars: [], patina: [], compressed: false };

  // Walk backwards from the most recent day, taking whole days until the
  // individual-scar budget is spent. Everything older is compressed.
  let budget = MAX_RENDERED_SCARS;
  let splitIndex = settled.length;
  for (let index = settled.length - 1; index >= 0; index -= 1) {
    const cost = settled[index]!.incomingAttacks;
    if (cost > budget) break;
    budget -= cost;
    splitIndex = index;
  }

  const compressedEra = settled.slice(0, splitIndex);
  const drawn = settled.slice(splitIndex);

  return {
    scars: projectFacadeScars(drawn, bounds),
    patina: projectPatina(compressedEra, bounds),
    compressed: compressedEra.length > 0,
  };
}

/**
 * Collapse an older era into a small number of consolidated repair zones.
 * Each zone keeps the real date range and real strike total it stands for.
 */
export function projectPatina(
  era: readonly SettledStratum[],
  bounds: FacadeBounds = DEFAULT_FACADE_BOUNDS
): PatinaZone[] {
  if (!era.length) return [];
  const zoneCount = Math.min(MAX_PATINA_ZONES, era.length);
  const perZone = Math.ceil(era.length / zoneCount);
  const zones: PatinaZone[] = [];

  for (let index = 0; index < zoneCount; index += 1) {
    const slice = era.slice(index * perZone, (index + 1) * perZone);
    if (!slice.length) continue;
    const absorbedStrikes = slice.reduce(
      (total, stratum) => total + stratum.incomingAttacks,
      0
    );
    zones.push({
      key: `patina:${slice[0]!.businessDate}:${slice.at(-1)!.businessDate}`,
      fromDate: slice[0]!.businessDate,
      toDate: slice.at(-1)!.businessDate,
      absorbedStrikes,
      days: slice.length,
      xPercent: bounds.minX,
      yPercent: 0,
      widthPercent: bounds.maxX - bounds.minX,
      heightPercent: 0,
      intensity: 0,
    });
  }

  // Oldest era sits lowest on the facade: the building's foundations carry
  // the deepest weathering. Bands are laid out deterministically by count.
  const span = bounds.maxY - bounds.minY;
  const bandHeight = span / zones.length;
  const heaviest = Math.max(...zones.map(zone => zone.absorbedStrikes), 1);
  return zones.map((zone, index) => ({
    ...zone,
    // index 0 is the oldest slice, so it is placed at the bottom band.
    yPercent: bounds.maxY - bandHeight * (index + 1),
    heightPercent: bandHeight,
    intensity: zone.absorbedStrikes / heaviest,
  }));
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
