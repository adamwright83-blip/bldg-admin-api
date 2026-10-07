CREATE TABLE `daphne_goals` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `goalKey` varchar(191) NOT NULL,
  `horizon` enum('current','near','long') NOT NULL,
  `statement` text NOT NULL,
  `priority` int NOT NULL DEFAULT 0,
  `constraintsJson` json,
  `status` enum('active','completed','abandoned','superseded') NOT NULL DEFAULT 'active',
  `sourceObservationId` varchar(64) NOT NULL,
  `supersedesGoalId` varchar(64),
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `closedAt` timestamp(3),
  CONSTRAINT `daphne_goals_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_daphne_goals_operator_goal` ON `daphne_goals` (`tenantId`,`canonicalOperatorId`,`goalKey`,`createdAt`);
CREATE INDEX `idx_daphne_goals_operator_status` ON `daphne_goals` (`tenantId`,`canonicalOperatorId`,`status`,`priority`);

CREATE TABLE `daphne_meta_preferences` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `preferenceKey` varchar(96) NOT NULL,
  `valueJson` json NOT NULL,
  `version` int NOT NULL,
  `sourceObservationId` varchar(64) NOT NULL,
  `status` enum('active','revoked') NOT NULL DEFAULT 'active',
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `daphne_meta_preferences_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_daphne_meta_pref_version` UNIQUE(`tenantId`,`canonicalOperatorId`,`preferenceKey`,`version`)
);
CREATE INDEX `idx_daphne_meta_pref_operator` ON `daphne_meta_preferences` (`tenantId`,`canonicalOperatorId`,`preferenceKey`,`createdAt`);

CREATE TABLE `daphne_interventions` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `agentId` varchar(128) NOT NULL,
  `decisionPointId` varchar(128) NOT NULL,
  `contextKey` varchar(191) NOT NULL,
  `acceptableActionsJson` json NOT NULL,
  `chosenAction` varchar(128) NOT NULL,
  `selectionMode` enum('deterministic','randomized','propensity','manual','abstain') NOT NULL,
  `selectionProbability` decimal(8,7),
  `propensityJson` json,
  `policyVersion` varchar(64) NOT NULL,
  `policyReceiptJson` json,
  `interventionDefinitionVersion` int,
  `proximalOutcomeWindowMinutes` int,
  `sourceObservationIdsJson` json NOT NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `daphne_interventions_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_daphne_interventions_idempotency` UNIQUE(`tenantId`,`canonicalOperatorId`,`idempotencyKey`)
);
CREATE INDEX `idx_daphne_interventions_operator_decision` ON `daphne_interventions` (`tenantId`,`canonicalOperatorId`,`decisionPointId`);
CREATE INDEX `idx_daphne_interventions_context` ON `daphne_interventions` (`tenantId`,`canonicalOperatorId`,`contextKey`,`createdAt`);

CREATE TABLE `daphne_outcomes` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `interventionId` varchar(64),
  `outcomeClass` enum('proximal','distal','burden','relationship') NOT NULL,
  `measureKey` varchar(128) NOT NULL,
  `valueJson` json NOT NULL,
  `evidenceClass` enum('authoritative_external','system_record','operator_attested') NOT NULL,
  `verificationStatus` enum('verified','attested','disputed','rejected') NOT NULL,
  `sourceReference` varchar(191) NOT NULL,
  `windowStart` timestamp(3),
  `windowEnd` timestamp(3),
  `observedAt` timestamp(3) NOT NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `daphne_outcomes_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_daphne_outcomes_idempotency` UNIQUE(`tenantId`,`canonicalOperatorId`,`idempotencyKey`)
);
CREATE INDEX `idx_daphne_outcomes_intervention` ON `daphne_outcomes` (`tenantId`,`canonicalOperatorId`,`interventionId`,`observedAt`);
CREATE INDEX `idx_daphne_outcomes_measure` ON `daphne_outcomes` (`tenantId`,`canonicalOperatorId`,`measureKey`,`observedAt`);

CREATE TABLE `daphne_metric_events` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `canonicalOperatorId` varchar(191),
  `agentId` varchar(128),
  `eventName` varchar(128) NOT NULL,
  `propertiesJson` json,
  `sourceReference` varchar(191),
  `occurredAt` timestamp(3) NOT NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `daphne_metric_events_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_daphne_metric_idempotency` UNIQUE(`tenantId`,`idempotencyKey`)
);
CREATE INDEX `idx_daphne_metric_event` ON `daphne_metric_events` (`tenantId`,`eventName`,`occurredAt`);
CREATE INDEX `idx_daphne_metric_operator` ON `daphne_metric_events` (`tenantId`,`canonicalOperatorId`,`occurredAt`);
