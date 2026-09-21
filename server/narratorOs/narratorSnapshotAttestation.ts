/**
 * Store-loaded Narrator snapshots are attested. A structurally identical
 * caller-constructed snapshot is not. Production Goldline rehydration
 * requires this membership. This module is not re-exported from the
 * Narrator production index.
 *
 * Wrapping is how NarratorStore load/init marks returned snapshots.
 * It is not a Goldline remember API and does not accept receipts.
 */
import type { NarratorSnapshot, NarratorStore } from "./store";

const AUTHORITATIVE_NARRATOR_SNAPSHOTS = new WeakSet<object>();

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
    ledger: snapshot.ledger.map(entry =>
      Object.freeze({
        ...entry,
        persistedVerifiedGoldline: entry.persistedVerifiedGoldline
          ? Object.freeze({ ...entry.persistedVerifiedGoldline })
          : entry.persistedVerifiedGoldline,
      })
    ),
    catalogVersion: snapshot.catalogVersion,
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

/**
 * Production store factories only. load/init results are attested copies.
 * Caller JSON that never came through these methods is not a member.
 */
export function withAuthoritativeNarratorStoreSnapshots(
  store: NarratorStore
): NarratorStore {
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
