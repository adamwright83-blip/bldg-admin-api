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
import { browserSyncAttempts, browserSyncBindings, browserSyncReceipts, dashboardWitnesses, dashboardWitnessScreenshots, economicReconciliations, verifiedEconomicEvents } from "./schema";
import { validatePayload, summarizeOrders } from "./validation";
import { witnessWrite } from "./dashboardWitness";
import {
  reconcileControlTotals,
  reconciliationEvidenceHash,
  verifiedEventsFromReconciliation,
  type PriorReconciliation,
  type WitnessControl,
} from "./reconcileEconomics";
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
import { assertPulseTenant, loadTenantOperatingPulse } from "./operatingPulse";
import { loadLatestCleanCloudSales } from "./latestSales";

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
  reportType: z.enum(["orders_sales", "orders_revenue"]).default("orders_sales"),
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

function isDuplicateKey(error: unknown): boolean {
  const value = error as { code?: string; errno?: number; message?: string } | null;
  return Boolean(
    value &&
      (value.code === "ER_DUP_ENTRY" ||
        value.errno === 1062 ||
        /duplicate entry/i.test(value.message ?? ""))
  );
}

function publicDashboardWitness(row: typeof dashboardWitnesses.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    storeId: row.storeId,
    storeLabel: row.storeLabel,
    rangeFrom: row.rangeFrom,
    rangeTo: row.rangeTo,
    comparisonFrom: row.comparisonFrom,
    comparisonTo: row.comparisonTo,
    salesCents: row.salesCents,
    comparisonSalesCents: row.comparisonSalesCents,
    revenueCents: row.revenueCents,
    comparisonRevenueCents: row.comparisonRevenueCents,
    orders: row.orders,
    comparisonOrders: row.comparisonOrders,
    newCustomers: row.newCustomers,
    observedAt: row.observedAt.toISOString(),
    screenshotSha256: row.screenshotSha256,
    extractionVersion: row.extractionVersion,
    source: row.source,
  };
}

function sameWitnessTotals(
  row: typeof dashboardWitnesses.$inferSelect,
  witness: {
    salesCents: number;
    revenueCents: number;
    orders: number;
    comparisonSalesCents: number | null;
    comparisonRevenueCents: number | null;
    comparisonOrders: number | null;
    newCustomers: number | null;
  }
) {
  return (
    row.salesCents === witness.salesCents &&
    row.revenueCents === witness.revenueCents &&
    row.orders === witness.orders &&
    row.comparisonSalesCents === witness.comparisonSalesCents &&
    row.comparisonRevenueCents === witness.comparisonRevenueCents &&
    row.comparisonOrders === witness.comparisonOrders &&
    row.newCustomers === witness.newCustomers
  );
}

function receiptCovers(
  receipts: { receiptJson: unknown }[],
  from: string,
  to: string,
  revenue: boolean
) {
  return receipts.some(row => {
    const json =
      row.receiptJson && typeof row.receiptJson === "object"
        ? (row.receiptJson as Record<string, unknown>)
        : null;
    if (!json || json.status === "cancelled") return false;
    if (typeof json.from !== "string" || typeof json.to !== "string") return false;
    if (json.from > from || json.to < to) return false;
    return revenue ? json.reportType === "orders_revenue" : json.reportType !== "orders_revenue";
  });
}

function publicEconomicEvent(row: typeof verifiedEconomicEvents.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    eventType: row.eventType,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    comparisonFrom: row.comparisonFrom,
    comparisonTo: row.comparisonTo,
    currentRevenueCents: row.currentRevenueCents,
    comparisonRevenueCents: row.comparisonRevenueCents,
    deltaCents: row.deltaCents,
    deltaPercentHundredths: row.deltaPercentHundredths,
    evidenceIds: Array.isArray(row.evidenceIdsJson)
      ? row.evidenceIdsJson.filter((id): id is string => typeof id === "string")
      : [],
    idempotencyKey: row.idempotencyKey,
    verifiedAt: row.verifiedAt.toISOString(),
  };
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
  operatingPulse: legacyDayforgeTenantOperatorProcedure.query(({ ctx }) =>
    loadTenantOperatingPulse(assertPulseTenant(ctx.tenantId))
  ),
  latestSales: legacyDayforgeTenantOperatorProcedure.query(({ ctx }) =>
    loadLatestCleanCloudSales({ tenantId: assertPulseTenant(ctx.tenantId) })
  ),
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
    .mutation(async ({ ctx, input }) => {
      assertAccount(ctx, input);
      const { executeCleanCloudIngestion } = await import("./ingestion");
      return executeCleanCloudIngestion({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        bindingId: input.bindingId,
        storeId: input.storeId,
        storeLabel: input.storeLabel,
        requestId: input.requestId,
        from: input.from,
        to: input.to,
        exportUrl: input.exportUrl,
        csv: input.csv,
        reportType: input.reportType,
        sourcePrefix: "browser",
      });
    }),
  /** Direct server-side sync using credentials configured in Railway */
  directSync: legacyDayforgeTenantOperatorProcedure
    .input(
      z
        .object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          reportTypes: z
            .array(z.enum(["orders_sales", "orders_revenue"]))
            .optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const { runCleanCloudDirectSync } = await import("./cleancloudDirectSync");
      return runCleanCloudDirectSync({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        from: input?.from,
        to: input?.to,
        reportTypes: input?.reportTypes,
      });
    }),
  /** Query direct sync availability and credentials status */
  directStatus: legacyDayforgeTenantOperatorProcedure.query(async ({ ctx }) => {
    const { isCleanCloudDirectConfigured } = await import(
      "./cleancloudDirectSync"
    );
    const db = await requireDb();
    const [binding] = await db
      .select()
      .from(browserSyncBindings)
      .where(eq(browserSyncBindings.tenantId, ctx.tenantId));
    return {
      configured: isCleanCloudDirectConfigured(),
      paired: !!binding,
      storeId: binding?.storeId ?? null,
      storeLabel: binding?.storeLabel ?? null,
      lastSuccessAt: binding?.lastSuccessAt ?? null,
    };
  }),
  /** Fine-grained stage heartbeat logging for browser automation observability */
  recordHeartbeat: legacyDayforgeTenantOperatorProcedure
    .input(
      account.extend({
        requestId: z.string().uuid().optional(),
        stage: z.string().trim().min(1).max(40),
        message: z.string().trim().max(500).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertAccount(ctx, input);
      const { recordSyncAttempt } = await import("./ingestion");
      await recordSyncAttempt({
        tenantId: ctx.tenantId,
        requestId: input.requestId ?? null,
        outcome: `extension_${input.stage}`,
        message: input.message ?? null,
        from: input.from ?? null,
        to: input.to ?? null,
      });
      return { recorded: true as const };
    }),
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
  recordWitness: legacyDayforgeTenantOperatorProcedure
    .input(
      account.extend({
        observedStoreLabel: z.string().trim().min(1).max(255),
        rangeFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        rangeTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        rangeText: z.string().trim().min(1).max(500),
        comparisonText: z.string().trim().min(1).max(500).nullable().optional(),
        fields: z
          .array(
            z.object({
              label: z.string().trim().min(1).max(80),
              valueText: z.string().trim().min(1).max(80),
            })
          )
          .max(40),
        screenshotBase64: z.string().regex(/^[A-Za-z0-9+/=\s]+$/).max(6_000_000),
        screenshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertAccount(ctx, input);
      const db = await requireDb();
      const [binding] = await db
        .select()
        .from(browserSyncBindings)
        .where(eq(browserSyncBindings.tenantId, ctx.tenantId));
      if (!binding) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No source binding." });
      }
      let screenshotBytes: Uint8Array;
      try {
        screenshotBytes = Buffer.from(input.screenshotBase64.replace(/\s/g, ""), "base64");
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The screenshot could not be read." });
      }
      const written = witnessWrite({
        tenantId: ctx.tenantId,
        storeId: binding.storeId,
        input: {
          expectedStoreLabel: binding.storeLabel,
          observedStoreLabel: input.observedStoreLabel,
          rangeFrom: input.rangeFrom,
          rangeTo: input.rangeTo,
          rangeText: input.rangeText,
          comparisonText: input.comparisonText ?? null,
          fields: input.fields,
          observedAt: new Date(),
          screenshotBytes,
          screenshotSha256: input.screenshotSha256,
        },
      });
      if (!written.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: written.reason });
      }
      const witness = written.write.witness;
      const existing = await db
        .select()
        .from(dashboardWitnesses)
        .where(
          and(
            eq(dashboardWitnesses.tenantId, ctx.tenantId),
            eq(dashboardWitnesses.storeId, binding.storeId),
            eq(dashboardWitnesses.rangeFrom, witness.rangeFrom),
            eq(dashboardWitnesses.rangeTo, witness.rangeTo),
            eq(dashboardWitnesses.screenshotSha256, witness.screenshotSha256)
          )
        )
        .limit(1);
      if (existing[0]) {
        if (!sameWitnessTotals(existing[0], witness)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This screenshot is already stored with different totals.",
          });
        }
        return { witness: publicDashboardWitness(existing[0]) };
      }
      const id = randomUUID();
      try {
        await db.transaction(async tx => {
          await tx.insert(dashboardWitnesses).values({
            id,
            tenantId: ctx.tenantId,
            storeId: binding.storeId,
            storeLabel: witness.storeLabel,
            rangeFrom: witness.rangeFrom,
            rangeTo: witness.rangeTo,
            comparisonFrom: witness.comparisonFrom,
            comparisonTo: witness.comparisonTo,
            salesCents: witness.salesCents,
            comparisonSalesCents: witness.comparisonSalesCents,
            revenueCents: witness.revenueCents,
            comparisonRevenueCents: witness.comparisonRevenueCents,
            orders: witness.orders,
            comparisonOrders: witness.comparisonOrders,
            newCustomers: witness.newCustomers,
            observedAt: new Date(witness.observedAt),
            screenshotSha256: witness.screenshotSha256,
            extractionVersion: witness.extractionVersion,
            source: witness.source,
          });
          await tx.insert(dashboardWitnessScreenshots).values({
            witnessId: id,
            tenantId: ctx.tenantId,
            sha256: witness.screenshotSha256,
            pngBase64: Buffer.from(screenshotBytes).toString("base64"),
          });
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        const [row] = await db
          .select()
          .from(dashboardWitnesses)
          .where(
            and(
              eq(dashboardWitnesses.tenantId, ctx.tenantId),
              eq(dashboardWitnesses.storeId, binding.storeId),
              eq(dashboardWitnesses.rangeFrom, witness.rangeFrom),
              eq(dashboardWitnesses.rangeTo, witness.rangeTo),
              eq(dashboardWitnesses.screenshotSha256, witness.screenshotSha256)
            )
          )
          .limit(1);
        if (!row || row.tenantId !== ctx.tenantId || !sameWitnessTotals(row, witness)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Witness race resolved to different totals or scope.",
          });
        }
        return { witness: publicDashboardWitness(row) };
      }
      const [row] = await db
        .select()
        .from(dashboardWitnesses)
        .where(and(eq(dashboardWitnesses.id, id), eq(dashboardWitnesses.tenantId, ctx.tenantId)));
      return { witness: publicDashboardWitness(row!) };
    }),
  latestDashboardWitness: legacyDayforgeTenantOperatorProcedure
    .input(
      z
        .object({
          rangeFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          rangeTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const filters = [eq(dashboardWitnesses.tenantId, ctx.tenantId)];
      if (input) {
        filters.push(eq(dashboardWitnesses.rangeFrom, input.rangeFrom));
        filters.push(eq(dashboardWitnesses.rangeTo, input.rangeTo));
      }
      const [row] = await db
        .select()
        .from(dashboardWitnesses)
        .where(and(...filters))
        .orderBy(desc(dashboardWitnesses.observedAt))
        .limit(1);
      return { witness: row ? publicDashboardWitness(row) : null };
    }),
  reconcilePeriod: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        rangeFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        rangeTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.rangeFrom > input.rangeTo) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The requested date range is not valid." });
      }
      const db = await requireDb();
      const [binding] = await db
        .select()
        .from(browserSyncBindings)
        .where(eq(browserSyncBindings.tenantId, ctx.tenantId));
      if (!binding) throw new TRPCError({ code: "NOT_FOUND", message: "No source binding." });
      const [witnessRow] = await db
        .select()
        .from(dashboardWitnesses)
        .where(
          and(
            eq(dashboardWitnesses.tenantId, ctx.tenantId),
            eq(dashboardWitnesses.storeId, binding.storeId),
            eq(dashboardWitnesses.rangeFrom, input.rangeFrom),
            eq(dashboardWitnesses.rangeTo, input.rangeTo)
          )
        )
        .orderBy(desc(dashboardWitnesses.observedAt))
        .limit(1);
      const orders = await db
        .select({
          cleancloudOrderId: cleancloudPaidOrders.cleancloudOrderId,
          cleancloudCustomerId: cleancloudPaidOrders.cleancloudCustomerId,
          sourceReportType: cleancloudPaidOrders.sourceReportType,
          paymentDateUtc: cleancloudPaidOrders.paymentDateUtc,
          paidDateUtc: cleancloudPaidOrders.paidDateUtc,
          paid: cleancloudPaidOrders.paid,
          totalCents: cleancloudPaidOrders.totalCents,
        })
        .from(cleancloudPaidOrders)
        .where(
          and(
            eq(cleancloudPaidOrders.tenantId, ctx.tenantId),
            eq(cleancloudPaidOrders.paid, true)
          )
        );
      const receipts = await db
        .select({ receiptJson: browserSyncReceipts.receiptJson })
        .from(browserSyncReceipts)
        .where(eq(browserSyncReceipts.tenantId, ctx.tenantId));
      const priorRows = await db
        .select()
        .from(economicReconciliations)
        .where(
          and(
            eq(economicReconciliations.tenantId, ctx.tenantId),
            eq(economicReconciliations.storeId, binding.storeId)
          )
        )
        .orderBy(desc(economicReconciliations.createdAt));
      const witness: WitnessControl | null = witnessRow
        ? {
            id: witnessRow.id,
            rangeFrom: witnessRow.rangeFrom,
            rangeTo: witnessRow.rangeTo,
            revenueCents: witnessRow.revenueCents,
            comparisonFrom: witnessRow.comparisonFrom,
            comparisonTo: witnessRow.comparisonTo,
            comparisonRevenueCents: witnessRow.comparisonRevenueCents,
          }
        : null;
      const draft = reconcileControlTotals({
        periodFrom: input.rangeFrom,
        periodTo: input.rangeTo,
        witness,
        rows: orders.map(order => ({
          ...order,
          customerName: null,
          customerPhone: null,
          customerEmail: null,
          storeLabel: binding.storeLabel,
        })),
        revenueReportCovered: receiptCovers(receipts, input.rangeFrom, input.rangeTo, true),
        orderCreatedCoverage: receiptCovers(receipts, input.rangeFrom, input.rangeTo, false),
      });
      const evidenceHash = reconciliationEvidenceHash(draft);
      const [existing] = await db
        .select()
        .from(economicReconciliations)
        .where(
          and(
            eq(economicReconciliations.tenantId, ctx.tenantId),
            eq(economicReconciliations.storeId, binding.storeId),
            eq(economicReconciliations.rangeFrom, input.rangeFrom),
            eq(economicReconciliations.rangeTo, input.rangeTo),
            eq(economicReconciliations.evidenceHash, evidenceHash)
          )
        )
        .limit(1);
      let reconciliationId = existing?.id ?? randomUUID();
      if (!existing) {
        try {
          await db.insert(economicReconciliations).values({
            id: reconciliationId,
            tenantId: ctx.tenantId,
            storeId: binding.storeId,
            rangeFrom: input.rangeFrom,
            rangeTo: input.rangeTo,
            status: draft.status,
            dashboardWitnessId: draft.dashboardWitnessId,
            dashboardRevenueCents: draft.dashboardRevenueCents,
            revenueReportCents: draft.revenueReportCents,
            bookCents: draft.bookCents,
            discrepancyCents: draft.discrepancyCents,
            evidenceIdsJson: draft.evidenceIds,
            evidenceHash,
          });
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
          const [winner] = await db
            .select()
            .from(economicReconciliations)
            .where(
              and(
                eq(economicReconciliations.tenantId, ctx.tenantId),
                eq(economicReconciliations.storeId, binding.storeId),
                eq(economicReconciliations.rangeFrom, input.rangeFrom),
                eq(economicReconciliations.rangeTo, input.rangeTo),
                eq(economicReconciliations.evidenceHash, evidenceHash)
              )
            )
            .limit(1);
          if (!winner) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Reconciliation race did not resolve to stored evidence.",
            });
          }
          reconciliationId = winner.id;
        }
      }
      // A period can be reconciled repeatedly as stronger evidence arrives.
      // The query is newest-first; retain only the latest authoritative version
      // of each period so superseded mismatch/insufficient rows cannot poison
      // comparison or monthly-record event generation.
      const latestPriorRows = new Map<string, (typeof priorRows)[number]>();
      for (const row of priorRows) {
        const key = `${row.rangeFrom}|${row.rangeTo}`;
        if (!latestPriorRows.has(key)) latestPriorRows.set(key, row);
      }
      const prior: PriorReconciliation[] = [...latestPriorRows.values()]
        .filter(row => row.id !== reconciliationId)
        .map(row => ({
          id: row.id,
          rangeFrom: row.rangeFrom,
          rangeTo: row.rangeTo,
          status: row.status,
          dashboardRevenueCents: row.dashboardRevenueCents,
          evidenceIds: Array.isArray(row.evidenceIdsJson)
            ? row.evidenceIdsJson.filter((id): id is string => typeof id === "string")
            : [],
        }));
      const events = verifiedEventsFromReconciliation({
        tenantId: ctx.tenantId,
        current: draft,
        witness,
        prior,
      });
      const verifiedAt = new Date();
      const storedEvents = [];
      for (const event of events) {
        const [already] = await db
          .select()
          .from(verifiedEconomicEvents)
          .where(
            and(
              eq(verifiedEconomicEvents.tenantId, ctx.tenantId),
              eq(verifiedEconomicEvents.idempotencyKey, event.idempotencyKey)
            )
          )
          .limit(1);
        if (already) {
          storedEvents.push(publicEconomicEvent(already));
          continue;
        }
        const id = randomUUID();
        try {
          await db.insert(verifiedEconomicEvents).values({
            id,
            tenantId: ctx.tenantId,
            eventType: event.eventType,
            periodFrom: event.periodFrom,
            periodTo: event.periodTo,
            comparisonFrom: event.comparisonFrom,
            comparisonTo: event.comparisonTo,
            currentRevenueCents: event.currentRevenueCents,
            comparisonRevenueCents: event.comparisonRevenueCents,
            deltaCents: event.deltaCents,
            deltaPercentHundredths: event.deltaPercentHundredths,
            evidenceIdsJson: event.evidenceIds,
            idempotencyKey: event.idempotencyKey,
            verifiedAt,
          });
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
          const [winner] = await db
            .select()
            .from(verifiedEconomicEvents)
            .where(
              and(
                eq(verifiedEconomicEvents.tenantId, ctx.tenantId),
                eq(verifiedEconomicEvents.idempotencyKey, event.idempotencyKey)
              )
            )
            .limit(1);
          if (!winner) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Verified-event race did not resolve to a stored event.",
            });
          }
          storedEvents.push(publicEconomicEvent(winner));
          continue;
        }
        const [inserted] = await db
          .select()
          .from(verifiedEconomicEvents)
          .where(
            and(
              eq(verifiedEconomicEvents.tenantId, ctx.tenantId),
              eq(verifiedEconomicEvents.idempotencyKey, event.idempotencyKey)
            )
          )
          .limit(1);
        if (!inserted) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Verified event was not readable after insert.",
          });
        }
        storedEvents.push(publicEconomicEvent(inserted));
      }
      return {
        reconciliation: {
          id: reconciliationId,
          tenantId: ctx.tenantId,
          storeId: binding.storeId,
          rangeFrom: input.rangeFrom,
          rangeTo: input.rangeTo,
          status: draft.status,
          discrepancyCents: draft.discrepancyCents,
          dashboardRevenueCents: draft.dashboardRevenueCents,
          revenueReportCents: draft.revenueReportCents,
          bookCents: draft.bookCents,
          evidenceIds: draft.evidenceIds,
          coverage: draft.coverage,
        },
        events: storedEvents,
      };
    }),
  latestVerifiedGain: legacyDayforgeTenantOperatorProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const [row] = await db
      .select()
      .from(verifiedEconomicEvents)
      .where(
        and(
          eq(verifiedEconomicEvents.tenantId, ctx.tenantId),
          eq(verifiedEconomicEvents.eventType, "economic.mom_revenue_gain_verified")
        )
      )
      .orderBy(desc(verifiedEconomicEvents.verifiedAt))
      .limit(1);
    return { event: row ? publicEconomicEvent(row) : null };
  }),
});
