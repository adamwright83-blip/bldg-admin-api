-- Goldline Territories & Guardians
--
-- Challenge definitions are game projection. They name real physical entities
-- as members but they are not commercial truth, pipeline stages, or customer
-- records. Member completion is derived from goldline_world_events rather than
-- stored as a mutable counter.
--
-- Additive, tenant-scoped, restart-safe. No coordinate columns. No customer
-- or order mutation. No duplicate physical entity rows.

CREATE TABLE IF NOT EXISTS `goldline_territory_definitions` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `stableKey` varchar(191) NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `fantasyTitle` varchar(128) NOT NULL,
  `realGeographyLabel` varchar(191) NULL,
  `grammar` enum('visit_hunt','break_the_silence','send_the_standard') NOT NULL,
  `guardianId` varchar(64) NOT NULL,
  `geometryMode` enum('corridor','cluster','authoritative_polygon') NOT NULL,
  `membersJson` json NOT NULL,
  `createdFrom` varchar(64) NOT NULL,
  `classification` varchar(32) NOT NULL DEFAULT 'game_projection',
  `publishedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goldline_territory_stable` (`tenantId`,`stableKey`,`version`),
  KEY `idx_goldline_territory_tenant` (`tenantId`,`publishedAt`)
);
