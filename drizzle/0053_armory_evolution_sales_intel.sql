-- Slice 13 — Armory Evolution.
--
-- Additive only. Five new tables; no existing table is altered, renamed, or
-- dropped, and no prior migration is renumbered or rewritten.
--
-- Tenancy split is deliberate and load-bearing:
--   sales_intel_*        global trainer intelligence, shared across tenants
--   armory_weapon_*      personal evidence, always tenant + actor scoped
--
-- Source, transcript, extraction, and framework stay separate records so a
-- source can be re-analyzed and re-extracted later without destroying the
-- original provenance.

CREATE TABLE IF NOT EXISTS `sales_intel_source_artifacts` (
  `id` varchar(36) NOT NULL,
  `sourceType` enum('manual_url','instagram','youtube','podcast','uploaded_transcript','test_fixture','other') NOT NULL,
  `sourceUrl` varchar(1024) NULL,
  `canonicalUrl` varchar(1024) NULL,
  `externalContentId` varchar(191) NULL,
  `creatorName` varchar(191) NULL,
  `creatorHandle` varchar(191) NULL,
  `publishedAt` timestamp NULL,
  `title` varchar(512) NULL,
  `contentHash` varchar(64) NOT NULL,
  `status` enum('received','awaiting_content','processing','analyzed','extracted','failed') NOT NULL DEFAULT 'received',
  `failureCode` varchar(96) NULL,
  `failureMessage` varchar(512) NULL,
  `failureRetryable` boolean NOT NULL DEFAULT false,
  `attemptCount` int NOT NULL DEFAULT 0,
  `lastAttemptAt` timestamp NULL,
  `metadataJson` json NOT NULL,
  `ingestedBy` varchar(128) NOT NULL,
  `ingestedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `sales_intel_source_artifacts_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_sales_intel_source_content` UNIQUE (`contentHash`),
  INDEX `idx_sales_intel_source_status` (`status`,`ingestedAt`),
  INDEX `idx_sales_intel_source_external` (`sourceType`,`externalContentId`)
);

-- Transcript or model-derived video analysis. Versioned per source: a new
-- analysis inserts version N+1 and never overwrites version N.
CREATE TABLE IF NOT EXISTS `sales_intel_transcripts` (
  `id` varchar(36) NOT NULL,
  `sourceArtifactId` varchar(36) NOT NULL,
  `contentKind` enum('supplied_transcript','video_understanding','audio_transcription','caption_only') NOT NULL DEFAULT 'supplied_transcript',
  `text` longtext NOT NULL,
  `segmentsJson` json NOT NULL,
  `provider` varchar(96) NULL,
  `model` varchar(96) NULL,
  `analysisVersion` varchar(96) NULL,
  `version` int NOT NULL DEFAULT 1,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `sales_intel_transcripts_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_sales_intel_transcript_version` UNIQUE (`sourceArtifactId`,`version`),
  INDEX `idx_sales_intel_transcript_source` (`sourceArtifactId`,`createdAt`)
);

-- Normalized trainer teaching. Two trainers who disagree produce two rows;
-- nothing here is ever averaged into a single "best practice".
CREATE TABLE IF NOT EXISTS `sales_intel_frameworks` (
  `id` varchar(36) NOT NULL,
  `sourceArtifactId` varchar(36) NOT NULL,
  `transcriptId` varchar(36) NULL,
  `frameworkKey` varchar(64) NOT NULL,
  `creatorName` varchar(191) NOT NULL,
  `creatorHandle` varchar(191) NULL,
  `archetype` enum('ANCHOR','GATEKEEPER','GHOST','STALLER') NOT NULL,
  `channel` enum('phone','in_person','follow_up','proposal') NOT NULL,
  `exactObjection` varchar(1000) NOT NULL,
  `diagnosis` text NULL,
  `frameworkName` varchar(191) NOT NULL,
  `principle` text NOT NULL,
  `responseFamily` varchar(191) NOT NULL,
  `discoveryQuestionsJson` json NOT NULL,
  `exampleLanguageJson` json NOT NULL,
  `whenToUseJson` json NOT NULL,
  `whenNotToUseJson` json NOT NULL,
  `followUpMovesJson` json NOT NULL,
  `badResponsesJson` json NOT NULL,
  `confidence` decimal(4,3) NULL,
  `extractionVersion` varchar(96) NOT NULL,
  `extractionProvider` varchar(96) NULL,
  `extractionModel` varchar(96) NULL,
  `promptVersion` varchar(96) NULL,
  `transcriptStartMs` int NULL,
  `transcriptEndMs` int NULL,
  `reviewState` enum('review_required','accepted','rejected') NOT NULL DEFAULT 'review_required',
  `reviewedBy` varchar(128) NULL,
  `reviewedAt` timestamp NULL,
  `version` int NOT NULL DEFAULT 1,
  `active` boolean NOT NULL DEFAULT true,
  `supersededAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `sales_intel_frameworks_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_sales_intel_framework_version` UNIQUE (`frameworkKey`,`version`),
  INDEX `idx_sales_intel_framework_lookup` (`archetype`,`channel`,`reviewState`,`active`),
  INDEX `idx_sales_intel_framework_source` (`sourceArtifactId`,`createdAt`)
);

-- Personal evidence, layer B. Tenant and actor scoped: one tenant's usage
-- history is never visible to another.
CREATE TABLE IF NOT EXISTS `armory_weapon_usages` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `actorId` varchar(128) NOT NULL,
  `missionId` int NOT NULL,
  `weaponId` varchar(191) NOT NULL,
  `frameworkId` varchar(36) NULL,
  `archetype` enum('ANCHOR','GATEKEEPER','GHOST','STALLER') NOT NULL,
  `channel` enum('phone','in_person','follow_up','proposal') NOT NULL,
  `provenanceKind` enum('trainer_source','personal_evidence','foundation') NOT NULL,
  `requestId` varchar(36) NOT NULL,
  `usedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `armory_weapon_usages_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_armory_weapon_usage_request` UNIQUE (`tenantId`,`requestId`),
  INDEX `idx_armory_weapon_usage_weapon` (`tenantId`,`actorId`,`weaponId`,`usedAt`),
  INDEX `idx_armory_weapon_usage_mission` (`tenantId`,`missionId`,`usedAt`)
);

-- Observed outcomes associated with a usage. Append-only: a later outcome adds
-- a row, it never rewrites the usage record. Association is explicitly not a
-- causal claim.
CREATE TABLE IF NOT EXISTS `armory_weapon_outcomes` (
  `id` varchar(36) NOT NULL,
  `usageId` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `actorId` varchar(128) NOT NULL,
  `missionId` int NOT NULL,
  `weaponId` varchar(191) NOT NULL,
  `outcomeKind` enum('follow_up_created','call_logged','visit_completed','account_won','account_lost','access_recorded','no_change') NOT NULL,
  `outcomeReference` varchar(191) NOT NULL,
  `observedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `armory_weapon_outcomes_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_armory_weapon_outcome` UNIQUE (`tenantId`,`usageId`,`outcomeKind`,`outcomeReference`),
  INDEX `idx_armory_weapon_outcome_weapon` (`tenantId`,`actorId`,`weaponId`,`observedAt`)
);
