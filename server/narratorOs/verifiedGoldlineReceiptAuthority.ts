/**
 * Unforgeable Goldline receipt membership.
 *
 * The exported receipt brand is not authority. Upstream-issued receipts and
 * rehydrated ledger evidence are distinct WeakSet members. Knowing the brand
 * and constructing a matching object does not confer either membership.
 *
 * Production index does not re-export remember functions. Narrator does not
 * issue. Rehydration is not issuance and cannot be re-ingested.
 */
import { isAuthorizedGoldlineProducerCapability } from "../goldlineVerification/producerCapability";
import type { GoldlineProducerCapability } from "../goldlineVerification/producerCapability";
import {
  isVerifiedGoldlineReceiptShape,
  type VerifiedGoldlineReceipt,
} from "./verifiedGoldlineReceipt";

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

/**
 * Bind validated ledger evidence for eligibility after restart.
 * Does not make the object ingestible as a new upstream event.
 */
export function rememberRehydratedVerifiedGoldlineEvidence(
  receipt: VerifiedGoldlineReceipt
): VerifiedGoldlineReceipt {
  if (!isVerifiedGoldlineReceiptShape(receipt)) {
    throw new Error("Rehydrated Goldline evidence must be well-formed");
  }
  REHYDRATED_VERIFIED_GOLDLINE_EVIDENCE.add(receipt);
  return receipt;
}
