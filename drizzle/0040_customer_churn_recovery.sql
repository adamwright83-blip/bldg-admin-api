CREATE TABLE `tenant_customer_recovery_profiles` (
  `tenantId` varchar(64) NOT NULL,
  `storeName` varchar(255) NOT NULL,
  `senderName` varchar(255) NOT NULL,
  `schedulingUrl` varchar(1024) NULL,
  `createdBy` varchar(128) NOT NULL,
  `updatedBy` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `tenant_customer_recovery_profiles_tenantId` PRIMARY KEY (`tenantId`)
);

CREATE TABLE `customer_churn_scans` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `requestId` varchar(36) NOT NULL,
  `status` enum('running','completed','failed') NOT NULL DEFAULT 'running',
  `sourceOrderCount` int NOT NULL DEFAULT 0,
  `customerCount` int NOT NULL DEFAULT 0,
  `atRiskCount` int NOT NULL DEFAULT 0,
  `errorMessage` text NULL,
  `computedAt` timestamp NULL,
  `createdBy` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `customer_churn_scans_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_customer_churn_scans_tenant_request` UNIQUE (`tenantId`,`requestId`),
  INDEX `idx_customer_churn_scans_tenant_created` (`tenantId`,`createdAt`)
);

CREATE TABLE `customer_churn_snapshots` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `scanId` varchar(36) NOT NULL,
  `customerKeyHash` varchar(64) NOT NULL,
  `customerName` varchar(255) NOT NULL,
  `customerPhone` varchar(30) NOT NULL,
  `lastOrderId` int NOT NULL,
  `score` int NOT NULL,
  `grade` enum('low','medium','high') NOT NULL,
  `confidence` enum('low','medium','high') NOT NULL,
  `historyOrderCount` int NOT NULL,
  `expectedCadenceDays` int NOT NULL,
  `lastServiceAt` timestamp NOT NULL,
  `daysSinceLastOrder` int NOT NULL,
  `daysLate` int NOT NULL,
  `averageOrderValueCents` int NOT NULL,
  `estimatedMonthlyImpactCents` int NOT NULL,
  `recentVolumeChangePct` int NULL,
  `activeOrderCount` int NOT NULL DEFAULT 0,
  `recommendedAction` enum('watch','prepare_win_back','contact_now') NOT NULL,
  `lastServiceLabel` varchar(64) NOT NULL,
  `reasonsJson` json NOT NULL,
  `evidenceJson` json NOT NULL,
  `sourceOrderIdsJson` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `customer_churn_snapshots_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_customer_churn_snapshots_scan_customer` UNIQUE (`scanId`,`customerKeyHash`),
  INDEX `idx_customer_churn_snapshots_tenant_score` (`tenantId`,`score`,`createdAt`),
  INDEX `idx_customer_churn_snapshots_tenant_customer` (`tenantId`,`customerKeyHash`,`createdAt`)
);

CREATE TABLE `customer_contact_permissions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `customerKeyHash` varchar(64) NOT NULL,
  `channel` enum('sms') NOT NULL DEFAULT 'sms',
  `purpose` enum('win_back_marketing') NOT NULL DEFAULT 'win_back_marketing',
  `status` enum('opted_in','opted_out') NOT NULL,
  `sourceReference` varchar(512) NOT NULL,
  `capturedAt` timestamp NOT NULL,
  `expiresAt` timestamp NULL,
  `recordedBy` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `customer_contact_permissions_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_customer_contact_permissions_scope` UNIQUE (`tenantId`,`customerKeyHash`,`channel`,`purpose`),
  INDEX `idx_customer_contact_permissions_tenant_status` (`tenantId`,`status`)
);

CREATE TABLE `customer_recovery_interventions` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `churnSnapshotId` varchar(36) NOT NULL,
  `customerKeyHash` varchar(64) NOT NULL,
  `activeCustomerKeyHash` varchar(64) NULL,
  `opsTaskId` int NOT NULL,
  `requestId` varchar(36) NOT NULL,
  `status` enum('draft_pending_review','approved','contacted','dismissed','recovered','unsuccessful') NOT NULL DEFAULT 'draft_pending_review',
  `assignedTo` varchar(128) NULL,
  `approvedBy` varchar(128) NULL,
  `approvedAt` timestamp NULL,
  `contactedAt` timestamp NULL,
  `recoveredAt` timestamp NULL,
  `recoveredOrderId` int NULL,
  `recoveredRevenueCents` int NOT NULL DEFAULT 0,
  `createdBy` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `customer_recovery_interventions_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_customer_recovery_interventions_tenant_request` UNIQUE (`tenantId`,`requestId`),
  CONSTRAINT `uq_customer_recovery_interventions_tenant_active_customer` UNIQUE (`tenantId`,`activeCustomerKeyHash`),
  INDEX `idx_customer_recovery_interventions_tenant_status` (`tenantId`,`status`,`updatedAt`),
  INDEX `idx_customer_recovery_interventions_tenant_customer` (`tenantId`,`customerKeyHash`,`updatedAt`)
);

CREATE TABLE `customer_recovery_drafts` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `interventionId` varchar(36) NOT NULL,
  `version` int NOT NULL,
  `channel` enum('sms') NOT NULL DEFAULT 'sms',
  `status` enum('draft','approved','superseded','void') NOT NULL DEFAULT 'draft',
  `message` text NOT NULL,
  `factsUsedJson` json NOT NULL,
  `contentHash` varchar(64) NOT NULL,
  `requestId` varchar(36) NOT NULL,
  `createdBy` varchar(128) NOT NULL,
  `approvedBy` varchar(128) NULL,
  `approvedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `customer_recovery_drafts_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_customer_recovery_drafts_intervention_version` UNIQUE (`tenantId`,`interventionId`,`version`),
  CONSTRAINT `uq_customer_recovery_drafts_tenant_request` UNIQUE (`tenantId`,`requestId`),
  INDEX `idx_customer_recovery_drafts_tenant_intervention` (`tenantId`,`interventionId`,`createdAt`)
);

CREATE TABLE `customer_recovery_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `interventionId` varchar(36) NOT NULL,
  `eventName` varchar(64) NOT NULL,
  `actorId` varchar(128) NOT NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `metadataJson` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `customer_recovery_events_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_customer_recovery_events_tenant_idempotency` UNIQUE (`tenantId`,`idempotencyKey`),
  INDEX `idx_customer_recovery_events_tenant_intervention` (`tenantId`,`interventionId`,`createdAt`)
);
