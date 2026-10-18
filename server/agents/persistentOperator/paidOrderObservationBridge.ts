import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, gte, or, sql } from "drizzle-orm";
import {
  cleancloudPaidOrders,
  dayDirectorCommitments,
  observationBridgeObligations,
} from "../../../drizzle/schema";
import { formatInTimeZone } from "date-fns-tz";
import { readCanonicalRevenue } from "../../analytics/canonicalRevenue";
import { identityKeysFor } from "../../analytics/customerIdentityResolution";
import { getDashboardTimeZone } from "../../dashboardZoned";
import { getDb } from "../../db";
import { resolveOperatorTimeZone } from "./operatorAppointmentPolicy";
import { COMMITMENT_COMPLETION_SOURCE } from "./commitmentExecutionBridge";
import { bridgeCleanCloudPaidOrder } from "./fieldEventBridge";
import {
  claimDueObservationObligations,
  recordObservationObligation,
  runObservationObligation,
  type ObservationBridgeHandler,
  type ObservationBridgeSettlement,
} from "./observationBridgeStore";

/**
 * Paid CleanCloud order → its goal observation, durably (Phase 2 · Slice D).
 *
 * Both CleanCloud imports commit the paid order (and its admitted paid
 * observation receipt) first. The goal side then runs through one obligation
 * per order, so a failure after the import committed is owned and retried
 * instead of logged as "deferred":
 *
 * - `bridged`: attached to its objective (Slice C's attempt match, or the
 *   existing deterministic lineage).
 * - `pending`: a transient failure, or an executed attempt that targeted this
 *   customer whose own execution evidence is still being recorded.
 * - `unresolved_identity`: the order carries no customer identity yet; a later
 *   sync that adds it is picked up by the retry.
 * - `unrelated`: no goal work owns it. Never matched by guessing.
 * - `ambiguous_review`: attempts on more than one objective could own it.
 * - `rejected`: the paid row or its admitted receipt is missing or disagrees, or
 *   the canonical paid-order ledger does not count the order. A suspected
 *   duplicate payment the ledger withholds goes to review instead.
 *
 * The handler re-reads the authoritative paid row on every attempt; the
 * obligation never carries money. Retrying never re-imports, and the economic
 * event stays the one financial fact: the goal outcome is attribution only.
 */

export const CLEANCLOUD_PAID_ORDER_SOURCE = "cleancloud_paid_order" as const;
const DAY_MS = 86_400_000;

type PaidOrderPayload = { cleancloudOrderId: string; sourceRef: string | null };

/** Replaceable for tests that need a failing bridge or a skipped post-import step. Production uses the defaults. */
export const paidOrderObservationDeps = {
  bridge: bridgeCleanCloudPaidOrder,
  afterImport: async (input: { tenantId: string; cleancloudOrderIds: readonly string[]; sourceRef: string }) =>
    recordPaidOrderObservations(input),
};

const record = (value: unknown): Record<string, unknown> => {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
};

/** The authoritative paid row for an order: paid, positive, the newest report of it. */
async function authoritativePaidRow(tenantId: string, cleancloudOrderId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(cleancloudPaidOrders)
    .where(
      and(
        eq(cleancloudPaidOrders.tenantId, tenantId),
        eq(cleancloudPaidOrders.cleancloudOrderId, cleancloudOrderId),
        eq(cleancloudPaidOrders.paid, true),
        gt(cleancloudPaidOrders.totalCents, 0)
      )
    )
    .orderBy(desc(cleancloudPaidOrders.updatedAt), desc(cleancloudPaidOrders.id))
    .limit(1);
  return row ?? null;
}

/**
 * Whether an executed attempt may still claim this order: a completed,
 * approved commitment that targeted this customer, whose execution evidence is
 * not recorded yet, and whose planned window would cover the payment.
 */
async function attemptLineagePending(input: { tenantId: string; identityKeys: readonly string[]; paidAt: Date }): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: dayDirectorCommitments.id, completedAt: dayDirectorCommitments.completedAt, metadataJson: dayDirectorCommitments.metadataJson })
    .from(dayDirectorCommitments)
    .where(
      and(
        eq(dayDirectorCommitments.tenantId, input.tenantId),
        eq(dayDirectorCommitments.status, "completed"),
        sql`JSON_EXTRACT(${dayDirectorCommitments.metadataJson}, '$.observationPlan') IS NOT NULL`,
        sql`JSON_EXTRACT(${dayDirectorCommitments.metadataJson}, '$.observation') IS NULL`,
        sql`NOT EXISTS (SELECT 1 FROM ${observationBridgeObligations} o WHERE o.tenantId = ${dayDirectorCommitments.tenantId} AND o.sourceKind = ${COMMITMENT_COMPLETION_SOURCE} AND o.sourceKey = ${dayDirectorCommitments.id} AND o.status IN ('unrelated', 'ambiguous_review', 'rejected'))`
      )
    );
  const keys = new Set(input.identityKeys);
  const paid = input.paidAt.getTime();
  return rows.some(row => {
    const plan = record(record(row.metadataJson).observationPlan);
    const targets = Array.isArray(plan.targets) ? plan.targets.map(t => record(t).identityKey) : [];
    if (!targets.some(key => typeof key === "string" && keys.has(key)) || !row.completedAt) return false;
    const start = row.completedAt.getTime();
    const days = typeof plan.windowDays === "number" ? plan.windowDays : 0;
    return paid >= start && paid <= start + days * DAY_MS;
  });
}

/**
 * How the canonical paid-order ledger treats this order on its payment day.
 * The goal side attributes only what the ledger includes, so goal revenue can
 * never exceed the financial truth.
 */
async function canonicalLedgerStanding(input: {
  tenantId: string;
  cleancloudOrderId: string;
  paidAt: Date;
}): Promise<"included" | "suspected_duplicate" | "duplicate_excluded" | "payment_unverified" | "unavailable"> {
  const timeZone = (await resolveOperatorTimeZone(input.tenantId)) ?? getDashboardTimeZone();
  const day = formatInTimeZone(input.paidAt, timeZone, "yyyy-MM-dd");
  const ledger = await readCanonicalRevenue({ tenantId: input.tenantId, from: day, to: day, timeZone });
  if (ledger.status !== "ok") return "unavailable";
  const eventKey = `cleancloud:${input.cleancloudOrderId}`;
  if (ledger.includedEvents.some(event => event.eventKey === eventKey)) return "included";
  if (ledger.suspectedWithheld.items.some(item => item.withheldEventKey === eventKey)) return "suspected_duplicate";
  if (ledger.definiteDuplicateExclusions.items.some(item => item.excludedEventKey === eventKey)) return "duplicate_excluded";
  return ledger.coverage.failedSources.includes("cleancloud") && !ledger.coverage.loadedSources.includes("cleancloud")
    ? "unavailable"
    : "payment_unverified";
}

export const paidOrderObservationHandler: ObservationBridgeHandler = async obligation => {
  const { cleancloudOrderId, sourceRef } = obligation.payload as unknown as PaidOrderPayload;
  const row = await authoritativePaidRow(obligation.tenantId, cleancloudOrderId);
  if (!row)
    return { status: "rejected", result: { reason: "paid_order_not_found", message: `No paid, positive CleanCloud row for order ${cleancloudOrderId}.` } };
  const paidAt = row.paymentDateUtc ?? row.paidDateUtc;
  if (!paidAt)
    return { status: "rejected", result: { reason: "payment_time_missing", message: `Order ${cleancloudOrderId} has no payment time.` } };
  const identityKeys = identityKeysFor({ phone: row.customerPhone, email: row.customerEmail, cleancloudCustomerId: row.cleancloudCustomerId });
  if (!identityKeys.length)
    return { status: "unresolved_identity", result: { reason: "customer_identity_missing", cleancloudOrderId }, error: "The order carries no customer identity yet" };

  const standing = await canonicalLedgerStanding({ tenantId: obligation.tenantId, cleancloudOrderId, paidAt });
  if (standing === "unavailable")
    return { status: "pending", result: { reason: "canonical_ledger_unavailable" }, error: "The paid-order ledger could not be read" };
  if (standing === "suspected_duplicate")
    return { status: "ambiguous_review", result: { reason: "suspected_duplicate_payment", message: `The ledger withholds order ${cleancloudOrderId} as a possible duplicate payment.` } };
  if (standing !== "included")
    return {
      status: "rejected",
      result: {
        reason: standing === "duplicate_excluded" ? "duplicate_of_canonical_event" : "payment_unverified_in_canonical_ledger",
        message: `The paid-order ledger does not count order ${cleancloudOrderId}, so no goal result is attributed to it.`,
      },
    };

  const bridged = await paidOrderObservationDeps.bridge({
    tenantId: obligation.tenantId,
    cleancloudOrderId,
    cleancloudCustomerId: row.cleancloudCustomerId,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    paid: true,
    totalCents: row.totalCents,
    paidDateUtc: paidAt,
    sourceFileName: sourceRef ?? row.sourceFileName,
  });
  if (bridged.bridged)
    return { status: "bridged", result: { objectiveId: bridged.objective.id, outcomeId: bridged.outcome.id, cleancloudOrderId } };
  const result = { reason: bridged.reason, message: bridged.message, ...(bridged.candidateObjectiveIds ? { candidateObjectiveIds: bridged.candidateObjectiveIds } : {}) };
  switch (bridged.reason) {
    case "unrelated_order":
      return (await attemptLineagePending({ tenantId: obligation.tenantId, identityKeys, paidAt }))
        ? { status: "pending", result: { ...result, reason: "awaiting_attempt_lineage" }, error: "An executed attempt that targeted this customer is not linked to its objective yet" }
        : { status: "unrelated", result };
    case "ambiguous_lineage":
      return { status: "ambiguous_review", result };
    case "objective_not_found":
      return { status: "pending", result, error: bridged.message };
    default:
      return { status: "rejected", result };
  }
};

/**
 * After an import committed: one obligation per paid order, each tried now.
 * A failure stays persisted for the sweep. Settled orders (a re-sync of the
 * same order) are not bridged again.
 */
export async function recordPaidOrderObservations(input: {
  tenantId: string;
  cleancloudOrderIds: readonly string[];
  sourceRef: string;
  now?: Date;
}): Promise<{ byStatus: Partial<Record<ObservationBridgeSettlement["status"], number>> }> {
  const byStatus: Partial<Record<ObservationBridgeSettlement["status"], number>> = {};
  const leaseOwner = `paid-order-import:${randomUUID()}`;
  for (const cleancloudOrderId of [...new Set(input.cleancloudOrderIds)]) {
    const obligation = await recordObservationObligation({
      tenantId: input.tenantId,
      sourceKind: CLEANCLOUD_PAID_ORDER_SOURCE,
      sourceKey: cleancloudOrderId,
      payload: { cleancloudOrderId, sourceRef: input.sourceRef },
      now: input.now,
    });
    const [claimed] = await claimDueObservationObligations({ leaseOwner, ids: [obligation.id], limit: 1, now: input.now, tenantId: input.tenantId });
    if (!claimed) {
      byStatus[obligation.status] = (byStatus[obligation.status] ?? 0) + 1;
      continue;
    }
    const { settlement } = await runObservationObligation({ obligation: claimed, handler: paidOrderObservationHandler, leaseOwner, now: input.now });
    byStatus[settlement.status] = (byStatus[settlement.status] ?? 0) + 1;
  }
  return { byStatus };
}

/**
 * Reconciliation: paid orders with no obligation (the process died after the
 * import committed, or the post-import step failed) get one. Bounded to
 * payments inside the lookback.
 */
export async function enqueueUnbridgedPaidOrderObligations(input: {
  since: Date;
  tenantId?: string;
  limit?: number;
  now?: Date;
}): Promise<{ enqueued: number }> {
  const db = await getDb();
  if (!db) return { enqueued: 0 };
  const conditions = [
    eq(cleancloudPaidOrders.paid, true),
    gt(cleancloudPaidOrders.totalCents, 0),
    or(gte(cleancloudPaidOrders.paymentDateUtc, input.since), gte(cleancloudPaidOrders.paidDateUtc, input.since)),
    sql`NOT EXISTS (SELECT 1 FROM ${observationBridgeObligations} o WHERE o.tenantId = ${cleancloudPaidOrders.tenantId} AND o.sourceKind = ${CLEANCLOUD_PAID_ORDER_SOURCE} AND o.sourceKey = ${cleancloudPaidOrders.cleancloudOrderId})`,
  ];
  if (input.tenantId) conditions.push(eq(cleancloudPaidOrders.tenantId, input.tenantId));
  const rows = await db
    .selectDistinct({ tenantId: cleancloudPaidOrders.tenantId, cleancloudOrderId: cleancloudPaidOrders.cleancloudOrderId })
    .from(cleancloudPaidOrders)
    .where(and(...conditions))
    .limit(input.limit ?? 100);
  for (const row of rows)
    await recordObservationObligation({
      tenantId: row.tenantId,
      sourceKind: CLEANCLOUD_PAID_ORDER_SOURCE,
      sourceKey: row.cleancloudOrderId,
      payload: { cleancloudOrderId: row.cleancloudOrderId, sourceRef: "reconciliation" },
      now: input.now,
    });
  return { enqueued: rows.length };
}
