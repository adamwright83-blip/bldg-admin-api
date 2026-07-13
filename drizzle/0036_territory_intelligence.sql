CREATE TABLE `territory_operator_profiles` (
  `tenantId` varchar(64) NOT NULL,
  `storeName` varchar(255) NOT NULL,
  `storeAddress` varchar(512) NOT NULL,
  `latitude` decimal(10,7),
  `longitude` decimal(10,7),
  `serviceRadiusMiles` decimal(6,2) NOT NULL DEFAULT '3.00',
  `commercialWashFoldEnabled` boolean NOT NULL DEFAULT true,
  `averagePricePerPoundCents` int NOT NULL,
  `availableWeeklyCapacityPounds` int NOT NULL,
  `routePointsJson` json NOT NULL,
  `turnaroundCompatibleByDefault` boolean NOT NULL DEFAULT true,
  `pickupDaysCompatibleByDefault` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `territory_operator_profiles_tenantId` PRIMARY KEY(`tenantId`)
);

CREATE TABLE `territory_scan_sessions` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64),
  `mode` enum('public_preview','tenant') NOT NULL,
  `addressQuery` varchar(512) NOT NULL,
  `centerJson` json NOT NULL,
  `providerName` varchar(64) NOT NULL,
  `resultCount` int NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `createdBy` varchar(128),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `territory_scan_sessions_id` PRIMARY KEY(`id`),
  INDEX `idx_territory_scan_sessions_tenant_created` (`tenantId`,`createdAt`),
  INDEX `idx_territory_scan_sessions_expires` (`expiresAt`)
);

CREATE TABLE `territory_scan_results` (
  `id` int AUTO_INCREMENT NOT NULL,
  `scanSessionId` varchar(64) NOT NULL,
  `tenantId` varchar(64),
  `candidateKey` varchar(191) NOT NULL,
  `providerName` varchar(64) NOT NULL,
  `providerAccountId` varchar(191) NOT NULL,
  `accountSnapshotJson` json NOT NULL,
  `scoreSnapshotJson` json NOT NULL,
  `evidenceJson` json NOT NULL,
  `sourceCapturedAt` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `territory_scan_results_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_territory_scan_results_session_candidate` UNIQUE(`scanSessionId`,`candidateKey`),
  INDEX `idx_territory_scan_results_tenant_session` (`tenantId`,`scanSessionId`)
);
