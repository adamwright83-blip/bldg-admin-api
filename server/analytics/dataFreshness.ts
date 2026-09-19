import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  cleancloudImportBatches,
  cleancloudPaidOrders,
  clearentDailySummaries,
  clearentImportBatches,
  clearentTransactions,
  orders,
} from "../../drizzle/schema";
import { browserSyncAttempts, browserSyncBindings, browserSyncReceipts } from "../cleancloudBrowserSync/schema";
import { getDb } from "../db";
import { zonedDayStartUtc, zonedYmd } from "../dashboardZoned";

/**
 * Is the business data current? This separates EVENT time (when a sale
 * happened) from INGESTION time (when Goldline recorded it), and GUMBALL's
 * own evidence (paired store, successful receipts, recorded attempts) from
 * inference. Absence of new sales is never reported as a failed import, and a
 * missing attempt log is never reported as "GUMBALL ran fine".
 */

export type LatestSale = {
  orderNumber: string;
  customerName: string | null;
  cents: number;
  /** Payment (sale) time. */
  paidAt: string | null;
  placedAt: string | null;
  /** When Goldline first stored the row. Null for native orders (they originate here). */
  ingestedAt: string | null;
  paymentType: string | null;
  cardPaymentType: string | null;
};

export type GumballReceipt = {
  at: string;
  status: "imported" | "cancelled";
  inserted: number | null;
  updated: number | null;
  unchanged: number | null;
  totalRows?: number | null;
  skipped?: number | null;
  rangeFrom: string | null;
  rangeTo: string | null;
  batchId: number | null;
  customerTruth?: string | null;
  map?: string | null;
  operatorStatusLine?: string | null;
};

export type GumballAttempt = {
  at: string;
  outcome: string;
  message: string | null;
  rangeFrom: string | null;
  rangeTo: string | null;
};

export type DataFreshness = {
  checkedAt: string;
  timeZone: string;
  today: string;
  cleancloud: {
    latestSale: LatestSale | null;
    previousSale: LatestSale | null;
    latestIngestedAt: string | null;
    salesToday: number;
    rowsIngestedToday: number;
    latestBatch: { id: number; source: string; at: string; importedRows: number; duplicateRows: number; status: string } | null;
  };
  gumball: {
    paired: boolean;
    storeLabel: string | null;
    lastSuccessAt: string | null;
    receipts: GumballReceipt[];
    /** Null when the attempt log does not exist yet — then failures cannot be proven either way. */
    attempts: GumballAttempt[] | null;
  };
  native: { latestSale: LatestSale | null };
  clearent: {
    /** Clearent tables are platform-level; only the default tenant can claim them. */
    applicable: boolean;
    transactionCount: number;
    dailySummaryFirstDate: string | null;
    dailySummaryLastDate: string | null;
    latestImportAt: string | null;
  };
};

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function optional<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    console.warn("[Freshness] optional source unavailable", error instanceof Error ? error.message : error);
    return fallback;
  }
}

export async function loadDataFreshness(input: { tenantId: string; now?: Date; timeZone: string }): Promise<DataFreshness> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = input.now ?? new Date();
  const today = zonedYmd(now, input.timeZone);
  const startOfToday = zonedDayStartUtc(today, input.timeZone);

  const saleTime = sql<Date>`COALESCE(${cleancloudPaidOrders.paymentDateUtc}, ${cleancloudPaidOrders.paidDateUtc})`;
  const [ccLatest, ccIngested, ccToday, ccIngestedToday, batches, binding, receipts, attempts, nativeLatest, clearentTx, clearentDaily, clearentBatch] =
    await Promise.all([
      db
        .select({
          orderNumber: cleancloudPaidOrders.cleancloudOrderId,
          customerName: cleancloudPaidOrders.customerName,
          cents: cleancloudPaidOrders.totalCents,
          paidAt: saleTime,
          placedAt: cleancloudPaidOrders.placedAtUtc,
          ingestedAt: cleancloudPaidOrders.createdAt,
          paymentType: cleancloudPaidOrders.paymentType,
          cardPaymentType: cleancloudPaidOrders.cardPaymentType,
        })
        .from(cleancloudPaidOrders)
        .where(and(eq(cleancloudPaidOrders.tenantId, input.tenantId), eq(cleancloudPaidOrders.paid, true)))
        .orderBy(desc(saleTime), desc(cleancloudPaidOrders.id))
        .limit(8),
      db
        .select({ at: sql<Date>`MAX(${cleancloudPaidOrders.createdAt})` })
        .from(cleancloudPaidOrders)
        .where(eq(cleancloudPaidOrders.tenantId, input.tenantId)),
      db
        .select({ n: sql<number>`COUNT(DISTINCT ${cleancloudPaidOrders.cleancloudOrderId})` })
        .from(cleancloudPaidOrders)
        .where(and(eq(cleancloudPaidOrders.tenantId, input.tenantId), eq(cleancloudPaidOrders.paid, true), gte(saleTime, startOfToday))),
      db
        .select({ n: sql<number>`COUNT(*)` })
        .from(cleancloudPaidOrders)
        .where(and(eq(cleancloudPaidOrders.tenantId, input.tenantId), gte(cleancloudPaidOrders.createdAt, startOfToday))),
      db
        .select()
        .from(cleancloudImportBatches)
        .where(eq(cleancloudImportBatches.tenantId, input.tenantId))
        .orderBy(desc(cleancloudImportBatches.id))
        .limit(1),
      optional(
        () => db.select().from(browserSyncBindings).where(eq(browserSyncBindings.tenantId, input.tenantId)).limit(1),
        []
      ),
      optional(
        () =>
          db
            .select()
            .from(browserSyncReceipts)
            .where(eq(browserSyncReceipts.tenantId, input.tenantId))
            .orderBy(desc(browserSyncReceipts.createdAt))
            .limit(10),
        []
      ),
      optional<Array<typeof browserSyncAttempts.$inferSelect> | null>(
        () =>
          db
            .select()
            .from(browserSyncAttempts)
            .where(eq(browserSyncAttempts.tenantId, input.tenantId))
            .orderBy(desc(browserSyncAttempts.createdAt))
            .limit(10),
        null
      ),
      db
        .select({
          id: orders.id,
          firstName: orders.firstName,
          lastName: orders.lastName,
          total: orders.total,
          paidAt: orders.paidAt,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(
          and(
            sql`COALESCE(${orders.tenantId}, 'default') = ${input.tenantId}`,
            eq(orders.paid, true),
            sql`${orders.stripePaymentIntentId} IS NOT NULL`,
            sql`${orders.paidAt} IS NOT NULL`
          )
        )
        .orderBy(desc(orders.paidAt))
        .limit(1),
      input.tenantId === "default"
        ? optional(() => db.select({ n: sql<number>`COUNT(*)` }).from(clearentTransactions), [{ n: 0 }])
        : Promise.resolve([{ n: 0 }]),
      input.tenantId === "default"
        ? optional(
            () =>
              db
                .select({
                  first: sql<Date>`MIN(${clearentDailySummaries.reportDateUtc})`,
                  last: sql<Date>`MAX(${clearentDailySummaries.reportDateUtc})`,
                })
                .from(clearentDailySummaries),
            [{ first: null as unknown as Date, last: null as unknown as Date }]
          )
        : Promise.resolve([{ first: null as unknown as Date, last: null as unknown as Date }]),
      input.tenantId === "default"
        ? optional(
            () =>
              db
                .select({ at: clearentImportBatches.createdAt })
                .from(clearentImportBatches)
                .where(eq(clearentImportBatches.importStatus, "completed"))
                .orderBy(desc(clearentImportBatches.id))
                .limit(1),
            []
          )
        : Promise.resolve([]),
    ]);

  // One row per order (a Sales row and a Revenue row can share an order id).
  const uniqueSales: LatestSale[] = [];
  for (const row of ccLatest) {
    if (uniqueSales.some(sale => sale.orderNumber === row.orderNumber)) continue;
    uniqueSales.push({
      orderNumber: row.orderNumber,
      customerName: row.customerName,
      cents: Number(row.cents ?? 0),
      paidAt: iso(row.paidAt),
      placedAt: iso(row.placedAt),
      ingestedAt: iso(row.ingestedAt),
      paymentType: row.paymentType,
      cardPaymentType: row.cardPaymentType,
    });
  }
  const bound = binding[0] ?? null;
  const native = nativeLatest[0];
  const dateOnly = (value: Date | string | null | undefined, timeZone: string) => {
    const at = iso(value);
    return at ? zonedYmd(new Date(at), timeZone) : null;
  };
  return {
    checkedAt: now.toISOString(),
    timeZone: input.timeZone,
    today,
    cleancloud: {
      latestSale: uniqueSales[0] ?? null,
      previousSale: uniqueSales[1] ?? null,
      latestIngestedAt: iso(ccIngested[0]?.at),
      salesToday: Number(ccToday[0]?.n ?? 0),
      rowsIngestedToday: Number(ccIngestedToday[0]?.n ?? 0),
      latestBatch: batches[0]
        ? {
            id: batches[0].id,
            source: batches[0].source,
            at: batches[0].createdAt.toISOString(),
            importedRows: batches[0].importedRowCount,
            duplicateRows: batches[0].duplicateRowCount,
            status: batches[0].importStatus,
          }
        : null,
    },
    gumball: {
      paired: Boolean(bound),
      storeLabel: bound?.storeLabel ?? null,
      lastSuccessAt: iso(bound?.lastSuccessAt),
      receipts: receipts.map(row => {
        const receipt = (row.receiptJson ?? {}) as Record<string, unknown>;
        return {
          at: row.createdAt.toISOString(),
          status: receipt.status === "cancelled" ? "cancelled" : "imported",
          inserted: num(receipt.inserted),
          updated: num(receipt.updated),
          unchanged: num(receipt.unchanged),
          totalRows: num(receipt.totalRows),
          skipped: num(receipt.skipped),
          rangeFrom: typeof receipt.from === "string" ? receipt.from : null,
          rangeTo: typeof receipt.to === "string" ? receipt.to : null,
          batchId: row.importBatchId || null,
          customerTruth: typeof receipt.customerTruth === "string" ? receipt.customerTruth : null,
          map: typeof receipt.map === "string" ? receipt.map : null,
          operatorStatusLine:
            typeof receipt.operatorStatusLine === "string" ? receipt.operatorStatusLine : null,
        } satisfies GumballReceipt;
      }),
      attempts: attempts
        ? attempts.map(row => ({
            at: row.createdAt.toISOString(),
            outcome: row.outcome,
            message: row.message ?? null,
            rangeFrom: row.rangeFrom ?? null,
            rangeTo: row.rangeTo ?? null,
          }))
        : null,
    },
    native: {
      latestSale: native
        ? {
            orderNumber: String(native.id),
            customerName: `${native.firstName ?? ""} ${native.lastName ?? ""}`.trim() || null,
            cents: Math.round(Number(native.total ?? 0) * 100),
            paidAt: iso(native.paidAt),
            placedAt: iso(native.createdAt),
            ingestedAt: null,
            paymentType: "Stripe",
            cardPaymentType: null,
          }
        : null,
    },
    clearent: {
      applicable: input.tenantId === "default",
      transactionCount: Number(clearentTx[0]?.n ?? 0),
      dailySummaryFirstDate: dateOnly(clearentDaily[0]?.first, input.timeZone),
      dailySummaryLastDate: dateOnly(clearentDaily[0]?.last, input.timeZone),
      latestImportAt: iso(clearentBatch[0]?.at),
    },
  };
}
