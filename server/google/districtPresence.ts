import { eq } from "drizzle-orm";
import { entityLocations } from "../../drizzle/schema";
import { getDb } from "../db";
import { getDashboardTimeZone, zonedYmd } from "../dashboardZoned";
import { loadCustomerGroups, projectGeographicCustomers } from "../geography/customerOrderTruth";
import { computeRecencyStatus } from "../../shared/customerStatus";
import { STRATEGIC_DISTRICT_CIRCLES, type DistrictPresence } from "./googlePlacesAggregateService";

export type PresenceCustomer = {
  totalOrders: number;
  firstOrderAt: string;
  lastOrderAt: string;
  location: { latitude: number; longitude: number } | null;
};

const EARTH_RADIUS_M = 6_371_000;
function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Active customers (recency "new" or "active", shared/customerStatus.ts) counted inside each district's circle,
 * the same circles Google counts buildings in. A customer without a geocoded location counts nowhere; circles
 * overlap, as the building counts do, so a customer on a boundary counts in both.
 */
export function countPresenceByDistrict(customers: readonly PresenceCustomer[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(STRATEGIC_DISTRICT_CIRCLES.map(d => [d.districtId, 0]));
  for (const customer of customers) {
    if (!customer.location) continue;
    const recency = computeRecencyStatus({
      totalOrders: customer.totalOrders,
      firstOrderAt: new Date(customer.firstOrderAt),
      lastOrderAt: new Date(customer.lastOrderAt),
    });
    if (recency !== "new" && recency !== "active") continue;
    const at = { lat: customer.location.latitude, lng: customer.location.longitude };
    for (const district of STRATEGIC_DISTRICT_CIRCLES) {
      if (metresBetween(at, { lat: district.lat, lng: district.lng }) <= district.radiusM) counts[district.districtId] += 1;
    }
  }
  return counts;
}

/** The tenant's real customer presence per district, from its order history and geocoded locations; null when unreadable. */
export async function loadDistrictPresence(tenantId: string, now = new Date()): Promise<DistrictPresence> {
  try {
    const db = await getDb();
    if (!db) return null;
    const timeZone = getDashboardTimeZone();
    const [groups, locations] = await Promise.all([
      loadCustomerGroups(tenantId),
      db.select().from(entityLocations).where(eq(entityLocations.tenantId, tenantId)),
    ]);
    const customers = projectGeographicCustomers({
      groups,
      locationMap: new Map(locations.map(row => [`${row.entityType}:${row.entityKey}`, row])),
      timeZone,
      today: zonedYmd(now, timeZone),
    });
    return countPresenceByDistrict(customers);
  } catch (error) {
    console.warn("[DistrictPresence] customer presence unavailable:", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
