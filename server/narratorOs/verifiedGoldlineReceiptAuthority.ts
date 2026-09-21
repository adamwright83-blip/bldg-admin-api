/**
 * Unforgeable Goldline receipt membership.
 *
 * The exported receipt brand is not authority. Upstream-issued receipts and
 * rehydrated ledger evidence are distinct WeakSet members. Knowing the brand
 * and constructing a matching object does not confer either membership.
 *
 * Rehydration membership is not a public remember API. It is created only
 * while walking validated VERIFIED_GOLDLINE_OUTCOME rows on an attested
 * store-loaded snapshot. A structurally identical caller-constructed
 * snapshot is not authority.
 *
 * Production index does not re-export remember functions. Narrator does not
 * issue. Rehydration is not issuance and cannot be re-ingested.
 */
import { isAuthorizedGoldlineProducerCapability } from "../goldlineVerification/producerCapability";
import type { GoldlineProducerCapability } from "../goldlineVerification/producerCapability";
import type { PersistedVerifiedGoldlineReceipt } from "../../shared/narratorOs/contracts";
import {
  isPersistedVerifiedGoldlineReceipt,
  persistedReceiptMatchesLedgerIdentity,
} from "./goldlineReceiptIdentity";
import { isAuthoritativeNarratorSnapshot } from "./narratorSnapshotAttestation";
import type { NarratorSnapshot } from "./store";
import {
  isVerifiedGoldlineReceiptShape,
  type VerifiedGoldlineReceipt,
} from "./verifiedGoldlineReceipt";
import { VERIFIED_GOLDLINE_RECEIPT_BRAND } from "./verifiedGoldlineReceiptBrand";

const UPSTREAM_ISSUED_VERIFIED_GOLDLINE_RECEIPTS = new WeakSet<object>();
const REHYDRATED_VERIFIED_GOLDLINE_EVIDENCE = new WeakSet<object>();

function assertTestIssuanceAllowed(): void {
  const nodeEnv = process.env.NODE_ENV;
  const inVitest = Boolean(process.env.VITEST);
  if (nodeEnv === "test" || inVitest) return;
  throw new Error(
    "VerifiedGoldlineReceipt test issuance is not available outside tests"
  );
}

export function isGoldlineReceiptAuthorityMember(value: object): boolean {
  return (
    UPSTREAM_ISSUED_VERIFIED_GOLDLINE_RECEIPTS.has(value) ||
    REHYDRATED_VERIFIED_GOLDLINE_EVIDENCE.has(value)
  );
}

export function isUpstreamIssuedVerifiedGoldlineReceipt(
  value: unknown
): value is VerifiedGoldlineReceipt {
  return (
    isVerifiedGoldlineReceiptShape(value) &&
    UPSTREAM_ISSUED_VERIFIED_GOLDLINE_RECEIPTS.has(value)
  );
}

export function isRehydratedVerifiedGoldlineEvidence(
  value: unknown
): value is VerifiedGoldlineReceipt {
  return (
    isVerifiedGoldlineReceiptShape(value) &&
    REHYDRATED_VERIFIED_GOLDLINE_EVIDENCE.has(value)
  );
}

/**
 * Bind an already-built receipt as upstream-issued. Requires an authorized
 * producer capability. Brand possession is not enough.
 */
export function rememberUpstreamIssuedVerifiedGoldlineReceipt(
  producer: GoldlineProducerCapability,
  receipt: VerifiedGoldlineReceipt
): VerifiedGoldlineReceipt {
  if (!isAuthorizedGoldlineProducerCapability(producer)) {
    throw new Error("Goldline receipt issuance requires authorized producer");
  }
  if (!isVerifiedGoldlineReceiptShape(receipt)) {
    throw new Error("Goldline receipt issuance requires a well-formed receipt");
  }
  UPSTREAM_ISSUED_VERIFIED_GOLDLINE_RECEIPTS.add(receipt);
  return receipt;
}

/**
 * Env-gated test issuance membership. Does not create production producer
 * authority. Analogous to the D.5 env-gated receipt test factory.
 */
export function rememberTestUpstreamIssuedVerifiedGoldlineReceipt(
  receipt: VerifiedGoldlineReceipt
): VerifiedGoldlineReceipt {
  assertTestIssuanceAllowed();
  if (!isVerifiedGoldlineReceiptShape(receipt)) {
    throw new Error(
      "Test Goldline receipt issuance requires a well-formed receipt"
    );
  }
  UPSTREAM_ISSUED_VERIFIED_GOLDLINE_RECEIPTS.add(receipt);
  return receipt;
}

function rehydrateOne(
  persisted: PersistedVerifiedGoldlineReceipt
): VerifiedGoldlineReceipt {
  const receipt = Object.freeze({
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
  REHYDRATED_VERIFIED_GOLDLINE_EVIDENCE.add(receipt);
  return receipt;
}

/**
 * Rebuild branded receipts from ingested ledger evidence. Incomplete,
 * unattested, or scope-mismatched snapshots/rows are skipped (fail closed).
 * Does not mint new outcomes. Does not accept a caller-constructed receipt
 * or a structurally identical caller-constructed snapshot.
 */
export function rehydratePersistedVerifiedGoldlineReceipts(
  snapshot: NarratorSnapshot
): readonly VerifiedGoldlineReceipt[] {
  if (!isAuthoritativeNarratorSnapshot(snapshot)) return [];
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
