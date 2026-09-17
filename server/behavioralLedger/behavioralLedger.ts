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
import { and, eq } from "drizzle-orm";
import {
  behavioralLedgerEvents,
  type BehavioralLedgerEvent,
  type InsertBehavioralLedgerEvent,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { LedgerEventInput } from "../../shared/behavioralLedger";

export type BehavioralLedgerStore = {
  insertIfAbsent(input: InsertBehavioralLedgerEvent): Promise<BehavioralLedgerEvent | null>;
  listByCorrelation(tenantId: string, correlationId: string): Promise<BehavioralLedgerEvent[]>;
};

const drizzleBehavioralLedgerStore: BehavioralLedgerStore = {
  async insertIfAbsent(input) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const existing = await db
      .select()
      .from(behavioralLedgerEvents)
      .where(
        and(
          eq(behavioralLedgerEvents.tenantId, input.tenantId),
          eq(behavioralLedgerEvents.idempotencyKey, input.idempotencyKey)
        )
      )
      .limit(1);
    if (existing[0]) return existing[0];

    await db.insert(behavioralLedgerEvents).values(input);
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
      );
  },
};

/**
 * Records one observed behavioral event. Fails closed: unresolved identity or
 * an unavailable database results in a no-op (null), never a thrown error
 * surfaced mid-caller — the same contract as recordClaireAttestedEvent.
 *
 * Idempotent by (tenantId, idempotencyKey): callers must derive a stable key
 * from the source transition (e.g. `ops_task:${taskId}:started`), not from a
 * timestamp, so retries/replays of the same authoritative write never
 * duplicate a row.
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
