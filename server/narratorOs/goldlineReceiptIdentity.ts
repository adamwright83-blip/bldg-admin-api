import { createHash } from "node:crypto";
import type {
  NarrativeEventLedgerEntry,
  PersistedVerifiedGoldlineReceipt,
} from "../../shared/narratorOs/contracts";

/** Matches `narrator_os_event_ledger.idempotencyKey` varchar(191). */
export const NARRATOR_LEDGER_IDEMPOTENCY_MAX = 191;

export type GoldlineReceiptAuthoritativeIdentity = {
  tenantId: string;
  operatorUserId: string;
  producerNamespace: string;
  sourceEventId: string;
};

function lengthPrefixed(value: string): string {
  return `${value.length}:${value}`;
}

/**
 * Canonical identity. Length-prefixed so opaque ids that contain colons
 * cannot collide. Not used as the DB key (too long); hashed into receiptId.
 */
export function canonicalGoldlineReceiptIdentity(
  identity: GoldlineReceiptAuthoritativeIdentity
): string {
  return [
    "glv",
    lengthPrefixed(identity.tenantId),
    lengthPrefixed(identity.operatorUserId),
    lengthPrefixed(identity.producerNamespace),
    lengthPrefixed(identity.sourceEventId),
  ].join(":");
}

export function goldlineReceiptIdFromAuthoritativeIdentity(
  identity: GoldlineReceiptAuthoritativeIdentity
): string {
  const digest = createHash("sha256")
    .update(canonicalGoldlineReceiptIdentity(identity), "utf8")
    .digest("hex");
  return `glv:${digest}`;
}

export function goldlineLedgerIdempotencyKey(receiptId: string): string {
  const key = `goldline:${receiptId}`;
  if (key.length > NARRATOR_LEDGER_IDEMPOTENCY_MAX) {
    throw new Error(
      `Goldline ledger idempotency key exceeds varchar(191): ${key.length}`
    );
  }
  return key;
}

export function persistedReceiptMatchesLedgerIdentity(
  entry: NarrativeEventLedgerEntry,
  persisted: PersistedVerifiedGoldlineReceipt
): boolean {
  if (entry.kind !== "VERIFIED_GOLDLINE_OUTCOME") return false;
  if (
    entry.idempotencyKey !== goldlineLedgerIdempotencyKey(persisted.receiptId)
  ) {
    return false;
  }
  if (entry.tenantId !== persisted.tenantId) return false;
  if (entry.operatorUserId !== persisted.operatorUserId) return false;
  if (entry.goldlineOutcomeId !== persisted.outcomeId) return false;
  if (!persisted.producerNamespace || !persisted.sourceEventId) {
    return false;
  }
  return (
    goldlineReceiptIdFromAuthoritativeIdentity({
      tenantId: persisted.tenantId,
      operatorUserId: persisted.operatorUserId,
      producerNamespace: persisted.producerNamespace,
      sourceEventId: persisted.sourceEventId,
    }) === persisted.receiptId
  );
}
