CREATE TABLE `commercial_accounts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `name` varchar(255) NOT NULL,
  `accountType` varchar(96) NOT NULL,
  `providerName` varchar(64),
  `providerAccountId` varchar(191),
  `website` varchar(512),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commercial_accounts_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_commercial_accounts_tenant_provider` UNIQUE(`tenantId`,`providerName`,`providerAccountId`),
  INDEX `idx_commercial_accounts_tenant_name` (`tenantId`,`name`)
);

CREATE TABLE `commercial_account_locations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `accountId` int NOT NULL,
  `label` varchar(128),
  `address` varchar(512) NOT NULL,
  `latitude` decimal(10,7) NOT NULL,
  `longitude` decimal(10,7) NOT NULL,
  `isPrimary` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commercial_account_locations_id` PRIMARY KEY(`id`),
  INDEX `idx_commercial_locations_tenant_account` (`tenantId`,`accountId`)
);

CREATE TABLE `commercial_account_contacts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `accountId` int NOT NULL,
  `name` varchar(255),
  `title` varchar(255),
  `email` varchar(320),
  `phone` varchar(64),
  `sourceUrl` varchar(1024),
  `sourcedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commercial_account_contacts_id` PRIMARY KEY(`id`),
  INDEX `idx_commercial_contacts_tenant_account` (`tenantId`,`accountId`)
);

CREATE TABLE `commercial_opportunities` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `accountId` int NOT NULL,
  `score` int NOT NULL,
  `grade` enum('low','medium','high') NOT NULL,
  `estimatedAnnualValueCents` int NOT NULL,
  `estimateConfidence` enum('low','medium','high') NOT NULL,
  `primarySignal` text NOT NULL,
  `reasonsJson` json NOT NULL,
  `risksJson` json NOT NULL,
  `evidenceJson` json NOT NULL,
  `scoredAt` timestamp NOT NULL DEFAULT (now()),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commercial_opportunities_id` PRIMARY KEY(`id`),
  INDEX `idx_commercial_opportunities_tenant_account` (`tenantId`,`accountId`),
  INDEX `idx_commercial_opportunities_tenant_score` (`tenantId`,`score`)
);

CREATE TABLE `commercial_missions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `opportunityId` int,
  `opsTaskId` int,
  `assignedTo` varchar(128),
  `code` varchar(32) NOT NULL,
  `status` enum('candidate','selected','game_ready','game_active','game_completed','phone_ready','preparing','en_route','arrived','visit_completed','follow_up','won','lost') NOT NULL DEFAULT 'candidate',
  `version` int NOT NULL DEFAULT 1,
  `accountSnapshotJson` json NOT NULL,
  `opportunitySnapshotJson` json NOT NULL,
  `missionBriefJson` json NOT NULL,
  `expiresAt` timestamp,
  `createdBy` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `completedAt` timestamp,
  CONSTRAINT `commercial_missions_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_commercial_missions_tenant_code` UNIQUE(`tenantId`,`code`),
  INDEX `idx_commercial_missions_tenant_status` (`tenantId`,`status`),
  INDEX `idx_commercial_missions_tenant_assignee` (`tenantId`,`assignedTo`)
);

CREATE TABLE `commercial_mission_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `missionId` int NOT NULL,
  `eventName` varchar(64) NOT NULL,
  `fromStatus` varchar(32),
  `toStatus` varchar(32),
  `actorType` enum('system','operator','driver','game') NOT NULL,
  `actorId` varchar(128),
  `idempotencyKey` varchar(191) NOT NULL,
  `metadataJson` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `commercial_mission_events_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_commercial_mission_events_tenant_idempotency` UNIQUE(`tenantId`,`idempotencyKey`),
  INDEX `idx_commercial_mission_events_tenant_mission` (`tenantId`,`missionId`)
);

CREATE TABLE `commercial_mission_steps` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `missionId` int NOT NULL,
  `stepKey` varchar(64) NOT NULL,
  `label` varchar(255) NOT NULL,
  `detail` text NOT NULL,
  `status` enum('locked','ready','active','completed','skipped') NOT NULL,
  `position` int NOT NULL,
  `completedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commercial_mission_steps_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_commercial_mission_steps_tenant_mission_key` UNIQUE(`tenantId`,`missionId`,`stepKey`)
);

CREATE TABLE `commercial_visit_outcomes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `missionId` int NOT NULL,
  `outcome` enum('follow_up','won','lost') NOT NULL,
  `notes` text,
  `followUpAt` timestamp,
  `estimatedContractValueCents` int,
  `recordedBy` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `commercial_visit_outcomes_id` PRIMARY KEY(`id`),
  INDEX `idx_commercial_visit_outcomes_tenant_mission` (`tenantId`,`missionId`)
);
