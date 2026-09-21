/**
 * Test-only Goldline producer capability. Do not import from production
 * paths. Production runtime cannot call this factory. Analogous to the
 * VerifiedGoldlineReceipt test-support boundary.
 *
 * Minting goes through the env-gated authorizer so the capability is in the
 * private authorized set. Production registry stays empty.
 */
import type { GoldlineEvidenceClass } from "../narratorOs/verifiedGoldlineReceipt";
import { authorizeTestGoldlineProducerCapability } from "./producerCapability";
import type { GoldlineProducerCapability } from "./producerCapability";
import type { SupportedProductionGoldlineOutcomeId } from "./supportedOutcomes";
import { isSupportedProductionGoldlineOutcomeId } from "./supportedOutcomes";

export type TestGoldlineProducerCapabilityDraft = {
  producerNamespace: string;
  allowedOutcomeIds: readonly SupportedProductionGoldlineOutcomeId[];
  allowedEvidenceClasses: readonly GoldlineEvidenceClass[];
};

export function claimTestGoldlineProducerCapability(
  draft: TestGoldlineProducerCapabilityDraft
): GoldlineProducerCapability {
  if (
    draft.allowedOutcomeIds.some(
      id => !isSupportedProductionGoldlineOutcomeId(id)
    )
  ) {
    throw new Error("Test Goldline producer outcomes must be supported");
  }
  return authorizeTestGoldlineProducerCapability(draft);
}
