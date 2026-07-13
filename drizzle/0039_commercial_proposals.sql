CREATE TABLE `tenant_commercial_proposal_profiles` (
  `tenantId` varchar(64) NOT NULL,
  `storeName` varchar(255) NOT NULL,
  `operatorName` varchar(255) NOT NULL,
  `phone` varchar(64) NOT NULL,
  `email` varchar(320) NOT NULL,
  `website` varchar(512) NOT NULL,
  `address` varchar(512) NOT NULL,
  `logoUrl` varchar(1024) NULL,
  `commercialPricePerPoundCents` int NOT NULL,
  `minimumOrderCents` int NULL,
  `turnaroundLabel` varchar(255) NOT NULL,
  `pickupScheduleLabel` varchar(255) NOT NULL,
  `serviceAreaLabel` varchar(255) NOT NULL,
  `insuranceLabel` varchar(255) NULL,
  `servicesJson` json NOT NULL,
  `createdBy` varchar(128) NOT NULL,
  `updatedBy` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `tenant_commercial_proposal_profiles_tenantId` PRIMARY KEY (`tenantId`)
);

CREATE TABLE `commercial_proposals` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `missionId` int NOT NULL,
  `version` int NOT NULL,
  `status` enum('draft','approved','superseded','void') NOT NULL DEFAULT 'draft',
  `snapshotJson` json NOT NULL,
  `contentHash` varchar(64) NOT NULL,
  `requestId` varchar(36) NOT NULL,
  `validThrough` timestamp NOT NULL,
  `createdBy` varchar(128) NOT NULL,
  `approvedBy` varchar(128) NULL,
  `approvedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commercial_proposals_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_commercial_proposals_tenant_mission_version` UNIQUE (`tenantId`,`missionId`,`version`),
  CONSTRAINT `uq_commercial_proposals_tenant_request` UNIQUE (`tenantId`,`requestId`),
  INDEX `idx_commercial_proposals_tenant_mission_status` (`tenantId`,`missionId`,`status`,`createdAt`)
);

CREATE TABLE `commercial_proposal_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `missionId` int NOT NULL,
  `proposalId` varchar(36) NOT NULL,
  `eventName` varchar(64) NOT NULL,
  `actorId` varchar(128) NOT NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `metadataJson` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `commercial_proposal_events_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_commercial_proposal_events_tenant_idempotency` UNIQUE (`tenantId`,`idempotencyKey`),
  INDEX `idx_commercial_proposal_events_tenant_proposal` (`tenantId`,`proposalId`,`createdAt`)
);
