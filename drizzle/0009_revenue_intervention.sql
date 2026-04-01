CREATE TABLE `admin_settings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `weeklyRevenueTargetCents` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `admin_settings_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_admin_settings_tenant` UNIQUE(`tenantId`)
);

INSERT IGNORE INTO `admin_settings` (`tenantId`, `weeklyRevenueTargetCents`) VALUES ('default', 0);

CREATE TABLE `admin_action_log` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `actionType` varchar(64) NOT NULL,
  `entityType` enum('order','customer') NOT NULL,
  `entityId` varchar(128) NOT NULL,
  `dollarValueCents` int NOT NULL,
  `status` enum('success','reversed','failed') NOT NULL,
  `source` enum('manual_action','auto_capture') NOT NULL,
  `executionTimeMs` int,
  `metadata` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `admin_action_log_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_admin_action_log_tenant_created` ON `admin_action_log` (`tenantId`, `createdAt`);
CREATE INDEX `idx_admin_action_log_dedupe` ON `admin_action_log` (`tenantId`, `actionType`, `entityType`, `entityId`, `status`, `createdAt`);

ALTER TABLE `orders` ADD `manualRiskFlag` boolean NOT NULL DEFAULT false;
