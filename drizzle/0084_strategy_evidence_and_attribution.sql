-- Strategy Evidence, Attribution, and Stall Reasons (Slice 8)
CREATE TABLE IF NOT EXISTS `strategy_evidence` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `playId` varchar(64) NOT NULL,
  `windowDays` int NOT NULL,
  `windowStart` varchar(10) NOT NULL,
  `windowEnd` varchar(10) NOT NULL,
  `funnelCountsJson` json NOT NULL,
  `untrackedFunnelStepsJson` json NOT NULL,
  `statement` text NOT NULL,
  `sampleSize` int NOT NULL DEFAULT 0,
  `thresholdMet` tinyint(1) NOT NULL DEFAULT 0,
  `worldSignal` enum('brighten','dim','none') NOT NULL DEFAULT 'none',
  `provenanceJson` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_strategy_evidence_play` (`tenantId`, `playId`),
  KEY `idx_strategy_evidence_signal` (`tenantId`, `worldSignal`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `opportunity_stall_reasons` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `opportunityId` varchar(64) DEFAULT NULL,
  `source` varchar(64) NOT NULL DEFAULT 'debrief',
  `reason` enum('timing','price','trust','pickup_convenience','existing_provider','access_restriction','service_issue','unknown') NOT NULL DEFAULT 'unknown',
  `detail` text DEFAULT NULL,
  `recordedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_opp_stall_reason` (`tenantId`, `reason`),
  KEY `idx_opp_stall_opp` (`tenantId`, `opportunityId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
