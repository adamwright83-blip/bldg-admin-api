-- Phase 2 · Slice A: durable Work Thread identity.
-- A Work Thread is one underlying business opportunity a tenant pursues over
-- time. Its identity is the minted `id`. `opportunityKey` (with its sha256 in
-- `opportunityKeyHash`) is only how a newly observed opportunity finds its open
-- thread: built from structured scope or a durable source id, never from
-- wording, diagnosis ids, timestamps or goal-cycle occurrence ids.
-- `openSlot` is 1 while the thread is open and NULL once it closes, so a key has
-- at most one open thread; closing frees the key for a new generation (a new
-- initiative) instead of reopening history.
CREATE TABLE IF NOT EXISTS `work_threads` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `opportunityKey` varchar(512) NOT NULL,
  `opportunityKeyHash` char(64) NOT NULL,
  `generation` int NOT NULL DEFAULT 1,
  `openSlot` tinyint NULL DEFAULT 1,
  `status` varchar(16) NOT NULL DEFAULT 'open',
  `kind` varchar(32) NOT NULL,
  `opportunityJson` json NOT NULL,
  `title` varchar(255) NOT NULL,
  `createdByOperatorId` varchar(191) NULL,
  `firstSourceRef` varchar(191) NULL,
  `lastSourceRef` varchar(191) NULL,
  `lastObservedAt` timestamp(3) NULL,
  `closedReason` varchar(64) NULL,
  `closedAt` timestamp(3) NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_work_threads_open` (`tenantId`, `opportunityKeyHash`, `openSlot`),
  UNIQUE KEY `uq_work_threads_generation` (`tenantId`, `opportunityKeyHash`, `generation`),
  KEY `idx_work_threads_tenant_status` (`tenantId`, `status`, `updatedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
