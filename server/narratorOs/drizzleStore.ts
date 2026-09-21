import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  narratorOsEventLedger,
  narratorOsKnowledge,
  narratorOsOperator,
} from "../../drizzle/schema";
import type {
  AuthoredFact,
  KnowledgePlane,
  KnowledgeState,
  NarrativeEventLedgerEntry,
  NarrativeState,
  PersistedVerifiedGoldlineReceipt,
} from "../../shared/narratorOs/contracts";
import { getDb } from "../db";
import {
  isMysqlDuplicateKeyError,
  isMysqlMissingTableError,
} from "../mysqlErrors";
import { CLAIRE_LIVED_BIO_FACTS, NARRATOR_LIVED_BIO_VERSION } from "./livedBio";
import {
  EMPTY_KNOWLEDGE,
  SEEDED_NARRATIVE_STATE,
  cloneKnowledge,
  type NarratorSnapshot,
  type NarratorStore,
  type OperatorScope,
} from "./store";
import { NARRATOR_WORLD_TRUTH_VERSION, WORLD_TRUTH_FACTS } from "./worldTruth";
import { resolveDuplicateNarratorLedgerInsert } from "./goldlineLedgerReplay";
import { withAuthoritativeNarratorStoreSnapshots } from "./narratorSnapshotAttestation";

function seedState(): NarrativeState {
  return {
    values: { ...SEEDED_NARRATIVE_STATE.values },
    closedForwardPaths: [],
    holdOpenedAtMs: {},
  };
}

function knowledgeFromRows(
  rows: (typeof narratorOsKnowledge.$inferSelect)[]
): KnowledgeState {
  const knowledge = cloneKnowledge(EMPTY_KNOWLEDGE);
  for (const row of rows) {
    const plane = knowledge.planes[row.plane as KnowledgePlane];
    if (row.known && !plane.knownFactIds.includes(row.factId)) {
      plane.knownFactIds = [...plane.knownFactIds, row.factId];
    }
    plane.factKinds = {
      ...plane.factKinds,
      [row.factId]: row.factKind as "EVENT_FACT" | "CHARACTER_INTERPRETATION",
    };
    if (row.interpretationText) {
      plane.interpretations = {
        ...plane.interpretations,
        [row.factId]: row.interpretationText,
      };
    }
  }
  return knowledge;
}

function ledgerFromRow(
  row: typeof narratorOsEventLedger.$inferSelect
): NarrativeEventLedgerEntry {
  const payload = (row.payloadJson ?? {}) as {
    evidenceRef?: NarrativeEventLedgerEntry["evidenceRef"];
    persistedVerifiedGoldline?: PersistedVerifiedGoldlineReceipt | null;
  };
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorUserId: row.operatorUserId,
    kind: row.kind,
    beatId: (row.beatId as NarrativeEventLedgerEntry["beatId"]) ?? null,
    goldlineOutcomeId: row.goldlineOutcomeId,
    offscreen: Boolean(row.offscreen),
    playerVisible: Boolean(row.playerVisible),
    evidenceRef: payload.evidenceRef ?? null,
    occurredAt: row.occurredAt.toISOString(),
    idempotencyKey: row.idempotencyKey,
    persistedVerifiedGoldline: payload.persistedVerifiedGoldline ?? null,
  };
}

function ledgerPayloadJson(entry: NarrativeEventLedgerEntry): {
  evidenceRef: NarrativeEventLedgerEntry["evidenceRef"];
  persistedVerifiedGoldline: PersistedVerifiedGoldlineReceipt | null;
} {
  return {
    evidenceRef: entry.evidenceRef,
    persistedVerifiedGoldline: entry.persistedVerifiedGoldline ?? null,
  };
}

function knowledgeRowsFor(
  scope: OperatorScope,
  knowledge: KnowledgeState
): {
  id: string;
  tenantId: string;
  operatorUserId: string;
  plane: "PLAYER" | "CLAIRE" | "CHEMIST" | "OTHER";
  factId: string;
  factKind: "EVENT_FACT" | "CHARACTER_INTERPRETATION";
  known: boolean;
  interpretationText: string | null;
}[] {
  return (["PLAYER", "CLAIRE", "CHEMIST", "OTHER"] as const).flatMap(plane => {
    const state = knowledge.planes[plane];
    const factIds = new Set([
      ...state.knownFactIds,
      ...Object.keys(state.interpretations),
    ]);
    return [...factIds].map(factId => ({
      id: randomUUID(),
      tenantId: scope.tenantId,
      operatorUserId: scope.operatorUserId,
      plane,
      factId,
      factKind: (state.factKinds[factId] ??
        (state.interpretations[factId]
          ? "CHARACTER_INTERPRETATION"
          : "EVENT_FACT")) as "EVENT_FACT" | "CHARACTER_INTERPRETATION",
      known: state.knownFactIds.includes(factId),
      interpretationText: state.interpretations[factId] ?? null,
    }));
  });
}

export { resolveDuplicateNarratorLedgerInsert } from "./goldlineLedgerReplay";
export function createDrizzleNarratorStore(): NarratorStore {
  const store: NarratorStore = {
    async initOperator(scope) {
      const existing = await this.load(scope);
      if (existing) return existing;
      const db = await getDb();
      if (!db) {
        return {
          ...scope,
          worldTruth: WORLD_TRUTH_FACTS,
          livedBio: CLAIRE_LIVED_BIO_FACTS,
          knowledge: cloneKnowledge(EMPTY_KNOWLEDGE),
          narrativeState: seedState(),
          ledger: [],
          catalogVersion: {
            worldTruth: NARRATOR_WORLD_TRUTH_VERSION,
            livedBio: NARRATOR_LIVED_BIO_VERSION,
          },
        };
      }
      try {
        await db.insert(narratorOsOperator).values({
          id: randomUUID(),
          tenantId: scope.tenantId,
          operatorUserId: scope.operatorUserId,
          worldTruthJson: WORLD_TRUTH_FACTS,
          livedBioJson: CLAIRE_LIVED_BIO_FACTS,
          narrativeStateJson: seedState(),
          worldTruthVersion: NARRATOR_WORLD_TRUTH_VERSION,
          livedBioVersion: NARRATOR_LIVED_BIO_VERSION,
        });
      } catch (error) {
        if (
          !isMysqlDuplicateKeyError(error) &&
          !isMysqlMissingTableError(error)
        ) {
          throw error;
        }
      }
      return (
        (await this.load(scope)) ?? {
          ...scope,
          worldTruth: WORLD_TRUTH_FACTS,
          livedBio: CLAIRE_LIVED_BIO_FACTS,
          knowledge: cloneKnowledge(EMPTY_KNOWLEDGE),
          narrativeState: seedState(),
          ledger: [],
          catalogVersion: {
            worldTruth: NARRATOR_WORLD_TRUTH_VERSION,
            livedBio: NARRATOR_LIVED_BIO_VERSION,
          },
        }
      );
    },
    async load(scope) {
      const db = await getDb();
      if (!db) return null;
      try {
        const [operator] = await db
          .select()
          .from(narratorOsOperator)
          .where(
            and(
              eq(narratorOsOperator.tenantId, scope.tenantId),
              eq(narratorOsOperator.operatorUserId, scope.operatorUserId)
            )
          )
          .limit(1);
        if (!operator) return null;
        const knowledgeRows = await db
          .select()
          .from(narratorOsKnowledge)
          .where(
            and(
              eq(narratorOsKnowledge.tenantId, scope.tenantId),
              eq(narratorOsKnowledge.operatorUserId, scope.operatorUserId)
            )
          );
        const ledgerRows = await db
          .select()
          .from(narratorOsEventLedger)
          .where(
            and(
              eq(narratorOsEventLedger.tenantId, scope.tenantId),
              eq(narratorOsEventLedger.operatorUserId, scope.operatorUserId)
            )
          );
        return {
          ...scope,
          worldTruth: operator.worldTruthJson as AuthoredFact[],
          livedBio: operator.livedBioJson as AuthoredFact[],
          knowledge: knowledgeFromRows(knowledgeRows),
          narrativeState: operator.narrativeStateJson as NarrativeState,
          ledger: ledgerRows.map(ledgerFromRow),
          catalogVersion: {
            worldTruth: operator.worldTruthVersion,
            livedBio: operator.livedBioVersion,
          },
        };
      } catch (error) {
        if (isMysqlMissingTableError(error)) return null;
        throw error;
      }
    },
    async replaceKnowledge(scope, knowledge) {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.transaction(async tx => {
        await tx
          .delete(narratorOsKnowledge)
          .where(
            and(
              eq(narratorOsKnowledge.tenantId, scope.tenantId),
              eq(narratorOsKnowledge.operatorUserId, scope.operatorUserId)
            )
          );
        const rows = knowledgeRowsFor(scope, knowledge);
        if (rows.length) await tx.insert(narratorOsKnowledge).values(rows);
      });
    },
    async replaceNarrativeState(scope, state) {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db
        .update(narratorOsOperator)
        .set({ narrativeStateJson: state })
        .where(
          and(
            eq(narratorOsOperator.tenantId, scope.tenantId),
            eq(narratorOsOperator.operatorUserId, scope.operatorUserId)
          )
        );
    },
    async appendLedger(scope, entry) {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const stored: NarrativeEventLedgerEntry = {
        ...entry,
        id: entry.id ?? randomUUID(),
        tenantId: scope.tenantId,
        operatorUserId: scope.operatorUserId,
      };
      try {
        await db.insert(narratorOsEventLedger).values({
          id: stored.id,
          tenantId: stored.tenantId,
          operatorUserId: stored.operatorUserId,
          kind: stored.kind,
          beatId: stored.beatId,
          goldlineOutcomeId: stored.goldlineOutcomeId,
          offscreen: stored.offscreen,
          playerVisible: stored.playerVisible,
          payloadJson: ledgerPayloadJson(stored),
          occurredAt: new Date(stored.occurredAt),
          idempotencyKey: stored.idempotencyKey,
        });
      } catch (error) {
        if (isMysqlDuplicateKeyError(error)) {
          const [existing] = await db
            .select()
            .from(narratorOsEventLedger)
            .where(
              and(
                eq(narratorOsEventLedger.tenantId, scope.tenantId),
                eq(narratorOsEventLedger.idempotencyKey, stored.idempotencyKey)
              )
            )
            .limit(1);
          if (existing) {
            // Duplicate Goldline rows must verify payload identity; never
            // return ledgerFromRow(existing) without conflict detection.
            return resolveDuplicateNarratorLedgerInsert(
              ledgerFromRow(existing),
              stored
            );
          }
        }
        throw error;
      }
      return stored;
    },
    async commitAtomic(scope, commit) {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const stored: NarrativeEventLedgerEntry = {
        ...commit.ledgerEntry,
        id: commit.ledgerEntry.id ?? randomUUID(),
        tenantId: scope.tenantId,
        operatorUserId: scope.operatorUserId,
      };
      try {
        await db.transaction(async tx => {
          await tx
            .delete(narratorOsKnowledge)
            .where(
              and(
                eq(narratorOsKnowledge.tenantId, scope.tenantId),
                eq(narratorOsKnowledge.operatorUserId, scope.operatorUserId)
              )
            );
          const rows = knowledgeRowsFor(scope, commit.knowledge);
          if (rows.length) await tx.insert(narratorOsKnowledge).values(rows);
          await tx
            .update(narratorOsOperator)
            .set({ narrativeStateJson: commit.narrativeState })
            .where(
              and(
                eq(narratorOsOperator.tenantId, scope.tenantId),
                eq(narratorOsOperator.operatorUserId, scope.operatorUserId)
              )
            );
          await tx.insert(narratorOsEventLedger).values({
            id: stored.id,
            tenantId: stored.tenantId,
            operatorUserId: stored.operatorUserId,
            kind: stored.kind,
            beatId: stored.beatId,
            goldlineOutcomeId: stored.goldlineOutcomeId,
            offscreen: stored.offscreen,
            playerVisible: stored.playerVisible,
            payloadJson: ledgerPayloadJson(stored),
            occurredAt: new Date(stored.occurredAt),
            idempotencyKey: stored.idempotencyKey,
          });
        });
      } catch (error) {
        if (isMysqlDuplicateKeyError(error)) {
          throw new Error(
            `Non-repeatable or duplicate narrator ledger key: ${stored.idempotencyKey}`
          );
        }
        throw error;
      }
      return stored;
    },
  };
  return withAuthoritativeNarratorStoreSnapshots(store);
}
