/**
 * Behavioral Ledger — Slice 1 (see docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md).
 *
 * Authoritative event-emission surface. This is the ONLY place production code
 * should call to record a ledger event, mirroring the discipline in
 * server/claire/character/relationshipEmitters.ts: append-only, idempotent,
 * fails closed on unresolved identity, never callable by a model directly.
 *
 * Emit only from authoritative server-side state transitions — never from a
 * React render, a poll, or an incidental read. A UI opening or a mission
 * animation must never produce a STARTED or COMPLETED row.
 */
import { and, asc, eq } from "drizzle-orm";
import {
  behavioralLedgerEvents,
  type BehavioralLedgerEvent,
  type InsertBehavioralLedgerEvent,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import type { LedgerEventInput } from "../../shared/behavioralLedger";

export type BehavioralLedgerStore = {
  insertIfAbsent(input: InsertBehavioralLedgerEvent): Promise<BehavioralLedgerEvent | null>;
  listByCorrelation(tenantId: string, correlationId: string): Promise<BehavioralLedgerEvent[]>;
  listByOperatorSource?(
    tenantId: string,
    operatorUserId: string,
    sourceEntityId: string
  ): Promise<BehavioralLedgerEvent[]>;
};

async function findExistingByIdempotencyKey(
  input: Pick<InsertBehavioralLedgerEvent, "tenantId" | "idempotencyKey">
): Promise<BehavioralLedgerEvent | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .select()
    .from(behavioralLedgerEvents)
    .where(
      and(
        eq(behavioralLedgerEvents.tenantId, input.tenantId),
        eq(behavioralLedgerEvents.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);
  return row ?? null;
}

const drizzleBehavioralLedgerStore: BehavioralLedgerStore = {
  async insertIfAbsent(input) {
    const existing = await findExistingByIdempotencyKey(input);
    if (existing) return existing;

    const db = await getDb();
    if (!db) throw new Error("Database not available");
    try {
      await db.insert(behavioralLedgerEvents).values(input);
    } catch (error) {
      // SELECT-then-INSERT alone is not concurrency-safe. The database unique
      // key is the arbiter: if another retry won the race, return that row
      // instead of turning an idempotent replay into a caller-visible failure.
      if (!isMysqlDuplicateKeyError(error)) throw error;
    }

    return findExistingByIdempotencyKey(input);
  },

    async listByCorrelation(tenantId, correlationId) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(behavioralLedgerEvents)
      .where(
        and(
          eq(behavioralLedgerEvents.tenantId, tenantId),
          eq(behavioralLedgerEvents.correlationId, correlationId)
        )
      )
      .orderBy(asc(behavioralLedgerEvents.occurredAt), asc(behavioralLedgerEvents.id));
  },
  async listByOperatorSource(tenantId, operatorUserId, sourceEntityId) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(behavioralLedgerEvents)
      .where(
        and(
          eq(behavioralLedgerEvents.tenantId, tenantId),
          eq(behavioralLedgerEvents.operatorUserId, operatorUserId),
          eq(behavioralLedgerEvents.sourceEntityId, sourceEntityId)
        )
      )
      .orderBy(asc(behavioralLedgerEvents.occurredAt), asc(behavioralLedgerEvents.id));
  },
};

/**
 * Records one observed behavioral event.
 *
 * Unresolved identity is a no-op rather than fabricated truth. Database errors
 * are not swallowed here: callers that mirror an already-authoritative source
 * event may catch/report infrastructure failure so telemetry cannot make the
 * underlying business transition appear to fail.
 *
 * Idempotent by (tenantId, idempotencyKey): callers should derive the key from
 * the immutable source event/transition identity, not merely from event type.
 * That preserves legitimate repeated behavior while deduplicating a replay of
 * the same source event.
 */
export async function recordBehavioralLedgerEvent(
  input: LedgerEventInput,
  store: BehavioralLedgerStore = drizzleBehavioralLedgerStore
): Promise<BehavioralLedgerEvent | null> {
  if (!input.tenantId || !input.operatorUserId) return null;

  const dp = input.decisionPoint ?? null;
  return store.insertIfAbsent({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    correlationId: input.correlationId,
    sourceSystem: input.sourceSystem,
    sourceEntityType: input.sourceEntityType,
    sourceEntityId: input.sourceEntityId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    verificationClass: input.verificationClass,
    provenance: input.provenance,
    evidenceSource: input.evidenceSource ?? null,
    decisionPointId: dp?.decisionPointId ?? null,
    availability: dp?.availability ?? null,
    eligibleOptionsJson: dp?.eligibleOptions ?? null,
    assignedOption: dp?.assignedOption ?? null,
    assignmentProbability: dp?.assignmentProbability != null ? String(dp.assignmentProbability) : null,
    interventionPolicyVersion: dp?.interventionPolicyVersion ?? null,
    interventionDefinitionVersion: dp?.interventionDefinitionVersion ?? null,
    proximalOutcomeWindowMinutes: dp?.proximalOutcomeWindowMinutes ?? null,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function listBehavioralLedgerEventsForCorrelation(
  tenantId: string,
  correlationId: string,
  store: BehavioralLedgerStore = drizzleBehavioralLedgerStore
): Promise<BehavioralLedgerEvent[]> {
  return store.listByCorrelation(tenantId, correlationId);
}

export async function listBehavioralLedgerEventsForOperatorSource(
  tenantId: string,
  operatorUserId: string,
  sourceEntityId: string,
  store: BehavioralLedgerStore = drizzleBehavioralLedgerStore
): Promise<BehavioralLedgerEvent[]> {
  if (store.listByOperatorSource) {
    return store.listByOperatorSource(tenantId, operatorUserId, sourceEntityId);
  }
  const correlated = await store.listByCorrelation(tenantId, sourceEntityId);
  return correlated.filter(
    row => row.operatorUserId === operatorUserId && row.sourceEntityId === sourceEntityId
  );
}
