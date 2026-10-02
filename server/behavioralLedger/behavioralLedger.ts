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
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  behavioralLedgerEvents,
  type BehavioralLedgerEvent,
  type InsertBehavioralLedgerEvent,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import type { LedgerEventInput, LedgerEventType, LedgerSourceSystem } from "../../shared/behavioralLedger";

export const DEFAULT_BOUNDED_OPERATOR_LEDGER_LIMIT = 200;
export const MAX_BOUNDED_OPERATOR_LEDGER_LIMIT = 500;

export type BoundedLedgerReadEvent = {
  id: number;
  tenantId: string;
  operatorUserId: string;
  correlationId: string;
  sourceSystem: LedgerSourceSystem;
  sourceEntityType: string;
  sourceEntityId: string;
  eventType: LedgerEventType;
  occurredAt: Date;
  verificationClass: "VERIFIED" | "ATTESTED" | "CLAIMED" | null;
  provenance: string;
  evidenceSource: string | null;
  decisionPointId: string | null;
  availability: boolean | null;
  eligibleOptionsJson: unknown;
  assignedOption: string | null;
  assignmentProbability: string | null;
  interventionPolicyVersion: number | null;
  interventionDefinitionVersion: number | null;
  proximalOutcomeWindowMinutes: number | null;
  idempotencyKey: string;
};

export type BehavioralLedgerStore = {
  insertIfAbsent(input: InsertBehavioralLedgerEvent): Promise<BehavioralLedgerEvent | null>;
  listByCorrelation(tenantId: string, correlationId: string): Promise<BehavioralLedgerEvent[]>;
  listByOperatorSource?(
    tenantId: string,
    operatorUserId: string,
    sourceEntityId: string
  ): Promise<BehavioralLedgerEvent[]>;
  listByOperatorCorrelation?(
    tenantId: string,
    operatorUserId: string,
    correlationId: string
  ): Promise<BehavioralLedgerEvent[]>;
  listByDecisionPoint?(
    tenantId: string,
    decisionPointId: string
  ): Promise<BehavioralLedgerEvent[]>;
  listByOperatorBounded?(
    tenantId: string,
    operatorUserIds: string[],
    limit?: number
  ): Promise<BoundedLedgerReadEvent[]>;
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
  async listByOperatorCorrelation(tenantId, operatorUserId, correlationId) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(behavioralLedgerEvents)
      .where(
        and(
          eq(behavioralLedgerEvents.tenantId, tenantId),
          eq(behavioralLedgerEvents.operatorUserId, operatorUserId),
          eq(behavioralLedgerEvents.correlationId, correlationId)
        )
      )
      .orderBy(asc(behavioralLedgerEvents.occurredAt), asc(behavioralLedgerEvents.id));
  },
  async listByDecisionPoint(tenantId, decisionPointId) {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(behavioralLedgerEvents)
      .where(
        and(
          eq(behavioralLedgerEvents.tenantId, tenantId),
          eq(behavioralLedgerEvents.decisionPointId, decisionPointId)
        )
      )
      .orderBy(asc(behavioralLedgerEvents.occurredAt), asc(behavioralLedgerEvents.id));
  },
  async listByOperatorBounded(tenantId, operatorUserIds, limit = DEFAULT_BOUNDED_OPERATOR_LEDGER_LIMIT) {
    if (!tenantId || !operatorUserIds.length) return [];
    const db = await getDb();
    if (!db) {
      throw new Error("Behavioral ledger database unavailable for bounded read");
    }
    const boundedLimit = Math.min(Math.max(1, limit), MAX_BOUNDED_OPERATOR_LEDGER_LIMIT);
    const where =
      operatorUserIds.length === 1
        ? and(
            eq(behavioralLedgerEvents.tenantId, tenantId),
            eq(behavioralLedgerEvents.operatorUserId, operatorUserIds[0])
          )
        : and(
            eq(behavioralLedgerEvents.tenantId, tenantId),
            inArray(behavioralLedgerEvents.operatorUserId, operatorUserIds)
          );

    return db
      .select({
        id: behavioralLedgerEvents.id,
        tenantId: behavioralLedgerEvents.tenantId,
        operatorUserId: behavioralLedgerEvents.operatorUserId,
        correlationId: behavioralLedgerEvents.correlationId,
        sourceSystem: behavioralLedgerEvents.sourceSystem,
        sourceEntityType: behavioralLedgerEvents.sourceEntityType,
        sourceEntityId: behavioralLedgerEvents.sourceEntityId,
        eventType: behavioralLedgerEvents.eventType,
        occurredAt: behavioralLedgerEvents.occurredAt,
        verificationClass: behavioralLedgerEvents.verificationClass,
        provenance: behavioralLedgerEvents.provenance,
        evidenceSource: behavioralLedgerEvents.evidenceSource,
        decisionPointId: behavioralLedgerEvents.decisionPointId,
        availability: behavioralLedgerEvents.availability,
        eligibleOptionsJson: behavioralLedgerEvents.eligibleOptionsJson,
        assignedOption: behavioralLedgerEvents.assignedOption,
        assignmentProbability: behavioralLedgerEvents.assignmentProbability,
        interventionPolicyVersion: behavioralLedgerEvents.interventionPolicyVersion,
        interventionDefinitionVersion: behavioralLedgerEvents.interventionDefinitionVersion,
        proximalOutcomeWindowMinutes: behavioralLedgerEvents.proximalOutcomeWindowMinutes,
        idempotencyKey: behavioralLedgerEvents.idempotencyKey,
      })
      .from(behavioralLedgerEvents)
      .where(where)
      .orderBy(desc(behavioralLedgerEvents.occurredAt), desc(behavioralLedgerEvents.id))
      .limit(boundedLimit);
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

/** History for one behavioral subject. For ops tasks: correlationId `ops_task:<taskId>`. */
export async function listBehavioralLedgerEventsForOperatorCorrelation(
  tenantId: string,
  operatorUserId: string,
  correlationId: string,
  store: BehavioralLedgerStore = drizzleBehavioralLedgerStore
): Promise<BehavioralLedgerEvent[]> {
  if (store.listByOperatorCorrelation) {
    return store.listByOperatorCorrelation(tenantId, operatorUserId, correlationId);
  }
  const correlated = await store.listByCorrelation(tenantId, correlationId);
  return correlated.filter(row => row.operatorUserId === operatorUserId);
}

export async function listBehavioralLedgerEventsForDecisionPoint(
  tenantId: string,
  decisionPointId: string,
  store: BehavioralLedgerStore = drizzleBehavioralLedgerStore
): Promise<BehavioralLedgerEvent[]> {
  if (store.listByDecisionPoint) {
    return store.listByDecisionPoint(tenantId, decisionPointId);
  }
  return [];
}

/**
 * Stage 1 Operator Context bounded read:
 * - Scoped by tenantId
 * - Scoped by authorized mapped operatorUserId(s)
 * - Fixed explicit maximum limit
 * - Backed by index `idx_behavioral_ledger_tenant_operator`
 * - Never performs a tenant-wide full table scan
 */
export async function listBehavioralLedgerEventsForOperatorBounded(
  input: {
    tenantId: string;
    operatorUserIds: string[];
    limit?: number;
  },
  store: BehavioralLedgerStore = drizzleBehavioralLedgerStore
): Promise<BoundedLedgerReadEvent[]> {
  const tenantId = input.tenantId?.trim();
  const operatorUserIds = (input.operatorUserIds ?? []).map(id => id.trim()).filter(Boolean);
  if (!tenantId || !operatorUserIds.length) return [];
  if (!store.listByOperatorBounded) {
    throw new Error("Behavioral ledger store does not implement listByOperatorBounded");
  }
  return store.listByOperatorBounded(tenantId, operatorUserIds, input.limit);
}

