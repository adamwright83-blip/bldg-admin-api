-- Strategy Recovery Items and Drop Pattern Flags (Slice 10)
CREATE TABLE IF NOT EXISTS `recovery_items` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `commitmentRef` varchar(128) NOT NULL,
  `playId` varchar(64) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `state` enum('visible','queued','repaired','rescheduled','dropped','archived_outstanding') NOT NULL DEFAULT 'queued',
  `dropReason` text DEFAULT NULL,
  `rescheduledToDate` varchar(10) DEFAULT NULL,
  `missedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `resolvedAt` timestamp NULL DEFAULT NULL,
  `promotedVisibleAt` timestamp NULL DEFAULT NULL,
  `chronicleRef` varchar(128) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_recovery_items_tenant_state` (`tenantId`, `state`),
  KEY `idx_recovery_items_tenant_play` (`tenantId`, `playId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `drop_pattern_flags` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `patternType` enum('play_cluster_drops','overall_drops_surge','repeated_reschedules','archived_backlog') NOT NULL,
  `playId` varchar(64) DEFAULT NULL,
  `windowDays` int NOT NULL DEFAULT 14,
  `occurrenceCount` int NOT NULL DEFAULT 0,
  `firstOccurrenceAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastOccurrenceAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `surfacedAtDawn` tinyint(1) NOT NULL DEFAULT 0,
  `dawnSummary` text DEFAULT NULL,
  `acknowledgedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_drop_pattern_tenant_type` (`tenantId`, `patternType`, `surfacedAtDawn`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
