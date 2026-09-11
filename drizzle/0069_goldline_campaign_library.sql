-- Slice 1: growth campaign library.
-- Durable, editable campaign templates. Never business truth by itself —
-- an ops_task row (server/opsTasks.ts) is the real instance of doing one.
-- Round-trips the existing shared/leadHunt.ts contract via legacyContract.

CREATE TABLE IF NOT EXISTS `goldline_campaigns` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `campaignId` varchar(64) NOT NULL,
  `enabled` boolean NOT NULL DEFAULT true,
  `title` varchar(191) NOT NULL,
  `objective` varchar(512) NOT NULL,
  `completionCondition` varchar(512) NOT NULL,
  `prepLeadDays` int NOT NULL DEFAULT 0,
  `prepCondition` varchar(512) NULL,
  `pocketKind` varchar(32) NOT NULL,
  `pocketMinutesMin` int NOT NULL,
  `fallbackVariantJson` json NULL,
  `autoVerifiableJson` json NOT NULL,
  `selfReportedJson` json NOT NULL,
  `missionCategory` varchar(64) NOT NULL,
  `companionAbilityId` varchar(64) NULL,
  `timingAssumptionsJson` json NOT NULL,
  `opsTaskType` varchar(64) NOT NULL,
  `legacyContract` varchar(32) NULL,
  `legacyContractRefJson` json NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goldline_campaign_id` (`tenantId`,`campaignId`)
);
