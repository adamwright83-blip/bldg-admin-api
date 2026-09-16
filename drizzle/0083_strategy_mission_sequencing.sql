-- Strategy Mission Sequencing, Permissions, and Activation Tracks (Slice 7)
CREATE TABLE IF NOT EXISTS `strategy_mission_plan` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `playId` varchar(64) NOT NULL,
  `dayDirectorCommitmentId` varchar(36) DEFAULT NULL,
  `commercialMissionId` int DEFAULT NULL,
  `businessDate` varchar(10) NOT NULL,
  `missionType` enum('growth','support') NOT NULL DEFAULT 'growth',
  `status` enum('planned','wait_approval','active','completed','cancelled') NOT NULL DEFAULT 'planned',
  `title` varchar(255) NOT NULL,
  `geographyCluster` varchar(128) DEFAULT NULL,
  `stopCount` int NOT NULL DEFAULT 1,
  `spendReservationId` varchar(64) DEFAULT NULL,
  `spendCategory` varchar(64) DEFAULT NULL,
  `spendCents` int NOT NULL DEFAULT 0,
  `preparedSalesPrepJson` json NOT NULL,
  `dedupeKey` varchar(191) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_strategy_mission_plan_dedupe` (`tenantId`, `dedupeKey`),
  KEY `idx_strategy_mission_plan_date` (`tenantId`, `businessDate`),
  KEY `idx_strategy_mission_plan_play` (`tenantId`, `playId`),
  KEY `idx_strategy_mission_plan_status` (`tenantId`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `communication_permissions` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `subjectType` enum('lead','contact','customer','property') NOT NULL,
  `subjectId` varchar(128) NOT NULL,
  `channel` enum('sms','email','call','visit','any') NOT NULL DEFAULT 'any',
  `status` enum('opted_in','opted_out','refused','unspecified') NOT NULL DEFAULT 'unspecified',
  `reason` text DEFAULT NULL,
  `lastOutreachAt` timestamp NULL DEFAULT NULL,
  `frequencyCapDays` int NOT NULL DEFAULT 7,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_comm_perm_subject_channel` (`tenantId`, `subjectType`, `subjectId`, `channel`),
  KEY `idx_comm_perm_tenant_status` (`tenantId`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `property_activation_tracks` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `propertyId` varchar(128) NOT NULL,
  `propertyName` varchar(255) NOT NULL,
  `agreedServiceDetailsJson` json NOT NULL,
  `residentCommunicationPermitted` tinyint(1) NOT NULL DEFAULT 0,
  `bookingInstructions` text DEFAULT NULL,
  `pickupArrangements` text DEFAULT NULL,
  `stage` enum('access_granted','flyer_distribution','resident_announcement','first_order','repeat_orders') NOT NULL DEFAULT 'access_granted',
  `blockedReason` text DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_property_activation_property` (`tenantId`, `propertyId`),
  KEY `idx_property_activation_stage` (`tenantId`, `stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
