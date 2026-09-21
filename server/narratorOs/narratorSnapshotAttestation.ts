/**
 * Store-loaded Narrator snapshots are attested. A structurally identical
 * caller-constructed snapshot is not. Production Goldline rehydration
 * requires this membership. This module is not re-exported from the
 * Narrator production index.
 *
 * Attestation is minted only inside the concrete in-memory and Drizzle
 * store factories. There is no exported wrap/seal/remember that accepts a
 * caller-supplied store or snapshot.
 */
import type {
  NarrativeEventLedgerEntry,
  PersistedVerifiedGoldlineReceipt,
  VerifiedGoldlineEvidenceRef,
} from "../../shared/narratorOs/contracts";
import { createDrizzleNarratorStoreUnsealed } from "./drizzleStore";
import { createInMemoryNarratorStoreUnsealed } from "./memoryStore";
import type { NarratorSnapshot, NarratorStore } from "./store";

const AUTHORITATIVE_NARRATOR_SNAPSHOTS = new WeakSet<object>();

function freezeEvidenceRef(
  ref: VerifiedGoldlineEvidenceRef | NarrativeEventLedgerEntry["evidenceRef"]
): NarrativeEventLedgerEntry["evidenceRef"] {
  if (!ref) return ref;
  return Object.freeze({
    sourceType: ref.sourceType,
    sourceReference: ref.sourceReference,
    classification: ref.classification,
  });
}

function freezePersistedVerifiedGoldline(
  persisted: PersistedVerifiedGoldlineReceipt
): PersistedVerifiedGoldlineReceipt {
  return Object.freeze({
    ...persisted,
    evidenceRef: freezeEvidenceRef(persisted.evidenceRef)!,
    targetRef: persisted.targetRef
      ? Object.freeze({
          kind: "goldline_target" as const,
          id: persisted.targetRef.id,
        })
      : persisted.targetRef,
  });
}

function freezeLedgerEntry(
  entry: NarrativeEventLedgerEntry
): NarrativeEventLedgerEntry {
  return Object.freeze({
    ...entry,
    evidenceRef: freezeEvidenceRef(entry.evidenceRef),
    persistedVerifiedGoldline: entry.persistedVerifiedGoldline
      ? freezePersistedVerifiedGoldline(entry.persistedVerifiedGoldline)
      : entry.persistedVerifiedGoldline,
  });
}

function sealAuthoritativeNarratorSnapshot(
  snapshot: NarratorSnapshot
): NarratorSnapshot {
  if (AUTHORITATIVE_NARRATOR_SNAPSHOTS.has(snapshot)) return snapshot;
  const sealed: NarratorSnapshot = {
    tenantId: snapshot.tenantId,
    operatorUserId: snapshot.operatorUserId,
    worldTruth: snapshot.worldTruth,
    livedBio: snapshot.livedBio,
    knowledge: snapshot.knowledge,
    narrativeState: snapshot.narrativeState,
    ledger: snapshot.ledger.map(freezeLedgerEntry),
    catalogVersion: Object.freeze({ ...snapshot.catalogVersion }),
  };
  Object.freeze(sealed.ledger);
  Object.freeze(sealed);
  AUTHORITATIVE_NARRATOR_SNAPSHOTS.add(sealed);
  return sealed;
}

export function isAuthoritativeNarratorSnapshot(
  value: unknown
): value is NarratorSnapshot {
  return Boolean(
    value &&
      typeof value === "object" &&
      AUTHORITATIVE_NARRATOR_SNAPSHOTS.has(value)
  );
}

function wrapConcreteNarratorStore(store: NarratorStore): NarratorStore {
  return {
    async initOperator(scope) {
      return sealAuthoritativeNarratorSnapshot(await store.initOperator(scope));
    },
    async load(scope) {
      const snapshot = await store.load(scope);
      return snapshot ? sealAuthoritativeNarratorSnapshot(snapshot) : null;
    },
    replaceKnowledge(scope, knowledge) {
      return store.replaceKnowledge(scope, knowledge);
    },
    replaceNarrativeState(scope, state) {
      return store.replaceNarrativeState(scope, state);
    },
    appendLedger(scope, entry) {
      return store.appendLedger(scope, entry);
    },
    commitAtomic(scope, commit) {
      return store.commitAtomic(scope, commit);
    },
  };
}

export function createInMemoryNarratorStore(
  seed?: ReadonlyMap<string, NarratorSnapshot>
): NarratorStore {
  return wrapConcreteNarratorStore(createInMemoryNarratorStoreUnsealed(seed));
}

export function createDrizzleNarratorStore(): NarratorStore {
  return wrapConcreteNarratorStore(createDrizzleNarratorStoreUnsealed());
}
