-- Narrator OS slices A–D. Applied by scripts/migrate.mjs (this file is not
-- executed directly; keep both in sync). Additive. Conservative defaults:
-- no fake history, no fired beats, no inferred knowledge, no OPEN resolution,
-- no Claire knowledge from legacy chats, no biography from CRM.
--
-- Separate from goldline_world_events (business truth), claire_personal_ledger
-- (rapport/disclosure), and Brain V2 working memory.

CREATE TABLE IF NOT EXISTS `narrator_os_operator` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `worldTruthJson` json NOT NULL,
  `livedBioJson` json NOT NULL,
  `narrativeStateJson` json NOT NULL,
  `worldTruthVersion` varchar(96) NOT NULL,
  `livedBioVersion` varchar(96) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_narrator_os_operator` (`tenantId`, `operatorUserId`)
);

CREATE TABLE IF NOT EXISTS `narrator_os_knowledge` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `plane` enum('PLAYER','CLAIRE','CHEMIST','OTHER') NOT NULL,
  `factId` varchar(128) NOT NULL,
  `factKind` enum('EVENT_FACT','CHARACTER_INTERPRETATION') NOT NULL,
  `known` boolean NOT NULL,
  `interpretationText` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_narrator_os_knowledge_fact` (`tenantId`, `operatorUserId`, `plane`, `factId`),
  KEY `idx_narrator_os_knowledge_operator` (`tenantId`, `operatorUserId`, `plane`)
);

CREATE TABLE IF NOT EXISTS `narrator_os_event_ledger` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `kind` enum('FIRED_AUTHORED_BEAT','VERIFIED_GOLDLINE_OUTCOME') NOT NULL,
  `beatId` varchar(64) DEFAULT NULL,
  `goldlineOutcomeId` varchar(128) DEFAULT NULL,
  `offscreen` boolean NOT NULL DEFAULT 0,
  `playerVisible` boolean NOT NULL DEFAULT 0,
  `payloadJson` json NOT NULL,
  `occurredAt` timestamp NOT NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_narrator_os_ledger_idempotency` (`tenantId`, `idempotencyKey`),
  KEY `idx_narrator_os_ledger_operator` (`tenantId`, `operatorUserId`, `occurredAt`)
);
