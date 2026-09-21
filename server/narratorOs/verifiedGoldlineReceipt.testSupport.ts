/**
 * Test-only Goldline receipt issuer. Do not import from production Narrator
 * paths. Production index does not re-export this module. Production runtime
 * cannot call this factory.
 */
import type { VerifiedGoldlineEvidenceRef } from "../../shared/narratorOs/contracts";
import type {
  GoldlineEvidenceClass,
  VerifiedGoldlineReceipt,
} from "./verifiedGoldlineReceipt";
import { VERIFIED_GOLDLINE_RECEIPT_BRAND } from "./verifiedGoldlineReceiptBrand";

export type VerifiedGoldlineReceiptDraft = {
  receiptId: string;
  tenantId: string;
  operatorUserId: string;
  outcomeId: string;
  evidenceClass: GoldlineEvidenceClass;
  evidenceRef: VerifiedGoldlineEvidenceRef;
};

function assertTestIssuanceAllowed(): void {
  const nodeEnv = process.env.NODE_ENV;
  const inVitest = Boolean(process.env.VITEST);
  if (nodeEnv === "test" || inVitest) return;
  throw new Error(
    "VerifiedGoldlineReceipt test issuance is not available outside tests"
  );
}

export function issueVerifiedGoldlineReceiptForTests(
  draft: VerifiedGoldlineReceiptDraft
): VerifiedGoldlineReceipt {
  assertTestIssuanceAllowed();
  if (!draft.receiptId) {
    throw new Error("VerifiedGoldlineReceipt requires receiptId");
  }
  if (!draft.tenantId || !draft.operatorUserId) {
    throw new Error(
      "VerifiedGoldlineReceipt requires tenant and operator scope"
    );
  }
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
    receiptId: draft.receiptId,
    tenantId: draft.tenantId,
    operatorUserId: draft.operatorUserId,
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
