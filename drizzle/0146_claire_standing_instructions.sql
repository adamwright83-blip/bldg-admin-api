-- Claire standing instructions and prepared items (promise ledger).
-- Idempotent: safe to run on every boot from scripts/migrate.mjs. No business rows are backfilled.
CREATE TABLE IF NOT EXISTS `claire_operator_instructions` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `kind` varchar(32) NOT NULL,
  `subjectKey` varchar(96) NOT NULL,
  `version` int NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `instructionText` text NOT NULL,
  `quote` text NOT NULL,
  `payloadJson` json NULL,
  `fingerprint` varchar(64) NOT NULL,
  `sourceConversationKey` varchar(191) NOT NULL,
  `sourceTurnId` varchar(191) NOT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_claire_op_instr_fingerprint` (`tenantId`, `canonicalOperatorId`, `fingerprint`),
  UNIQUE KEY `uq_claire_op_instr_version` (`tenantId`, `canonicalOperatorId`, `subjectKey`, `version`),
  KEY `idx_claire_op_instr_active` (`tenantId`, `canonicalOperatorId`, `status`, `createdAt`)
);

CREATE TABLE IF NOT EXISTS `claire_prepared_items` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `kind` varchar(32) NOT NULL,
  `forBusinessDate` varchar(10) NOT NULL,
  `promiseText` text NOT NULL,
  `payloadJson` json NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'prepared',
  `sourceConversationKey` varchar(191) NOT NULL,
  `consumedConversationKey` varchar(191) NULL,
  `consumedAt` timestamp(3) NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_claire_prepared_scope` (`tenantId`, `canonicalOperatorId`, `kind`, `forBusinessDate`),
  KEY `idx_claire_prepared_open` (`tenantId`, `canonicalOperatorId`, `status`, `forBusinessDate`)
);
