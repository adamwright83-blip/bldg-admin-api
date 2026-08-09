CREATE TABLE IF NOT EXISTS `open_channel_missions` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `driverId` varchar(128) NOT NULL,
  `businessDate` varchar(10) NOT NULL,
  `status` enum('draft','active','completed','cancelled') NOT NULL DEFAULT 'draft',
  `title` varchar(191) NOT NULL,
  `laraBriefing` text NOT NULL,
  `transcript` text NOT NULL,
  `generationSource` enum('anthropic_structured','deterministic_fallback') NOT NULL,
  `gapStartedAt` timestamp NOT NULL,
  `nextCommitmentAt` timestamp NULL,
  `availableMinutes` int NULL,
  `currentLocationJson` json NULL,
  `requestId` varchar(36) NOT NULL,
  `approvedAt` timestamp NULL,
  `completedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `open_channel_missions_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_open_channel_missions_tenant_request` UNIQUE (`tenantId`,`requestId`),
  INDEX `idx_open_channel_missions_tenant_driver_date_status` (`tenantId`,`driverId`,`businessDate`,`status`)
);

CREATE TABLE IF NOT EXISTS `open_channel_mission_tasks` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `missionId` varchar(36) NOT NULL,
  `position` int NOT NULL,
  `title` varchar(191) NOT NULL,
  `detail` text NOT NULL,
  `estimatedMinutes` int NOT NULL,
  `category` enum('food','sales','operations','personal','finance','travel','other') NOT NULL,
  `navigationQuery` varchar(512) NULL,
  `status` enum('pending','completed') NOT NULL DEFAULT 'pending',
  `completedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `open_channel_mission_tasks_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_open_channel_tasks_mission_position` UNIQUE (`missionId`,`position`),
  INDEX `idx_open_channel_tasks_tenant_mission_status` (`tenantId`,`missionId`,`status`)
);

CREATE TABLE IF NOT EXISTS `open_channel_task_events` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `missionId` varchar(36) NOT NULL,
  `taskId` varchar(36) NOT NULL,
  `actorId` varchar(128) NOT NULL,
  `requestId` varchar(36) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `open_channel_task_events_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_open_channel_task_events_tenant_request` UNIQUE (`tenantId`,`requestId`),
  INDEX `idx_open_channel_task_events_tenant_mission` (`tenantId`,`missionId`,`createdAt`)
);
