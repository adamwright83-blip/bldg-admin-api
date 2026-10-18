-- Phase 2 · Slices C and D: durable observation-bridge obligations.
-- One row per durable source event (a completed Day Line commitment, a paid
-- CleanCloud order) that must be connected to its goal objective. The row owns
-- the retry: a failed bridge stays `pending` with its error and next attempt,
-- instead of being logged as "deferred" and lost. Retries are leased so two
-- workers never run one obligation at once, and the bridge writes are
-- idempotent, so a crash at any point replays safely.
--
-- status: bridged | pending | unresolved_identity | unrelated | ambiguous_review | rejected
CREATE TABLE IF NOT EXISTS `observation_bridge_obligations` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `sourceKind` varchar(48) NOT NULL,
  `sourceKey` varchar(191) NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'pending',
  `payloadJson` json NOT NULL,
  `resultJson` json NULL,
  `attemptCount` int NOT NULL DEFAULT 0,
  `nextAttemptAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leaseOwner` varchar(191) NULL,
  `leaseExpiresAt` timestamp(3) NULL,
  `lastError` text NULL,
  `resolvedAt` timestamp(3) NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_observation_bridge_source` (`tenantId`, `sourceKind`, `sourceKey`),
  KEY `idx_observation_bridge_due` (`status`, `nextAttemptAt`),
  KEY `idx_observation_bridge_tenant_status` (`tenantId`, `status`, `updatedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
