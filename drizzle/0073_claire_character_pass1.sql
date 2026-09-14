-- Claire Pass 1: persistent character runtime substrate.
-- Operator scope is tenantId + operatorUserId + characterId (decided
-- before implementation). Relationship events are append-only; relationship
-- state is a reproducible cache derived from them (server/claire/character/tierEngine.ts).
-- Hand-written to match this repo's manual migration convention — drizzle-kit's
-- meta/_journal.json snapshot state is stale relative to the applied 0000-0072
-- migrations and must not be used to auto-generate this file.

CREATE TABLE IF NOT EXISTS `claire_relationship_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `characterId` varchar(32) NOT NULL DEFAULT 'claire',
  `eventType` varchar(48) NOT NULL,
  `summary` varchar(512) NOT NULL,
  `provenance` varchar(128) NOT NULL,
  `relatedEntityType` varchar(64) NULL,
  `relatedEntityId` varchar(64) NULL,
  `evidenceSource` varchar(128) NULL,
  `occurredAt` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_claire_relationship_event_operator` (`tenantId`,`operatorUserId`,`characterId`,`occurredAt`)
);

CREATE TABLE IF NOT EXISTS `claire_relationship_state` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `characterId` varchar(32) NOT NULL DEFAULT 'claire',
  `professionalRespect` int NOT NULL DEFAULT 0,
  `reliability` int NOT NULL DEFAULT 0,
  `disclosureSafety` int NOT NULL DEFAULT 0,
  `familiarity` int NOT NULL DEFAULT 0,
  `disclosureTier` int NOT NULL DEFAULT 0,
  `qualifyingInteractionCount` int NOT NULL DEFAULT 0,
  `distinctInteractionDays` int NOT NULL DEFAULT 0,
  `lastEventId` int NULL,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_claire_relationship_state` (`tenantId`,`operatorUserId`,`characterId`)
);

CREATE TABLE IF NOT EXISTS `claire_tier_transitions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `characterId` varchar(32) NOT NULL DEFAULT 'claire',
  `fromTier` int NOT NULL,
  `toTier` int NOT NULL,
  `reasonsJson` json NOT NULL,
  `supportingEventIdsJson` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_claire_tier_transition_operator` (`tenantId`,`operatorUserId`,`characterId`,`createdAt`)
);

CREATE TABLE IF NOT EXISTS `claire_generation_logs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorUserId` varchar(128) NULL,
  `characterId` varchar(32) NOT NULL DEFAULT 'claire',
  `characterVersion` varchar(32) NOT NULL,
  `compilerVersion` varchar(32) NOT NULL,
  `mode` varchar(32) NOT NULL,
  `generationKind` varchar(32) NOT NULL,
  `generationSource` varchar(16) NOT NULL,
  `disclosureTier` int NOT NULL,
  `generatedText` varchar(1024) NOT NULL,
  `relationshipDimensionsJson` json NOT NULL,
  `sharedHistoryEventIdsJson` json NOT NULL,
  `canonFragmentIdsJson` json NOT NULL,
  `businessContextSummary` varchar(512) NULL,
  `fallbackReason` varchar(64) NULL,
  `reviewLabel` varchar(32) NULL,
  `reviewedByUserId` varchar(128) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_claire_generation_log_tenant` (`tenantId`,`createdAt`)
);
