import type {
  NarrativeEventLedgerEntry,
  PersistedVerifiedGoldlineReceipt,
} from "../../shared/narratorOs/contracts";

export class ConflictingGoldlineLedgerReplayError extends Error {
  constructor(detail: string) {
    super(`Conflicting Goldline ledger replay: ${detail}`);
    this.name = "ConflictingGoldlineLedgerReplayError";
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function persistedGoldlineReceiptsMatch(
  existing: PersistedVerifiedGoldlineReceipt | null | undefined,
  incoming: PersistedVerifiedGoldlineReceipt | null | undefined
): boolean {
  if (existing == null || incoming == null) {
    return existing == null && incoming == null;
  }
  return (
    existing.receiptId === incoming.receiptId &&
    existing.tenantId === incoming.tenantId &&
    existing.operatorUserId === incoming.operatorUserId &&
    existing.outcomeId === incoming.outcomeId &&
    existing.verificationClass === incoming.verificationClass &&
    existing.evidenceClass === incoming.evidenceClass &&
    existing.occurredAtMs === incoming.occurredAtMs &&
    existing.producerNamespace === incoming.producerNamespace &&
    existing.sourceEventId === incoming.sourceEventId &&
    canonicalJson(existing.evidenceRef) ===
      canonicalJson(incoming.evidenceRef) &&
    canonicalJson(existing.targetRef ?? null) ===
      canonicalJson(incoming.targetRef ?? null)
  );
}

function assertGoldlineReplayIdentical(
  existing: NarrativeEventLedgerEntry,
  incoming: NarrativeEventLedgerEntry
): void {
  if (existing.tenantId !== incoming.tenantId) {
    throw new ConflictingGoldlineLedgerReplayError("tenant mismatch");
  }
  if (existing.operatorUserId !== incoming.operatorUserId) {
    throw new ConflictingGoldlineLedgerReplayError("operator mismatch");
  }
  if (existing.kind !== incoming.kind) {
    throw new ConflictingGoldlineLedgerReplayError("kind mismatch");
  }
  if (existing.goldlineOutcomeId !== incoming.goldlineOutcomeId) {
    throw new ConflictingGoldlineLedgerReplayError("outcome mismatch");
  }
  if (existing.occurredAt !== incoming.occurredAt) {
    throw new ConflictingGoldlineLedgerReplayError("chronology mismatch");
  }
  if (
    canonicalJson(existing.evidenceRef) !== canonicalJson(incoming.evidenceRef)
  ) {
    throw new ConflictingGoldlineLedgerReplayError("evidence mismatch");
  }
  if (
    !persistedGoldlineReceiptsMatch(
      existing.persistedVerifiedGoldline,
      incoming.persistedVerifiedGoldline
    )
  ) {
    throw new ConflictingGoldlineLedgerReplayError(
      "persisted Goldline evidence contradicts the existing row"
    );
  }
}

/**
 * Duplicate idempotency key: identical Goldline replay is success and
 * returns the original row. Conflicting Goldline data fails closed.
 * Non-Goldline duplicates keep prior return-existing behavior.
 */
export function resolveDuplicateNarratorLedgerInsert(
  existing: NarrativeEventLedgerEntry,
  incoming: NarrativeEventLedgerEntry
): NarrativeEventLedgerEntry {
  if (existing.idempotencyKey !== incoming.idempotencyKey) {
    throw new ConflictingGoldlineLedgerReplayError(
      "idempotency key mismatch on duplicate insert"
    );
  }
  if (
    existing.kind === "VERIFIED_GOLDLINE_OUTCOME" ||
    incoming.kind === "VERIFIED_GOLDLINE_OUTCOME"
  ) {
    assertGoldlineReplayIdentical(existing, incoming);
  }
  return existing;
}
