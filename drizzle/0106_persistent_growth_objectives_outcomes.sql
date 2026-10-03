-- Persistent Growth Operator PR5 — Slices H + I.
-- Materialized playable objectives, outcome binding, and economic accountability.
-- This file is the one-shot schema migration. scripts/migrate.mjs applies the
-- same shape idempotently for production boot migrations.

CREATE TABLE IF NOT EXISTS `goal_cycle_objectives` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `goalRunId` varchar(36) NOT NULL,
  `cycleId` varchar(36) NOT NULL,
  `decisionId` varchar(36) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `selectionKind` varchar(32) NOT NULL,
  `selectedRef` varchar(191) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `executionType` varchar(32) NULL,
  `authority` varchar(32) NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'presented',
  `statusReason` text NULL,
  `actionTargetType` varchar(64) NULL,
  `actionTargetId` varchar(128) NULL,
  `actionTargetDisplayName` varchar(255) NULL,
  `businessDate` varchar(10) NOT NULL,
  `windowStart` varchar(32) NULL,
  `windowEnd` varchar(32) NULL,
  `loadoutJson` json NOT NULL,
  `evidenceRefsJson` json NOT NULL,
  `completedAt` timestamp(3) NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goal_cycle_objectives_decision` (`tenantId`, `decisionId`),
  KEY `idx_goal_cycle_objectives_run` (`tenantId`, `goalRunId`, `createdAt`),
  KEY `idx_goal_cycle_objectives_operator` (`tenantId`, `canonicalOperatorId`, `status`, `businessDate`)
);

CREATE TABLE IF NOT EXISTS `goal_cycle_outcomes` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `goalRunId` varchar(36) NOT NULL,
  `cycleId` varchar(36) NOT NULL,
  `decisionId` varchar(36) NOT NULL,
  `objectiveId` varchar(36) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `outcomeKind` varchar(64) NOT NULL,
  `impactClass` varchar(32) NOT NULL,
  `epistemicStatus` varchar(32) NOT NULL DEFAULT 'verified',
  `evidenceClass` varchar(32) NOT NULL,
  `evidenceReference` varchar(191) NOT NULL,
  `sourceSystem` varchar(64) NOT NULL,
  `monetaryValueCents` int NULL,
  `quantityValue` decimal(15, 2) NULL,
  `unit` varchar(32) NULL,
  `explanation` text NULL,
  `metadataJson` json NULL,
  `observedAt` timestamp(3) NOT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goal_cycle_outcomes_idempotency` (`tenantId`, `objectiveId`, `outcomeKind`, `evidenceReference`),
  KEY `idx_goal_cycle_outcomes_decision` (`tenantId`, `decisionId`, `createdAt`),
  KEY `idx_goal_cycle_outcomes_objective` (`tenantId`, `objectiveId`, `createdAt`),
  KEY `idx_goal_cycle_outcomes_run` (`tenantId`, `goalRunId`, `createdAt`)
);

ALTER TABLE `agent_events`
  ADD COLUMN `objectiveId` varchar(36) NULL,
  ADD KEY `idx_agent_events_objective` (`tenantId`, `objectiveId`, `id`);
