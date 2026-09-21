/**
 * Production Goldline → Narrator receipt issuer.
 *
 * Lives at the Goldline verification boundary, not inside Narrator
 * eligibility. Narrator cannot self-issue. There is no generic public
 * "make verified receipt" API: callers must supply an authoritative
 * mutation record with opaque target identity and trusted chronology.
 *
 * No production mutation is registered in Slice E. The issuer is ready;
 * attaching it to a weak producer is forbidden.
 */
import type { VerifiedGoldlineEvidenceRef } from "../../shared/narratorOs/contracts";
import {
  isGoldlineTargetRef,
  type GoldlineEvidenceClass,
  type VerifiedGoldlineReceipt,
} from "../narratorOs/verifiedGoldlineReceipt";
import { VERIFIED_GOLDLINE_RECEIPT_BRAND } from "../narratorOs/verifiedGoldlineReceiptBrand";
import {
  isSupportedProductionGoldlineOutcomeId,
  type SupportedProductionGoldlineOutcomeId,
} from "./supportedOutcomes";

export type AuthoritativeGoldlineSourceVerification = "VERIFIED" | "ATTESTED";

export type AuthoritativeGoldlineMutation = {
  readonly sourceEventId: string;
  readonly tenantId: string;
  readonly operatorUserId: string;
  readonly outcomeId: string;
  readonly occurredAtMs: number;
  readonly targetId: string;
  readonly evidenceClass: GoldlineEvidenceClass;
  readonly evidenceRef: VerifiedGoldlineEvidenceRef;
  readonly sourceVerificationClass: AuthoritativeGoldlineSourceVerification;
};

export class UntrustedGoldlineIssuanceError extends Error {
  constructor(detail: string) {
    super(`Goldline cannot issue a Narrator receipt: ${detail}`);
    this.name = "UntrustedGoldlineIssuanceError";
  }
}

export class UnsupportedGoldlineProducerError extends Error {
  constructor(detail: string) {
    super(`Untrustworthy Goldline producer cannot become VERIFIED: ${detail}`);
    this.name = "UnsupportedGoldlineProducerError";
  }
}

function stableReceiptId(sourceEventId: string, tenantId: string): string {
  return `glv:${tenantId}:${sourceEventId}`;
}

function assertIssuableMutation(
  mutation: AuthoritativeGoldlineMutation
): asserts mutation is AuthoritativeGoldlineMutation & {
  outcomeId: SupportedProductionGoldlineOutcomeId;
} {
  if (
    !mutation.sourceEventId ||
    mutation.sourceEventId.trim() !== mutation.sourceEventId
  ) {
    throw new UntrustedGoldlineIssuanceError("sourceEventId is required");
  }
  if (!mutation.tenantId || !mutation.operatorUserId) {
    throw new UntrustedGoldlineIssuanceError(
      "tenant and operator scope are required"
    );
  }
  if (!isSupportedProductionGoldlineOutcomeId(mutation.outcomeId)) {
    throw new UnsupportedGoldlineProducerError(
      `outcome ${JSON.stringify(mutation.outcomeId)} is not a supported production outcome`
    );
  }
  if (
    mutation.evidenceClass !== "authoritative_external" &&
    mutation.evidenceClass !== "operator_attested"
  ) {
    throw new UntrustedGoldlineIssuanceError("evidenceClass is not trusted");
  }
  if (
    mutation.sourceVerificationClass !== "VERIFIED" &&
    mutation.sourceVerificationClass !== "ATTESTED"
  ) {
    throw new UnsupportedGoldlineProducerError(
      "source verification class is not trusted"
    );
  }
  if (
    mutation.evidenceClass === "authoritative_external" &&
    mutation.sourceVerificationClass !== "VERIFIED"
  ) {
    throw new UnsupportedGoldlineProducerError(
      "ATTESTED or weaker source cannot be promoted to authoritative_external"
    );
  }
  if (mutation.evidenceRef.classification !== mutation.evidenceClass) {
    throw new UntrustedGoldlineIssuanceError(
      "evidenceRef.classification must match evidenceClass"
    );
  }
  if (
    !mutation.evidenceRef.sourceType ||
    !mutation.evidenceRef.sourceReference
  ) {
    throw new UntrustedGoldlineIssuanceError(
      "evidenceRef identity is required"
    );
  }
  if (
    typeof mutation.occurredAtMs !== "number" ||
    !Number.isFinite(mutation.occurredAtMs)
  ) {
    throw new UntrustedGoldlineIssuanceError(
      "occurredAtMs must come from trustworthy source chronology"
    );
  }
  if (!mutation.targetId || mutation.targetId.trim() !== mutation.targetId) {
    throw new UntrustedGoldlineIssuanceError(
      "target identity must be an authoritative opaque id"
    );
  }
}

/**
 * Issue a branded receipt from an already-authoritative Goldline mutation.
 * Does not persist. Does not evaluate eligibility. Does not fire beats.
 */
export function issueVerifiedGoldlineReceiptFromAuthoritativeMutation(
  mutation: AuthoritativeGoldlineMutation
): VerifiedGoldlineReceipt {
  assertIssuableMutation(mutation);
  const targetRef = Object.freeze({
    kind: "goldline_target" as const,
    id: mutation.targetId,
  });
  if (!isGoldlineTargetRef(targetRef)) {
    throw new UntrustedGoldlineIssuanceError(
      "targetRef is not an opaque goldline_target"
    );
  }
  return Object.freeze({
    [VERIFIED_GOLDLINE_RECEIPT_BRAND]: true as const,
    receiptId: stableReceiptId(mutation.sourceEventId, mutation.tenantId),
    tenantId: mutation.tenantId,
    operatorUserId: mutation.operatorUserId,
    outcomeId: mutation.outcomeId,
    verificationClass: "VERIFIED" as const,
    evidenceClass: mutation.evidenceClass,
    evidenceRef: Object.freeze({
      sourceType: mutation.evidenceRef.sourceType,
      sourceReference: mutation.evidenceRef.sourceReference,
      classification: mutation.evidenceRef.classification,
    }),
    targetRef,
    occurredAtMs: mutation.occurredAtMs,
  });
}
