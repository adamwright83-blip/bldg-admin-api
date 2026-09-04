/**
 * The city's view of its customers.
 *
 * Assembles what Lantern City needs to light its windows: every scored customer,
 * bound to a canonical building through the order they last placed, carrying the
 * evidence the client projects into vitality.
 *
 * WHY THIS DOES NOT REUSE `getChurnScanResult`
 *
 * `snapshotResponse` deliberately does not expose `lastOrderId` — the admin
 * console has no use for it and the masked shape is the right public contract.
 * But `lastOrderId` is the only join key to a building, so this reads the
 * snapshots directly rather than widening a response shape other callers rely
 * on.
 *
 * WHY IT RETURNS EVIDENCE AND NOT APPEARANCE
 *
 * No vitality is computed here. The server returns counts and timestamps; the
 * client projects them (`lanternVitality.ts`). That split exists because the
 * outreach ribbon expires on a wall clock — a page left open must dim itself
 * without asking the server again, which it can only do if it holds the
 * timestamps rather than a rendered verdict.
 */
import { desc, eq, inArray } from "drizzle-orm";
import {
  customerChurnScans,
  customerChurnSnapshots,
  customerRecoveryInterventions,
  orders,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { BUILDINGS } from "@shared/buildings";
import {
  bindCustomerToBuilding,
  describeUnresolved,
  summarizeBindings,
  type CustomerBinding,
  type UnresolvedReason,
} from "./customerBuildingBinding";
import { refreshCustomerRecoveryAttribution } from "./customerChurnService";

export type LanternCityCustomer = {
  customerId: string;
  customerName: string;
  activeOrderCount: number | null;
  score: number | null;
  daysSinceLastOrder: number | null;
  /** ISO, or null. The client turns this into a ribbon expiry. */
  contactedAt: string | null;
  /** "Last order at Opus Los Angeles" — evidence, never residence. */
  evidenceLabel: string;
};

export type LanternCityBuilding = {
  buildingId: string;
  buildingName: string;
  customers: LanternCityCustomer[];
};

export type LanternCityVitality = {
  scanId: string | null;
  buildings: LanternCityBuilding[];
  unresolved: {
    count: number;
    byReason: Record<UnresolvedReason, number>;
    /** Plain-language tally, or null when everyone was placed. */
    label: string | null;
  };
};

const EMPTY_UNRESOLVED: Record<UnresolvedReason, number> = {
  no_last_order: 0,
  order_not_found: 0,
  no_building_evidence: 0,
  conflicting_evidence: 0,
};

export async function getLanternCityVitality(
  tenantId: string
): Promise<LanternCityVitality> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  /*
    Refresh attribution FIRST. A customer who has genuinely reordered since the
    last look must stop showing as merely contacted — without this the city
    would keep a stale ribbon and a stale quiet window indefinitely. This is the
    same side effect `listRecoveryInterventions` relies on, called explicitly
    because we do not need the hundred detail queries that come with it.
  */
  await refreshCustomerRecoveryAttribution(tenantId);

  const scanRows = await db
    .select({ id: customerChurnScans.id })
    .from(customerChurnScans)
    .where(eq(customerChurnScans.tenantId, tenantId))
    .orderBy(desc(customerChurnScans.createdAt))
    .limit(1);
  const scanId = scanRows[0]?.id ?? null;
  if (!scanId) {
    return {
      scanId: null,
      buildings: [],
      unresolved: { count: 0, byReason: { ...EMPTY_UNRESOLVED }, label: null },
    };
  }

  const snapshots = await db
    .select({
      id: customerChurnSnapshots.id,
      customerKeyHash: customerChurnSnapshots.customerKeyHash,
      customerName: customerChurnSnapshots.customerName,
      score: customerChurnSnapshots.score,
      activeOrderCount: customerChurnSnapshots.activeOrderCount,
      daysSinceLastOrder: customerChurnSnapshots.daysSinceLastOrder,
      lastOrderId: customerChurnSnapshots.lastOrderId,
    })
    .from(customerChurnSnapshots)
    .where(eq(customerChurnSnapshots.scanId, scanId));

  // The orders these customers were last served on — the only building evidence
  // the snapshot carries.
  const orderIds = snapshots
    .map(row => row.lastOrderId)
    .filter((id): id is number => typeof id === "number");
  const orderRows = orderIds.length
    ? await db
        .select({
          id: orders.id,
          address: orders.address,
          buildingSlug: orders.buildingSlug,
        })
        .from(orders)
        .where(inArray(orders.id, orderIds))
    : [];
  const ordersById = new Map(orderRows.map(row => [row.id, row]));

  /*
    Latest outreach per customer. Read straight from the interventions table
    rather than through the detail loader: the city needs one timestamp per
    customer, and `listRecoveryInterventions` would issue a detail query per row
    to assemble drafts and permissions the city never renders.
  */
  const interventionRows = await db
    .select({
      customerKeyHash: customerRecoveryInterventions.customerKeyHash,
      contactedAt: customerRecoveryInterventions.contactedAt,
    })
    .from(customerRecoveryInterventions)
    .where(eq(customerRecoveryInterventions.tenantId, tenantId));

  const contactedByCustomer = new Map<string, Date>();
  for (const row of interventionRows) {
    if (!row.contactedAt) continue;
    const existing = contactedByCustomer.get(row.customerKeyHash);
    // Most recent outreach wins — an older attempt must not shorten the ribbon
    // earned by a newer one.
    if (!existing || row.contactedAt > existing) {
      contactedByCustomer.set(row.customerKeyHash, row.contactedAt);
    }
  }

  const bindings: Array<{ customerId: string; binding: CustomerBinding }> = [];
  const customersByBuilding = new Map<string, LanternCityCustomer[]>();

  for (const snapshot of snapshots) {
    const binding = bindCustomerToBuilding({
      lastOrderId: snapshot.lastOrderId,
      order: snapshot.lastOrderId
        ? ordersById.get(snapshot.lastOrderId) ?? null
        : null,
    });
    bindings.push({ customerId: snapshot.id, binding });
    if (!binding.resolved) continue;

    const list = customersByBuilding.get(binding.buildingId) ?? [];
    list.push({
      customerId: snapshot.id,
      customerName: snapshot.customerName,
      activeOrderCount: snapshot.activeOrderCount,
      score: snapshot.score,
      daysSinceLastOrder: snapshot.daysSinceLastOrder,
      contactedAt:
        contactedByCustomer.get(snapshot.customerKeyHash)?.toISOString() ?? null,
      evidenceLabel: binding.evidenceLabel,
    });
    customersByBuilding.set(binding.buildingId, list);
  }

  const summary = summarizeBindings(bindings);

  /*
    Every canonical building is returned, including ones with no customers. A
    tower missing from this list would simply not render, which reads as "this
    place does not exist" rather than "nothing is happening here" — and the
    second is the true statement.
  */
  const buildings: LanternCityBuilding[] = BUILDINGS.map(building => ({
    buildingId: building.id,
    buildingName: building.name,
    customers: customersByBuilding.get(building.id) ?? [],
  }));

  return {
    scanId,
    buildings,
    unresolved: {
      count: summary.unresolvedCount,
      byReason: summary.unresolvedByReason,
      label: describeUnresolved(summary),
    },
  };
}
