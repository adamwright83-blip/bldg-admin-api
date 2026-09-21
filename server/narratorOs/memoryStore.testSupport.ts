/**
 * Test-only in-memory Narrator reload. Do not import from production
 * Narrator paths. Production index does not re-export this module.
 * Production runtime cannot seed attested snapshots from caller JSON.
 */
import type { NarratorSnapshot, NarratorStore } from "./store";
import { createInMemoryNarratorStoreFromSeedForTests } from "./narratorSnapshotAttestation";

function assertTestReloadAllowed(): void {
  const nodeEnv = process.env.NODE_ENV;
  const inVitest = Boolean(process.env.VITEST);
  if (nodeEnv === "test" || inVitest) return;
  throw new Error(
    "In-memory Narrator snapshot reload is not available outside tests"
  );
}

function keyOf(snapshot: NarratorSnapshot): string {
  return `${snapshot.tenantId}::${snapshot.operatorUserId}`;
}

function jsonCloneSnapshot(snapshot: NarratorSnapshot): NarratorSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as NarratorSnapshot;
}

/**
 * Simulate process/store restart: JSON-clone a loaded snapshot into a fresh
 * store. Branded receipts cannot survive this path; only ledger payload can.
 */
export function reloadInMemoryNarratorStoreFromSnapshot(
  snapshot: NarratorSnapshot
): NarratorStore {
  assertTestReloadAllowed();
  const cloned = jsonCloneSnapshot(snapshot);
  return createInMemoryNarratorStoreFromSeedForTests(
    new Map([[keyOf(cloned), cloned]])
  );
}
