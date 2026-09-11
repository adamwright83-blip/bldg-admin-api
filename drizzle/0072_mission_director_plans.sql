-- Slice 4: Mission Director plans. Append-only revisions per business date —
-- never overwritten, so it stays provable what the plan said before the day
-- changed. stableKey/inputFingerprint follows the authored_days pattern.

CREATE TABLE IF NOT EXISTS `mission_director_plans` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorId` varchar(128) NOT NULL,
  `businessDate` varchar(10) NOT NULL,
  `stableKey` varchar(191) NOT NULL,
  `revision` int NOT NULL DEFAULT 1,
  `inputFingerprint` varchar(80) NOT NULL,
  `outcomeJson` json NOT NULL,
  `usageOutcome` varchar(16) NULL,
  `usageReportedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mission_director_plan_revision` (`tenantId`,`operatorId`,`businessDate`,`revision`)
);
