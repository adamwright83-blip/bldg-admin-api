/**
 * Persist and recover branded Goldline receipts from the Narrator ledger.
 *
 * Production authority after restart is persisted VERIFIED_GOLDLINE_OUTCOME
 * rows, not a hidden in-memory array. Rehydration re-applies the runtime
 * brand to evidence that ingestion already accepted. It is not issuance.
 * A caller-constructed ledger-shaped object is still not a receipt.
 */
import type { PersistedVerifiedGoldlineReceipt } from "../../shared/narratorOs/contracts";
import { persistedReceiptMatchesLedgerIdentity } from "./goldlineReceiptIdentity";
import type { NarratorSnapshot } from "./store";
import {
  isGoldlineTargetRef,
  isVerifiedGoldlineReceipt,
  type VerifiedGoldlineReceipt,
} from "./verifiedGoldlineReceipt";
import { VERIFIED_GOLDLINE_RECEIPT_BRAND } from "./verifiedGoldlineReceiptBrand";

export function persistableVerifiedGoldlineReceipt(
  receipt: VerifiedGoldlineReceipt
): PersistedVerifiedGoldlineReceipt {
  if (!isVerifiedGoldlineReceipt(receipt)) {
    throw new Error("Cannot persist an unbranded Goldline object");
  }
  return {
    receiptId: receipt.receiptId,
    tenantId: receipt.tenantId,
    operatorUserId: receipt.operatorUserId,
    outcomeId: receipt.outcomeId,
    verificationClass: "VERIFIED",
    evidenceClass: receipt.evidenceClass,
    evidenceRef: {
      sourceType: receipt.evidenceRef.sourceType,
      sourceReference: receipt.evidenceRef.sourceReference,
      classification: receipt.evidenceRef.classification,
    },
    targetRef: receipt.targetRef
      ? { kind: "goldline_target", id: receipt.targetRef.id }
      : null,
    occurredAtMs: receipt.occurredAtMs,
    ...(receipt.producerNamespace
      ? { producerNamespace: receipt.producerNamespace }
      : {}),
    ...(receipt.sourceEventId ? { sourceEventId: receipt.sourceEventId } : {}),
  };
}

export function isPersistedVerifiedGoldlineReceipt(
  value: unknown
): value is PersistedVerifiedGoldlineReceipt {
  if (!value || typeof value !== "object") return false;
  const persisted = value as PersistedVerifiedGoldlineReceipt;
  const targetOk =
    persisted.targetRef == null || isGoldlineTargetRef(persisted.targetRef);
  return (
    typeof persisted.receiptId === "string" &&
    persisted.receiptId.length > 0 &&
    typeof persisted.tenantId === "string" &&
    persisted.tenantId.length > 0 &&
    typeof persisted.operatorUserId === "string" &&
    persisted.operatorUserId.length > 0 &&
    typeof persisted.outcomeId === "string" &&
    persisted.outcomeId.length > 0 &&
    persisted.verificationClass === "VERIFIED" &&
    (persisted.evidenceClass === "authoritative_external" ||
      persisted.evidenceClass === "operator_attested") &&
    Boolean(persisted.evidenceRef) &&
    typeof persisted.evidenceRef === "object" &&
    typeof persisted.evidenceRef.sourceType === "string" &&
    persisted.evidenceRef.sourceType.length > 0 &&
    typeof persisted.evidenceRef.sourceReference === "string" &&
    persisted.evidenceRef.sourceReference.length > 0 &&
    persisted.evidenceRef.classification === persisted.evidenceClass &&
    targetOk &&
    typeof persisted.occurredAtMs === "number" &&
    Number.isFinite(persisted.occurredAtMs) &&
    (persisted.producerNamespace === undefined ||
      (typeof persisted.producerNamespace === "string" &&
        persisted.producerNamespace.length > 0)) &&
    (persisted.sourceEventId === undefined ||
      (typeof persisted.sourceEventId === "string" &&
        persisted.sourceEventId.length > 0))
  );
}

function rehydrateOne(
  persisted: PersistedVerifiedGoldlineReceipt
): VerifiedGoldlineReceipt {
  return Object.freeze({
    [VERIFIED_GOLDLINE_RECEIPT_BRAND]: true as const,
    receiptId: persisted.receiptId,
    tenantId: persisted.tenantId,
    operatorUserId: persisted.operatorUserId,
    outcomeId: persisted.outcomeId,
    verificationClass: "VERIFIED" as const,
    evidenceClass: persisted.evidenceClass,
    evidenceRef: Object.freeze({
      sourceType: persisted.evidenceRef.sourceType,
      sourceReference: persisted.evidenceRef.sourceReference,
      classification: persisted.evidenceRef.classification,
    }),
    targetRef: persisted.targetRef
      ? Object.freeze({
          kind: "goldline_target" as const,
          id: persisted.targetRef.id,
        })
      : null,
    occurredAtMs: persisted.occurredAtMs,
    ...(persisted.producerNamespace
      ? { producerNamespace: persisted.producerNamespace }
      : {}),
    ...(persisted.sourceEventId
      ? { sourceEventId: persisted.sourceEventId }
      : {}),
  });
}

/**
 * Rebuild branded receipts from ingested ledger evidence. Incomplete or
 * scope-mismatched rows are skipped (fail closed). Does not mint new
 * outcomes. Does not treat caller arrays as input.
 */
export function rehydratePersistedVerifiedGoldlineReceipts(
  snapshot: NarratorSnapshot
): readonly VerifiedGoldlineReceipt[] {
  const receipts: VerifiedGoldlineReceipt[] = [];
  const seen = new Set<string>();
  for (const entry of snapshot.ledger) {
    if (entry.kind !== "VERIFIED_GOLDLINE_OUTCOME") continue;
    const persisted = entry.persistedVerifiedGoldline;
    if (!isPersistedVerifiedGoldlineReceipt(persisted)) continue;
    if (!persistedReceiptMatchesLedgerIdentity(entry, persisted)) continue;
    if (persisted.tenantId !== snapshot.tenantId) continue;
    if (persisted.operatorUserId !== snapshot.operatorUserId) continue;
    if (seen.has(persisted.receiptId)) continue;
    seen.add(persisted.receiptId);
    receipts.push(rehydrateOne(persisted));
  }
  return receipts;
}

/**
 * Production Goldline evidence: persisted ingested receipts are authority.
 * Live branded receipts may join for same-process evaluation. Unbranded
 * caller objects never join. Persisted wins on receiptId collision.
 */
export function productionVerifiedGoldlineEvidence(
  snapshot: NarratorSnapshot,
  incoming: readonly unknown[]
): readonly VerifiedGoldlineReceipt[] {
  const byId = new Map<string, VerifiedGoldlineReceipt>();
  for (const receipt of rehydratePersistedVerifiedGoldlineReceipts(snapshot)) {
    byId.set(receipt.receiptId, receipt);
  }
  for (const value of incoming) {
    if (!isVerifiedGoldlineReceipt(value)) continue;
    if (value.tenantId !== snapshot.tenantId) continue;
    if (value.operatorUserId !== snapshot.operatorUserId) continue;
    if (byId.has(value.receiptId)) continue;
    byId.set(value.receiptId, value);
  }
  return [...byId.values()];
}
