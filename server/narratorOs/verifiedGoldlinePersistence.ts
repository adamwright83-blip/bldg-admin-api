/**
 * Persist and recover branded Goldline receipts from the Narrator ledger.
 *
 * Production authority after restart is persisted VERIFIED_GOLDLINE_OUTCOME
 * rows on an attested store-loaded snapshot, not a hidden in-memory array.
 * Rehydration walks validated ledger evidence. It is not issuance and is
 * not a generic remember API. Caller-constructed snapshot JSON is not
 * authoritative persisted Narrator evidence.
 */
import type { PersistedVerifiedGoldlineReceipt } from "../../shared/narratorOs/contracts";
import type { NarratorSnapshot } from "./store";
import {
  isUpstreamIssuedVerifiedGoldlineReceipt,
  type VerifiedGoldlineReceipt,
} from "./verifiedGoldlineReceipt";
import { rehydratePersistedVerifiedGoldlineReceipts } from "./verifiedGoldlineReceiptAuthority";

export { isPersistedVerifiedGoldlineReceipt } from "./goldlineReceiptIdentity";
export { rehydratePersistedVerifiedGoldlineReceipts } from "./verifiedGoldlineReceiptAuthority";

export function persistableVerifiedGoldlineReceipt(
  receipt: VerifiedGoldlineReceipt
): PersistedVerifiedGoldlineReceipt {
  if (!isUpstreamIssuedVerifiedGoldlineReceipt(receipt)) {
    throw new Error("Cannot persist an unissued Goldline object");
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

/**
 * Production Goldline evidence: persisted ingested receipts are authority
 * after restart via rehydration membership. Live incoming values count only
 * if they are upstream-issued. Forged branded objects and rehydrated
 * evidence are not ingest credentials.
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
    if (!isUpstreamIssuedVerifiedGoldlineReceipt(value)) continue;
    if (value.tenantId !== snapshot.tenantId) continue;
    if (value.operatorUserId !== snapshot.operatorUserId) continue;
    if (byId.has(value.receiptId)) continue;
    byId.set(value.receiptId, value);
  }
  return [...byId.values()];
}
