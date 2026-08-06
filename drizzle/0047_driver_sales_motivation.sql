CREATE TABLE IF NOT EXISTS `driver_sales_score_events` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `driverId` varchar(128) NOT NULL,
  `missionId` int NULL,
  `eventType` varchar(64) NOT NULL,
  `points` int NOT NULL,
  `dedupeKey` varchar(191) NOT NULL,
  `metadataJson` json NULL,
  `occurredAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_driver_sales_score_tenant_dedupe` (`tenantId`,`dedupeKey`),
  KEY `idx_driver_sales_score_tenant_driver_occurred` (`tenantId`,`driverId`,`occurredAt`)
);

CREATE TABLE IF NOT EXISTS `driver_sales_journals` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `driverId` varchar(128) NOT NULL,
  `journalDate` varchar(10) NOT NULL,
  `audioStorageKey` varchar(512) NULL,
  `audioMimeType` varchar(96) NULL,
  `transcript` text NOT NULL,
  `insightsJson` json NOT NULL,
  `processingStatus` enum('processed','fallback') NOT NULL,
  `journalPoints` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_driver_sales_journal_tenant_driver_date` (`tenantId`,`driverId`,`journalDate`),
  KEY `idx_driver_sales_journal_tenant_created` (`tenantId`,`createdAt`)
);

CREATE TABLE IF NOT EXISTS `driver_sales_playbook_sources` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `name` varchar(191) NOT NULL,
  `sourceType` enum('foundation','instagram','document','video','other') NOT NULL,
  `sourceUrl` varchar(1024) NULL,
  `attribution` varchar(512) NULL,
  `content` text NOT NULL,
  `active` boolean NOT NULL DEFAULT true,
  `createdBy` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_driver_sales_playbook_tenant_active` (`tenantId`,`active`)
);
