/**
 * Authorized Goldline producer capability.
 *
 * A structurally constructible mutation record is not authority. Issuance
 * requires a capability object that this module itself minted into the
 * private authorized set. Production capabilities are created only from
 * REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS. That list is empty: there is
 * currently no production authority token.
 *
 * Importing the brand symbol, supplying a producer name, or constructing a
 * lookalike object does not confer membership. There is no lookup-by-name
 * API. Adding a future producer requires an explicit code change that names
 * the producer and the outcomes/evidence classes it may issue.
 */
import type { GoldlineEvidenceClass } from "../narratorOs/verifiedGoldlineReceipt";
import { GOLDLINE_PRODUCER_CAPABILITY_BRAND } from "./producerCapabilityBrand";
import { REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS } from "./supportedOutcomes";
import type { SupportedProductionGoldlineOutcomeId } from "./supportedOutcomes";

export type GoldlineProducerCapability = {
  readonly [GOLDLINE_PRODUCER_CAPABILITY_BRAND]: true;
  readonly producerNamespace: string;
  readonly allowedOutcomeIds: readonly SupportedProductionGoldlineOutcomeId[];
  readonly allowedEvidenceClasses: readonly GoldlineEvidenceClass[];
};

const AUTHORIZED_GOLDLINE_PRODUCER_CAPABILITIES = new WeakSet<object>();

function assertTestCapabilityAllowed(): void {
  const nodeEnv = process.env.NODE_ENV;
  const inVitest = Boolean(process.env.VITEST);
  if (nodeEnv === "test" || inVitest) return;
  throw new Error(
    "Goldline producer test capability is not available outside tests"
  );
}

function mintGoldlineProducerCapability(input: {
  producerNamespace: string;
  allowedOutcomeIds: readonly SupportedProductionGoldlineOutcomeId[];
  allowedEvidenceClasses: readonly GoldlineEvidenceClass[];
}): GoldlineProducerCapability {
  const capability = Object.freeze({
    [GOLDLINE_PRODUCER_CAPABILITY_BRAND]: true as const,
    producerNamespace: input.producerNamespace,
    allowedOutcomeIds: Object.freeze([...input.allowedOutcomeIds]),
    allowedEvidenceClasses: Object.freeze([...input.allowedEvidenceClasses]),
  });
  AUTHORIZED_GOLDLINE_PRODUCER_CAPABILITIES.add(capability);
  return capability;
}

export function isGoldlineProducerCapability(
  value: unknown
): value is GoldlineProducerCapability {
  if (!value || typeof value !== "object") return false;
  const capability = value as GoldlineProducerCapability;
  return (
    capability[GOLDLINE_PRODUCER_CAPABILITY_BRAND] === true &&
    typeof capability.producerNamespace === "string" &&
    capability.producerNamespace.length > 0 &&
    capability.producerNamespace.trim() === capability.producerNamespace &&
    Array.isArray(capability.allowedOutcomeIds) &&
    capability.allowedOutcomeIds.length > 0 &&
    Array.isArray(capability.allowedEvidenceClasses) &&
    capability.allowedEvidenceClasses.length > 0
  );
}

/**
 * Authority check. Brand shape alone is not membership in the trusted set.
 */
export function isAuthorizedGoldlineProducerCapability(
  value: unknown
): value is GoldlineProducerCapability {
  return (
    isGoldlineProducerCapability(value) &&
    AUTHORIZED_GOLDLINE_PRODUCER_CAPABILITIES.has(value)
  );
}

/**
 * Env-gated registration for test-support minting. Production runtime cannot
 * use this to obtain a capability. Does not add to any production collection.
 */
export function authorizeTestGoldlineProducerCapability(input: {
  producerNamespace: string;
  allowedOutcomeIds: readonly SupportedProductionGoldlineOutcomeId[];
  allowedEvidenceClasses: readonly GoldlineEvidenceClass[];
}): GoldlineProducerCapability {
  assertTestCapabilityAllowed();
  if (
    !input.producerNamespace ||
    input.producerNamespace.trim() !== input.producerNamespace
  ) {
    throw new Error("Test Goldline producer requires a producer namespace");
  }
  if (!input.allowedOutcomeIds.length) {
    throw new Error("Test Goldline producer requires allowed outcomes");
  }
  if (!input.allowedEvidenceClasses.length) {
    throw new Error("Test Goldline producer requires allowed evidence classes");
  }
  return mintGoldlineProducerCapability(input);
}

/**
 * Production capabilities are minted into the private WeakSet only. The
 * registry is empty: there is no production capability object to take.
 * Future producers must be named here and handed to a dedicated adapter,
 * never exported as a generic array/map/lookup.
 */
for (const definition of REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS) {
  mintGoldlineProducerCapability(definition);
}
