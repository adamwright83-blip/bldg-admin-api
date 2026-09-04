import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  router,
  dayforgeTenantAdminProcedure,
  dayforgeTenantOperatorProcedure,
} from "../_core/trpc";
import { getDb } from "../db";
import {
  cleancloudPaidOrders,
  cleancloudImportBatches,
} from "../../drizzle/schema";
import { browserSyncBindings, browserSyncReceipts } from "./schema";
import { validatePayload, summarizeOrders } from "./validation";

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

export const cleancloudBrowserSyncRouter = router({
  context: dayforgeTenantOperatorProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const [binding] = await db
      .select()
      .from(browserSyncBindings)
      .where(eq(browserSyncBindings.tenantId, ctx.tenantId));
    return {
      tenantId: ctx.tenantId,
      actorId: ctx.user.openId,
      accountLabel: ctx.user.name || ctx.user.openId,
      binding: binding ?? null,
      protocolVersion: 1,
    };
  }),
  pair: dayforgeTenantAdminProcedure
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
  receipt: dayforgeTenantOperatorProcedure
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
  resolve: dayforgeTenantOperatorProcedure
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
  import: dayforgeTenantOperatorProcedure
    .input(importInput)
    .mutation(async ({ ctx, input }) => {
      assertAccount(ctx, input);
      // Validate ALL rows before any write. Existing CSV endpoint permits partial
      // imports; this transport deliberately requires an atomic, auditable result.
      const { normalized, digest } = validatePayload(input, ctx.tenantId);
      const db = await requireDb();
      return db.transaction(async tx => {
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
          const values = { ...row, importBatchId: batch.id, sourceFileName };
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
    }),
});
