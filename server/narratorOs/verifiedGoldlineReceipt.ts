import type { VerifiedGoldlineEvidenceRef } from "../../shared/narratorOs/contracts";
import { VERIFIED_GOLDLINE_RECEIPT_BRAND } from "./verifiedGoldlineReceiptBrand";

/**
 * Opaque verified-Goldline authority. Types and the runtime guard live here.
 * This module does not issue receipts. Production ingestion stays unwired.
 * A structurally similar object without the brand is not a receipt.
 */
export type GoldlineEvidenceClass =
  "authoritative_external" | "operator_attested";

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
};

export function isVerifiedGoldlineReceipt(
  value: unknown
): value is VerifiedGoldlineReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as VerifiedGoldlineReceipt;
  const evidenceRef = receipt.evidenceRef;
  const targetRefOk =
    receipt.targetRef == null || isGoldlineTargetRef(receipt.targetRef);
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
    targetRefOk
  );
}
