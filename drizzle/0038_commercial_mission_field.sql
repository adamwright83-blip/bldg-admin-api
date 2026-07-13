ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','driver') NOT NULL DEFAULT 'user';

ALTER TABLE `commercial_visit_outcomes`
  ADD COLUMN `decisionMakerStatus` enum('met','unavailable','not_recorded') NOT NULL DEFAULT 'not_recorded',
  ADD COLUMN `collateralDelivered` boolean NOT NULL DEFAULT false,
  ADD COLUMN `quoteRequested` boolean NOT NULL DEFAULT false,
  ADD COLUMN `pilotRequested` boolean NOT NULL DEFAULT false,
  ADD COLUMN `followUpRequested` boolean NOT NULL DEFAULT false,
  ADD COLUMN `reason` varchar(64) NULL,
  ADD COLUMN `evidenceJson` json NULL;

UPDATE `commercial_visit_outcomes` SET `evidenceJson` = JSON_OBJECT() WHERE `evidenceJson` IS NULL;

ALTER TABLE `commercial_visit_outcomes`
  MODIFY COLUMN `evidenceJson` json NOT NULL,
  ADD CONSTRAINT `uq_commercial_visit_outcomes_tenant_mission` UNIQUE(`tenantId`,`missionId`);

CREATE TABLE `tenant_field_checklist_templates` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `itemKey` varchar(64) NOT NULL,
  `label` varchar(255) NOT NULL,
  `detail` text NOT NULL,
  `required` boolean NOT NULL DEFAULT true,
  `position` int NOT NULL,
  `active` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `tenant_field_checklist_templates_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_tenant_field_checklist_item` UNIQUE(`tenantId`,`itemKey`),
  INDEX `idx_tenant_field_checklist_position` (`tenantId`,`position`)
);

CREATE TABLE `commercial_mission_field_states` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `missionId` int NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `notes` text NOT NULL,
  `preparationStartedAt` timestamp NULL,
  `departedAt` timestamp NULL,
  `arrivedAt` timestamp NULL,
  `checkInMethod` enum('manual','location') NULL,
  `latitude` decimal(10,7) NULL,
  `longitude` decimal(10,7) NULL,
  `locationAccuracyMeters` int NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commercial_mission_field_states_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_commercial_field_states_tenant_mission` UNIQUE(`tenantId`,`missionId`)
);

CREATE TABLE `commercial_mission_field_checklist_items` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `missionId` int NOT NULL,
  `itemKey` varchar(64) NOT NULL,
  `label` varchar(255) NOT NULL,
  `detail` text NOT NULL,
  `required` boolean NOT NULL,
  `position` int NOT NULL,
  `status` enum('pending','completed','skipped') NOT NULL DEFAULT 'pending',
  `completedAt` timestamp NULL,
  `completedBy` varchar(128) NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `commercial_mission_field_checklist_items_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_commercial_field_items_tenant_mission_item` UNIQUE(`tenantId`,`missionId`,`itemKey`),
  INDEX `idx_commercial_field_items_tenant_mission_position` (`tenantId`,`missionId`,`position`)
);

CREATE TABLE `commercial_mission_phone_handoffs` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `missionId` int NOT NULL,
  `assignedTo` varchar(128) NOT NULL,
  `channel` enum('secure_link','sms','email') NOT NULL,
  `tokenHash` varchar(64) NOT NULL,
  `targetMasked` varchar(320) NULL,
  `expiresAt` timestamp NOT NULL,
  `consumedAt` timestamp NULL,
  `consumedBy` varchar(128) NULL,
  `createdBy` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `commercial_mission_phone_handoffs_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_commercial_phone_handoffs_tenant_token` UNIQUE(`tenantId`,`tokenHash`),
  INDEX `idx_commercial_phone_handoffs_tenant_mission` (`tenantId`,`missionId`,`createdAt`)
);
