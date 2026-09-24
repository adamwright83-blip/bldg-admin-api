/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  router,
  legacyDayforgeTenantAdminProcedure,
  legacyDayforgeTenantOperatorProcedure,
} from "../_core/trpc";
import { getDb } from "../db";
import {
  cleancloudPaidOrders,
  cleancloudImportBatches,
} from "../../drizzle/schema";
import { browserSyncAttempts, browserSyncBindings, browserSyncReceipts } from "./schema";
import { validatePayload, summarizeOrders } from "./validation";
import { enqueueEconomicSnapshot } from "./worldOutbox";
import { findPhysicalEntityIdByAddress } from "../goldlineWorld/entityLookup";
import {
  assimilateImportedCustomerTruth,
  assimilationReceiptFields,
  isCustomerTruthAssimilated,
  refreshImportedGeographyMap,
} from "./assimilateCustomerTruth";
import {
  asGumballAssimilationStatus,
  formatGumballOperatorStatus,
  gumballObservability,
} from "./gumballOperatorStatus";

const store = z.object({
  storeId: z.string().regex(/^[1-9]\d{0,15}$/),
  storeLabel: z.string().trim().min(1).max(255),
});
const account = z.object({
  tenantId: z.string().min(1).max(64),
  actorId: z.string().min(1).max(128),
});
const importInput = store.merge(account).extend({
  bindingId: z.string().uuid(),
  requestId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  exportUrl: z.string().max(2048),
  csv: z.string().min(1).max(4_000_000),
});
function assertAccount(
  ctx: { tenantId: string; user: { openId: string } },
  input: z.infer<typeof account>
) {
  if (ctx.tenantId !== input.tenantId || ctx.user.openId !== input.actorId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Goldline account changed. Reconnect.",
    });
}
async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Database unavailable.",
    });
  return db;
}

function operatorLineFromReceipt(receipt: Record<string, unknown>) {
  return formatGumballOperatorStatus({
    lastAttemptAt:
      typeof receipt.completedAt === "string" ? receipt.completedAt : null,
    lastAttemptOutcome: "imported",
    lastSuccessAt:
      typeof receipt.completedAt === "string" ? receipt.completedAt : null,
    storeLabel:
      typeof receipt.storeLabel === "string" ? receipt.storeLabel : null,
    rangeFrom: typeof receipt.from === "string" ? receipt.from : null,
    rangeTo: typeof receipt.to === "string" ? receipt.to : null,
    rowsParsed: Number(receipt.totalRows ?? 0),
    inserted: Number(receipt.inserted ?? 0),
    updated: Number(receipt.updated ?? 0),
    unchanged: Number(receipt.unchanged ?? 0),
    skipped: Number(receipt.skipped ?? 0),
    unresolvedBuildings: Number(receipt.unresolved ?? 0),
    unresolvedGeographyCount:
      receipt.unresolvedGeographyCount == null
        ? null
        : Number(receipt.unresolvedGeographyCount),
    customerTruth: asGumballAssimilationStatus(receipt.customerTruth),
    map: asGumballAssimilationStatus(receipt.map),
  });
}

const geographyRefreshInFlight = new Set<string>();

function scheduleImportedGeographyMapRefresh(
  tenantId: string,
  requestId: string
) {
  const key = `${tenantId}:${requestId}`;
  if (geographyRefreshInFlight.has(key)) return;
  geographyRefreshInFlight.add(key);
  void (async () => {
    try {
      const result = await refreshImportedGeographyMap(tenantId);
      const db = await getDb();
      if (!db) return;
      const [row] = await db
        .select()
        .from(browserSyncReceipts)
        .where(
          and(
            eq(browserSyncReceipts.tenantId, tenantId),
            eq(browserSyncReceipts.requestId, requestId)
          )
        );
      if (!row) return;
      const current = (row.receiptJson ?? {}) as Record<string, unknown>;
      if (current.status === "cancelled") return;
      const next = {
        ...current,
        map: result.map,
        assimilationError: result.error,
        operatorStatusLine: operatorLineFromReceipt({
          ...current,
          map: result.map,
          assimilationError: result.error,
        }),
      };
      await db
        .update(browserSyncReceipts)
        .set({ receiptJson: next })
        .where(
          and(
            eq(browserSyncReceipts.tenantId, tenantId),
            eq(browserSyncReceipts.requestId, requestId)
          )
        );
    } catch (error) {
      console.error("[gumball] geography map refresh deferred", error);
    } finally {
      geographyRefreshInFlight.delete(key);
    }
  })();
}

async function persistImportReceipt(
  tenantId: string,
  requestId: string,
  receipt: Record<string, unknown>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(browserSyncReceipts)
    .set({ receiptJson: receipt })
    .where(
      and(
        eq(browserSyncReceipts.tenantId, tenantId),
        eq(browserSyncReceipts.requestId, requestId)
      )
    );
}

async function completeImportDownstream(
  tenantId: string,
  receipt: Record<string, unknown>,
  requestId: string
) {
  if (receipt.status === "cancelled") return receipt;
  if (isCustomerTruthAssimilated(receipt)) {
    if (receipt.map === "pending") {
      scheduleImportedGeographyMapRefresh(tenantId, requestId);
    }
    return {
      ...receipt,
      importCommitted: true,
      operatorStatusLine:
        typeof receipt.operatorStatusLine === "string"
          ? receipt.operatorStatusLine
          : operatorLineFromReceipt(receipt),
    };
  }
  try {
    const assimilation = await assimilateImportedCustomerTruth(tenantId);
    const next = {
      ...receipt,
      ...assimilationReceiptFields(assimilation),
      operatorStatusLine: operatorLineFromReceipt({
        ...receipt,
        ...assimilationReceiptFields(assimilation),
      }),
    };
    await persistImportReceipt(tenantId, requestId, next);
    if (next.map === "pending") {
      scheduleImportedGeographyMapRefresh(tenantId, requestId);
    }
    return next;
  } catch (error) {
    const next = {
      ...receipt,
      importCommitted: true,
      customerTruth: "failed",
      map: "pending",
      assimilationError: error instanceof Error ? error.message : String(error),
      operatorStatusLine: operatorLineFromReceipt({
        ...receipt,
        customerTruth: "failed",
        map: "pending",
      }),
    };
    await persistImportReceipt(tenantId, requestId, next);
    return next;
  }
}
function businessFields(row: Record<string, unknown>) {
  const {
    id,
    importBatchId,
    sourceFileName,
    createdAt,
    updatedAt,
    ...business
  } = row;
  // Consistent key order and Date serialization across database and normalized rows.
  const canonical = (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)])
      );
    return value;
  };
  return JSON.stringify(canonical(business));
}

/**
 * Import-attempt evidence for "is GUMBALL working?". Best effort: logging an
 * attempt must never change the import's own result.
 */
async function recordAttempt(input: {
  tenantId: string;
  requestId?: string | null;
  outcome: string;
  message?: string | null;
  from?: string | null;
  to?: string | null;
  rowCount?: number | null;
}) {
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
    console.warn("[gumball] attempt log unavailable", error instanceof Error ? error.message : error);
  }
}

function attemptOutcome(error: unknown): string {
  if (error instanceof TRPCError) {
    if (error.code === "CONFLICT") return "conflict";
    if (error.code === "BAD_REQUEST") return "rejected";
    if (error.code === "FORBIDDEN") return "unpaired";
    if (error.code === "SERVICE_UNAVAILABLE") return "unavailable";
  }
  return "failed";
}

async function runRecordedImport<T>(
  ctx: { tenantId: string },
  input: { requestId: string; from: string; to: string },
  work: () => Promise<T>
): Promise<T> {
  try {
    const result = await work();
    const receipt = (result ?? {}) as Record<string, unknown>;
    await recordAttempt({
      tenantId: ctx.tenantId,
      requestId: input.requestId,
      outcome: receipt.completedAt ? "imported" : "replayed",
      from: input.from,
      to: input.to,
      rowCount:
        Number(receipt.totalRows ?? 0) ||
        Number(receipt.inserted ?? 0) + Number(receipt.updated ?? 0),
    });
    return result;
  } catch (error) {
    await recordAttempt({
      tenantId: ctx.tenantId,
      requestId: input.requestId,
      outcome: attemptOutcome(error),
      message: error instanceof Error ? error.message : String(error),
      from: input.from,
      to: input.to,
    });
    throw error;
  }
}

export const cleancloudBrowserSyncRouter = router({
  context: legacyDayforgeTenantOperatorProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const [binding] = await db
      .select()
      .from(browserSyncBindings)
      .where(eq(browserSyncBindings.tenantId, ctx.tenantId));
    const [latestAttempt] = await db
      .select()
      .from(browserSyncAttempts)
      .where(eq(browserSyncAttempts.tenantId, ctx.tenantId))
      .orderBy(desc(browserSyncAttempts.createdAt))
      .limit(1);
    const receipts = await db
      .select()
      .from(browserSyncReceipts)
      .where(eq(browserSyncReceipts.tenantId, ctx.tenantId))
      .orderBy(desc(browserSyncReceipts.createdAt))
      .limit(10);
    const imported = receipts.find(row => {
      const json = (row.receiptJson ?? {}) as Record<string, unknown>;
      return json.status !== "cancelled" && typeof json.completedAt === "string";
    });
    const receipt = (imported?.receiptJson ?? {}) as Record<string, unknown>;
    const observability = gumballObservability({
      lastAttemptAt: latestAttempt?.createdAt ?? null,
      lastAttemptOutcome: latestAttempt?.outcome ?? null,
      lastAttemptMessage: latestAttempt?.message ?? null,
      lastSuccessAt: binding?.lastSuccessAt ?? null,
      storeLabel: binding?.storeLabel ?? null,
      rangeFrom:
        typeof receipt.from === "string"
          ? receipt.from
          : latestAttempt?.rangeFrom ?? null,
      rangeTo:
        typeof receipt.to === "string"
          ? receipt.to
          : latestAttempt?.rangeTo ?? null,
      rowsParsed:
        receipt.totalRows == null ? latestAttempt?.rowCount ?? null : Number(receipt.totalRows),
      inserted: receipt.inserted == null ? null : Number(receipt.inserted),
      updated: receipt.updated == null ? null : Number(receipt.updated),
      unchanged: receipt.unchanged == null ? null : Number(receipt.unchanged),
      skipped: receipt.skipped == null ? null : Number(receipt.skipped),
      unresolvedBuildings:
        receipt.unresolved == null ? null : Number(receipt.unresolved),
      unresolvedGeographyCount:
        receipt.unresolvedGeographyCount == null
          ? null
          : Number(receipt.unresolvedGeographyCount),
      customerTruth: asGumballAssimilationStatus(receipt.customerTruth),
      map: asGumballAssimilationStatus(receipt.map),
    });
    return {
      tenantId: ctx.tenantId,
      actorId: ctx.user.openId,
      accountLabel: ctx.user.name || ctx.user.openId,
      binding: binding ?? null,
      protocolVersion: 1,
      observability,
    };
  }),
  pair: legacyDayforgeTenantAdminProcedure
    .input(store.merge(account))
    .mutation(async ({ ctx, input }) => {
      assertAccount(ctx, input);
      const db = await requireDb();
      // First pairing is explicit. Never silently reassign old order IDs to a new store.
      await db
        .insert(browserSyncBindings)
        .values({
          tenantId: ctx.tenantId,
          id: randomUUID(),
          storeId: input.storeId,
          storeLabel: input.storeLabel,
          createdBy: ctx.user.openId,
        })
        .onDuplicateKeyUpdate({ set: { tenantId: ctx.tenantId } });
      const [binding] = await db
        .select()
        .from(browserSyncBindings)
        .where(eq(browserSyncBindings.tenantId, ctx.tenantId));
      if (
        binding.storeId !== input.storeId ||
        binding.storeLabel !== input.storeLabel
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Tenant is paired to a different store. Administrator review is required.",
        });
      return binding;
    }),
  receipt: legacyDayforgeTenantOperatorProcedure
    .input(account.extend({ requestId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertAccount(ctx, input);
      const db = await requireDb();
      const [receipt] = await db
        .select()
        .from(browserSyncReceipts)
        .where(
          and(
            eq(browserSyncReceipts.tenantId, ctx.tenantId),
            eq(browserSyncReceipts.requestId, input.requestId)
          )
        );
      return { receipt: receipt?.receiptJson ?? null };
    }),
  resolve: legacyDayforgeTenantOperatorProcedure
    .input(account.extend({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      assertAccount(ctx, input);
      const db = await requireDb();
      return db.transaction(async tx => {
        // Wait for any committing import. If none committed, install a tombstone
        // before releasing the lock so even a delayed original request cannot run.
        const [binding] = await tx
          .select()
          .from(browserSyncBindings)
          .where(eq(browserSyncBindings.tenantId, ctx.tenantId))
          .for("update");
        if (!binding)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No source binding.",
          });
        const [prior] = await tx
          .select()
          .from(browserSyncReceipts)
          .where(
            and(
              eq(browserSyncReceipts.tenantId, ctx.tenantId),
              eq(browserSyncReceipts.requestId, input.requestId)
            )
          );
        if (prior) return { receipt: prior.receiptJson };
        const receipt = {
          requestId: input.requestId,
          status: "cancelled",
          tenantId: ctx.tenantId,
        };
        await tx
          .insert(browserSyncReceipts)
          .values({
            id: randomUUID(),
            tenantId: ctx.tenantId,
            requestId: input.requestId,
            digest: "cancelled",
            storeId: binding.storeId,
            importBatchId: 0,
            receiptJson: receipt,
          });
        return { receipt };
      });
    }),
  import: legacyDayforgeTenantOperatorProcedure
    .input(importInput)
    .mutation(({ ctx, input }) => runRecordedImport(ctx, input, async () => {
      assertAccount(ctx, input);
      // Validate ALL rows before any write. Existing CSV endpoint permits partial
      // imports; this transport deliberately requires an atomic, auditable result.
      const { normalized, digest } = validatePayload(input, ctx.tenantId);
      const db = await requireDb();
      const physicalIds = new Map<string, string | null>();
      for (const row of normalized) {
        physicalIds.set(row.cleancloudOrderId, row.buildingResolutionStatus === "resolved"
          ? await findPhysicalEntityIdByAddress({ tenantId: ctx.tenantId, address: row.address }) : null);
      }
      const committed = await db.transaction(async tx => {
        const [binding] = await tx
          .select()
          .from(browserSyncBindings)
          .where(eq(browserSyncBindings.tenantId, ctx.tenantId))
          .for("update");
        if (
          !binding ||
          binding.id !== input.bindingId ||
          binding.storeId !== input.storeId ||
          binding.storeLabel !== input.storeLabel
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Source binding does not match. Reconnect.",
          });
        const [prior] = await tx
          .select()
          .from(browserSyncReceipts)
          .where(
            and(
              eq(browserSyncReceipts.tenantId, ctx.tenantId),
              eq(browserSyncReceipts.requestId, input.requestId)
            )
          );
        if (prior) {
          if (prior.digest !== digest)
            throw new TRPCError({
              code: "CONFLICT",
              message: "Retry payload differs from the original request.",
            });
          return prior.receiptJson;
        }
        const sourceFileName = `browser-${input.storeId}-${input.from}-${input.to}-${input.requestId}.csv`;
        const [batch] = await tx
          .insert(cleancloudImportBatches)
          .values({
            tenantId: ctx.tenantId,
            source: "cleancloud_orders_sales",
            sourceFileName,
            importStatus: "completed",
          })
          .$returningId();
        let inserted = 0,
          updated = 0,
          unchanged = 0;
        for (const row of normalized) {
          const values = { ...row, importBatchId: batch.id, sourceFileName };
          await enqueueEconomicSnapshot(tx, values, physicalIds.get(row.cleancloudOrderId) ?? null);
          const [existing] = await tx
            .select()
            .from(cleancloudPaidOrders)
            .where(
              and(
                eq(cleancloudPaidOrders.tenantId, ctx.tenantId),
                eq(
                  cleancloudPaidOrders.cleancloudOrderId,
                  row.cleancloudOrderId
                ),
                eq(cleancloudPaidOrders.sourceReportType, "orders_sales")
              )
            )
            .for("update");
          if (existing && businessFields(existing) === businessFields(row)) {
            unchanged++;
            continue;
          }
          if (existing) {
            await tx
              .update(cleancloudPaidOrders)
              .set(values)
              .where(eq(cleancloudPaidOrders.id, existing.id));
            updated++;
          } else {
            await tx.insert(cleancloudPaidOrders).values(values);
            inserted++;
          }
        }
        const completedAt = new Date();
        const receipt = {
          requestId: input.requestId,
          tenantId: ctx.tenantId,
          storeId: input.storeId,
          storeLabel: input.storeLabel,
          actorId: ctx.user.openId,
          digest,
          from: input.from,
          to: input.to,
          reportType: "orders_sales",
          completedAt: completedAt.toISOString(),
          batchId: batch.id,
          inserted,
          updated,
          unchanged,
          skipped: 0,
          totalRows: normalized.length,
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
        await tx
          .insert(browserSyncReceipts)
          .values({
            id: randomUUID(),
            tenantId: ctx.tenantId,
            requestId: input.requestId,
            digest,
            storeId: input.storeId,
            importBatchId: batch.id,
            receiptJson: receipt,
          });
        await tx
          .update(browserSyncBindings)
          .set({ lastSuccessAt: completedAt })
          .where(eq(browserSyncBindings.tenantId, ctx.tenantId));
        return receipt;
      });
      return completeImportDownstream(
        ctx.tenantId,
        committed as Record<string, unknown>,
        input.requestId
      );
    })),
  /** The extension reports failures that happen before an import reaches Goldline. */
  reportFailure: legacyDayforgeTenantOperatorProcedure
    .input(
      account.extend({
        requestId: z.string().uuid().optional(),
        stage: z.string().trim().min(1).max(20).optional(),
        message: z.string().trim().min(1).max(500),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertAccount(ctx, input);
      await recordAttempt({
        tenantId: ctx.tenantId,
        requestId: input.requestId ?? null,
        outcome: `extension_${input.stage ?? "failed"}`,
        message: input.message,
        from: input.from ?? null,
        to: input.to ?? null,
      });
      return { recorded: true as const };
    }),
});
