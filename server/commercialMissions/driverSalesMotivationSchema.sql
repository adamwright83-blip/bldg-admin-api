-- Driver sales motivation: score events, daily journals, and playbook sources.
--
-- Same never-applied-migration bug documented in
-- server/goldlineWorld/schema.sql: these tables were introduced in
-- drizzle/0047_driver_sales_motivation.sql and drizzle/0061 (which added
-- transcript/location columns to driver_sales_journals), but
-- scripts/migrate.mjs never runs drizzle/*.sql, so production never had
-- them and driver journal capture failed on every submission.
--
-- driver_sales_journals below is 0047's shape merged with 0061's additive
-- columns, so a fresh install lands on the final shape in one step; the
-- ALTER TABLE further down is a best-effort upgrade for a database that
-- already has the 0047-only shape.
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
)
;

CREATE TABLE IF NOT EXISTS `driver_sales_journals` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `driverId` varchar(128) NOT NULL,
  `journalDate` varchar(10) NOT NULL,
  `clientRequestId` varchar(36) NULL,
  `audioStorageKey` varchar(512) NULL,
  `audioMimeType` varchar(96) NULL,
  `rawTranscript` text NULL,
  `transcript` text NOT NULL,
  `insightsJson` json NOT NULL,
  `processingStatus` enum('captured','transcribing','extracting','processed','fallback','failed') NOT NULL DEFAULT 'captured',
  `journalPoints` int NOT NULL DEFAULT 0,
  `captureLatitude` decimal(10,7) NULL,
  `captureLongitude` decimal(10,7) NULL,
  `captureAccuracyMeters` decimal(10,2) NULL,
  `locationCapturedAt` timestamp NULL,
  `locationContemporaneous` boolean NOT NULL DEFAULT false,
  `processingError` varchar(512) NULL,
  `processingAttempts` int NOT NULL DEFAULT 0,
  `processedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_driver_sales_journal_tenant_request` (`tenantId`,`clientRequestId`),
  KEY `idx_driver_sales_journal_processing` (`tenantId`,`processingStatus`,`createdAt`),
  KEY `idx_driver_sales_journal_driver_date` (`tenantId`,`driverId`,`journalDate`,`createdAt`),
  KEY `idx_driver_sales_journal_tenant_created` (`tenantId`,`createdAt`)
)
;

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
)
