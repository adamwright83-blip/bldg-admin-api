-- Goldline campaigns — Adventure Director 2.0
--
-- Identity, authored bindings, revision history, and cross-device fiction
-- assignment. Not a copy of business records or territory progress.
-- Additive, tenant-scoped, operator-scoped, restart-safe. No coordinates.

CREATE TABLE IF NOT EXISTS `goldline_campaign_instances` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorId` varchar(128) NOT NULL,
  `businessDate` varchar(10) NOT NULL,
  `rulesVersion` int NOT NULL DEFAULT 1,
  `stableKey` varchar(191) NOT NULL,
  `campaignArchetypeId` varchar(32) NOT NULL,
  `title` varchar(128) NOT NULL,
  `premise` varchar(512) NOT NULL,
  `inputFingerprint` varchar(80) NOT NULL,
  `status` varchar(16) NOT NULL,
  `currentChapterId` varchar(191) NULL,
  `completedChapterIdsJson` json NOT NULL,
  `chaptersJson` json NOT NULL,
  `revision` int NOT NULL DEFAULT 1,
  `endingTreatment` varchar(512) NULL,
  `classification` varchar(32) NOT NULL DEFAULT 'game_projection',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `startedAt` timestamp NULL,
  `completedAt` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goldline_campaign_day` (`tenantId`,`businessDate`,`rulesVersion`),
  UNIQUE KEY `uq_goldline_campaign_stable` (`tenantId`,`stableKey`),
  KEY `idx_goldline_campaign_operator` (`tenantId`,`operatorId`,`businessDate`)
);

CREATE TABLE IF NOT EXISTS `goldline_campaign_revisions` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `campaignId` varchar(36) NOT NULL,
  `revision` int NOT NULL,
  `inputFingerprint` varchar(80) NOT NULL,
  `reasonCodesJson` json NOT NULL,
  `addedFutureChapterIdsJson` json NOT NULL,
  `removedFutureChapterIdsJson` json NOT NULL,
  `reorderedFutureChapterIdsJson` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goldline_campaign_revision` (`campaignId`,`revision`)
);

CREATE TABLE IF NOT EXISTS `goldline_fiction_assignments` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorId` varchar(128) NOT NULL,
  `stableMissionKey` varchar(191) NOT NULL,
  `templateId` varchar(64) NOT NULL,
  `rulesVersion` int NOT NULL DEFAULT 1,
  `instantiatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goldline_fiction_mission` (`tenantId`,`operatorId`,`stableMissionKey`)
);
