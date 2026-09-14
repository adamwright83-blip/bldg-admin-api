import { and, desc, eq } from "drizzle-orm";
import {
  claireGenerationLogs,
  claireRelationshipEvents,
  claireRelationshipState,
  claireTierTransitions,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import type {
  CharacterId,
  ClaireRelationshipEvent,
  ClaireRelationshipEventInput,
  ClaireRelationshipState,
  ClaireTierTransition,
} from "./types";

/**
 * Narrow persistence seam for the character substrate. Production uses the
 * real (Drizzle/MySQL) implementation below; tests inject an in-memory
 * implementation (character/testStore.ts) so relationship-progression
 * end-to-end behavior can be proven deterministically without a live
 * database — this repo has no local MySQL, so that's the only way to
 * exercise "append event -> recompute -> tier transition -> retrieval" as
 * a real integration rather than only pure-function unit tests.
 */
export type ClaireRelationshipStore = {
  appendEvent(input: ClaireRelationshipEventInput): Promise<ClaireRelationshipEvent | null>;
  listEvents(input: {
    tenantId: string;
    operatorUserId: string;
    characterId: CharacterId;
    limit?: number;
  }): Promise<ClaireRelationshipEvent[]>;
  getState(input: {
    tenantId: string;
    operatorUserId: string;
    characterId: CharacterId;
  }): Promise<ClaireRelationshipState | null>;
  upsertState(state: Omit<ClaireRelationshipState, "updatedAt">): Promise<void>;
  insertTierTransition(
    transition: Omit<ClaireTierTransition, "createdAt">
  ): Promise<void>;
  listTierTransitions(input: {
    tenantId: string;
    operatorUserId: string;
    characterId: CharacterId;
  }): Promise<ClaireTierTransition[]>;
};

function toEventRecord(
  row: typeof claireRelationshipEvents.$inferSelect
): ClaireRelationshipEvent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorUserId: row.operatorUserId,
    characterId: row.characterId as CharacterId,
    eventType: row.eventType as ClaireRelationshipEvent["eventType"],
    summary: row.summary,
    provenance: row.provenance,
    relatedEntityType: row.relatedEntityType ?? null,
    relatedEntityId: row.relatedEntityId ?? null,
    evidenceSource: row.evidenceSource ?? null,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toStateRecord(
  row: typeof claireRelationshipState.$inferSelect
): ClaireRelationshipState {
  return {
    tenantId: row.tenantId,
    operatorUserId: row.operatorUserId,
    characterId: row.characterId as CharacterId,
    professionalRespect: row.professionalRespect,
    reliability: row.reliability,
    disclosureSafety: row.disclosureSafety,
    familiarity: row.familiarity,
    disclosureTier: row.disclosureTier as ClaireRelationshipState["disclosureTier"],
    qualifyingInteractionCount: row.qualifyingInteractionCount,
    distinctInteractionDays: row.distinctInteractionDays,
    lastEventId: row.lastEventId ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createDrizzleClaireRelationshipStore(): ClaireRelationshipStore {
  return {
    async appendEvent(input) {
      const db = await getDb();
      if (!db) return null;
      const occurredAt = input.occurredAt ?? new Date();
      const [result] = await db.insert(claireRelationshipEvents).values({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        characterId: input.characterId ?? "claire",
        eventType: input.eventType,
        summary: input.summary,
        provenance: input.provenance,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
        evidenceSource: input.evidenceSource ?? null,
        occurredAt,
      });
      const insertedId = (result as { insertId?: number }).insertId;
      if (!insertedId) return null;
      const [row] = await db
        .select()
        .from(claireRelationshipEvents)
        .where(eq(claireRelationshipEvents.id, insertedId))
        .limit(1);
      return row ? toEventRecord(row) : null;
    },

    async listEvents(input) {
      const db = await getDb();
      if (!db) return [];
      const query = db
        .select()
        .from(claireRelationshipEvents)
        .where(
          and(
            eq(claireRelationshipEvents.tenantId, input.tenantId),
            eq(claireRelationshipEvents.operatorUserId, input.operatorUserId),
            eq(claireRelationshipEvents.characterId, input.characterId)
          )
        )
        .orderBy(desc(claireRelationshipEvents.occurredAt));
      const rows = input.limit ? await query.limit(input.limit) : await query;
      return rows.map(toEventRecord).reverse();
    },

    async getState(input) {
      const db = await getDb();
      if (!db) return null;
      const [row] = await db
        .select()
        .from(claireRelationshipState)
        .where(
          and(
            eq(claireRelationshipState.tenantId, input.tenantId),
            eq(claireRelationshipState.operatorUserId, input.operatorUserId),
            eq(claireRelationshipState.characterId, input.characterId)
          )
        )
        .limit(1);
      return row ? toStateRecord(row) : null;
    },

    async upsertState(state) {
      const db = await getDb();
      if (!db) return;
      const values = {
        tenantId: state.tenantId,
        operatorUserId: state.operatorUserId,
        characterId: state.characterId,
        professionalRespect: state.professionalRespect,
        reliability: state.reliability,
        disclosureSafety: state.disclosureSafety,
        familiarity: state.familiarity,
        disclosureTier: state.disclosureTier,
        qualifyingInteractionCount: state.qualifyingInteractionCount,
        distinctInteractionDays: state.distinctInteractionDays,
        lastEventId: state.lastEventId,
      };
      await db
        .insert(claireRelationshipState)
        .values(values)
        .onDuplicateKeyUpdate({ set: values });
    },

    async insertTierTransition(transition) {
      const db = await getDb();
      if (!db) return;
      await db.insert(claireTierTransitions).values({
        tenantId: transition.tenantId,
        operatorUserId: transition.operatorUserId,
        characterId: transition.characterId,
        fromTier: transition.fromTier,
        toTier: transition.toTier,
        reasonsJson: transition.reasons,
        supportingEventIdsJson: transition.supportingEventIds,
      });
    },

    async listTierTransitions(input) {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(claireTierTransitions)
        .where(
          and(
            eq(claireTierTransitions.tenantId, input.tenantId),
            eq(claireTierTransitions.operatorUserId, input.operatorUserId),
            eq(claireTierTransitions.characterId, input.characterId)
          )
        );
      return rows.map(row => ({
        tenantId: row.tenantId,
        operatorUserId: row.operatorUserId,
        characterId: row.characterId as CharacterId,
        fromTier: row.fromTier as ClaireTierTransition["fromTier"],
        toTier: row.toTier as ClaireTierTransition["toTier"],
        reasons: row.reasonsJson as string[],
        supportingEventIds: row.supportingEventIdsJson as number[],
        createdAt: row.createdAt.toISOString(),
      }));
    },
  };
}

let sharedStore: ClaireRelationshipStore | null = null;

/** The production store, lazily constructed. Tests should pass an explicit store instead of touching this. */
export function getClaireRelationshipStore(): ClaireRelationshipStore {
  if (!sharedStore) sharedStore = createDrizzleClaireRelationshipStore();
  return sharedStore;
}

/** Test-only seam: swap the shared store (e.g. for an in-memory fake). */
export function setClaireRelationshipStoreForTesting(
  store: ClaireRelationshipStore | null
): void {
  sharedStore = store;
}

export { claireGenerationLogs };
