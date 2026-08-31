/**
 * CANONICAL BUILDING ART — one composition, every camera distance.
 *
 * A building must be the same object on Home, in Lantern City and in Tower Wars.
 * Before this module it was not:
 *
 *   - Home rendered OPUS as `opus-la-siege-driver-v5.png`, an old composite with a
 *     thin baked club, while Tower Wars rendered the plate plus the current driver.
 *     The same building had two different weapons depending on the screen.
 *   - Century Park East rendered `century-park-east-tower-v2.png` (classical stone,
 *     with a crater and a bazooka baked in) AND overlaid
 *     `century-bazooka-optimized.png`, which is not a bazooka at all — it is an
 *     entirely different, modern CPE tower with its own weapon and its own damage.
 *     CPE was literally two different buildings stacked on top of each other.
 *
 * Every surface now composes a building from the same ordered layers:
 *
 *     pristine plate            no combat damage baked in
 *       + settled scars         permanent history (prior days)
 *       + fresh damage          TODAY only
 *       + weapon overlay        so it can actually move
 *       + projectile
 *
 * All layers share the 800x1200 art space and are positioned `center bottom / contain`,
 * so they stay locked together at any scale. Geometry below is in that art space.
 */

export const ART_SPACE = { width: 800, height: 1200 } as const;

export type CanonicalBuildingId = "opus_la" | "century_park_east";

export type WeaponGeometry = {
  /** Pivot the weapon rotates about, in art space. */
  pivot: { x: number; y: number };
  /** Where the projectile rests / launches from. */
  muzzle: { x: number; y: number };
  /** Which way the projectile travels. OPUS strikes right, CPE strikes left. */
  strikeDirection: "left_to_right" | "right_to_left";
};

export type BuildingArt = {
  id: CanonicalBuildingId;
  displayName: string;
  /** Tower with no club, no ball, no bazooka and no combat damage baked in. */
  plate: string;
  /** The one and only weapon for this building. */
  weapon: string;
  /** The projectile, when it ships as its own art. */
  projectile: string | null;
  weaponGeometry: WeaponGeometry;
};

const ASSETS = "/assets/admin/control-room/tower-wars";

export const BUILDING_ART: Record<CanonicalBuildingId, BuildingArt> = {
  opus_la: {
    id: "opus_la",
    displayName: "OPUS LA",
    plate: `${ASSETS}/opus-la-tower-plate-v4.png`,
    weapon: `${ASSETS}/opus-la-driver-overlay-v6.png`,
    projectile: `${ASSETS}/opus-la-ball-v1.png`,
    weaponGeometry: {
      // Articulated mount on the taller tower; head rests LEFT of the ball so the
      // swing travels into it, toward Century Park East.
      pivot: { x: 320, y: 270 },
      muzzle: { x: 548, y: 754 },
      strikeDirection: "left_to_right",
    },
  },
  century_park_east: {
    id: "century_park_east",
    displayName: "Century Park East",
    plate: `${ASSETS}/century-park-east-tower-plate-v3.png`,
    weapon: `${ASSETS}/century-bazooka-overlay-v1.png`,
    // The launched cars ship inside the weapon art; the flying projectile is drawn
    // by the arena rather than as a separate plate.
    projectile: null,
    weaponGeometry: {
      // Turret base on the rooftop pavilion. The muzzle points LEFT, which is
      // correct: CPE sits right of OPUS and must fire right to left.
      pivot: { x: 350, y: 196 },
      muzzle: { x: 208, y: 96 },
      strikeDirection: "right_to_left",
    },
  },
};

/** transform-origin for a weapon's own motion, as CSS percentages of the art space. */
export function weaponPivotPercent(id: CanonicalBuildingId): { x: number; y: number } {
  const { pivot } = BUILDING_ART[id].weaponGeometry;
  return {
    x: (pivot.x / ART_SPACE.width) * 100,
    y: (pivot.y / ART_SPACE.height) * 100,
  };
}

/**
 * Assets that must never be rendered again.
 *
 * `opus-la-siege-driver-v5.png` is a stale composite of tower+club; using it beside
 * the current plate makes OPUS change weapons between screens.
 * `century-bazooka-optimized.png` is a different building entirely.
 * `century-park-east-tower-v2.png` and `opus-la-tower-v2.png` have combat damage and
 * weapons baked in, which the layer model forbids.
 */
export const RETIRED_BUILDING_ART = [
  "opus-la-siege-driver-v5.png",
  "opus-la-siege-driver-v4.png",
  "century-bazooka-optimized.png",
  "century-park-east-tower-v2.png",
  "opus-la-tower-v2.png",
  "opus-la-tower-plate-v3.png",
] as const;
