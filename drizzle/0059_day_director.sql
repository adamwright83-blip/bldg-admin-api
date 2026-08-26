CREATE TABLE IF NOT EXISTS `day_director_processing_locations` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `name` varchar(191) NOT NULL,
  `locality` varchar(191),
  `address` varchar(512),
  `active` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_day_director_processing_tenant` (`tenantId`)
);

CREATE TABLE IF NOT EXISTS `day_director_commitments` (
  `id` varchar(36) PRIMARY KEY,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `actorId` varchar(128) NOT NULL,
  `businessDate` varchar(10) NOT NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `title` varchar(255) NOT NULL,
  `kind` enum('growth','prep','operations') NOT NULL,
  `quantity` int,
  `provenance` enum('user_reported','manual') NOT NULL,
  `status` enum('open','completed') NOT NULL DEFAULT 'open',
  `sourceText` text,
  `metadataJson` json,
  `completedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_day_director_commitment_key` (`tenantId`,`actorId`,`businessDate`,`idempotencyKey`),
  KEY `idx_day_director_commitment_today` (`tenantId`,`actorId`,`businessDate`)
);

CREATE TABLE IF NOT EXISTS `day_director_prompt_states` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `actorId` varchar(128) NOT NULL,
  `businessDate` varchar(10) NOT NULL,
  `promptKey` varchar(191) NOT NULL,
  `state` enum('accepted','dismissed') NOT NULL,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_day_director_prompt_state` (`tenantId`,`actorId`,`businessDate`,`promptKey`)
);

INSERT INTO `day_director_processing_locations` (`tenantId`,`name`,`locality`,`active`)
VALUES ('default','Lugo''s Lavanderia','Huntington Park',true)
ON DUPLICATE KEY UPDATE `tenantId` = VALUES(`tenantId`);
