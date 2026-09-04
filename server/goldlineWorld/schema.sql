-- Goldline world events: the tenant-scoped evidence and game-projection ledger.
--
-- WHY THIS FILE EXISTS
--
-- The table was introduced in drizzle/0061_goldline_living_business_world.sql,
-- but `scripts/migrate.mjs` — the production bootstrap (`pnpm start` runs
-- migrate then the server) — applies specific hand-written schema files and
-- never runs drizzle/*.sql. So production never had this table, and the first
-- mission's field-outcome write, which inserts the operator's attested
-- evidence here, failed on the live deployment.
--
-- The definition below is copied from 0061 unchanged and is CREATE TABLE IF NOT
-- EXISTS, so it is a no-op wherever the table already exists.
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
)

;

-- Existing-world detection reads these two tables to decide whether a tenant
-- already owns a canonical Goldline world and must bypass onboarding. Both come
-- from the same never-applied drizzle migrations, so without them that check
-- threw and the onboarding state query returned 500 for every tenant.
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
)
;

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
)
