-- Slice 2: Kingdom sequence and campaign contracts.
-- A Kingdom row connects a real campaign (goldline_campaigns) to its
-- fictional field mission, Lantern City status, Driver-day relevance, the
-- companion it earns, and the next Kingdom it enables. No fictional surface
-- may write business outcomes through this table.

CREATE TABLE IF NOT EXISTS `goldline_kingdoms` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `kingdomId` varchar(64) NOT NULL,
  `sequence` int NOT NULL,
  `title` varchar(191) NOT NULL,
  `realCampaignId` varchar(64) NULL,
  `fictionalFieldMission` varchar(191) NOT NULL,
  `lanternCityStatus` varchar(32) NOT NULL DEFAULT 'locked',
  `driverDayRelevance` varchar(512) NOT NULL,
  `companionEarnedId` varchar(64) NULL,
  `enablesKingdomId` varchar(64) NULL,
  `capabilityRequirement` varchar(512) NULL,
  `selectedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goldline_kingdom_id` (`tenantId`,`kingdomId`)
);
