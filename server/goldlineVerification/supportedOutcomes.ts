/**
 * Outcome IDs that COMPLETE Narrator eligibility currently knows how to read.
 * Issuance still requires a real authoritative producer. Slice E inventory
 * found none that are trustworthy enough to attach. An empty producer
 * registry is a successful inventory, not a prompt to synthesize evidence.
 */
export const SUPPORTED_PRODUCTION_GOLDLINE_OUTCOME_IDS = [
  "physical_first_visit",
  "dormant_known_customer_reactivation",
  "warm_first_outbound",
  "spoken_no",
  "silence_eligible_for_retry",
  "no_show",
  "contact_reopened_after_no",
  "legitimate_second_site_visit",
  "timed_retry_after_silence",
  "reinspect_previously_deployed_item",
  "kept_promised_send_visit_or_call",
  "legitimate_physical_run_inside_real_window",
] as const;

export type SupportedProductionGoldlineOutcomeId =
  (typeof SUPPORTED_PRODUCTION_GOLDLINE_OUTCOME_IDS)[number];

export function isSupportedProductionGoldlineOutcomeId(
  value: string
): value is SupportedProductionGoldlineOutcomeId {
  return (
    SUPPORTED_PRODUCTION_GOLDLINE_OUTCOME_IDS as readonly string[]
  ).includes(value);
}

/**
 * Closed production producer registry. Empty on purpose: none of the
 * COMPLETE-mission outcomes currently have a trustworthy producer. Do not
 * put a name here to complete the table. A future producer is an explicit
 * code change here (namespace + allowed outcomes + evidence classes) plus
 * a named capability constant minted in producerCapability.ts.
 */
export type ProductionGoldlineProducerDefinition = {
  readonly producerNamespace: string;
  readonly allowedOutcomeIds: readonly SupportedProductionGoldlineOutcomeId[];
  readonly allowedEvidenceClasses: readonly (
    | "authoritative_external"
    | "operator_attested"
  )[];
};

export const REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS: readonly ProductionGoldlineProducerDefinition[] =
  [];
