import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { observationBridgeObligations } from "../../../drizzle/schema";
import { getDb } from "../../db";

/**
 * Durable observation-bridge obligations (Phase 2 · Slices C and D).
 *
 * A durable source event that must reach its goal objective (a completed Day
 * Line commitment, a paid CleanCloud order) gets one row, keyed by tenant,
 * source kind and source key. The row owns the retry: a failed bridge stays
 * retryable with its error and next attempt, instead of a "deferred" log line.
 *
 * - `bridged`: connected; the outcome ids are in the result.
 * - `pending`: a transient failure (database, outage, lost lease); retried with backoff.
 * - `unresolved_identity`: the source cannot be matched yet; retried more slowly.
 * - `unrelated`: no goal objective owns it. Terminal, and never invented.
 * - `ambiguous_review`: more than one lineage fits. Terminal until a person decides.
 * - `rejected`: the source evidence is missing, invalid or contradicts its lineage. Terminal.
 *
 * Retries are leased (one worker per row at a time) and settlement is fenced by
 * the lease, so a worker that lost its lease cannot overwrite a newer result.
 * Handlers must be idempotent: a crash after a write replays to the same outcome.
 */

export const OBSERVATION_BRIDGE_STATUSES = [
  "bridged",
  "pending",
  "unresolved_identity",
  "unrelated",
  "ambiguous_review",
  "rejected",
] as const;
export type ObservationBridgeStatus = (typeof OBSERVATION_BRIDGE_STATUSES)[number];

/** Statuses a worker retries. Everything else is settled. */
export const RETRYABLE_OBSERVATION_BRIDGE_STATUSES = ["pending", "unresolved_identity"] as const satisfies readonly ObservationBridgeStatus[];

export const OBSERVATION_BRIDGE_SOURCE_KINDS = [
  "day_line_commitment_completion",
  "cleancloud_paid_order",
] as const;
export type ObservationBridgeSourceKind = (typeof OBSERVATION_BRIDGE_SOURCE_KINDS)[number];

export type ObservationBridgeObligation = {
  id: string;
  tenantId: string;
  sourceKind: ObservationBridgeSourceKind;
  sourceKey: string;
  status: ObservationBridgeStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  attemptCount: number;
  nextAttemptAt: string;
  leaseOwner: string | null;
  lastError: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A handler's classification of one attempt. */
export type ObservationBridgeSettlement =
  | { status: "bridged" | "unrelated" | "ambiguous_review" | "rejected"; result: Record<string, unknown> }
  | { status: "pending" | "unresolved_identity"; result?: Record<string, unknown>; error?: string };

export type ObservationBridgeHandler = (
  obligation: ObservationBridgeObligation
) => Promise<ObservationBridgeSettlement>;

const MINUTE = 60_000;

/** Exponential backoff, capped: a transient failure retries within minutes, an unresolved identity within hours. */
export function observationRetryDelayMs(attemptCount: number, status: "pending" | "unresolved_identity"): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 12));
  return status === "pending"
    ? Math.min(MINUTE * 2 ** exponent, 6 * 60 * MINUTE)
    : Math.min(30 * MINUTE * 2 ** exponent, 24 * 60 * MINUTE);
}

const json = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;

function toRecord(row: typeof observationBridgeObligations.$inferSelect): ObservationBridgeObligation {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sourceKind: row.sourceKind as ObservationBridgeSourceKind,
    sourceKey: row.sourceKey,
    status: (OBSERVATION_BRIDGE_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as ObservationBridgeStatus)
      : "pending",
    payload: json<Record<string, unknown>>(row.payloadJson) ?? {},
    result: row.resultJson == null ? null : json<Record<string, unknown>>(row.resultJson),
    attemptCount: row.attemptCount,
    nextAttemptAt: row.nextAttemptAt.toISOString(),
    leaseOwner: row.leaseOwner,
    lastError: row.lastError,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Observation bridge database unavailable");
  return db;
}

export async function getObservationObligation(input: {
  tenantId: string;
  sourceKind: ObservationBridgeSourceKind;
  sourceKey: string;
}): Promise<ObservationBridgeObligation | null> {
  const db = await database();
  const [row] = await db
    .select()
    .from(observationBridgeObligations)
    .where(
      and(
        eq(observationBridgeObligations.tenantId, input.tenantId),
        eq(observationBridgeObligations.sourceKind, input.sourceKind),
        eq(observationBridgeObligations.sourceKey, input.sourceKey)
      )
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

/**
 * Records the obligation for a source event, once. A second record of the same
 * event (a retried request, a reconciliation sweep) returns the existing row
 * and never replaces the payload it was first recorded with.
 */
export async function recordObservationObligation(input: {
  tenantId: string;
  sourceKind: ObservationBridgeSourceKind;
  sourceKey: string;
  payload: Record<string, unknown>;
  now?: Date;
}): Promise<ObservationBridgeObligation> {
  const tenantId = input.tenantId.trim();
  const sourceKey = input.sourceKey.trim();
  if (!tenantId || !sourceKey) throw new Error("Observation obligation requires a tenant and a source key");
  if (sourceKey.length > 191) throw new Error("Observation obligation source key is too long");
  const db = await database();
  await db
    .insert(observationBridgeObligations)
    .values({
      id: randomUUID(),
      tenantId,
      sourceKind: input.sourceKind,
      sourceKey,
      status: "pending",
      payloadJson: input.payload,
      nextAttemptAt: input.now ?? new Date(),
    })
    .onDuplicateKeyUpdate({ set: { sourceKey } });
  const stored = await getObservationObligation({ tenantId, sourceKind: input.sourceKind, sourceKey });
  if (!stored) throw new Error("Observation obligation readback failed");
  return stored;
}

/**
 * Leases due, retryable obligations to `leaseOwner`. A row whose lease expired
 * (its worker died) is due again. Times are the caller's clock throughout.
 */
export async function claimDueObservationObligations(input: {
  leaseOwner: string;
  leaseMs?: number;
  limit?: number;
  now?: Date;
  tenantId?: string;
  ids?: readonly string[];
  sourceKinds?: readonly ObservationBridgeSourceKind[];
}): Promise<ObservationBridgeObligation[]> {
  const db = await database();
  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + (input.leaseMs ?? 2 * MINUTE));
  const conditions = [
    inArray(observationBridgeObligations.status, [...RETRYABLE_OBSERVATION_BRIDGE_STATUSES]),
    lte(observationBridgeObligations.nextAttemptAt, now),
    or(isNull(observationBridgeObligations.leaseExpiresAt), lt(observationBridgeObligations.leaseExpiresAt, now)),
  ];
  if (input.tenantId) conditions.push(eq(observationBridgeObligations.tenantId, input.tenantId));
  if (input.ids?.length) conditions.push(inArray(observationBridgeObligations.id, [...input.ids]));
  if (input.sourceKinds?.length) conditions.push(inArray(observationBridgeObligations.sourceKind, [...input.sourceKinds]));
  const due = await db
    .select({ id: observationBridgeObligations.id })
    .from(observationBridgeObligations)
    .where(and(...conditions))
    .orderBy(asc(observationBridgeObligations.nextAttemptAt), asc(observationBridgeObligations.id))
    .limit(input.limit ?? 25);
  const claimed: ObservationBridgeObligation[] = [];
  for (const { id } of due) {
    // Conditional on the row still being due and unleased: two workers never both win it.
    const [result] = await db
      .update(observationBridgeObligations)
      .set({ leaseOwner: input.leaseOwner, leaseExpiresAt })
      .where(and(eq(observationBridgeObligations.id, id), ...conditions));
    if ((result as { affectedRows?: number }).affectedRows !== 1) continue;
    const [row] = await db.select().from(observationBridgeObligations).where(eq(observationBridgeObligations.id, id)).limit(1);
    if (row && row.leaseOwner === input.leaseOwner) claimed.push(toRecord(row));
  }
  return claimed;
}

/**
 * Settles one attempt. Fenced by the lease: a worker that no longer holds the
 * lease changes nothing and gets `false`. Retryable outcomes get the next
 * attempt time; settled outcomes are resolved.
 */
export async function settleObservationObligation(input: {
  obligation: Pick<ObservationBridgeObligation, "id" | "tenantId" | "attemptCount">;
  leaseOwner: string;
  settlement: ObservationBridgeSettlement;
  now?: Date;
}): Promise<boolean> {
  const db = await database();
  const now = input.now ?? new Date();
  const attempts = input.obligation.attemptCount + 1;
  const { settlement } = input;
  const retryable = settlement.status === "pending" || settlement.status === "unresolved_identity";
  const [result] = await db
    .update(observationBridgeObligations)
    .set({
      status: settlement.status,
      resultJson: settlement.result ?? null,
      attemptCount: attempts,
      lastError: retryable ? ((settlement as { error?: string }).error ?? null)?.slice(0, 4000) ?? null : null,
      nextAttemptAt: retryable
        ? new Date(now.getTime() + observationRetryDelayMs(attempts, settlement.status as "pending" | "unresolved_identity"))
        : now,
      resolvedAt: retryable ? null : now,
      leaseOwner: null,
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(observationBridgeObligations.id, input.obligation.id),
        eq(observationBridgeObligations.tenantId, input.obligation.tenantId),
        eq(observationBridgeObligations.leaseOwner, input.leaseOwner)
      )
    );
  return (result as { affectedRows?: number }).affectedRows === 1;
}

/** Runs one leased obligation through its handler and settles it. A throwing handler is a transient failure. */
export async function runObservationObligation(input: {
  obligation: ObservationBridgeObligation;
  handler: ObservationBridgeHandler | undefined;
  leaseOwner: string;
  now?: Date;
}): Promise<{ settlement: ObservationBridgeSettlement; settled: boolean }> {
  let settlement: ObservationBridgeSettlement;
  if (!input.handler) {
    settlement = { status: "pending", error: `No observation bridge handler for ${input.obligation.sourceKind}` };
  } else {
    try {
      settlement = await input.handler(input.obligation);
    } catch (error) {
      settlement = { status: "pending", error: error instanceof Error ? error.message : String(error) };
    }
  }
  const settled = await settleObservationObligation({
    obligation: input.obligation,
    leaseOwner: input.leaseOwner,
    settlement,
    now: input.now,
  });
  return { settlement, settled };
}

/**
 * One reconciliation pass: lease due obligations, run each through its
 * handler, settle each. Per-item failures are returned, never swallowed, and
 * never stop the rest of the batch.
 */
export async function drainObservationBridgeObligations(input: {
  handlers: Partial<Record<ObservationBridgeSourceKind, ObservationBridgeHandler>>;
  leaseOwner?: string;
  leaseMs?: number;
  limit?: number;
  now?: Date;
  tenantId?: string;
}): Promise<{
  attempted: number;
  byStatus: Partial<Record<ObservationBridgeStatus, number>>;
  errors: Array<{ id: string; sourceKind: string; sourceKey: string; error: string }>;
}> {
  const leaseOwner = input.leaseOwner?.trim() || `observation-bridge:${randomUUID()}`;
  const claimed = await claimDueObservationObligations({
    leaseOwner,
    leaseMs: input.leaseMs,
    limit: input.limit,
    now: input.now,
    tenantId: input.tenantId,
    sourceKinds: Object.keys(input.handlers) as ObservationBridgeSourceKind[],
  });
  const byStatus: Partial<Record<ObservationBridgeStatus, number>> = {};
  const errors: Array<{ id: string; sourceKind: string; sourceKey: string; error: string }> = [];
  for (const obligation of claimed) {
    const { settlement } = await runObservationObligation({
      obligation,
      handler: input.handlers[obligation.sourceKind],
      leaseOwner,
      now: input.now,
    });
    byStatus[settlement.status] = (byStatus[settlement.status] ?? 0) + 1;
    const error = (settlement as { error?: string }).error;
    if (error) errors.push({ id: obligation.id, sourceKind: obligation.sourceKind, sourceKey: obligation.sourceKey, error });
  }
  return { attempted: claimed.length, byStatus, errors };
}

/**
 * The backlog signal: how many obligations sit in each status, how many need a
 * person, and how long the oldest retryable one has waited. Read-only.
 */
export async function readObservationBridgeBacklog(input: { tenantId?: string; now?: Date } = {}): Promise<{
  byStatus: Record<ObservationBridgeStatus, number>;
  bySourceKind: Partial<Record<ObservationBridgeSourceKind, Partial<Record<ObservationBridgeStatus, number>>>>;
  retrying: number;
  needsReview: number;
  oldestRetryingSince: string | null;
  oldestRetryingAgeMs: number | null;
}> {
  const db = await database();
  const now = input.now ?? new Date();
  const rows = await db
    .select({
      sourceKind: observationBridgeObligations.sourceKind,
      status: observationBridgeObligations.status,
      createdAt: observationBridgeObligations.createdAt,
    })
    .from(observationBridgeObligations)
    .where(input.tenantId ? eq(observationBridgeObligations.tenantId, input.tenantId) : undefined);
  const byStatus = Object.fromEntries(OBSERVATION_BRIDGE_STATUSES.map(status => [status, 0])) as Record<ObservationBridgeStatus, number>;
  const bySourceKind: Partial<Record<ObservationBridgeSourceKind, Partial<Record<ObservationBridgeStatus, number>>>> = {};
  let oldest: Date | null = null;
  for (const row of rows) {
    const status = row.status as ObservationBridgeStatus;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const kind = (bySourceKind[row.sourceKind as ObservationBridgeSourceKind] ??= {});
    kind[status] = (kind[status] ?? 0) + 1;
    if ((RETRYABLE_OBSERVATION_BRIDGE_STATUSES as readonly string[]).includes(status) && (!oldest || row.createdAt < oldest))
      oldest = row.createdAt;
  }
  return {
    byStatus,
    bySourceKind,
    retrying: byStatus.pending + byStatus.unresolved_identity,
    needsReview: byStatus.ambiguous_review,
    oldestRetryingSince: oldest?.toISOString() ?? null,
    oldestRetryingAgeMs: oldest ? Math.max(0, now.getTime() - oldest.getTime()) : null,
  };
}
