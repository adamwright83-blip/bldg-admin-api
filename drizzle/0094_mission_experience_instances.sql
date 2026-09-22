-- One wrapper row per playable selected-work instance.
-- Campaign runs and Mission Director plans are not 1:1 with that instance.
-- Applied by scripts/migrate.mjs (keep both in sync).

CREATE TABLE IF NOT EXISTS `mission_experience_instances` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorId` varchar(128) NOT NULL,
  `businessDate` varchar(10) NOT NULL,
  `authorityKey` varchar(191) NOT NULL,
  `source` varchar(32) NOT NULL,
  `title` varchar(255) NOT NULL,
  `realObjective` text NOT NULL,
  `status` varchar(32) NOT NULL,
  `phase` varchar(64) NOT NULL,
  `playShape` varchar(16) NOT NULL,
  `gameplayHost` varchar(64) NULL,
  `visualPackageId` varchar(64) NULL,
  `authorityRefJson` json NOT NULL,
  `gameplayJson` json NOT NULL,
  `realGateJson` json NOT NULL,
  `consequenceJson` json NOT NULL,
  `replacementJson` json NULL,
  `entrancesJson` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mission_experience_authority` (`tenantId`, `operatorId`, `businessDate`, `authorityKey`),
  KEY `idx_mission_experience_day` (`tenantId`, `operatorId`, `businessDate`)
);
