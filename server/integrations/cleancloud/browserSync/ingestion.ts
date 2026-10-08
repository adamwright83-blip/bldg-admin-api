/* LEGACY DAYFORGE COMPATIBILITY: cleancloud browser sync ingestion foundation */
import { randomUUID, createHash } from "node:crypto";
import { salesSourceRevisions } from "../../../analytics/salesReconciliationStore";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../../../db";
import { findPhysicalEntityIdByAddress } from "../../../goldlineWorld/entityLookup";
import { enqueueEconomicSnapshot } from "./worldOutbox";
import { validatePayload, validateHistoricalPayload } from "./validation";
import { cleancloudImportBatches } from "../../../../drizzle/schema";
import {
  cleanCloudPaidOrderBusinessFields,
  upsertCleanCloudPaidOrderWith,
} from "../cleancloudPaidEvidence";
import {
  browserSyncBindings,
  browserSyncReceipts,
  browserSyncAttempts,
} from "./schema";
import {
  assimilateImportedCustomerTruth,
  type CustomerTruthAssimilation,
} from "./assimilateCustomerTruth";
import type { GumballAssimilationStatus } from "./gumballOperatorStatus";

export type CleanCloudIngestionInput = {
  tenantId: string;
  actorId: string;
  bindingId?: string;
  storeId: string;
  storeLabel: string;
  requestId: string;
  from: string;
  to: string;
  exportUrl: string;
  csv: string;
  reportType?: "orders_sales" | "orders_revenue";
  sourcePrefix?: string;
};

export type CleanCloudIngestionResult = Record<string, unknown> & {
  requestId: string;
  tenantId: string;
  storeId: string;
  storeLabel: string;
  reportType: "orders_sales" | "orders_revenue";
  completedAt: string;
  batchId: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  totalRows: number;
  importCommitted: boolean;
};

function summarizeOrders(
  rows: Array<{
    buildingSlug?: string | null;
    paymentDateUtc?: Date | null;
    paidDateUtc?: Date | null;
    totalCents?: number | null;
    paid?: boolean | null;
    buildingResolutionStatus?: string | null;
  }>
) {
  const aggregates = new Map<
    string,
    { building: string; paymentDate: string; orders: number; cents: number }
  >();
  let unresolved = 0;
  for (const r of rows) {
    if (r.buildingResolutionStatus === "unresolved_needs_mapping") unresolved++;
    if (!r.paid) continue;
    const date = (r.paymentDateUtc || r.paidDateUtc)?.toISOString().slice(0, 10) ?? "unknown";
    const b = r.buildingSlug || "unknown";
    const key = `${b}|${date}`;
    const cur = aggregates.get(key) || {
      building: b,
      paymentDate: date,
      orders: 0,
      cents: 0,
    };
    cur.orders++;
    cur.cents += r.totalCents ?? 0;
    aggregates.set(key, cur);
  }
  return {
    unresolved,
    byBuildingAndPaymentDate: [...aggregates.values()],
  };
}

function operatorLineFromReceipt(receipt: Record<string, unknown>): string {
  const inserted = Number(receipt.inserted ?? 0);
  const updated = Number(receipt.updated ?? 0);
  const unchanged = Number(receipt.unchanged ?? 0);
  const unresolved = Number(receipt.unresolved ?? 0);
  return `${inserted} new · ${updated} updated · ${unchanged} unchanged · ${unresolved} unresolved building associations. Totals below describe this report, not additional revenue from this sync.`;
}

function assimilationReceiptFields(
  assimilation: CustomerTruthAssimilation
): Record<string, unknown> {
  return {
    customerTruth: assimilation.customerTruth,
    map: assimilation.map,
    customerCount: assimilation.customerCount,
    unresolvedGeographyCount: assimilation.unresolvedGeographyCount,
    outboxDrained: assimilation.outboxDrained,
    ...(assimilation.error ? { assimilationError: assimilation.error } : {}),
  };
}

export async function recordSyncAttempt(input: {
  tenantId: string;
  requestId?: string | null;
  outcome: string;
  message?: string | null;
  from?: string | null;
  to?: string | null;
  rowCount?: number | null;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(browserSyncAttempts).values({
      id: randomUUID(),
      tenantId: input.tenantId,
      requestId: input.requestId ?? null,
      outcome: input.outcome.slice(0, 32),
      message: input.message ? input.message.slice(0, 512) : null,
      rangeFrom: input.from ?? null,
      rangeTo: input.to ?? null,
      rowCount: input.rowCount ?? null,
    });
  } catch (error) {
    console.warn(
      "[CleanCloudSync] attempt log unavailable",
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Atomic ingestion pipeline for CleanCloud CSV data.
 * Validates payload, checks/locks binding, upserts orders, enqueues economic snapshots,
 * bridges to Persistent Growth Operator, and assimilates customer truth.
 */
export async function executeCleanCloudIngestion(
  input: CleanCloudIngestionInput,
  options?: { trustedLocalHistoricalImport: true }
): Promise<CleanCloudIngestionResult> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Database unavailable.",
    });
  }

  const reportType = input.reportType ?? "orders_sales";
  const sourcePrefix = input.sourcePrefix ?? "browser";

  // 1. Validate payload
  const { normalized, digest } = (
    options?.trustedLocalHistoricalImport
      ? validateHistoricalPayload
      : validatePayload)(
    {
      csv: input.csv,
      exportUrl: input.exportUrl,
      from: input.from,
      to: input.to,
      storeId: input.storeId,
      reportType,
    },
    input.tenantId
  );

  // 2. Resolve physical entity IDs for addresses
  const physicalIds = new Map<string, string | null>();
  const addressPhysicalIds = new Map<string, string | null>();
  for (const row of normalized) {
    if (row.buildingResolutionStatus !== "resolved" || !row.address) {
    physicalIds.set(
      row.cleancloudOrderId,
      null);
      continue;
    }
    if (!addressPhysicalIds.has(row.address))
      addressPhysicalIds.set(
        row.address,
        await findPhysicalEntityIdByAddress({
            tenantId: input.tenantId,
            address: row.address,
          })
        );
    physicalIds.set(
      row.cleancloudOrderId,
      addressPhysicalIds.get(row.address) ?? null
    );
  }

  const paidToBridge: Array<{
    cleancloudOrderId: string;
    cleancloudCustomerId?: string | null;
    customerEmail?: string | null;
    customerPhone?: string | null;
    totalCents: number;
    paidAt: Date;
  }> = [];

  // 3. Database transaction for atomic import
  const committed = await db.transaction(async tx => {
    const [binding] = await tx
      .select()
      .from(browserSyncBindings)
      .where(eq(browserSyncBindings.tenantId, input.tenantId))
      .for("update");

    if (
      !binding ||
      (input.bindingId && binding.id !== input.bindingId) ||
      binding.storeId !== input.storeId ||
      binding.storeLabel !== input.storeLabel
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Source binding does not match. Reconnect.",
      });
    }

    const [prior] = await tx
      .select()
      .from(browserSyncReceipts)
      .where(
        and(
          eq(browserSyncReceipts.tenantId, input.tenantId),
          eq(browserSyncReceipts.requestId, input.requestId)
        )
      );

    if (prior) {
      if (prior.digest !== digest) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Retry payload differs from the original request.",
        });
      }
      return prior.receiptJson as CleanCloudIngestionResult;
    }

    const sourceFileName = `${sourcePrefix}-${input.storeId}-${input.from}-${input.to}-${input.requestId}.csv`;
    const [batch] = await tx
      .insert(cleancloudImportBatches)
      .values({
        tenantId: input.tenantId,
        source: `cleancloud_${reportType}`,
        sourceFileName,
        importStatus: "completed",
      })
      .$returningId();

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const row of normalized) {
      const values = { ...row, importBatchId: batch.id, sourceFileName };
      const fingerprint = createHash("sha256")
        .update(cleanCloudPaidOrderBusinessFields(row))
        .digest("hex");
      await tx
        .insert(salesSourceRevisions)
        .values({
          tenantId: input.tenantId,
          orderId: row.cleancloudOrderId,
          reportType,
          fingerprint,
          importBatchId: batch.id,
          amounts: {
            paid: row.paid,
            netCents: row.totalCents,
            subtotalCents: row.subtotalCents,
            discountCents: row.discountCents,
            creditCents: row.creditCents,
          },
          dates: {
            placedAt: row.placedAtUtc?.toISOString() ?? null,
            paymentAt:
              row.paymentDateUtc?.toISOString() ??
              row.paidDateUtc?.toISOString() ??
              null,
          },
        })
        .onDuplicateKeyUpdate({ set: { fingerprint } });
      await enqueueEconomicSnapshot(
        tx,
        values,
        physicalIds.get(row.cleancloudOrderId) ?? null
      );

      if (row.paid && (row.totalCents ?? 0) > 0) {
        paidToBridge.push({
          cleancloudOrderId: String(row.cleancloudOrderId),
          cleancloudCustomerId:
            row.cleancloudCustomerId != null
              ? String(row.cleancloudCustomerId)
              : null,
          customerEmail: row.customerEmail ?? null,
          customerPhone: row.customerPhone ?? null,
          totalCents: row.totalCents ?? 0,
          paidAt:
            row.paymentDateUtc ||
            row.paidDateUtc ||
            row.placedAtUtc ||
            new Date(),
        });
      }

      const write = await upsertCleanCloudPaidOrderWith(tx, {
        values,
        existingMode: "skip_unchanged",
      });
      if (write === "inserted") inserted++;
      else if (write === "updated") updated++;
      else unchanged++;
    }

    const completedAt = new Date();
    const receipt: CleanCloudIngestionResult = {
      requestId: input.requestId,
      tenantId: input.tenantId,
      storeId: input.storeId,
      storeLabel: input.storeLabel,
      actorId: input.actorId,
      digest,
      from: input.from,
      to: input.to,
      reportType,
      sourceEvidenceKind: options?.trustedLocalHistoricalImport
        ? "operator_supplied_historical_export"
        : "observed_export",
      completedAt: completedAt.toISOString(),
      batchId: batch.id,
      inserted,
      updated,
      unchanged,
      skipped: 0,
      totalRows: normalized.length,
      uniqueOrderCount: new Set(normalized.map(row => row.cleancloudOrderId))
        .size,
      sourceDateCoverage: {
        earliest:
          normalized
            .map(row => row.placedAtUtc?.toISOString())
            .filter(Boolean)
            .sort()[0] ?? null,
        latest:
          normalized
            .map(row => row.placedAtUtc?.toISOString())
            .filter(Boolean)
            .sort()
            .at(-1) ?? null,
      },
      importCommitted: true,
      ...summarizeOrders(normalized),
      scope:
        "Orders created in the selected report period; totals use actual payment dates. Older orders and later corrections outside this window are not covered.",
    };

    await tx
      .update(cleancloudImportBatches)
      .set({
        importedRowCount: inserted + updated,
        duplicateRowCount: unchanged,
      })
      .where(eq(cleancloudImportBatches.id, batch.id));

    await tx.insert(browserSyncReceipts).values({
      id: randomUUID(),
      tenantId: input.tenantId,
      requestId: input.requestId,
      digest,
      storeId: input.storeId,
      importBatchId: batch.id,
      receiptJson: receipt,
    });

    await tx
      .update(browserSyncBindings)
      .set({ lastSuccessAt: completedAt })
      .where(eq(browserSyncBindings.tenantId, input.tenantId));

    return receipt;
  });

  // 4. Bridge paid orders to Persistent Growth Operator ledger
  if (paidToBridge.length > 0) {
    try {
      const { bridgeCleanCloudPaidOrder } = await import(
        "../../../agents/persistentOperator/fieldEventBridge"
      );
      for (const order of paidToBridge) {
        await bridgeCleanCloudPaidOrder({
          tenantId: input.tenantId,
          cleancloudOrderId: String(order.cleancloudOrderId),
          cleancloudCustomerId:
            order.cleancloudCustomerId != null
              ? String(order.cleancloudCustomerId)
              : undefined,
          customerEmail: order.customerEmail ?? undefined,
          customerPhone: order.customerPhone ?? undefined,
          paid: true,
          totalCents: order.totalCents,
          paidDateUtc: order.paidAt,
          sourceFileName: `${sourcePrefix}_sync:${input.requestId}`,
        }).catch((err: unknown) => {
          console.warn(
            "[CleanCloudSync] order bridge deferred",
            err instanceof Error ? err.message : err
          );
        });
      }
    } catch (err) {
      console.warn(
        "[CleanCloudSync] failed to load fieldEventBridge",
        err instanceof Error ? err.message : err
      );
    }
  }

  // 5. Downstream customer truth & geography assimilation (Jawbreaker)
  let assimilation: CustomerTruthAssimilation;
  try {
    assimilation = await assimilateImportedCustomerTruth(input.tenantId);
  } catch (error) {
    assimilation = {
      customerTruth: "failed",
      map: "pending",
      customerCount: null,
      unresolvedGeographyCount: null,
      outboxDrained: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const finalReceipt: CleanCloudIngestionResult = {
    ...committed,
    ...assimilationReceiptFields(assimilation),
    operatorStatusLine: operatorLineFromReceipt({
      ...committed,
      ...assimilationReceiptFields(assimilation),
    }),
  };

  await db
    .update(browserSyncReceipts)
    .set({ receiptJson: finalReceipt })
    .where(
      and(
        eq(browserSyncReceipts.tenantId, input.tenantId),
        eq(browserSyncReceipts.requestId, input.requestId)
      )
    );

  // 6. Record attempt evidence in cleancloud_browser_sync_attempts
  await recordSyncAttempt({
    tenantId: input.tenantId,
    requestId: input.requestId,
    outcome: committed.completedAt ? "imported" : "replayed",
    from: input.from,
    to: input.to,
    rowCount:
      Number(finalReceipt.totalRows ?? 0) ||
      Number(finalReceipt.inserted ?? 0) + Number(finalReceipt.updated ?? 0),
  });

  return finalReceipt;
}
