-- Phase 0 — Persistent Growth Operator core contracts.
-- Armory J0 preserves association lineage without multiplying one real outcome
-- into multiple business wins. Historical associations are explicitly legacy.
ALTER TABLE `armory_weapon_usages`
  ADD COLUMN `decisionPointId` varchar(191) NULL AFTER `provenanceKind`,
  ADD COLUMN `encounterReference` varchar(191) NULL AFTER `decisionPointId`;

ALTER TABLE `armory_weapon_outcomes`
  ADD COLUMN `associationStrength` enum(
    'decision_point',
    'encounter',
    'mission_window_legacy'
  ) NOT NULL DEFAULT 'mission_window_legacy' AFTER `outcomeReference`;

CREATE TABLE `tenant_learning_governance` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `scope` varchar(96) NOT NULL,
  `version` int NOT NULL,
  `termsVersion` varchar(96) NOT NULL,
  `policyVersion` varchar(96) NOT NULL,
  `permittedAggregationUse` boolean NOT NULL DEFAULT false,
  `authorizedByUserId` varchar(128) NOT NULL,
  `effectiveAt` timestamp NOT NULL,
  `revokedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `tenant_learning_governance_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_tenant_learning_governance_scope_version`
    UNIQUE (`tenantId`, `scope`, `version`),
  INDEX `idx_tenant_learning_governance_active`
    (`tenantId`, `scope`, `effectiveAt`, `revokedAt`)
);
