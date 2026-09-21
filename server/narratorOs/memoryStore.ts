import { randomUUID } from "node:crypto";
import { CLAIRE_LIVED_BIO_FACTS, NARRATOR_LIVED_BIO_VERSION } from "./livedBio";
import {
  EMPTY_KNOWLEDGE,
  SEEDED_NARRATIVE_STATE,
  cloneKnowledge,
  type NarratorSnapshot,
  type NarratorStore,
  type OperatorScope,
} from "./store";
import type {
  KnowledgeState,
  NarrativeEventLedgerEntry,
  NarrativeState,
} from "../../shared/narratorOs/contracts";
import { WORLD_TRUTH_FACTS, NARRATOR_WORLD_TRUTH_VERSION } from "./worldTruth";

function keyOf(scope: OperatorScope): string {
  return `${scope.tenantId}::${scope.operatorUserId}`;
}

function seedSnapshot(scope: OperatorScope): NarratorSnapshot {
  return {
    ...scope,
    worldTruth: WORLD_TRUTH_FACTS,
    livedBio: CLAIRE_LIVED_BIO_FACTS,
    knowledge: cloneKnowledge(EMPTY_KNOWLEDGE),
    narrativeState: {
      values: { ...SEEDED_NARRATIVE_STATE.values },
      closedForwardPaths: [],
      holdOpenedAtMs: {},
    },
    ledger: [],
    catalogVersion: {
      worldTruth: NARRATOR_WORLD_TRUTH_VERSION,
      livedBio: NARRATOR_LIVED_BIO_VERSION,
    },
  };
}

export function createInMemoryNarratorStore(): NarratorStore {
  const rows = new Map<string, NarratorSnapshot>();

  return {
    async initOperator(scope) {
      const existing = rows.get(keyOf(scope));
      if (existing) return existing;
      const seeded = seedSnapshot(scope);
      rows.set(keyOf(scope), seeded);
      return seeded;
    },
    async load(scope) {
      return rows.get(keyOf(scope)) ?? null;
    },
    async replaceKnowledge(scope, knowledge: KnowledgeState) {
      const current = rows.get(keyOf(scope));
      if (!current) throw new Error("Narrator operator is not initialized");
      rows.set(keyOf(scope), {
        ...current,
        knowledge: cloneKnowledge(knowledge),
      });
    },
    async replaceNarrativeState(scope, state: NarrativeState) {
      const current = rows.get(keyOf(scope));
      if (!current) throw new Error("Narrator operator is not initialized");
      rows.set(keyOf(scope), {
        ...current,
        narrativeState: {
          values: { ...state.values },
          closedForwardPaths: [...state.closedForwardPaths],
          holdOpenedAtMs: { ...state.holdOpenedAtMs },
        },
      });
    },
    async appendLedger(scope, entry) {
      const current = rows.get(keyOf(scope));
      if (!current) throw new Error("Narrator operator is not initialized");
      const duplicate = current.ledger.find(
        row => row.idempotencyKey === entry.idempotencyKey
      );
      if (duplicate) return duplicate;
      const stored: NarrativeEventLedgerEntry = {
        ...entry,
        id: entry.id ?? randomUUID(),
        tenantId: scope.tenantId,
        operatorUserId: scope.operatorUserId,
      };
      rows.set(keyOf(scope), {
        ...current,
        ledger: [...current.ledger, stored],
      });
      return stored;
    },
    async commitAtomic(scope, commit) {
      const current = rows.get(keyOf(scope));
      if (!current) throw new Error("Narrator operator is not initialized");
      const duplicate = current.ledger.find(
        row => row.idempotencyKey === commit.ledgerEntry.idempotencyKey
      );
      if (duplicate) {
        rows.set(keyOf(scope), {
          ...current,
          knowledge: cloneKnowledge(commit.knowledge),
          narrativeState: {
            values: { ...commit.narrativeState.values },
            closedForwardPaths: [...commit.narrativeState.closedForwardPaths],
            holdOpenedAtMs: { ...commit.narrativeState.holdOpenedAtMs },
          },
        });
        return duplicate;
      }
      const stored: NarrativeEventLedgerEntry = {
        ...commit.ledgerEntry,
        id: commit.ledgerEntry.id ?? randomUUID(),
        tenantId: scope.tenantId,
        operatorUserId: scope.operatorUserId,
      };
      rows.set(keyOf(scope), {
        ...current,
        knowledge: cloneKnowledge(commit.knowledge),
        narrativeState: {
          values: { ...commit.narrativeState.values },
          closedForwardPaths: [...commit.narrativeState.closedForwardPaths],
          holdOpenedAtMs: { ...commit.narrativeState.holdOpenedAtMs },
        },
        ledger: [...current.ledger, stored],
      });
      return stored;
    },
  };
}
