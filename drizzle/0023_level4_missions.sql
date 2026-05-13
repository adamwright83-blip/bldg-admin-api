ALTER TABLE `agent_events` MODIFY COLUMN `agentType` enum('resident_agent','operator_voice_agent','vendor_agent','driver_agent','gm_agent','building_agent','collections_agent','operator_task_agent','system_agent') NOT NULL;

CREATE TABLE IF NOT EXISTS `level4_missions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `operatorId` varchar(128) NOT NULL DEFAULT 'tenant_proxy',
  `taskId` int NOT NULL,
  `status` enum('locked','unlocked','completed','expired') NOT NULL DEFAULT 'locked',
  `missionDate` varchar(10) NOT NULL,
  `activatedAt` timestamp NOT NULL DEFAULT (now()),
  `unlockedAt` timestamp,
  `startedAt` timestamp,
  `completedAt` timestamp,
  `expiredAt` timestamp,
  `visibleUntil` timestamp,
  `xpAwarded` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `level4_missions_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_level4_missions_tenant_operator_status` ON `level4_missions` (`tenantId`,`operatorId`,`status`);
CREATE INDEX `idx_level4_missions_tenant_operator_date` ON `level4_missions` (`tenantId`,`operatorId`,`missionDate`);
CREATE INDEX `idx_level4_missions_task` ON `level4_missions` (`taskId`);
