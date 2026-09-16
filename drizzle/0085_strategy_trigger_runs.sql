-- Strategy Trigger Runs Bookkeeping (Slice 9)
CREATE TABLE IF NOT EXISTS `strategy_trigger_runs` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `triggerType` enum('morning','mission_completion','mission_skip','business_change','weekly_dawn') NOT NULL,
  `businessDate` varchar(10) NOT NULL,
  `dedupeKey` varchar(191) NOT NULL,
  `snapshotId` varchar(64) DEFAULT NULL,
  `outcome` varchar(64) NOT NULL DEFAULT 'success',
  `detailJson` json NOT NULL,
  `errorMessage` text DEFAULT NULL,
  `executedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_strategy_trigger_dedupe` (`tenantId`, `dedupeKey`),
  KEY `idx_strategy_trigger_tenant_type` (`tenantId`, `triggerType`, `executedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
