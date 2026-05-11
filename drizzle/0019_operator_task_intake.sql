ALTER TABLE `agent_events` MODIFY COLUMN `agentType` enum('resident_agent','operator_voice_agent','vendor_agent','driver_agent','gm_agent','building_agent','collections_agent','operator_task_agent') NOT NULL;

CREATE TABLE `operator_tasks` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `source` enum('emergency_composer','operator_voice','manual') NOT NULL DEFAULT 'emergency_composer',
  `level` enum('level_1','level_2','level_3','level_4') NOT NULL,
  `title` varchar(255) NOT NULL,
  `details` text,
  `status` enum('open','in_progress','done','blocked') NOT NULL DEFAULT 'open',
  `priority` enum('emergency','high','normal','low') NOT NULL DEFAULT 'high',
  `target` varchar(255),
  `sourceNote` text,
  `createdByUserId` varchar(128),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `operator_tasks_id` PRIMARY KEY(`id`)
);
