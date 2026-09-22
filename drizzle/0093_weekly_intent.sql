-- Thin weekly agreement. Not a task table. Day Director remains the work.
-- Applied by scripts/migrate.mjs (keep both in sync).

CREATE TABLE IF NOT EXISTS `weekly_intents` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `operatorId` varchar(128) NOT NULL,
  `weekStart` varchar(10) NOT NULL,
  `revision` int NOT NULL,
  `source` enum('operator_confirmed_proposal') NOT NULL,
  `lockedAt` timestamp NOT NULL,
  `daysJson` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_weekly_intent_revision` (`tenantId`, `operatorId`, `weekStart`, `revision`),
  KEY `idx_weekly_intent_week` (`tenantId`, `operatorId`, `weekStart`)
);
