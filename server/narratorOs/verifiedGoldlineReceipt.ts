import type { VerifiedGoldlineEvidenceRef } from "../../shared/narratorOs/contracts";
import { isGoldlineReceiptAuthorityMember } from "./verifiedGoldlineReceiptAuthority";
import { VERIFIED_GOLDLINE_RECEIPT_BRAND } from "./verifiedGoldlineReceiptBrand";

/**
 * Opaque verified-Goldline types. This module does not issue receipts.
 * Production issuance lives at the Goldline verification boundary. Brand
 * possession is not authority; membership is tracked separately.
 */
export type GoldlineEvidenceClass =
  | "authoritative_external"
  | "operator_attested";

/**
 * Opaque trusted subject/target identity. Correlation uses this token only.
 * Runtime must not infer a target from free-form evidence strings.
 */
export type GoldlineTargetRef = {
  readonly kind: "goldline_target";
  readonly id: string;
};

export function isGoldlineTargetRef(
  value: unknown
): value is GoldlineTargetRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as GoldlineTargetRef;
  return (
    ref.kind === "goldline_target" &&
    typeof ref.id === "string" &&
    ref.id.length > 0 &&
    ref.id.trim() === ref.id
  );
}

export type VerifiedGoldlineReceipt = {
  readonly [VERIFIED_GOLDLINE_RECEIPT_BRAND]: true;
  readonly receiptId: string;
  readonly tenantId: string;
  readonly operatorUserId: string;
  readonly outcomeId: string;
  readonly verificationClass: "VERIFIED";
  readonly evidenceClass: GoldlineEvidenceClass;
  readonly evidenceRef: Readonly<VerifiedGoldlineEvidenceRef>;
  readonly targetRef: GoldlineTargetRef | null;
  /**
   * Authoritative source occurrence time. Sequence uses this field only.
   * Runtime must not infer order from array position, receiptId, or
   * free-form sourceReference.
   */
  readonly occurredAtMs: number;
  readonly producerNamespace?: string;
  readonly sourceEventId?: string;
};

export function isVerifiedGoldlineReceiptShape(
  value: unknown
): value is VerifiedGoldlineReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as VerifiedGoldlineReceipt;
  const evidenceRef = receipt.evidenceRef;
  const targetRefOk =
    receipt.targetRef == null || isGoldlineTargetRef(receipt.targetRef);
  const occurredAtOk =
    typeof receipt.occurredAtMs === "number" &&
    Number.isFinite(receipt.occurredAtMs);
  return (
    receipt[VERIFIED_GOLDLINE_RECEIPT_BRAND] === true &&
    typeof receipt.receiptId === "string" &&
    receipt.receiptId.length > 0 &&
    typeof receipt.tenantId === "string" &&
    receipt.tenantId.length > 0 &&
    typeof receipt.operatorUserId === "string" &&
    receipt.operatorUserId.length > 0 &&
    typeof receipt.outcomeId === "string" &&
    receipt.outcomeId.length > 0 &&
    receipt.verificationClass === "VERIFIED" &&
    (receipt.evidenceClass === "authoritative_external" ||
      receipt.evidenceClass === "operator_attested") &&
    Boolean(evidenceRef) &&
    typeof evidenceRef === "object" &&
    typeof evidenceRef.sourceType === "string" &&
    evidenceRef.sourceType.length > 0 &&
    typeof evidenceRef.sourceReference === "string" &&
    evidenceRef.sourceReference.length > 0 &&
    (evidenceRef.classification === "authoritative_external" ||
      evidenceRef.classification === "operator_attested") &&
    evidenceRef.classification === receipt.evidenceClass &&
    targetRefOk &&
    occurredAtOk &&
    (receipt.producerNamespace === undefined ||
      (typeof receipt.producerNamespace === "string" &&
        receipt.producerNamespace.length > 0)) &&
    (receipt.sourceEventId === undefined ||
      (typeof receipt.sourceEventId === "string" &&
        receipt.sourceEventId.length > 0))
  );
}

/**
 * Authoritative receipt: branded shape plus unforgeable issuance or
 * rehydration membership. Importing the brand is not enough.
 */
export function isVerifiedGoldlineReceipt(
  value: unknown
): value is VerifiedGoldlineReceipt {
  return (
    isVerifiedGoldlineReceiptShape(value) &&
    isGoldlineReceiptAuthorityMember(value)
  );
}

export {
  isUpstreamIssuedVerifiedGoldlineReceipt,
  isRehydratedVerifiedGoldlineEvidence,
} from "./verifiedGoldlineReceiptAuthority";
