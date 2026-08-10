ALTER TABLE `open_channel_missions`
  CHANGE COLUMN `laraBriefing` `operatorBriefing` text NOT NULL;

CREATE TABLE IF NOT EXISTS `driver_game_world_nodes` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `actorId` varchar(128) NOT NULL,
  `missionId` int NOT NULL,
  `entityType` varchar(64) NOT NULL DEFAULT 'commercial_mission',
  `entityId` varchar(191) NOT NULL,
  `locationId` int NULL,
  `visualState` enum('available','approaching','active','captured','contested','recovery_available','recovery_active','watching','closed') NOT NULL,
  `worldAnchor` varchar(64) NOT NULL DEFAULT 'fortress_gate',
  `unlockedPath` varchar(64) NULL,
  `discoveryState` enum('hidden','discovered','engaged') NOT NULL DEFAULT 'discovered',
  `lastResolvedAt` timestamp NULL,
  `metadataJson` json NULL,
  `version` int NOT NULL DEFAULT 1,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `driver_game_world_nodes_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_driver_game_world_actor_mission` UNIQUE (`tenantId`,`actorId`,`missionId`),
  INDEX `idx_driver_game_world_tenant_actor_state` (`tenantId`,`actorId`,`visualState`,`updatedAt`)
);
