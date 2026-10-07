CREATE TABLE `daphne_epistemic_claims` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `agentId` varchar(128),
  `claimType` enum(
    'direct_fact',
    'statistical_regularity',
    'prediction',
    'latent_state_estimate',
    'person_distribution_estimate',
    'if_then_hypothesis',
    'relationship_hypothesis',
    'association_estimate',
    'treatment_effect_estimate',
    'contradiction',
    'supersession'
  ) NOT NULL,
  `claimKey` varchar(191) NOT NULL,
  `claimJson` json NOT NULL,
  `sourceObservationIdsJson` json NOT NULL,
  `supportingEvidenceJson` json,
  `counterEvidenceJson` json,
  `scopeJson` json,
  `contextApplicabilityJson` json,
  `uncertaintyJson` json,
  `epistemicStatus` enum(
    'unknown',
    'insufficient_evidence',
    'association_only',
    'suggestive',
    'experimentally_supported',
    'context_specific',
    'possible_regime_change',
    'active',
    'contradicted',
    'superseded',
    'rejected'
  ) NOT NULL DEFAULT 'active',
  `causalEvidenceStatus` enum(
    'none',
    'observational',
    'propensity_supported',
    'randomized'
  ) NOT NULL DEFAULT 'none',
  `validFrom` timestamp(3),
  `validUntil` timestamp(3),
  `lastReinforcedAt` timestamp(3),
  `modelVersion` varchar(64) NOT NULL,
  `humanPinned` boolean NOT NULL DEFAULT false,
  `correctedByObservationId` varchar(64),
  `supersedesClaimId` varchar(64),
  `idempotencyKey` varchar(191) NOT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `daphne_epistemic_claims_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_daphne_epistemic_claim_idempotency` UNIQUE(`tenantId`,`canonicalOperatorId`,`idempotencyKey`)
);

CREATE INDEX `idx_daphne_epistemic_operator_claim`
  ON `daphne_epistemic_claims` (`tenantId`,`canonicalOperatorId`,`claimType`,`claimKey`,`createdAt`);

CREATE INDEX `idx_daphne_epistemic_agent_claim`
  ON `daphne_epistemic_claims` (`tenantId`,`canonicalOperatorId`,`agentId`,`claimType`,`createdAt`);

CREATE INDEX `idx_daphne_epistemic_supersedes`
  ON `daphne_epistemic_claims` (`tenantId`,`canonicalOperatorId`,`supersedesClaimId`);
