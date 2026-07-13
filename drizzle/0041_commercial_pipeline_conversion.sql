ALTER TABLE `commercial_accounts`
  ADD COLUMN `identityKey` varchar(64) NULL AFTER `tenantId`,
  ADD CONSTRAINT `uq_commercial_accounts_tenant_identity` UNIQUE (`tenantId`,`identityKey`);

ALTER TABLE `commercial_account_locations`
  ADD COLUMN `locationKey` varchar(64) NULL AFTER `accountId`,
  ADD CONSTRAINT `uq_commercial_locations_tenant_account_key` UNIQUE (`tenantId`,`accountId`,`locationKey`);

ALTER TABLE `commercial_account_contacts`
  ADD COLUMN `contactKey` varchar(64) NULL AFTER `accountId`,
  ADD CONSTRAINT `uq_commercial_contacts_tenant_account_key` UNIQUE (`tenantId`,`accountId`,`contactKey`);

CREATE TABLE `commercial_pipeline_records` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `accountId` int NOT NULL,
  `opportunityId` int NOT NULL,
  `missionId` int NOT NULL,
  `stage` enum('discovered','qualified','mission_created','game_ready','field_ready','visit_planned','visited','follow_up','proposal_sent','pilot_requested','verbal_yes','won','lost') NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `estimatedContractValueCents` int NOT NULL,
  `approvedContractValueCents` int NULL,
  `invoicedRevenueCents` int NOT NULL DEFAULT 0,
  `paidRevenueCents` int NOT NULL DEFAULT 0,
  `realizedRevenueCents` int NOT NULL DEFAULT 0,
  `commercialCustomerId` int NULL,
  `firstOrderId` int NULL,
  `nextFollowUpAt` timestamp NULL,
  `lossReason` varchar(128) NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commercial_pipeline_records_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_commercial_pipeline_tenant_opportunity` UNIQUE (`tenantId`,`opportunityId`),
  CONSTRAINT `uq_commercial_pipeline_tenant_mission` UNIQUE (`tenantId`,`missionId`),
  INDEX `idx_commercial_pipeline_tenant_stage` (`tenantId`,`stage`,`updatedAt`)
);

CREATE TABLE `commercial_pipeline_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `pipelineId` int NOT NULL,
  `missionId` int NOT NULL,
  `fromStage` varchar(32) NULL,
  `toStage` varchar(32) NOT NULL,
  `actorType` enum('system','operator','driver','game') NOT NULL,
  `actorId` varchar(128) NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `correlationId` varchar(191) NOT NULL,
  `metadataJson` json NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `commercial_pipeline_events_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_commercial_pipeline_events_tenant_idempotency` UNIQUE (`tenantId`,`idempotencyKey`),
  INDEX `idx_commercial_pipeline_events_tenant_pipeline` (`tenantId`,`pipelineId`,`createdAt`)
);

CREATE TABLE `commercial_customers` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `accountId` int NOT NULL,
  `sourceMissionId` int NOT NULL,
  `status` enum('active','paused','churned','closed') NOT NULL DEFAULT 'active',
  `approvedAnnualValueCents` int NULL,
  `firstOrderId` int NULL,
  `convertedAt` timestamp NOT NULL DEFAULT (now()),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commercial_customers_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_commercial_customers_tenant_account` UNIQUE (`tenantId`,`accountId`),
  CONSTRAINT `uq_commercial_customers_tenant_source_mission` UNIQUE (`tenantId`,`sourceMissionId`)
);

CREATE TABLE `commercial_customer_locations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `commercialCustomerId` int NOT NULL,
  `locationId` int NOT NULL,
  `active` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `commercial_customer_locations_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_commercial_customer_locations_scope` UNIQUE (`tenantId`,`commercialCustomerId`,`locationId`)
);

CREATE TABLE `commercial_customer_contacts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `commercialCustomerId` int NOT NULL,
  `contactId` int NOT NULL,
  `active` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `commercial_customer_contacts_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_commercial_customer_contacts_scope` UNIQUE (`tenantId`,`commercialCustomerId`,`contactId`)
);

CREATE TABLE `commercial_service_expectations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `commercialCustomerId` int NOT NULL,
  `sourceMissionId` int NOT NULL,
  `sourceProposalId` varchar(36) NULL,
  `sourceProposalVersion` int NULL,
  `status` enum('proposed','approved','active','paused') NOT NULL DEFAULT 'approved',
  `pricePerPoundCents` int NULL,
  `minimumOrderCents` int NULL,
  `expectedWeeklyPounds` int NULL,
  `capacityReservedPoundsPerWeek` int NOT NULL DEFAULT 0,
  `pickupScheduleLabel` varchar(255) NULL,
  `turnaroundLabel` varchar(255) NULL,
  `serviceAreaLabel` varchar(255) NULL,
  `approvedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commercial_service_expectations_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_commercial_service_expectations_scope` UNIQUE (`tenantId`,`commercialCustomerId`,`sourceMissionId`)
);

CREATE TABLE `commercial_agreements` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `commercialCustomerId` int NOT NULL,
  `missionId` int NOT NULL,
  `proposalId` varchar(36) NULL,
  `proposalVersion` int NULL,
  `status` enum('verbal_yes','pending_signature','approved','declined') NOT NULL DEFAULT 'verbal_yes',
  `approvedAnnualValueCents` int NULL,
  `evidenceReference` varchar(1024) NULL,
  `recordedBy` varchar(128) NOT NULL,
  `approvedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commercial_agreements_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_commercial_agreements_tenant_mission` UNIQUE (`tenantId`,`missionId`),
  INDEX `idx_commercial_agreements_tenant_customer` (`tenantId`,`commercialCustomerId`)
);

CREATE TABLE `commercial_route_assignments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `commercialCustomerId` int NOT NULL,
  `locationId` int NOT NULL,
  `serviceExpectationId` int NOT NULL,
  `status` enum('planned','active','paused','ended') NOT NULL DEFAULT 'planned',
  `routeLabel` varchar(255) NOT NULL,
  `routeWindowLabel` varchar(255) NULL,
  `capacityReservedPoundsPerWeek` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commercial_route_assignments_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_commercial_route_assignments_scope` UNIQUE (`tenantId`,`commercialCustomerId`,`locationId`)
);

CREATE TABLE `commercial_follow_ups` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `pipelineId` int NOT NULL,
  `missionId` int NOT NULL,
  `status` enum('open','completed','cancelled') NOT NULL DEFAULT 'open',
  `dueAt` timestamp NOT NULL,
  `note` text NOT NULL,
  `assignedTo` varchar(128) NULL,
  `requestId` varchar(36) NOT NULL,
  `createdBy` varchar(128) NOT NULL,
  `completedAt` timestamp NULL,
  `completedBy` varchar(128) NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commercial_follow_ups_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_commercial_follow_ups_tenant_request` UNIQUE (`tenantId`,`requestId`),
  INDEX `idx_commercial_follow_ups_tenant_due` (`tenantId`,`status`,`dueAt`)
);

CREATE TABLE `commercial_order_attributions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `commercialCustomerId` int NOT NULL,
  `missionId` int NOT NULL,
  `orderId` int NOT NULL,
  `attributionType` enum('first_order','recurring') NOT NULL,
  `invoicedCents` int NOT NULL DEFAULT 0,
  `paidCents` int NOT NULL DEFAULT 0,
  `realizedCents` int NOT NULL DEFAULT 0,
  `paidAt` timestamp NULL,
  `requestId` varchar(36) NOT NULL,
  `createdBy` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commercial_order_attributions_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_commercial_order_attributions_tenant_order` UNIQUE (`tenantId`,`orderId`),
  CONSTRAINT `uq_commercial_order_attributions_tenant_request` UNIQUE (`tenantId`,`requestId`),
  INDEX `idx_commercial_order_attributions_tenant_customer` (`tenantId`,`commercialCustomerId`,`createdAt`)
);

CREATE TABLE `commercial_mission_final_rewards` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `missionId` int NOT NULL,
  `commercialCustomerId` int NOT NULL,
  `playerId` varchar(128) NOT NULL,
  `xpAwarded` int NOT NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `awardedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `commercial_mission_final_rewards_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_commercial_final_rewards_tenant_mission` UNIQUE (`tenantId`,`missionId`),
  CONSTRAINT `uq_commercial_final_rewards_tenant_idempotency` UNIQUE (`tenantId`,`idempotencyKey`)
);
