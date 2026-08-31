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

function physicalKey(customer: GeographicCustomer): string {
  const location = customer.location!;
  const address = location.canonicalAddress?.toLowerCase().replace(/(?:\b(?:apt|unit|suite)\s*|#\s*)[a-z0-9-]+\b/g, "").replace(/\s+/g, " ").trim();
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
