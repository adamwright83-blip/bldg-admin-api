import type { GeographicEntity } from "./GoogleMapsRealityLayer";

export type GeographicCustomer = {
  identityKey: string;
  displayName: string;
  phone: string | null;
  cadence: { state: "active" | "dimming" | "dark"; daysSinceLastOrder: number };
  location: null | { latitude: number; longitude: number; x: number; y: number; outOfBounds: boolean; canonicalAddress: string | null };
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
    .replace(/(?:\b(?:apartment|apt|unit|suite|ste|floor|fl)\.?\s*|#\s*)[a-z0-9-]+\b/g, "")
    .replace(/(\b\d{5})-\d{4}\b/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
  return address ? `address:${address}` : `coord:${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`;
}

export function clusterGeographicCustomers(customers: GeographicCustomer[]): CustomerLocationCluster[] {
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
    return { key, latitude: location.latitude, longitude: location.longitude, x: location.x, y: location.y, outsideAtlas: location.outOfBounds, canonicalAddress: location.canonicalAddress, customers: members, total: members.length, ...counts };
  });
}

export function clustersAsGoogleEntities(clusters: CustomerLocationCluster[], onSelect: (cluster: CustomerLocationCluster) => void): GeographicEntity[] {
  return clusters.map(cluster => ({ id: `customer-cluster:${cluster.key}`, latitude: cluster.latitude, longitude: cluster.longitude, label: cluster.total === 1 ? cluster.customers[0]!.displayName : `${cluster.total} customers`, kind: "customer", onSelect: () => onSelect(cluster) }));
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
    groupOf.set(
      cluster.key,
      near ? groupOf.get(near.key)! : nextGroup++
    );
  }
  const takenPerGroup = new Map<number, number>();
  return ordered.map(cluster => {
    const group = groupOf.get(cluster.key)!;
    const used = takenPerGroup.get(group) ?? 0;
    takenPerGroup.set(group, used + 1);
    return { cluster, fanSlot: used % ATLAS_FAN_SLOTS };
  });
}
