import { and, eq, inArray } from "drizzle-orm";
import {
  authorityReceipts,
  cleancloudPaidOrders,
  type InsertCleancloudPaidOrder,
} from "../../../drizzle/schema";
import {
  admitAuthorityClaimWith,
  assertAuthorityClaimPolicy,
  type AuthorityReceipt,
  type AuthorityTransaction,
} from "../../platform/authority/authorityReceipt";
import { getDb } from "../../db";

export type CleanCloudPaidObservationExpectation = {
  tenantId: string;
  subjectType: "cleancloud_order";
  subjectId: string;
  sourceType: "cleancloud_paid_order";
  sourceRef: string | null;
  /** The order's economic payment time (`paymentDateUtc ?? paidDateUtc`), ISO. */
  paymentAt?: string | null;
};

export function requireCleanCloudTenantId(
  tenantId: string | null | undefined
): string {
  const normalized = tenantId?.trim() ?? "";
  if (!normalized) {
    throw new Error("CleanCloud paid evidence requires explicit tenantId");
  }
  return normalized;
}

export function cleanCloudPaidOrderBusinessFields(
  row: Record<string, unknown>
): string {
  const {
    id,
    importBatchId,
    sourceFileName,
    createdAt,
    updatedAt,
    ...business
  } = row;
  if (business.totalWeightLbs != null) {
    business.totalWeightLbs = Number(
      Number(business.totalWeightLbs).toFixed(2)
    );
  }
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

export async function upsertCleanCloudPaidOrderWith(
  tx: AuthorityTransaction,
  input: {
    values: InsertCleancloudPaidOrder;
    existingMode: "update" | "skip_unchanged";
  }
): Promise<"inserted" | "updated" | "unchanged"> {
  const tenantId = requireCleanCloudTenantId(input.values.tenantId);
  const values: InsertCleancloudPaidOrder = {
    ...input.values,
    tenantId,
  };
  const lookup = (locking: boolean) => {
    const query = tx
      .select()
      .from(cleancloudPaidOrders)
      .where(
        and(
          eq(cleancloudPaidOrders.tenantId, tenantId),
          eq(
            cleancloudPaidOrders.cleancloudOrderId,
            String(values.cleancloudOrderId)
          ),
          eq(
            cleancloudPaidOrders.sourceReportType,
            values.sourceReportType
          )
        )
      );
    return locking ? query.for("update").limit(1) : query.limit(1);
  };

  const writeExisting = async (
    existing: typeof cleancloudPaidOrders.$inferSelect
  ): Promise<"updated" | "unchanged"> => {
    if (
      input.existingMode === "skip_unchanged" &&
      cleanCloudPaidOrderBusinessFields(
        existing as Record<string, unknown>
      ) === cleanCloudPaidOrderBusinessFields(values as Record<string, unknown>)
    ) {
      return "unchanged";
    }
    await tx
      .update(cleancloudPaidOrders)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(cleancloudPaidOrders.id, existing.id));
    return "updated";
  };

  const [existing] = await lookup(false);
  if (existing) return writeExisting(existing);

  try {
    await tx.insert(cleancloudPaidOrders).values(values);
    return "inserted";
  } catch (error) {
    // Two independent tenants can legitimately import the same provider order
    // id at the same time. Do not gap-lock the missing unique-key range before
    // insert; only serialize after a real same-key duplicate race.
    let current: unknown = error;
    let duplicate = false;
    while (current && typeof current === "object") {
      const record = current as {
        code?: unknown;
        errno?: unknown;
        cause?: unknown;
      };
      if (record.code === "ER_DUP_ENTRY" || record.errno === 1062) {
        duplicate = true;
        break;
      }
      current = record.cause;
    }
    if (!duplicate) throw error;

    const [raced] = await lookup(true);
    if (!raced) throw error;
    return writeExisting(raced);
  }
}

export async function admitCleanCloudPaidObservationWith(
  tx: AuthorityTransaction,
  input: {
    tenantId: string;
    cleancloudOrderId: string;
    sourceRef: string;
    occurredAt: Date | string;
    metadata?: Record<string, unknown> | null;
  }
): Promise<AuthorityReceipt> {
  const tenantId = requireCleanCloudTenantId(input.tenantId);
  return admitAuthorityClaimWith(tx, {
    tenantId,
    claimType: "cleancloud_paid_observed",
    subjectType: "cleancloud_order",
    subjectId: input.cleancloudOrderId.trim(),
    sourceType: "cleancloud_paid_order",
    sourceRef: input.sourceRef.trim(),
    actorType: "system",
    actorId: null,
    evidenceClass: "authoritative_external",
    verificationClass: "VERIFIED",
    admissionPolicy: "cleancloud_paid_observation_v1",
    occurredAt: input.occurredAt,
    metadata: input.metadata ?? null,
  });
}

export function cleanCloudPaidObservationReceiptMatches(
  receipt: AuthorityReceipt,
  expected: CleanCloudPaidObservationExpectation
): boolean {
  if (
    !expected.sourceRef ||
    receipt.tenantId !== expected.tenantId ||
    receipt.claimType !== "cleancloud_paid_observed" ||
    receipt.subjectType !== "cleancloud_order" ||
    receipt.subjectId !== expected.subjectId ||
    receipt.sourceType !== "cleancloud_paid_order" ||
    receipt.sourceRef !== expected.sourceRef
  ) {
    return false;
  }
  try {
    assertAuthorityClaimPolicy(receipt);
    return true;
  } catch {
    return false;
  }
}

/**
 * The receipt for a CleanCloud order's current economic revision, or null.
 *
 * A paid observation is admitted only when the order's economics change
 * (enqueueEconomicSnapshot), and it carries the payment time it observed. So
 * the newest receipt that observed this row's payment time is the one for its
 * current revision, whichever import batch later re-observed the row. A
 * re-sync that changes no money (a customer id filled in, the same file
 * imported again) moves the row to a new batch and correctly admits nothing;
 * the import batch is provenance of the latest write, not the payment's
 * identity, so it does not decide which receipt applies.
 *
 * The payment time, not recency alone, selects the receipt: the Sales and the
 * Revenue report describe one order with their own payment times, and each
 * import of one admits a receipt for its time. The newest receipt for the
 * order can therefore be the other report's.
 *
 * Fail-closed: the newest receipt for this payment time must pass its
 * admission policy (an older one is never substituted). No receipt for the
 * row's payment time means no import observed this payment. A row with no
 * import batch is never admitted (no import observed it).
 */
export function currentCleanCloudPaidObservationReceipt(
  receipts: readonly AuthorityReceipt[],
  expected: CleanCloudPaidObservationExpectation & { importBatchId?: number | null }
): AuthorityReceipt | null {
  if (expected.importBatchId == null || !expected.paymentAt) return null;
  const paymentAt = Date.parse(expected.paymentAt);
  if (!Number.isFinite(paymentAt)) return null;
  const newest = receipts
    .filter(
      receipt =>
        receipt.tenantId === expected.tenantId &&
        receipt.claimType === "cleancloud_paid_observed" &&
        receipt.subjectType === "cleancloud_order" &&
        receipt.subjectId === expected.subjectId &&
        receipt.sourceType === "cleancloud_paid_order" &&
        receipt.occurredAt != null &&
        Date.parse(receipt.occurredAt) === paymentAt
    )
    .sort((a, b) => b.admittedAt.localeCompare(a.admittedAt) || b.id.localeCompare(a.id))[0];
  if (!newest) return null;
  try {
    assertAuthorityClaimPolicy(newest);
    return newest;
  } catch {
    return null;
  }
}

function toReceipt(
  row: typeof authorityReceipts.$inferSelect
): AuthorityReceipt {
  return {
    id: row.id,
    tenantId: row.tenantId,
    claimType: row.claimType,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
    actorType: row.actorType,
    actorId: row.actorId,
    evidenceClass: row.evidenceClass,
    verificationClass: row.verificationClass,
    admissionPolicy: row.admissionPolicy,
    occurredAt: row.occurredAt?.toISOString() ?? null,
    admittedAt: row.admittedAt.toISOString(),
    metadata:
      row.metadataJson && typeof row.metadataJson === "object"
        ? (row.metadataJson as Record<string, unknown>)
        : null,
    idempotencyKey: row.idempotencyKey,
  };
}

export async function readCleanCloudPaidObservationReceipts(input: {
  tenantId: string;
  expectations: readonly CleanCloudPaidObservationExpectation[];
}): Promise<AuthorityReceipt[]> {
  const tenantId = requireCleanCloudTenantId(input.tenantId);
  if (input.expectations.some(item => item.tenantId !== tenantId)) {
    throw new Error("CleanCloud evidence batch crosses tenant boundary");
  }
  if (!input.expectations.length) return [];
  const db = await getDb();
  if (!db) throw new Error("CleanCloud evidence receipts unavailable");

  const ids = [
    ...new Set(input.expectations.map(item => item.subjectId.trim())),
  ].filter(Boolean);
  const receipts: AuthorityReceipt[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await db
      .select()
      .from(authorityReceipts)
      .where(
        and(
          eq(authorityReceipts.tenantId, tenantId),
          eq(authorityReceipts.claimType, "cleancloud_paid_observed"),
          eq(authorityReceipts.subjectType, "cleancloud_order"),
          inArray(authorityReceipts.subjectId, ids.slice(i, i + 200))
        )
      );
    receipts.push(...rows.map(toReceipt));
  }
  return receipts;
}

export async function findCleanCloudPaidObservationReceipt(input: {
  tenantId: string;
  cleancloudOrderId: string;
}): Promise<AuthorityReceipt | null> {
  const expectations: CleanCloudPaidObservationExpectation[] = [
    {
      tenantId: requireCleanCloudTenantId(input.tenantId),
      subjectType: "cleancloud_order",
      subjectId: input.cleancloudOrderId.trim(),
      sourceType: "cleancloud_paid_order",
      sourceRef: null,
    },
  ];
  const receipts = await readCleanCloudPaidObservationReceipts({
    tenantId: expectations[0]!.tenantId,
    expectations,
  });
  return receipts
    .filter(
      receipt =>
        receipt.subjectId === expectations[0]!.subjectId &&
        receipt.sourceType === "cleancloud_paid_order"
    )
    .sort((a, b) => b.admittedAt.localeCompare(a.admittedAt))[0] ?? null;
}
