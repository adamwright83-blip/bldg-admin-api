/**
 * CANONICAL GEOGRAPHY — the one place a canonical building's real coordinate lives.
 *
 * Goldline held the same three numbers in three different files: the server's
 * `CANONICAL_BUILDING_GEO`, the client's `CANONICAL_GEOGRAPHIC_TARGETS`, and
 * `WorldGeographySurface`'s own tower table plus an inline camera switch. Four
 * copies of one physical fact is four chances for the world to disagree with
 * itself about where a building actually is.
 *
 * THE PRODUCT RULE THIS FILE ENFORCES
 *
 *   canonical entity owns lat/lng   → here
 *   renderer owns projection        → GoogleMapsRealityLayer / the atlas projection
 *   presentation owns choreography  → range, tilt, zoom, altitude, timing
 *
 * So this module deliberately carries NO camera fields. `range`/`tilt`/`zoom`
 * are choices about how to depict an approach; they are not properties of the
 * building, and putting them here would re-create the duplication in a new
 * place. `facadeHeading` IS here, because which way the building's front face
 * points is a physical fact about the structure, not a camera preference.
 *
 * This is not a new geographic database. `entityLocations` and the geographic
 * truth service remain authoritative for resolved/provider-sourced coordinates.
 * These two entries are the operator-confirmed canonical anchors that both the
 * server providers and the client renderer must agree on.
 */

export const CANONICAL_BUILDING_IDS = ["opus_la", "century_park_east"] as const;
export type CanonicalGeographyId = (typeof CANONICAL_BUILDING_IDS)[number];

export type CanonicalBuildingGeography = {
  id: CanonicalGeographyId;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  /** Physical: the compass bearing a viewer faces to look at the front facade. */
  facadeHeading: number;
};

export const CANONICAL_BUILDING_GEOGRAPHY: Record<
  CanonicalGeographyId,
  CanonicalBuildingGeography
> = {
  opus_la: {
    id: "opus_la",
    name: "OPUS LA",
    address: "3545 Wilshire Blvd, Los Angeles, CA 90010",
    latitude: 34.0618,
    longitude: -118.3011,
    facadeHeading: 195,
  },
  century_park_east: {
    id: "century_park_east",
    name: "Century Park East",
    address: "2170 Century Park E, Los Angeles, CA 90067",
    latitude: 34.0591,
    longitude: -118.4147,
    facadeHeading: 140,
  },
};

/**
 * The wide establishing frame over Los Angeles. This is a real place — downtown
 * LA — not a fabricated centroid, and it is shared by every surface that needs
 * to open on "the city" before committing to a building.
 */
export const LOS_ANGELES_ESTABLISHING = {
  latitude: 34.0522,
  longitude: -118.2437,
} as const;

export function isCanonicalGeographyId(
  value: unknown,
): value is CanonicalGeographyId {
  return (
    typeof value === "string" &&
    (CANONICAL_BUILDING_IDS as readonly string[]).includes(value)
  );
}

/** Resolve a canonical building's real coordinate, or null if it is not one. */
export function canonicalGeographyFor(
  id: string | null | undefined,
): CanonicalBuildingGeography | null {
  return isCanonicalGeographyId(id) ? CANONICAL_BUILDING_GEOGRAPHY[id] : null;
}
