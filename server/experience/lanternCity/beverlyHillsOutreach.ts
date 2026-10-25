import { and, eq, ne } from "drizzle-orm";
import { beverlyHillsOutreach, orders } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { loadBeverlyHillsProspects } from "./beverlyHillsProspects";
import {
  addressKey,
  apartmentProspect,
  BEVERLY_HANGER_ID,
  laDate,
  plotsFromOrders,
  validateReview,
  type OutreachRecord,
  type OutreachSubmission,
} from "../../../shared/beverlyHillsOutreach";
async function database() {
  const db = await getDb();
  if (!db)
    throw new Error("The outreach ledger is unavailable. No report was saved.");
  return db;
}
export async function loadBeverlyOutreach(
  tenantId: string,
  operatorId: string,
  canReview: boolean
) {
  const db = await database();
  const prospects = await loadBeverlyHillsProspects(tenantId);
  const buildings = prospects.prospects.filter(apartmentProspect);
  const records = await db
    .select()
    .from(beverlyHillsOutreach)
    .where(eq(beverlyHillsOutreach.tenantId, tenantId));
  // Separate read model: each non-cancelled order's exact recorded address and the date it was placed (its
  // creation time, not its pickup date). No campaign attribution, no invented conversions.
  const orderRows = await db
    .select({ address: orders.address, createdAt: orders.createdAt })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), ne(orders.status, "cancelled")));
  const byAddress = new Map<string, number>();
  for (const row of orderRows) byAddress.set(addressKey(row.address), (byAddress.get(addressKey(row.address)) ?? 0) + 1);
  return {
    tenantId,
    operatorId,
    canReview,
    brandName: prospects.brandName,
    readable: prospects.readable,
    buildings: buildings.map(p => ({
      ...p,
      recordedOrders: byAddress.get(addressKey(p.address!)) ?? 0,
    })),
    records: records as OutreachRecord[],
    restoredPlots: plotsFromOrders(
      records as OutreachRecord[],
      orderRows.map(row => ({ address: row.address, placedOn: laDate(row.createdAt) }))
    ),
    hangerId: BEVERLY_HANGER_ID,
  };
}
export async function submitBeverlyOutreach(
  tenantId: string,
  operatorId: string,
  input: OutreachSubmission
) {
  if (tenantId !== "laundry_farm")
    throw new Error("Select Laundry Farm to record this mission.");
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Los_Angeles",
  });
  if (
    input.performedOn > today ||
    Number.isNaN(Date.parse(input.performedOn)) ||
    new Date(input.performedOn).toISOString().slice(0, 10) !== input.performedOn
  )
    throw new Error("Choose a valid activity date, no later than today.");
  const db = await database();
  const source = await loadBeverlyHillsProspects(tenantId);
  const p = source.prospects.find(
    p => p.id === input.prospectId && apartmentProspect(p)
  );
  if (!source.readable || !p?.address)
    throw new Error(
      "Choose a current apartment building from this business’s records."
    );
  const existing = await db
    .select()
    .from(beverlyHillsOutreach)
    .where(
      and(
        eq(beverlyHillsOutreach.tenantId, tenantId),
        eq(beverlyHillsOutreach.id, input.requestId)
      )
    );
  if (existing.length) {
    if (existing[0].operatorId !== operatorId)
      throw new Error("Report identifier already in use.");
    return { ok: true as const };
  }
  await db
    .insert(beverlyHillsOutreach)
    .values({
      id: input.requestId,
      tenantId,
      operatorId,
      prospectId: p.id,
      address: p.address,
      performedOn: input.performedOn,
      hangerId: BEVERLY_HANGER_ID,
      count: input.count,
      permission: input.permission,
      evidenceUrl: input.evidenceUrl,
      notes: input.notes,
      status: "submitted",
    })
    .onDuplicateKeyUpdate({ set: { id: input.requestId } });
  return { ok: true as const };
}
export async function reviewBeverlyOutreach(
  tenantId: string,
  reviewerId: string,
  input: { id: string; decision: "verified" | "rejected"; note: string }
) {
  const db = await database();
  const where = and(
    eq(beverlyHillsOutreach.tenantId, tenantId),
    eq(beverlyHillsOutreach.id, input.id)
  );
  const [record] = await db.select().from(beverlyHillsOutreach).where(where);
  if (!record) throw new Error("Report not found.");
  validateReview(record as OutreachRecord, reviewerId);
  await db
    .update(beverlyHillsOutreach)
    .set({
      status: input.decision,
      reviewerId,
      reviewNote: input.note,
      reviewedAt: new Date(),
    })
    .where(and(where, eq(beverlyHillsOutreach.status, "submitted")));
  return { ok: true as const };
}
