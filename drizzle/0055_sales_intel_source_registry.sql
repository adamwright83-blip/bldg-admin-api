-- Slice 37 — Sales Intelligence Source Registry.
--
-- Additive only. One new table plus one nullable, backward-compatible
-- column added to an existing table. No prior migration is renumbered,
-- rewritten, or altered destructively.
--
-- `sales_intel_sources` is a curated, admin-managed watch list of
-- creators/channels — distinct from `sales_intel_source_artifacts`, which
-- is one row per individual piece of ingested content. A YouTube channel
-- source can produce many artifacts over time via monitoring (Slice 38);
-- disabling a source stops future monitoring but never deletes the
-- artifacts/frameworks it already produced — provenance is never destroyed
-- by curation. Global, like the rest of sales_intel_* — not tenant scoped.

CREATE TABLE IF NOT EXISTS `sales_intel_sources` (
  `id` varchar(36) NOT NULL,
  `creatorName` varchar(191) NOT NULL,
  `creatorHandle` varchar(191) NULL,
  `platform` enum('youtube','instagram','manual') NOT NULL,
  `sourceType` enum('youtube_channel','youtube_playlist','youtube_video','instagram_profile_reference','manual_source') NOT NULL,
  `canonicalSourceUrl` varchar(1024) NOT NULL,
  -- sha256(canonicalSourceUrl), same pattern as
  -- sales_intel_source_artifacts.contentHash: a varchar(1024) unique index
  -- exceeds InnoDB's 3072-byte max key length under utf8mb4, so dedup is
  -- enforced on this fixed-width hash instead of the raw URL.
  `canonicalSourceUrlHash` varchar(64) NOT NULL,
  `externalChannelId` varchar(191) NULL,
  `acquisitionMode` enum('AUTO_YOUTUBE','MANUAL_TRANSCRIPT','MANUAL_MEDIA','URL_REFERENCE_ONLY','PROVIDER_ANALYSIS') NOT NULL,
  `status` enum('active','disabled') NOT NULL DEFAULT 'active',
  `notes` varchar(2048) NULL,
  `lastCheckedAt` timestamp NULL,
  `createdBy` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `sales_intel_sources_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_sales_intel_source_canonical_url_hash` UNIQUE (`canonicalSourceUrlHash`),
  INDEX `idx_sales_intel_source_registry_status` (`status`,`platform`)
);

ALTER TABLE `sales_intel_source_artifacts`
  ADD COLUMN `sourceRegistryId` varchar(36) NULL AFTER `id`;

ALTER TABLE `sales_intel_source_artifacts`
  ADD INDEX `idx_sales_intel_source_registry` (`sourceRegistryId`);
