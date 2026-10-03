-- Persistent Growth Operator PR6 — Slices J + K + L.
-- Receipt-backed learning deltas, proof/read models, and multi-tenant hardening.
-- This file is the one-shot schema migration. scripts/migrate.mjs applies the
-- same shape idempotently for production boot migrations.

CREATE TABLE IF NOT EXISTS `goal_cycle_learned_deltas` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `goalRunId` varchar(36) NOT NULL,
  `cycleId` varchar(36) NOT NULL,
  `decisionId` varchar(36) NOT NULL,
  `objectiveId` varchar(36) NOT NULL,
  `outcomeId` varchar(36) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `learningKind` varchar(64) NOT NULL,
  `targetKey` varchar(191) NOT NULL,
  `deltaType` varchar(32) NOT NULL,
  `beforeStateJson` json NULL,
  `afterStateJson` json NOT NULL,
  `evidenceReference` varchar(191) NOT NULL,
  `confidence` varchar(32) NOT NULL DEFAULT 'high',
  `explanation` text NOT NULL,
  `appliedCount` int NOT NULL DEFAULT 1,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goal_cycle_learned_deltas_idempotency` (`tenantId`, `outcomeId`, `learningKind`, `targetKey`),
  KEY `idx_goal_cycle_learned_deltas_decision` (`tenantId`, `decisionId`, `createdAt`),
  KEY `idx_goal_cycle_learned_deltas_objective` (`tenantId`, `objectiveId`, `createdAt`),
  KEY `idx_goal_cycle_learned_deltas_run` (`tenantId`, `goalRunId`, `createdAt`),
  KEY `idx_goal_cycle_learned_deltas_operator` (`tenantId`, `canonicalOperatorId`, `learningKind`, `targetKey`)
);
