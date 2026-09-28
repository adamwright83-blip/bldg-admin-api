-- Period reconciliation of the overview witness, the Orders (Revenue) total,
-- and the normalized CleanCloud book. Verified events are inserted only from
-- a reconciled result. Screenshot bytes are not stored here.

CREATE TABLE IF NOT EXISTS `cleancloud_economic_reconciliations` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `storeId` varchar(32) NOT NULL,
  `rangeFrom` varchar(10) NOT NULL,
  `rangeTo` varchar(10) NOT NULL,
  `status` enum('reconciled','mismatch','insufficient_evidence') NOT NULL,
  `dashboardWitnessId` varchar(36) NULL,
  `dashboardRevenueCents` int NULL,
  `revenueReportCents` int NULL,
  `bookCents` int NULL,
  `discrepancyCents` int NULL,
  `evidenceIdsJson` json NOT NULL,
  `evidenceHash` char(64) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cc_economic_reconciliation_evidence` (`tenantId`, `storeId`, `rangeFrom`, `rangeTo`, `evidenceHash`),
  KEY `idx_cc_economic_reconciliation_period` (`tenantId`, `rangeFrom`, `rangeTo`, `createdAt`)
);

CREATE TABLE IF NOT EXISTS `cleancloud_verified_economic_events` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `eventType` varchar(64) NOT NULL,
  `periodFrom` varchar(10) NOT NULL,
  `periodTo` varchar(10) NOT NULL,
  `comparisonFrom` varchar(10) NULL,
  `comparisonTo` varchar(10) NULL,
  `currentRevenueCents` int NOT NULL,
  `comparisonRevenueCents` int NULL,
  `deltaCents` int NOT NULL,
  `deltaPercentHundredths` int NULL,
  `evidenceIdsJson` json NOT NULL,
  `idempotencyKey` char(64) NOT NULL,
  `verifiedAt` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cc_verified_economic_event` (`tenantId`, `idempotencyKey`)
);
