CREATE TABLE `driver_cold_call_batches` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `actorId` varchar(128) NOT NULL,
  `status` enum('active','completed') NOT NULL DEFAULT 'active',
  `combo` int NOT NULL DEFAULT 0,
  `completedCount` int NOT NULL DEFAULT 0,
  `totalTargets` int NOT NULL,
  `requestId` varchar(36) NOT NULL,
  `sourceReferencesJson` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `driver_cold_call_batches_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_driver_cold_call_batch_request` UNIQUE (`tenantId`,`actorId`,`requestId`),
  INDEX `idx_driver_cold_call_batch_active` (`tenantId`,`actorId`,`status`,`updatedAt`)
);

CREATE TABLE `driver_cold_call_targets` (
  `id` varchar(36) NOT NULL,
  `batchId` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `actorId` varchar(128) NOT NULL,
  `missionId` int NOT NULL,
  `accountId` int NOT NULL,
  `position` int NOT NULL,
  `status` enum('pending','selected','live','completed') NOT NULL DEFAULT 'pending',
  `sourceReference` varchar(512) NOT NULL,
  `callAttemptEventId` int NULL,
  `outcome` varchar(64) NULL,
  `completedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `driver_cold_call_targets_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_driver_cold_call_batch_mission` UNIQUE (`batchId`,`missionId`),
  INDEX `idx_driver_cold_call_target_progress` (`tenantId`,`actorId`,`batchId`,`status`,`position`)
);

CREATE TABLE `driver_capability_unlocks` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `scopeId` varchar(128) NOT NULL DEFAULT 'tenant_business',
  `capabilityId` varchar(96) NOT NULL,
  `unlockedByActorId` varchar(128) NOT NULL,
  `unlockedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `sourceReferencesJson` json NOT NULL,
  `evidenceSummaryJson` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `driver_capability_unlocks_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_driver_capability_scope` UNIQUE (`tenantId`,`scopeId`,`capabilityId`)
);

CREATE TABLE `driver_scout_reports` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `actorId` varchar(128) NOT NULL,
  `requestId` varchar(36) NOT NULL,
  `capabilityUnlockId` varchar(36) NOT NULL,
  `sourceScanId` varchar(64) NULL,
  `criteriaJson` json NOT NULL,
  `sourceReferencesJson` json NOT NULL,
  `discoveryCount` int NOT NULL DEFAULT 0,
  `generatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `driver_scout_reports_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_driver_scout_report_request` UNIQUE (`tenantId`,`actorId`,`requestId`),
  INDEX `idx_driver_scout_reports_actor` (`tenantId`,`actorId`,`generatedAt`)
);

CREATE TABLE `driver_scout_discoveries` (
  `id` varchar(36) NOT NULL,
  `reportId` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `actorId` varchar(128) NOT NULL,
  `candidateKey` varchar(191) NOT NULL,
  `providerName` varchar(64) NOT NULL,
  `providerAccountId` varchar(191) NOT NULL,
  `sourceReference` varchar(512) NOT NULL,
  `missionId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `driver_scout_discoveries_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_driver_scout_candidate` UNIQUE (`tenantId`,`candidateKey`),
  CONSTRAINT `uq_driver_scout_mission` UNIQUE (`tenantId`,`missionId`),
  INDEX `idx_driver_scout_report_discovery` (`reportId`,`createdAt`)
);
