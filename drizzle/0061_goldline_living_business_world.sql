-- Goldline Living Business World
--
-- Existing driver_sales_journals rows remain in place.  The former daily
-- uniqueness rule made a second journal overwrite the first; removing that
-- index turns the existing table into an immutable entry ledger without
-- rewriting historical evidence.
ALTER TABLE `driver_sales_journals`
  DROP INDEX `uq_driver_sales_journal_tenant_driver_date`;

ALTER TABLE `driver_sales_journals`
  MODIFY COLUMN `processingStatus` enum(
    'captured','transcribing','extracting','processed','fallback','failed'
  ) NOT NULL DEFAULT 'captured',
  ADD COLUMN `clientRequestId` varchar(36) NULL AFTER `journalDate`,
  ADD COLUMN `rawTranscript` text NULL AFTER `audioMimeType`,
  ADD COLUMN `captureLatitude` decimal(10,7) NULL AFTER `journalPoints`,
  ADD COLUMN `captureLongitude` decimal(10,7) NULL AFTER `captureLatitude`,
  ADD COLUMN `captureAccuracyMeters` decimal(10,2) NULL AFTER `captureLongitude`,
  ADD COLUMN `locationCapturedAt` timestamp NULL AFTER `captureAccuracyMeters`,
  ADD COLUMN `locationContemporaneous` boolean NOT NULL DEFAULT false AFTER `locationCapturedAt`,
  ADD COLUMN `processingError` varchar(512) NULL AFTER `locationContemporaneous`,
  ADD COLUMN `processingAttempts` int NOT NULL DEFAULT 0 AFTER `processingError`,
  ADD COLUMN `processedAt` timestamp NULL AFTER `processingAttempts`,
  ADD UNIQUE KEY `uq_driver_sales_journal_tenant_request` (`tenantId`,`clientRequestId`),
  ADD KEY `idx_driver_sales_journal_processing` (`tenantId`,`processingStatus`,`createdAt`),
  ADD KEY `idx_driver_sales_journal_driver_date` (`tenantId`,`driverId`,`journalDate`,`createdAt`);

UPDATE `driver_sales_journals`
SET `rawTranscript` = `transcript`,
    `processedAt` = COALESCE(`processedAt`, `updatedAt`)
WHERE `rawTranscript` IS NULL;

-- Role-neutral real-world identity.  This table intentionally has no address,
-- latitude, or longitude; entity_locations remains geographic authority.
CREATE TABLE IF NOT EXISTS `physical_entities` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `kind` enum('building','property','other_place') NOT NULL DEFAULT 'building',
  `displayName` varchar(255) NOT NULL,
  `identityStatus` enum('confirmed','provisional','needs_review','merged') NOT NULL DEFAULT 'provisional',
  `canonicalEntityId` varchar(36) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_physical_entities_tenant_status` (`tenantId`,`identityStatus`,`updatedAt`),
  KEY `idx_physical_entities_canonical` (`tenantId`,`canonicalEntityId`)
);

CREATE TABLE IF NOT EXISTS `physical_entity_bindings` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `physicalEntityId` varchar(36) NOT NULL,
  `bindingType` enum(
    'canonical_building','customer_cluster','commercial_account',
    'commercial_location','commercial_prospect','journal_entry',
    'tower_wars_building','tower_asset','provider_place'
  ) NOT NULL,
  `bindingKey` varchar(191) NOT NULL,
  `evidenceReference` varchar(512) NOT NULL,
  `confidence` enum('high','medium','low') NOT NULL,
  `reviewState` enum('accepted','review_required','rejected') NOT NULL DEFAULT 'accepted',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_physical_binding_source` (`tenantId`,`bindingType`,`bindingKey`),
  KEY `idx_physical_binding_entity` (`tenantId`,`physicalEntityId`,`createdAt`)
);

CREATE TABLE IF NOT EXISTS `physical_entity_aliases` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `physicalEntityId` varchar(36) NOT NULL,
  `aliasType` enum('name','normalized_address','google_place_id','operator_alias') NOT NULL,
  `aliasValue` varchar(512) NOT NULL,
  `normalizedAliasValue` varchar(512) NOT NULL,
  `evidenceReference` varchar(512) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_physical_alias` (`tenantId`,`aliasType`,`normalizedAliasValue`),
  KEY `idx_physical_alias_entity` (`tenantId`,`physicalEntityId`)
);

-- Append-only reference ledger. Authoritative domain rows remain authoritative;
-- this seam records how those rows enter Goldline history and presentation.
CREATE TABLE IF NOT EXISTS `goldline_world_events` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `physicalEntityId` varchar(36) NULL,
  `eventType` varchar(64) NOT NULL,
  `classification` enum('evidence','action','outcome','derived_signal','game_projection') NOT NULL,
  `actorType` enum('system','operator','field','customer','provider','unknown') NOT NULL,
  `actorId` varchar(128) NULL,
  `occurredAt` timestamp NOT NULL,
  `observedAt` timestamp NULL,
  `sourceType` varchar(64) NOT NULL,
  `sourceId` varchar(191) NOT NULL,
  `sourceEvidenceReference` varchar(512) NOT NULL,
  `provenanceClass` enum(
    'operator_observed','operator_reported','device_location','provider_verified',
    'official_property_source','existing_business_record','derived','generated_game_fiction'
  ) NOT NULL,
  `verificationClass` enum('VERIFIED','ATTESTED','CLAIMED') NOT NULL,
  `confidence` enum('high','medium','low','unknown') NOT NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `correlationId` varchar(191) NOT NULL,
  `metadataJson` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goldline_world_event_idempotency` (`tenantId`,`idempotencyKey`),
  KEY `idx_goldline_world_event_entity` (`tenantId`,`physicalEntityId`,`occurredAt`),
  KEY `idx_goldline_world_event_class` (`tenantId`,`classification`,`occurredAt`),
  KEY `idx_goldline_world_event_source` (`tenantId`,`sourceType`,`sourceId`)
);

CREATE TABLE IF NOT EXISTS `goldline_event_receipts` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `worldEventId` varchar(36) NOT NULL,
  `viewerId` varchar(128) NOT NULL,
  `receiptType` enum('presented','read','acknowledged') NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goldline_event_receipt` (`tenantId`,`worldEventId`,`viewerId`,`receiptType`),
  KEY `idx_goldline_event_receipt_viewer` (`tenantId`,`viewerId`,`createdAt`)
);

CREATE TABLE IF NOT EXISTS `field_journal_extractions` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `journalEntryId` varchar(36) NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `provider` varchar(64) NULL,
  `model` varchar(96) NULL,
  `schemaVersion` varchar(32) NOT NULL,
  `status` enum('pending','processed','fallback','failed') NOT NULL DEFAULT 'pending',
  `itemsJson` json NOT NULL,
  `error` varchar(512) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_field_journal_extraction_version` (`tenantId`,`journalEntryId`,`version`),
  KEY `idx_field_journal_extraction_status` (`tenantId`,`status`,`createdAt`)
);

CREATE TABLE IF NOT EXISTS `tower_forge_jobs` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `physicalEntityId` varchar(36) NULL,
  `journalEntryId` varchar(36) NULL,
  `commercialAccountId` int NULL,
  `state` enum(
    'captured','extracting','entity_resolving','needs_review','geography_verifying',
    'prospect_created','researching','research_partial','concepting','rendering',
    'generation_unconfigured','generation_failed','review_ready','approved','rejected','published'
  ) NOT NULL DEFAULT 'captured',
  `correlationId` varchar(191) NOT NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `candidateJson` json NOT NULL,
  `retryCount` int NOT NULL DEFAULT 0,
  `lastError` varchar(512) NULL,
  `leaseOwner` varchar(128) NULL,
  `leaseExpiresAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completedAt` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tower_forge_job_idempotency` (`tenantId`,`idempotencyKey`),
  KEY `idx_tower_forge_job_queue` (`tenantId`,`state`,`leaseExpiresAt`,`updatedAt`),
  KEY `idx_tower_forge_job_entity` (`tenantId`,`physicalEntityId`,`updatedAt`)
);

CREATE TABLE IF NOT EXISTS `property_evidence_items` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `physicalEntityId` varchar(36) NOT NULL,
  `forgeJobId` varchar(36) NULL,
  `category` enum('real_identity','field_evidence','official_property_intelligence') NOT NULL,
  `factType` varchar(64) NOT NULL,
  `valueJson` json NOT NULL,
  `provenanceClass` enum(
    'operator_observed','operator_reported','device_location','provider_verified',
    'official_property_source','existing_business_record','derived','generated_game_fiction'
  ) NOT NULL,
  `sourceUrl` varchar(1024) NULL,
  `sourceReference` varchar(512) NOT NULL,
  `observedAt` timestamp NULL,
  `retrievedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_property_evidence_entity` (`tenantId`,`physicalEntityId`,`category`,`createdAt`),
  KEY `idx_property_evidence_forge` (`tenantId`,`forgeJobId`)
);

CREATE TABLE IF NOT EXISTS `tower_weapon_concepts` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `physicalEntityId` varchar(36) NOT NULL,
  `forgeJobId` varchar(36) NOT NULL,
  `rank` int NOT NULL,
  `title` varchar(191) NOT NULL,
  `sourceCharacteristic` varchar(512) NOT NULL,
  `sourceEvidenceIdsJson` json NOT NULL,
  `conceptJson` json NOT NULL,
  `similarityRisk` enum('low','medium','high') NOT NULL,
  `selected` boolean NOT NULL DEFAULT false,
  `reviewState` enum('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tower_weapon_concept_rank` (`tenantId`,`forgeJobId`,`rank`),
  KEY `idx_tower_weapon_concept_entity` (`tenantId`,`physicalEntityId`)
);

CREATE TABLE IF NOT EXISTS `tower_asset_versions` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `physicalEntityId` varchar(36) NOT NULL,
  `forgeJobId` varchar(36) NOT NULL,
  `conceptId` varchar(36) NOT NULL,
  `provider` varchar(64) NOT NULL,
  `modelVersion` varchar(96) NULL,
  `promptVersionHash` varchar(64) NOT NULL,
  `sourceEvidenceIdsJson` json NOT NULL,
  `storageKey` varchar(512) NOT NULL,
  `assetUrl` varchar(2048) NULL,
  `variantType` enum('base','weapon_layer','thumbnail') NOT NULL,
  `approvalStatus` enum('draft','approved','rejected','superseded') NOT NULL DEFAULT 'draft',
  `supersededBy` varchar(36) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tower_asset_entity` (`tenantId`,`physicalEntityId`,`approvalStatus`,`createdAt`),
  KEY `idx_tower_asset_forge` (`tenantId`,`forgeJobId`)
);

CREATE TABLE IF NOT EXISTS `goldline_creative_exclusions` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `themeKey` varchar(96) NOT NULL,
  `reason` varchar(512) NULL,
  `active` boolean NOT NULL DEFAULT true,
  `createdBy` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goldline_creative_exclusion` (`tenantId`,`themeKey`)
);
