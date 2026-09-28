-- CleanCloud Metrics → Overview control totals. Screenshot bytes are private
-- and are not part of the witness row the operator summary reads.

CREATE TABLE IF NOT EXISTS `cleancloud_dashboard_witnesses` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `storeId` varchar(32) NOT NULL,
  `storeLabel` varchar(255) NOT NULL,
  `rangeFrom` varchar(10) NOT NULL,
  `rangeTo` varchar(10) NOT NULL,
  `comparisonFrom` varchar(10) NULL,
  `comparisonTo` varchar(10) NULL,
  `salesCents` int NOT NULL,
  `comparisonSalesCents` int NULL,
  `revenueCents` int NOT NULL,
  `comparisonRevenueCents` int NULL,
  `orders` int NOT NULL,
  `comparisonOrders` int NULL,
  `newCustomers` int NULL,
  `observedAt` timestamp NOT NULL,
  `screenshotSha256` char(64) NOT NULL,
  `extractionVersion` varchar(64) NOT NULL,
  `source` varchar(64) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cc_dashboard_witness_observation` (`tenantId`, `storeId`, `rangeFrom`, `rangeTo`, `screenshotSha256`),
  KEY `idx_cc_dashboard_witness_period` (`tenantId`, `rangeFrom`, `rangeTo`, `observedAt`)
);

CREATE TABLE IF NOT EXISTS `cleancloud_dashboard_witness_screenshots` (
  `witnessId` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `sha256` char(64) NOT NULL,
  `pngBase64` mediumtext NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`witnessId`),
  KEY `idx_cc_dashboard_witness_screenshot_tenant` (`tenantId`)
);
