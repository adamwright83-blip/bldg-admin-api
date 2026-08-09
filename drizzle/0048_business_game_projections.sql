CREATE TABLE `business_game_move_decisions` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `moveId` varchar(191) NOT NULL,
  `sourceType` varchar(64) NOT NULL,
  `sourceId` varchar(191) NOT NULL,
  `decision` enum('accepted','dismissed','completed') NOT NULL,
  `actorId` varchar(128) NOT NULL,
  `requestId` varchar(36) NOT NULL,
  `metadataJson` json NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `business_game_move_decisions_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_business_move_decisions_tenant_request` UNIQUE (`tenantId`,`requestId`),
  INDEX `idx_business_move_decisions_tenant_move` (`tenantId`,`moveId`,`createdAt`)
);

CREATE TABLE `business_day_resolutions` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `businessDate` varchar(10) NOT NULL,
  `actorId` varchar(128) NOT NULL,
  `requestId` varchar(36) NOT NULL,
  `sourceThrough` timestamp NOT NULL,
  `contentHash` varchar(64) NOT NULL,
  `resolutionJson` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `business_day_resolutions_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_business_day_resolutions_tenant_date_actor` UNIQUE (`tenantId`,`businessDate`,`actorId`),
  CONSTRAINT `uq_business_day_resolutions_tenant_request` UNIQUE (`tenantId`,`requestId`)
);
