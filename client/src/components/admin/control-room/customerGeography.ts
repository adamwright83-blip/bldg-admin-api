import type { GeographicEntity } from "./GoogleMapsRealityLayer";

export type GeographicCustomer = {
  identityKey: string;
  displayName: string;
  phone: string | null;
  totalOrders?: number;
  firstOrderAt?: string;
  lastOrderAt?: string;
  cadence: {
    state: "active" | "dimming" | "dark";
    daysSinceLastOrder: number;
    expectedCadenceDays?: number | null;
  };
  location: null | {
    latitude: number;
    longitude: number;
    x: number;
    y: number;
    outOfBounds: boolean;
    canonicalAddress: string | null;
  };
};

export type CustomerLocationCluster = {
  key: string;
  latitude: number;
  longitude: number;
  x: number;
  y: number;
  outsideAtlas: boolean;
  canonicalAddress: string | null;
  customers: GeographicCustomer[];
  total: number;
  active: number;
  dimming: number;
  dark: number;
};

/**
 * Residents of one building must land on one lantern. Address Validation returns a
 * per-resident canonical address, so the same premise arrives with a unit token and
 * with a unit-specific ZIP+4 suffix; both are stripped so the building is what
 * identifies the physical location. The street number is never stripped — neighbouring
 * towers are genuinely different places and stay separate lanterns.
 */
function physicalKey(customer: GeographicCustomer): string {
  const location = customer.location!;
  const address = location.canonicalAddress
    ?.toLowerCase()
    .replace(
      /(?:\b(?:apartment|apt|unit|suite|ste|floor|fl)\.?\s*|#\s*)[a-z0-9-]+\b/g,
      ""
    )
    .replace(/(\b\d{5})-\d{4}\b/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
  return address
    ? `address:${address}`
    : `coord:${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`;
}

export function clusterGeographicCustomers(
  customers: GeographicCustomer[]
): CustomerLocationCluster[] {
  const groups = new Map<string, GeographicCustomer[]>();
  for (const customer of customers) {
    if (!customer.location) continue;
    const key = physicalKey(customer);
    groups.set(key, [...(groups.get(key) ?? []), customer]);
  }
  return [...groups.entries()].map(([key, members]) => {
    const location = members[0]!.location!;
    const counts = { active: 0, dimming: 0, dark: 0 };
    for (const member of members) counts[member.cadence.state] += 1;
    return {
      key,
      latitude: location.latitude,
      longitude: location.longitude,
      x: location.x,
      y: location.y,
      outsideAtlas: location.outOfBounds,
      canonicalAddress: location.canonicalAddress,
      customers: members,
      total: members.length,
      ...counts,
    };
  });
}

export function clustersAsGoogleEntities(
  clusters: CustomerLocationCluster[],
  onSelect: (cluster: CustomerLocationCluster) => void
): GeographicEntity[] {
  return clusters.map(cluster => ({
    id: `customer-cluster:${cluster.key}`,
    latitude: cluster.latitude,
    longitude: cluster.longitude,
    label:
      cluster.total === 1
        ? cluster.customers[0]!.displayName
        : `${cluster.total} customers`,
    kind: "customer",
    onSelect: () => onSelect(cluster),
  }));
}

/**
 * Two lanterns can sit on the same pixel while describing genuinely different
 * places — 2170 and 2160 Century Park East are ~20m apart, so at atlas scale
 * one covers the other and only the top one can be clicked. Rather than move
 * either place, the atlas fans colliding lanterns onto deterministic slots and
 * draws a stem back to the true anchor, which stays marked. Slot 0 is the
 * anchor itself; the offsets for the other slots live in the stylesheet, in
 * pixels, so a fanned lantern clears its neighbour at any viewport width.
 *
 * Geography is never edited to do this: `x`/`y` remain the true projection and
 * Google mode, which places by latitude/longitude, does not fan at all.
 */
export const ATLAS_FAN_SLOTS = 5;

/** Percent-space nearness at which two lanterns overlap enough to block a click. */
const COLLISION_X = 2;
const COLLISION_Y = 4;

/** Shared threshold for a primary world object covering a customer cluster. */
export const ATLAS_PRIMARY_COVER_X = 1.2;
export const ATLAS_PRIMARY_COVER_Y = 1.2;

export function atlasPointsOverlap(
  left: { x: number; y: number },
  right: { x: number; y: number },
  thresholdX = ATLAS_PRIMARY_COVER_X,
  thresholdY = ATLAS_PRIMARY_COVER_Y
): boolean {
  return (
    Math.abs(left.x - right.x) < thresholdX &&
    Math.abs(left.y - right.y) < thresholdY
  );
}

export function findClusterAtAtlasPoint(
  point: { x: number; y: number },
  clusters: CustomerLocationCluster[]
): CustomerLocationCluster | null {
  return (
    clusters.find(cluster =>
      atlasPointsOverlap(point, cluster, COLLISION_X, COLLISION_Y)
    ) ?? null
  );
}

export function clusterCoveredByAtlasPoint(
  cluster: CustomerLocationCluster,
  point: { x: number; y: number }
): boolean {
  return atlasPointsOverlap(cluster, point);
}

/**
 * Truthful world position for a lantern that aggregates several physical
 * addresses: a customer-count-weighted centroid of the real cluster
 * locations, never a territory centroid. Every real source location stays
 * available separately via the caller's sourceAnchors/sourceClusters.
 */
export function centroidOfClusters(
  clusters: readonly CustomerLocationCluster[]
): { x: number; y: number; latitude: number; longitude: number } {
  const weight = (c: CustomerLocationCluster) => c.total || 1;
  const totalWeight = clusters.reduce((sum, c) => sum + weight(c), 0);
  const sum = clusters.reduce(
    (acc, c) => {
      const w = weight(c);
      acc.x += c.x * w;
      acc.y += c.y * w;
      acc.latitude += c.latitude * w;
      acc.longitude += c.longitude * w;
      return acc;
    },
    { x: 0, y: 0, latitude: 0, longitude: 0 }
  );
  return {
    x: sum.x / totalWeight,
    y: sum.y / totalWeight,
    latitude: sum.latitude / totalWeight,
    longitude: sum.longitude / totalWeight,
  };
}

/** Fold several clusters of the same premise into one light with one count. */
export function mergeClusters(
  clusters: readonly CustomerLocationCluster[]
): CustomerLocationCluster {
  if (clusters.length === 1) return clusters[0]!;
  const [first, ...rest] = clusters as [
    CustomerLocationCluster,
    ...CustomerLocationCluster[],
  ];
  const merged: CustomerLocationCluster = {
    ...first,
    key: clusters.map(cluster => cluster.key).join("+"),
    customers: clusters.flatMap(cluster => cluster.customers),
    total: 0,
    active: 0,
    dimming: 0,
    dark: 0,
  };
  for (const cluster of [first, ...rest]) {
    merged.total += cluster.total;
    merged.active += cluster.active;
    merged.dimming += cluster.dimming;
    merged.dark += cluster.dark;
  }
  return merged;
}

/**
 * Street number + first street token of an address: "2170 Century Park E,
 * Los Angeles" and "2170 Century Park East, Century City" are the same
 * premise. Unit tokens and city/ZIP never take part.
 */
export function streetIdentity(
  address: string | null | undefined
): string | null {
  const match = (address ?? "")
    .toLowerCase()
    .trim()
    .match(/^(\d+[a-z]?)\s+(?:[nsew]\.?\s+)?([a-z]+)/);
  return match ? `${match[1]} ${match[2]}` : null;
}

/**
 * A customer cluster that lives at a canonical stronghold's own street address
 * belongs to that building, whichever way the provider geocoded the parcel.
 * The customers' real coordinates are untouched — this only decides which
 * world object carries their light.
 */
export function clusterAtCanonicalAddress(
  cluster: CustomerLocationCluster,
  canonicalAddress: string
): boolean {
  const target = streetIdentity(canonicalAddress);
  if (!target) return false;
  return streetIdentity(cluster.canonicalAddress) === target;
}

export function lanternDensityClass(total: number): string {
  if (total >= 4) return "density-major";
  if (total >= 2) return "density-medium";
  return "density-single";
}

export type FannedCluster = {
  cluster: CustomerLocationCluster;
  /** 0 = drawn on its true anchor; >0 = drawn on an offset slot with a stem. */
  fanSlot: number;
};

export function fanOutAtlasCollisions(
  clusters: CustomerLocationCluster[]
): FannedCluster[] {
  const ordered = [...clusters].sort((left, right) =>
    left.key.localeCompare(right.key)
  );
  const groupOf = new Map<string, number>();
  let nextGroup = 0;
  for (const cluster of ordered) {
    const near = ordered.find(
      other =>
        groupOf.has(other.key) &&
        Math.abs(other.x - cluster.x) <= COLLISION_X &&
        Math.abs(other.y - cluster.y) <= COLLISION_Y
    );
    groupOf.set(cluster.key, near ? groupOf.get(near.key)! : nextGroup++);
  }
  const takenPerGroup = new Map<number, number>();
  return ordered.map(cluster => {
    const group = groupOf.get(cluster.key)!;
    const used = takenPerGroup.get(group) ?? 0;
    takenPerGroup.set(group, used + 1);
    return { cluster, fanSlot: used % ATLAS_FAN_SLOTS };
  });
}
