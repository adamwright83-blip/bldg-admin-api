import type { VerifiedGoldlineEvidenceRef } from "../../shared/narratorOs/contracts";

/**
 * Opaque verified-Goldline authority. Types and the runtime guard live here.
 * Minting for the A–D harness lives only as test-only issuance; production
 * ingestion is unwired. A structurally similar object without the brand is
 * not a receipt.
 */
const VERIFIED_GOLDLINE_RECEIPT_BRAND: unique symbol = Symbol(
  "narratorOs.VerifiedGoldlineReceipt"
);

export type GoldlineEvidenceClass =
  | "authoritative_external"
  | "operator_attested";

export type VerifiedGoldlineReceipt = {
  readonly [VERIFIED_GOLDLINE_RECEIPT_BRAND]: true;
  readonly outcomeId: string;
  readonly verificationClass: "VERIFIED";
  readonly evidenceClass: GoldlineEvidenceClass;
  readonly evidenceRef: Readonly<VerifiedGoldlineEvidenceRef>;
};

export type VerifiedGoldlineReceiptDraft = {
  outcomeId: string;
  evidenceClass: GoldlineEvidenceClass;
  evidenceRef: VerifiedGoldlineEvidenceRef;
};

export function isVerifiedGoldlineReceipt(
  value: unknown
): value is VerifiedGoldlineReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as VerifiedGoldlineReceipt;
  const evidenceRef = receipt.evidenceRef;
  return (
    receipt[VERIFIED_GOLDLINE_RECEIPT_BRAND] === true &&
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
    evidenceRef.classification === receipt.evidenceClass
  );
}

/**
 * Test-only issuance. Production Narrator index does not re-export this.
 * Production ingestion (Brain / HTTP / Goldline world events) stays unwired.
 * Import from `verifiedGoldlineReceipt.testSupport.ts` in tests.
 */
export function issueVerifiedGoldlineReceiptForTests(
  draft: VerifiedGoldlineReceiptDraft
): VerifiedGoldlineReceipt {
  if (!draft.outcomeId) {
    throw new Error("VerifiedGoldlineReceipt requires outcomeId");
  }
  if (
    draft.evidenceClass !== "authoritative_external" &&
    draft.evidenceClass !== "operator_attested"
  ) {
    throw new Error("VerifiedGoldlineReceipt requires trusted evidenceClass");
  }
  if (draft.evidenceRef.classification !== draft.evidenceClass) {
    throw new Error(
      "VerifiedGoldlineReceipt evidenceRef.classification must match evidenceClass"
    );
  }
  if (!draft.evidenceRef.sourceType || !draft.evidenceRef.sourceReference) {
    throw new Error("VerifiedGoldlineReceipt requires evidenceRef identity");
  }
  return Object.freeze({
    [VERIFIED_GOLDLINE_RECEIPT_BRAND]: true as const,
    outcomeId: draft.outcomeId,
    verificationClass: "VERIFIED" as const,
    evidenceClass: draft.evidenceClass,
    evidenceRef: Object.freeze({
      sourceType: draft.evidenceRef.sourceType,
      sourceReference: draft.evidenceRef.sourceReference,
      classification: draft.evidenceRef.classification,
    }),
  });
}
