import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  cleancloudImportBatches,
  cleancloudPaidOrders,
} from "../../drizzle/schema";
import {
  browserSyncAttempts,
  browserSyncBindings,
  browserSyncReceipts,
} from "../cleancloudBrowserSync/schema";
import {
  summarizeOrders,
  validateJawbreakerArtifact,
} from "../cleancloudBrowserSync/validation";
import { enqueueEconomicSnapshot } from "../cleancloudBrowserSync/worldOutbox";
import { findPhysicalEntityIdByAddress } from "../goldlineWorld/entityLookup";
import { MAX_ORDERS_SALES_BYTES } from "../cleancloudIngestion/ordersSalesCsv";

const artifactId = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const storeId = z.string().regex(/^[1-9]\d{0,15}$/);
const tenantId = z.string().min(1).max(64);
const safeFileName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(value => !/[\\/]/.test(value), "sourceFileName must be a base filename");

const auth = z.object({
  secret: z.string().min(1).max(1024),
  tenantId,
});

const importArtifactInput = auth.extend({
  artifactId,
  artifactSha256: sha256,
  sourceFileName: safeFileName,
  storeId,
  from: ymd,
  to: ymd,
  artifactBase64: z.string().min(1).max(6_000_000),
});

const heartbeatInput = auth.extend({
  pendingCount: z.number().int().min(0).max(10_000),
  oldestPendingName: safeFileName.optional().nullable(),
  oldestPendingAt: z.string().datetime().optional().nullable(),
});

function assertJawbreakerSecret(candidate: string): void {
  const expected = process.env.JAWBREAKER_SHARED_SECRET ?? "";
  if (!expected) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "JAWBREAKER_SHARED_SECRET is not configured.",
    });
  }
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Jawbreaker authentication failed." });
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Database unavailable." });
  }
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
  const canonical = (value: unknown): unknown => {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)])
      );
    }
    return value;
  };
  return JSON.stringify(canonical(business));
}

async function recordAttempt(input: {
  tenantId: string;
  artifactId?: string | null;
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
      requestId: input.artifactId ?? null,
      outcome: input.outcome.slice(0, 32),
      message: input.message?.slice(0, 512) ?? null,
      rangeFrom: input.from ?? null,
      rangeTo: input.to ?? null,
      rowCount: input.rowCount ?? null,
    });
  } catch (error) {
    console.warn(
      "[Jawbreaker] attempt evidence unavailable",
      error instanceof Error ? error.message : error
    );
  }
}

function decodeArtifact(encoded: string): Buffer {
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > MAX_ORDERS_SALES_BYTES || bytes.toString("base64") !== encoded) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or oversized artifact bytes." });
  }
  return bytes;
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Artifact is not valid UTF-8 CSV." });
  }
}

function receiptTransport(receiptJson: unknown): string | null {
  if (!receiptJson || typeof receiptJson !== "object") return null;
  const transport = (receiptJson as Record<string, unknown>).transport;
  return typeof transport === "string" ? transport : null;
}

export const jawbreakerRouter = router({
  importArtifact: publicProcedure.input(importArtifactInput).mutation(async ({ input }) => {
    assertJawbreakerSecret(input.secret);
    const bytes = decodeArtifact(input.artifactBase64);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== input.artifactSha256) {
      await recordAttempt({
        tenantId: input.tenantId,
        artifactId: input.artifactId,
        outcome: "jawbreaker_rejected",
        message: "Artifact digest did not match the uploaded bytes.",
        from: input.from,
        to: input.to,
      });
      throw new TRPCError({ code: "BAD_REQUEST", message: "Artifact digest mismatch." });
    }

    const csv = decodeUtf8(bytes);
    let normalized: ReturnType<typeof validateJawbreakerArtifact>["normalized"];
    try {
      const validated = validateJawbreakerArtifact(
        { csv, from: input.from, to: input.to },
        input.tenantId
      );
      if (validated.artifactSha256 !== digest) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Artifact digest changed during decode." });
      }
      normalized = validated.normalized;
    } catch (error) {
      await recordAttempt({
        tenantId: input.tenantId,
        artifactId: input.artifactId,
        outcome: "jawbreaker_rejected",
        message: error instanceof Error ? error.message : String(error),
        from: input.from,
        to: input.to,
      });
      throw error;
    }

    const db = await requireDb();
    const physicalIds = new Map<string, string | null>();
    for (const row of normalized) {
      physicalIds.set(
        row.cleancloudOrderId,
        row.buildingResolutionStatus === "resolved"
          ? await findPhysicalEntityIdByAddress({ tenantId: input.tenantId, address: row.address })
          : null
      );
    }

    try {
      const result = await db.transaction(async tx => {
        const [binding] = await tx
          .select()
          .from(browserSyncBindings)
          .where(eq(browserSyncBindings.tenantId, input.tenantId))
          .for("update");
        if (!binding || binding.storeId !== input.storeId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Artifact store does not match the tenant's paired CleanCloud store.",
          });
        }

        const [sameRequest] = await tx
          .select()
          .from(browserSyncReceipts)
          .where(
            and(
              eq(browserSyncReceipts.tenantId, input.tenantId),
              eq(browserSyncReceipts.requestId, input.artifactId)
            )
          );
        if (sameRequest) {
          if (sameRequest.digest !== digest) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Artifact ID was already used for different file bytes.",
            });
          }
          return { receipt: sameRequest.receiptJson, replayed: true as const };
        }

        const [sameArtifact] = await tx
          .select()
          .from(browserSyncReceipts)
          .where(
            and(
              eq(browserSyncReceipts.tenantId, input.tenantId),
              eq(browserSyncReceipts.digest, digest)
            )
          )
          .limit(1);
        if (sameArtifact && receiptTransport(sameArtifact.receiptJson) === "jawbreaker") {
          return { receipt: sameArtifact.receiptJson, replayed: true as const };
        }

        const [batch] = await tx
          .insert(cleancloudImportBatches)
          .values({
            tenantId: input.tenantId,
            source: "cleancloud_orders_sales",
            sourceFileName: input.sourceFileName,
            importStatus: "completed",
          })
          .$returningId();

        let inserted = 0;
        let updated = 0;
        let unchanged = 0;
        for (const row of normalized) {
          const values = {
            ...row,
            importBatchId: batch.id,
            sourceFileName: input.sourceFileName,
          };
          await enqueueEconomicSnapshot(
            tx,
            values,
            physicalIds.get(row.cleancloudOrderId) ?? null
          );
          const [existing] = await tx
            .select()
            .from(cleancloudPaidOrders)
            .where(
              and(
                eq(cleancloudPaidOrders.tenantId, input.tenantId),
                eq(cleancloudPaidOrders.cleancloudOrderId, row.cleancloudOrderId),
                eq(cleancloudPaidOrders.sourceReportType, "orders_sales")
              )
            )
            .for("update");
          if (existing && businessFields(existing) === businessFields(row)) {
            unchanged += 1;
            continue;
          }
          if (existing) {
            await tx
              .update(cleancloudPaidOrders)
              .set(values)
              .where(eq(cleancloudPaidOrders.id, existing.id));
            updated += 1;
          } else {
            await tx.insert(cleancloudPaidOrders).values(values);
            inserted += 1;
          }
        }

        const completedAt = new Date();
        const receipt = {
          transport: "jawbreaker" as const,
          artifactId: input.artifactId,
          artifactSha256: digest,
          sourceFileName: input.sourceFileName,
          tenantId: input.tenantId,
          storeId: input.storeId,
          storeLabel: binding.storeLabel,
          from: input.from,
          to: input.to,
          reportType: "orders_sales" as const,
          completedAt: completedAt.toISOString(),
          batchId: batch.id,
          inserted,
          updated,
          unchanged,
          skipped: 0,
          totalRows: normalized.length,
          ...summarizeOrders(normalized),
          scope:
            "Orders created in the source report period; totals use actual payment dates. Older orders and later corrections outside this artifact are not covered.",
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
          requestId: input.artifactId,
          digest,
          storeId: input.storeId,
          importBatchId: batch.id,
          receiptJson: receipt,
        });
        await tx
          .update(browserSyncBindings)
          .set({ lastSuccessAt: completedAt })
          .where(eq(browserSyncBindings.tenantId, input.tenantId));
        return { receipt, replayed: false as const };
      });

      await recordAttempt({
        tenantId: input.tenantId,
        artifactId: input.artifactId,
        outcome: result.replayed ? "jawbreaker_replayed" : "jawbreaker_imported",
        from: input.from,
        to: input.to,
        rowCount: normalized.length,
      });
      return result.receipt;
    } catch (error) {
      await recordAttempt({
        tenantId: input.tenantId,
        artifactId: input.artifactId,
        outcome:
          error instanceof TRPCError && error.code === "BAD_REQUEST"
            ? "jawbreaker_rejected"
            : error instanceof TRPCError && error.code === "CONFLICT"
              ? "jawbreaker_conflict"
              : "jawbreaker_failed",
        message: error instanceof Error ? error.message : String(error),
        from: input.from,
        to: input.to,
      });
      throw error;
    }
  }),

  heartbeat: publicProcedure.input(heartbeatInput).mutation(async ({ input }) => {
    assertJawbreakerSecret(input.secret);
    await recordAttempt({
      tenantId: input.tenantId,
      outcome: "jawbreaker_heartbeat",
      message: input.oldestPendingName
        ? `${input.oldestPendingName}${input.oldestPendingAt ? ` | ${input.oldestPendingAt}` : ""}`
        : null,
      rowCount: input.pendingCount,
    });
    return { ok: true as const };
  }),

  status: publicProcedure.input(auth).query(async ({ input }) => {
    assertJawbreakerSecret(input.secret);
    const db = await requireDb();
    const [binding, attempts, receipts] = await Promise.all([
      db
        .select()
        .from(browserSyncBindings)
        .where(eq(browserSyncBindings.tenantId, input.tenantId))
        .limit(1),
      db
        .select()
        .from(browserSyncAttempts)
        .where(eq(browserSyncAttempts.tenantId, input.tenantId))
        .orderBy(desc(browserSyncAttempts.createdAt))
        .limit(100),
      db
        .select()
        .from(browserSyncReceipts)
        .where(eq(browserSyncReceipts.tenantId, input.tenantId))
        .orderBy(desc(browserSyncReceipts.createdAt))
        .limit(30),
    ]);
    const jawbreakerReceipts = receipts.filter(row => receiptTransport(row.receiptJson) === "jawbreaker");
    const latestHeartbeat = attempts.find(row => row.outcome === "jawbreaker_heartbeat") ?? null;
    const latestImport = attempts.find(row => row.outcome === "jawbreaker_imported" || row.outcome === "jawbreaker_replayed") ?? null;
    const latestFailure = attempts.find(row => row.outcome === "jawbreaker_failed" || row.outcome === "jawbreaker_rejected" || row.outcome === "jawbreaker_conflict") ?? null;
    const latestGumballExport = attempts.find(row => row.outcome === "extension_exported") ?? null;
    const latestGumballFailure = attempts.find(row => row.outcome.startsWith("extension_") && row.outcome !== "extension_exported") ?? null;
    return {
      pairedStore: binding[0]
        ? { storeId: binding[0].storeId, storeLabel: binding[0].storeLabel }
        : null,
      gumball: {
        latestExportAt: latestGumballExport?.createdAt?.toISOString() ?? null,
        latestFailureAt: latestGumballFailure?.createdAt?.toISOString() ?? null,
        latestFailureMessage: latestGumballFailure?.message ?? null,
      },
      jawbreaker: {
        lastSuccessAt: latestImport?.createdAt?.toISOString() ?? binding[0]?.lastSuccessAt?.toISOString() ?? null,
        latestFailureAt: latestFailure?.createdAt?.toISOString() ?? null,
        latestFailureMessage: latestFailure?.message ?? null,
        lastHeartbeatAt: latestHeartbeat?.createdAt?.toISOString() ?? null,
        pendingCount: latestHeartbeat?.rowCount ?? null,
        oldestPending: latestHeartbeat?.message ?? null,
        latestReceipt: jawbreakerReceipts[0]?.receiptJson ?? null,
      },
    };
  }),
});
