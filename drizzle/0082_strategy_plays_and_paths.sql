-- Drizzle migration: strategy_plays, strategy_path_offers, strategy_path_choices (Slice 6)
CREATE TABLE IF NOT EXISTS `strategy_plays` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `tenantId` VARCHAR(64) NOT NULL,
  `businessName` VARCHAR(191) NOT NULL,
  `worldName` VARCHAR(191) NOT NULL,
  `hypothesis` TEXT NOT NULL,
  `primaryMetric` VARCHAR(64) NOT NULL,
  `geography` VARCHAR(128) NOT NULL,
  `stopsCount` INT NOT NULL DEFAULT 1,
  `isClustered` BOOLEAN NOT NULL DEFAULT FALSE,
  `estimatedInitiationCost` INT NOT NULL DEFAULT 0,
  `estimatedSpendCents` INT NOT NULL DEFAULT 0,
  `spendCategory` VARCHAR(64) NOT NULL DEFAULT 'other',
  `confidence` VARCHAR(32) NOT NULL DEFAULT 'medium',
  `evidenceReferencesJson` JSON NULL,
  `scoreBreakdownJson` JSON NOT NULL,
  `totalScore` INT NOT NULL DEFAULT 0,
  `status` ENUM('candidate', 'offered', 'chosen', 'active', 'paused', 'retired') NOT NULL DEFAULT 'candidate',
  `needsApprovalToRun` BOOLEAN NOT NULL DEFAULT FALSE,
  `minimumEvidenceThresholdJson` JSON NULL,
  `verticalKey` VARCHAR(64) NOT NULL DEFAULT 'generic',
  `templateKey` VARCHAR(64) NOT NULL,
  `provenanceJson` JSON NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_strategy_plays_tenant_status` (`tenantId`, `status`)
);

CREATE TABLE IF NOT EXISTS `strategy_path_offers` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `tenantId` VARCHAR(64) NOT NULL,
  `playIdsJson` JSON NOT NULL,
  `recommendedPlayId` VARCHAR(64) NOT NULL,
  `claireRationale` TEXT NOT NULL,
  `status` ENUM('active', 'accepted', 'expired', 'superseded') NOT NULL DEFAULT 'active',
  `offeredAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `businessDate` VARCHAR(10) NOT NULL,
  `expiresAt` TIMESTAMP NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_strategy_path_offers_tenant_status` (`tenantId`, `status`),
  KEY `idx_strategy_path_offers_tenant_date` (`tenantId`, `businessDate`)
);

CREATE TABLE IF NOT EXISTS `strategy_path_choices` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `tenantId` VARCHAR(64) NOT NULL,
  `offerId` VARCHAR(64) NULL,
  `playId` VARCHAR(64) NOT NULL,
  `chosenOnSurface` ENUM('map', 'voice', 'admin') NOT NULL,
  `previousPlayId` VARCHAR(64) NULL,
  `readbackConfirmed` BOOLEAN NOT NULL DEFAULT FALSE,
  `chosenAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_strategy_path_choices_tenant_play` (`tenantId`, `playId`)
);
