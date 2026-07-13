-- DayForge PR I: privacy-safe analytics, resumable public preview, durable
-- abuse controls, provider budgets, and explicit retention markers.

ALTER TABLE `dayforge_audit_events`
  MODIFY COLUMN `actorType` enum('public','owner','admin','operator','field','game','stripe','system') NOT NULL;

CREATE TABLE `dayforge_product_events` (
  `id` varchar(36) NOT NULL,
  `scopeKey` varchar(191) NOT NULL,
  `tenantId` varchar(64) NULL,
  `anonymousSessionId` varchar(64) NULL,
  `actorType` enum('public','owner','admin','operator','field','game','stripe','system') NOT NULL,
  `actorId` varchar(128) NULL,
  `entityType` varchar(96) NULL,
  `entityId` varchar(128) NULL,
  `missionId` int NULL,
  `accountId` int NULL,
  `opportunityId` int NULL,
  `customerId` int NULL,
  `eventName` varchar(96) NOT NULL,
  `eventVersion` int NOT NULL DEFAULT 1,
  `propertiesJson` json NOT NULL,
  `source` varchar(96) NOT NULL,
  `correlationId` varchar(191) NOT NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `occurredAt` timestamp NOT NULL DEFAULT (now()),
  `purgeAfter` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `dayforge_product_events_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_product_event_idempotency` UNIQUE (`scopeKey`,`idempotencyKey`),
  INDEX `idx_dayforge_product_event_tenant_name` (`tenantId`,`eventName`,`occurredAt`),
  INDEX `idx_dayforge_product_event_mission` (`tenantId`,`missionId`,`occurredAt`),
  INDEX `idx_dayforge_product_event_account` (`tenantId`,`accountId`,`occurredAt`),
  INDEX `idx_dayforge_product_event_anonymous` (`anonymousSessionId`,`occurredAt`),
  INDEX `idx_dayforge_product_event_purge` (`purgeAfter`)
);

CREATE TABLE `dayforge_public_preview_sessions` (
  `id` varchar(64) NOT NULL,
  `tokenHash` varchar(64) NOT NULL,
  `ipHash` varchar(64) NOT NULL,
  `status` enum('running','completed','failed','converting','converted','expired') NOT NULL DEFAULT 'running',
  `addressQuery` varchar(512) NOT NULL,
  `attributionJson` json NULL,
  `providerName` varchar(64) NULL,
  `resultCount` int NOT NULL DEFAULT 0,
  `executionStartedAt` timestamp NULL,
  `executionLeaseUntil` timestamp NULL,
  `executionAttemptCount` int NOT NULL DEFAULT 0,
  `scanSessionId` varchar(64) NULL,
  `selectedCandidateKey` varchar(191) NULL,
  `sampleMissionCreatedAt` timestamp NULL,
  `convertedTenantId` varchar(64) NULL,
  `convertedMissionId` int NULL,
  `expiresAt` timestamp NOT NULL,
  `purgeAfter` timestamp NOT NULL,
  `failureCode` varchar(96) NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_public_preview_sessions_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_public_preview_token` UNIQUE (`tokenHash`),
  CONSTRAINT `uq_dayforge_public_preview_scan` UNIQUE (`scanSessionId`),
  INDEX `idx_dayforge_public_preview_status_expires` (`status`,`expiresAt`),
  INDEX `idx_dayforge_public_preview_ip_created` (`ipHash`,`createdAt`),
  INDEX `idx_dayforge_public_preview_purge` (`purgeAfter`)
);

CREATE TABLE `dayforge_rate_limit_buckets` (
  `id` int AUTO_INCREMENT NOT NULL,
  `scopeKey` varchar(191) NOT NULL,
  `bucketKey` varchar(191) NOT NULL,
  `action` varchar(96) NOT NULL,
  `windowStart` timestamp NOT NULL,
  `windowSeconds` int NOT NULL,
  `requestCount` int NOT NULL DEFAULT 0,
  `expiresAt` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_rate_limit_buckets_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_rate_limit_window` UNIQUE (`scopeKey`,`bucketKey`,`action`,`windowStart`),
  INDEX `idx_dayforge_rate_limit_expiry` (`expiresAt`),
  INDEX `idx_dayforge_rate_limit_scope_action` (`scopeKey`,`action`,`windowStart`)
);

CREATE TABLE `dayforge_provider_budgets` (
  `id` int AUTO_INCREMENT NOT NULL,
  `providerName` varchar(64) NOT NULL,
  `operation` varchar(96) NOT NULL,
  `budgetDate` varchar(10) NOT NULL,
  `requestCount` int NOT NULL DEFAULT 0,
  `estimatedCostMicros` int NOT NULL DEFAULT 0,
  `failureCount` int NOT NULL DEFAULT 0,
  `consecutiveFailureCount` int NOT NULL DEFAULT 0,
  `circuitState` enum('closed','open','half_open') NOT NULL DEFAULT 'closed',
  `circuitOpenedAt` timestamp NULL,
  `lastFailureAt` timestamp NULL,
  `lastSuccessAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_provider_budgets_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_provider_budget_day` UNIQUE (`providerName`,`operation`,`budgetDate`),
  INDEX `idx_dayforge_provider_budget_circuit` (`circuitState`,`updatedAt`)
);
