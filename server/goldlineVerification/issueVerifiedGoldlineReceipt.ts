/**
 * Production Goldline → Narrator receipt issuer.
 *
 * Lives at the Goldline verification boundary, not inside Narrator
 * eligibility. Narrator cannot self-issue. A structurally constructible
 * mutation record is not authority. Issuance requires a branded producer
 * capability. The production capability list is empty: production minting
 * is currently impossible.
 */
import type { VerifiedGoldlineEvidenceRef } from "../../shared/narratorOs/contracts";
import { goldlineReceiptIdFromAuthoritativeIdentity } from "../narratorOs/goldlineReceiptIdentity";
import {
  isGoldlineTargetRef,
  type GoldlineEvidenceClass,
  type VerifiedGoldlineReceipt,
} from "../narratorOs/verifiedGoldlineReceipt";
import { rememberUpstreamIssuedVerifiedGoldlineReceipt } from "../narratorOs/verifiedGoldlineReceiptAuthority";
import { VERIFIED_GOLDLINE_RECEIPT_BRAND } from "../narratorOs/verifiedGoldlineReceiptBrand";
import {
  isAuthorizedGoldlineProducerCapability,
  type GoldlineProducerCapability,
} from "./producerCapability";
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

function assertIssuableMutation(
  producer: GoldlineProducerCapability,
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
  if (!producer.allowedOutcomeIds.includes(mutation.outcomeId)) {
    throw new UntrustedGoldlineIssuanceError(
      `producer ${producer.producerNamespace} is not authorized for ${mutation.outcomeId}`
    );
  }
  if (
    mutation.evidenceClass !== "authoritative_external" &&
    mutation.evidenceClass !== "operator_attested"
  ) {
    throw new UntrustedGoldlineIssuanceError("evidenceClass is not trusted");
  }
  if (!producer.allowedEvidenceClasses.includes(mutation.evidenceClass)) {
    throw new UntrustedGoldlineIssuanceError(
      `producer ${producer.producerNamespace} is not authorized for ${mutation.evidenceClass}`
    );
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
 * Issue a branded receipt from an already-authoritative Goldline mutation
 * presented by an authorized producer capability. Does not persist. Does
 * not evaluate eligibility. Does not fire beats.
 */
export function issueVerifiedGoldlineReceiptFromAuthoritativeMutation(input: {
  producer: GoldlineProducerCapability;
  mutation: AuthoritativeGoldlineMutation;
}): VerifiedGoldlineReceipt {
  if (!isAuthorizedGoldlineProducerCapability(input.producer)) {
    throw new UntrustedGoldlineIssuanceError(
      "missing authorized producer capability"
    );
  }
  const producer = input.producer;
  const mutation = input.mutation;
  assertIssuableMutation(producer, mutation);
  const targetRef = Object.freeze({
    kind: "goldline_target" as const,
    id: mutation.targetId,
  });
  if (!isGoldlineTargetRef(targetRef)) {
    throw new UntrustedGoldlineIssuanceError(
      "targetRef is not an opaque goldline_target"
    );
  }
  const receiptId = goldlineReceiptIdFromAuthoritativeIdentity({
    tenantId: mutation.tenantId,
    operatorUserId: mutation.operatorUserId,
    producerNamespace: producer.producerNamespace,
    sourceEventId: mutation.sourceEventId,
  });
  return rememberUpstreamIssuedVerifiedGoldlineReceipt(
    producer,
    Object.freeze({
      [VERIFIED_GOLDLINE_RECEIPT_BRAND]: true as const,
      receiptId,
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
      producerNamespace: producer.producerNamespace,
      sourceEventId: mutation.sourceEventId,
    })
  );
}
