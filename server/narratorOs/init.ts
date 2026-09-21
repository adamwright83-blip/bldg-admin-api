import { CLAIRE_LIVED_BIO_FACTS, NARRATOR_LIVED_BIO_VERSION } from "./livedBio";
import { createInMemoryNarratorStore } from "./memoryStore";
import {
  EMPTY_KNOWLEDGE,
  type NarratorSnapshot,
  type NarratorStore,
  type OperatorScope,
} from "./store";
import { WORLD_TRUTH_FACTS, NARRATOR_WORLD_TRUTH_VERSION } from "./worldTruth";

/**
 * New-operator init. Empty ledger + explicitly seeded static authored
 * WORLD_TRUTH / CLAIRE_LIVED_BIO / compact narrative state only.
 * Does not read chats, CRM, customers, orders, or logs.
 */
export async function initNarratorOperator(
  store: NarratorStore,
  scope: OperatorScope
): Promise<NarratorSnapshot> {
  return store.initOperator(scope);
}

export function assertNewUserSeed(snapshot: NarratorSnapshot): void {
  if (snapshot.ledger.length !== 0) {
    throw new Error("New narrator operator must have an empty event ledger");
  }
  if (snapshot.knowledge.planes.PLAYER.knownFactIds.length !== 0) {
    throw new Error("New narrator operator must not infer player knowledge");
  }
  if (snapshot.knowledge.planes.CLAIRE.knownFactIds.length !== 0) {
    throw new Error("New narrator operator must not infer Claire knowledge");
  }
  if (snapshot.catalogVersion.worldTruth !== NARRATOR_WORLD_TRUTH_VERSION) {
    throw new Error("WORLD_TRUTH seed version mismatch");
  }
  if (snapshot.catalogVersion.livedBio !== NARRATOR_LIVED_BIO_VERSION) {
    throw new Error("CLAIRE_LIVED_BIO seed version mismatch");
  }
  if (
    snapshot.worldTruth !== WORLD_TRUTH_FACTS &&
    snapshot.worldTruth.length === 0
  ) {
    throw new Error("WORLD_TRUTH must be seeded");
  }
  if (snapshot.livedBio.length !== CLAIRE_LIVED_BIO_FACTS.length) {
    throw new Error("CLAIRE_LIVED_BIO must be seeded statically");
  }
  if (snapshot.narrativeState.values.m03 !== undefined) {
    throw new Error(
      "New narrator operator must not begin universally M03-ARMED"
    );
  }
}

export { createInMemoryNarratorStore, EMPTY_KNOWLEDGE };
