/**
 * Persistence and lifecycle for externally-managed operational work.
 *
 * Every write in this file touches `external_operational_orders` and nothing
 * else. It cannot create a native order, a payment, a customer, or revenue —
 * not by policy but by construction, because it never imports the `orders`
 * table or anything downstream of it.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { externalOperationalOrders } from "../../drizzle/schema";
import { getDb } from "../db";
import type {
  ExternalIngestionMethod,
  ExternalJobKind,
  ExternalOperationalOrder,
  ExternalSourceSystem,
  ExtractedExternalJob,
} from "../../shared/externalOperationalOrder";

let schemaReady: Promise<void> | null = null;

/**
 * Production-safe schema guard.
 *
 * This table was introduced by 0057_external_operational_orders.sql, but the
 * production app process does not run drizzle migrations on startup. A route
 * must not render an import UI that can only work after a separate operator
 * remembers to run a DB command. CREATE TABLE IF NOT EXISTS is idempotent and
 * keeps this truth-isolated table available without mutating native orders.
 */
async function ensureExternalOrdersSchema(
  database: Awaited<ReturnType<typeof getDb>>
): Promise<void> {
  if (!database) throw new Error("Database not available");
  if (!schemaReady) {
    schemaReady = database
      .execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS external_operational_orders (
          id varchar(36) NOT NULL,
          tenantId varchar(64) NOT NULL DEFAULT 'default',
          sourceSystem enum('cleancloud','manual_external') NOT NULL,
          ingestionMethod enum('screenshot','manual','voice') NOT NULL,
          externalOrderId varchar(191) NULL,
          jobKind enum('pickup','dropoff') NOT NULL,
          customerName varchar(191) NOT NULL,
          address varchar(512) NULL,
          scheduledDate varchar(10) NULL,
          windowStart varchar(5) NULL,
          windowEnd varchar(5) NULL,
          notes text NULL,
          operationalStatus enum('scheduled','completed','cancelled') NOT NULL DEFAULT 'scheduled',
          completedAt timestamp NULL,
          reconciliationStatus enum('update_required','reconciled') NOT NULL DEFAULT 'update_required',
          reconciledAt timestamp NULL,
          externalLastVerifiedAt timestamp NULL,
          reviewState enum('pending_review','confirmed','discarded') NOT NULL DEFAULT 'pending_review',
          importBatchId varchar(36) NULL,
          confirmedAt timestamp NULL,
          createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_external_order_day (tenantId, scheduledDate, reviewState),
          INDEX idx_external_order_batch (importBatchId),
          INDEX idx_external_order_reconciliation (tenantId, reconciliationStatus)
        )
      `))
      .then(() => undefined)
      .catch(error => {
        schemaReady = null;
        throw error;
      });
  }
  await schemaReady;
}

async function db() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  await ensureExternalOrdersSchema(database);
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
  if (!row) throw new Error("External order was not persisted");
  return view(row);
}

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
    filters.push(eq(externalOperationalOrders.scheduledDate, input.scheduledDate));
  }
  const rows = await database
    .select()
    .from(externalOperationalOrders)
    .where(and(...filters))
    .orderBy(desc(externalOperationalOrders.createdAt));
  return rows.map(view);
}

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
