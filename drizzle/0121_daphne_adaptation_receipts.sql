-- Daphne Stage 3B causal adaptation receipts.
-- This is NOT business truth and never substitutes for Authority Receipts.
-- It proves only that one approved non-business Claire behavior was actually selected.

CREATE TABLE IF NOT EXISTS `operator_representative_adaptation_receipts` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `directiveId` varchar(36) NOT NULL,
  `targetKey` varchar(191) NOT NULL,
  `behaviorClass` enum('ask_before_ambiguous_pending_continuation') NOT NULL,
  `conversationId` varchar(191) NOT NULL,
  `turnId` varchar(191) NOT NULL,
  `executingSha` varchar(64) NOT NULL,
  `receiptClass` enum('non_business_claire_behavior') NOT NULL DEFAULT 'non_business_claire_behavior',
  `structuralOutcome` enum('clarification_branch_selected') NOT NULL,
  `firewallResult` enum('non_business_behavior_only') NOT NULL DEFAULT 'non_business_behavior_only',
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_operator_rep_adaptation_turn` (
    `tenantId`, `canonicalOperatorId`, `directiveId`, `conversationId`, `turnId`
  ),
  KEY `idx_operator_rep_adaptation_operator_created` (
    `tenantId`, `canonicalOperatorId`, `createdAt`
  ),
  KEY `idx_operator_rep_adaptation_directive` (
    `tenantId`, `canonicalOperatorId`, `directiveId`, `createdAt`
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
