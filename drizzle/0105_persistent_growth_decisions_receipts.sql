-- Persistent Growth Operator PR4 — Slices E + F + G.
-- Append-only goal-cycle decisions, obligation lineage, and receipt lineage.
-- This file is the one-shot schema migration. scripts/migrate.mjs applies the
-- same shape idempotently for production boot migrations.

CREATE TABLE IF NOT EXISTS `claire_proactive_obligations` (
  `id` varchar(191) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `kind` varchar(32) NOT NULL,
  `subjectKey` varchar(191) NOT NULL,
  `payloadJson` json NOT NULL,
  `status` varchar(32) NOT NULL,
  `dueDate` varchar(10) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_claire_proactive_open` (`tenantId`, `operatorUserId`, `status`, `dueDate`)
);

ALTER TABLE `claire_proactive_obligations`
  ADD COLUMN `canonicalOperatorId` varchar(191) NULL,
  ADD COLUMN `goalRunId` varchar(36) NULL,
  ADD COLUMN `cycleId` varchar(36) NULL,
  ADD COLUMN `decisionId` varchar(36) NULL,
  ADD COLUMN `executionType` varchar(32) NULL,
  ADD COLUMN `commercialFollowUpRef` varchar(191) NULL,
  ADD COLUMN `objectiveRef` varchar(191) NULL,
  ADD COLUMN `agentEventId` int NULL,
  ADD KEY `idx_claire_proactive_decision` (`tenantId`, `decisionId`),
  ADD KEY `idx_claire_proactive_cycle` (`tenantId`, `cycleId`);

CREATE TABLE `goal_cycle_decisions` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `goalRunId` varchar(36) NOT NULL,
  `cycleId` varchar(36) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `policyVersion` varchar(96) NOT NULL,
  `weeklyIntentId` varchar(36) NULL,
  `weeklyIntentRevision` int NULL,
  `weekStart` varchar(10) NULL,
  `candidateFingerprint` varchar(64) NULL,
  `candidateIdsJson` json NOT NULL,
  `candidateReasonCodesJson` json NOT NULL,
  `missionDirectorPlanId` varchar(36) NULL,
  `missionDirectorRevision` int NULL,
  `selectionKind` varchar(32) NOT NULL,
  `selectedRef` varchar(191) NULL,
  `selectedExecutionType` varchar(32) NULL,
  `selectedReasonCode` varchar(64) NOT NULL,
  `evidenceRefsJson` json NOT NULL,
  `blockedCandidatesJson` json NOT NULL,
  `priorComparableDecisionId` varchar(36) NULL,
  `sourceCoverageJson` json NOT NULL,
  `loadoutJson` json NOT NULL,
  `experimentJson` json NULL,
  `decisionFingerprint` varchar(64) NOT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goal_cycle_decisions_cycle` (`tenantId`, `cycleId`),
  KEY `idx_goal_cycle_decisions_run` (`tenantId`, `goalRunId`, `createdAt`),
  KEY `idx_goal_cycle_decisions_selected` (`tenantId`, `selectionKind`, `selectedRef`, `createdAt`)
);

ALTER TABLE `agent_events`
  MODIFY COLUMN `status` enum(
    'proposed','policy_denied','write_withheld','approval_required',
    'execution_started','success','failed','blocked'
  ) NOT NULL,
  ADD COLUMN `goalRunId` varchar(36) NULL,
  ADD COLUMN `cycleId` varchar(36) NULL,
  ADD COLUMN `decisionId` varchar(36) NULL,
  ADD COLUMN `obligationId` varchar(191) NULL,
  ADD COLUMN `authorityBasis` varchar(64) NULL,
  ADD COLUMN `approvalBasis` varchar(64) NULL,
  ADD COLUMN `standingAuthorizationId` varchar(36) NULL,
  ADD COLUMN `standingAuthorizationVersion` int NULL,
  ADD COLUMN `policyVersion` varchar(96) NULL,
  ADD COLUMN `operationStatus` varchar(32) NULL,
  ADD KEY `idx_agent_events_decision` (`tenantId`, `decisionId`, `id`),
  ADD KEY `idx_agent_events_cycle` (`tenantId`, `cycleId`, `id`);

ALTER TABLE `communication_receipts`
  ADD COLUMN `agentEventId` int NULL,
  ADD COLUMN `decisionId` varchar(36) NULL,
  ADD KEY `idx_communication_receipts_decision` (`tenantId`, `decisionId`, `createdAt`);
