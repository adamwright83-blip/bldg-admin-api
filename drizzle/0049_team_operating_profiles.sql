CREATE TABLE `employee_operating_profiles` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `userOpenId` varchar(64) NOT NULL,
  `displayName` varchar(255) NOT NULL,
  `employmentStatus` enum('active','leave','ended') NOT NULL DEFAULT 'active',
  `skillsJson` json NOT NULL,
  `weeklyCapacityUnits` int NULL,
  `createdBy` varchar(128) NOT NULL,
  `updatedBy` varchar(128) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `employee_operating_profiles_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_employee_operating_profiles_tenant_user` UNIQUE (`tenantId`,`userOpenId`),
  INDEX `idx_employee_operating_profiles_tenant_status` (`tenantId`,`employmentStatus`)
);

CREATE TABLE `employee_operating_profile_events` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `profileId` varchar(36) NOT NULL,
  `eventType` varchar(64) NOT NULL,
  `actorId` varchar(128) NOT NULL,
  `requestId` varchar(36) NOT NULL,
  `metadataJson` json NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `employee_operating_profile_events_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_employee_profile_events_tenant_request` UNIQUE (`tenantId`,`requestId`),
  INDEX `idx_employee_profile_events_tenant_profile` (`tenantId`,`profileId`,`createdAt`)
);
