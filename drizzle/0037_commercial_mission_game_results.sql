CREATE TABLE `commercial_mission_game_attempts` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `missionId` int NOT NULL,
  `missionVersion` int NOT NULL,
  `playerId` varchar(128) NOT NULL,
  `status` enum('active','abandoned','failed','qualified') NOT NULL DEFAULT 'active',
  `startedAt` timestamp NOT NULL DEFAULT (now()),
  `endedAt` timestamp NULL,
  `durationMs` int NULL,
  `telemetryJson` json NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `commercial_mission_game_attempts_id` PRIMARY KEY(`id`),
  INDEX `idx_commercial_game_attempts_tenant_mission` (`tenantId`,`missionId`,`startedAt`),
  INDEX `idx_commercial_game_attempts_tenant_player` (`tenantId`,`playerId`,`startedAt`)
);

CREATE TABLE `commercial_mission_game_results` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `missionId` int NOT NULL,
  `missionVersion` int NOT NULL,
  `gameAttemptId` varchar(36) NOT NULL,
  `playerId` varchar(128) NOT NULL,
  `sparkScore` int NOT NULL,
  `clockheadScore` int NOT NULL,
  `durationMs` int NOT NULL,
  `replayJson` json NOT NULL,
  `qualifiedAt` timestamp NOT NULL DEFAULT (now()),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `commercial_mission_game_results_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_commercial_game_results_tenant_mission` UNIQUE(`tenantId`,`missionId`),
  CONSTRAINT `uq_commercial_game_results_tenant_attempt` UNIQUE(`tenantId`,`gameAttemptId`)
);

CREATE TABLE `commercial_mission_game_rewards` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `missionId` int NOT NULL,
  `gameResultId` int NOT NULL,
  `playerId` varchar(128) NOT NULL,
  `xpAwarded` int NOT NULL,
  `streakDays` int NOT NULL,
  `awardedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `commercial_mission_game_rewards_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_commercial_game_rewards_tenant_mission` UNIQUE(`tenantId`,`missionId`),
  CONSTRAINT `uq_commercial_game_rewards_tenant_result` UNIQUE(`tenantId`,`gameResultId`)
);
