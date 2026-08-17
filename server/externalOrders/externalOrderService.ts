/**
 * Persistence and lifecycle for externally-managed operational work.
 *
 * Every write in this file touches `external_operational_orders` and nothing
 * else. It cannot create a native order, a payment, a customer, or revenue —
 * not by policy but by construction, because it never imports the `orders`
 * table or anything downstream of it.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { externalOperationalOrders } from "../../drizzle/schema";
import { getDb } from "../db";
import type {
  ExternalIngestionMethod,
  ExternalJobKind,
  ExternalOperationalOrder,
  ExternalSourceSystem,
  ExtractedExternalJob,
} from "../../shared/externalOperationalOrder";

async function db() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

const iso = (value: Date | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

function view(
  row: typeof externalOperationalOrders.$inferSelect
): ExternalOperationalOrder {
  return {
    id: row.id,
    sourceSystem: row.sourceSystem as ExternalSourceSystem,
    ingestionMethod: row.ingestionMethod as ExternalIngestionMethod,
    externalOrderId: row.externalOrderId ?? null,
    jobKind: row.jobKind as ExternalJobKind,
    customerName: row.customerName,
    address: row.address ?? null,
    scheduledDate: row.scheduledDate ?? null,
    windowStart: row.windowStart ?? null,
    windowEnd: row.windowEnd ?? null,
    notes: row.notes ?? null,
    operationalStatus: row.operationalStatus,
    completedAt: iso(row.completedAt),
    reconciliationStatus: row.reconciliationStatus,
    reconciledAt: iso(row.reconciledAt),
    reviewState: row.reviewState,
    importBatchId: row.importBatchId ?? null,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
  };
}

/**
 * Persists a reviewed batch of screenshot-extracted jobs.
 *
 * The jobs written are the ones the OPERATOR confirmed, not the ones the model
 * proposed — the caller passes back the corrected list, so an edit made on the
 * review screen is what lands. Rows are written already `confirmed`, because
 * the human review that `pending_review` exists to gate has just happened.
 */
export async function confirmExternalImport(input: {
  tenantId: string;
  batchId: string;
  sourceSystem: ExternalSourceSystem;
  jobs: ExtractedExternalJob[];
}): Promise<ExternalOperationalOrder[]> {
  if (input.jobs.length === 0) return [];
  const database = await db();
  const now = new Date();
  const rows = input.jobs.map(job => ({
    id: randomUUID(),
    tenantId: input.tenantId,
    sourceSystem: input.sourceSystem,
    ingestionMethod: "screenshot" as const,
    externalOrderId: job.externalOrderId,
    jobKind: job.jobKind,
    customerName: job.customerName,
    address: job.address,
    scheduledDate: job.scheduledDate,
    windowStart: job.windowStart,
    windowEnd: job.windowEnd,
    notes: job.notes,
    reviewState: "confirmed" as const,
    importBatchId: input.batchId,
    confirmedAt: now,
  }));

  await database.insert(externalOperationalOrders).values(rows);
  const ids = rows.map(row => row.id);
  const stored = await database
    .select()
    .from(externalOperationalOrders)
    .where(inArray(externalOperationalOrders.id, ids));
  return stored.map(view);
}

/**
 * One job the operator entered by hand.
 *
 * A first-class path, not a fallback for failed OCR: customers who text, call,
 * or DM are legitimate work that never appears in any driver app screenshot.
 * It is written confirmed for the same reason as the import above — the person
 * typing it IS the review.
 */
export async function createManualExternalOrder(input: {
  tenantId: string;
  sourceSystem: ExternalSourceSystem;
  ingestionMethod: Extract<ExternalIngestionMethod, "manual" | "voice">;
  jobKind: ExternalJobKind;
  customerName: string;
  address: string | null;
  scheduledDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  notes: string | null;
  externalOrderId: string | null;
}): Promise<ExternalOperationalOrder> {
  const database = await db();
  const id = randomUUID();
  await database.insert(externalOperationalOrders).values({
    id,
    tenantId: input.tenantId,
    sourceSystem: input.sourceSystem,
    ingestionMethod: input.ingestionMethod,
    externalOrderId: input.externalOrderId,
    jobKind: input.jobKind,
    customerName: input.customerName.trim(),
    address: input.address,
    scheduledDate: input.scheduledDate,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    notes: input.notes,
    reviewState: "confirmed",
    confirmedAt: new Date(),
  });
  const [row] = await database
    .select()
    .from(externalOperationalOrders)
    .where(eq(externalOperationalOrders.id, id));
  return view(row);
}

/** Confirmed external work for a day, newest first. */
export async function listExternalOrders(input: {
  tenantId: string;
  scheduledDate?: string;
}): Promise<ExternalOperationalOrder[]> {
  const database = await db();
  const filters = [
    eq(externalOperationalOrders.tenantId, input.tenantId),
    eq(externalOperationalOrders.reviewState, "confirmed"),
  ];
  if (input.scheduledDate) {
    filters.push(
      eq(externalOperationalOrders.scheduledDate, input.scheduledDate)
    );
  }
  const rows = await database
    .select()
    .from(externalOperationalOrders)
    .where(and(...filters))
    .orderBy(desc(externalOperationalOrders.createdAt));
  return rows.map(view);
}

/**
 * The physical work is done.
 *
 * This is the ONLY thing SECURE CARGO may assert for an external job, and it
 * deliberately leaves `reconciliationStatus` at `update_required`. The bag is
 * in the car; CleanCloud has not been told, and this build cannot tell it.
 */
export async function completeExternalOrder(input: {
  tenantId: string;
  id: string;
}): Promise<ExternalOperationalOrder | null> {
  const database = await db();
  await database
    .update(externalOperationalOrders)
    .set({ operationalStatus: "completed", completedAt: new Date() })
    .where(
      and(
        eq(externalOperationalOrders.id, input.id),
        eq(externalOperationalOrders.tenantId, input.tenantId)
      )
    );
  const [row] = await database
    .select()
    .from(externalOperationalOrders)
    .where(eq(externalOperationalOrders.id, input.id));
  return row ? view(row) : null;
}

/**
 * The operator says they updated CleanCloud.
 *
 * Records a human's statement, which is the strongest claim available without
 * API access. It is called `reconciled` rather than `verified` precisely
 * because nothing here checked anything — see the note in
 * shared/externalOperationalOrder.ts.
 *
 * Refuses to mark work reconciled before it is physically complete: that
 * ordering would let the badge clear while the laundry was still in the shop.
 */
export async function reconcileExternalOrder(input: {
  tenantId: string;
  id: string;
}): Promise<ExternalOperationalOrder | null> {
  const database = await db();
  const [existing] = await database
    .select()
    .from(externalOperationalOrders)
    .where(
      and(
        eq(externalOperationalOrders.id, input.id),
        eq(externalOperationalOrders.tenantId, input.tenantId)
      )
    );
  if (!existing) return null;
  if (existing.operationalStatus !== "completed") return view(existing);

  await database
    .update(externalOperationalOrders)
    .set({
      reconciliationStatus: "reconciled",
      reconciledAt: new Date(),
      externalLastVerifiedAt: null,
    })
    .where(eq(externalOperationalOrders.id, input.id));
  const [row] = await database
    .select()
    .from(externalOperationalOrders)
    .where(eq(externalOperationalOrders.id, input.id));
  return row ? view(row) : null;
}
