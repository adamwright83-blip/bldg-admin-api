-- Additive schema registered in scripts/migrate.mjs.
CREATE TABLE IF NOT EXISTS goldline_cleancloud_economic_heads (
  economicKey VARCHAR(64) PRIMARY KEY,
  revision INT NOT NULL,
  fingerprint VARCHAR(64) NOT NULL
);
CREATE TABLE IF NOT EXISTS goldline_cleancloud_outbox (
  id VARCHAR(80) PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  leaseOwner VARCHAR(128) NULL,
  leaseExpiresAt TIMESTAMP(3) NULL,
  attemptCount INT NOT NULL DEFAULT 0,
  lastError VARCHAR(512) NULL,
  publishedAt TIMESTAMP(3) NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_goldline_cleancloud_outbox_claim (publishedAt, leaseExpiresAt, createdAt)
);
CREATE TABLE IF NOT EXISTS cleancloud_browser_sync_bindings (
  tenantId VARCHAR(64) PRIMARY KEY,
  id VARCHAR(36) NOT NULL,
  storeId VARCHAR(32) NOT NULL,
  storeLabel VARCHAR(255) NOT NULL,
  createdBy VARCHAR(128) NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lastSuccessAt TIMESTAMP NULL
);
CREATE TABLE IF NOT EXISTS cleancloud_browser_sync_receipts (
  id VARCHAR(36) PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  requestId VARCHAR(36) NOT NULL,
  digest VARCHAR(64) NOT NULL,
  storeId VARCHAR(32) NOT NULL,
  importBatchId INT NOT NULL,
  receiptJson JSON NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cc_browser_sync_request (tenantId, requestId)
);
CREATE TABLE IF NOT EXISTS cleancloud_browser_sync_attempts (
  id VARCHAR(36) PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  requestId VARCHAR(36) NULL,
  outcome VARCHAR(32) NOT NULL,
  message VARCHAR(512) NULL,
  rangeFrom VARCHAR(10) NULL,
  rangeTo VARCHAR(10) NULL,
  rowCount INT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cc_browser_sync_attempts_tenant (tenantId, createdAt)
);
CREATE TABLE IF NOT EXISTS cleancloud_dashboard_witnesses (
  id VARCHAR(36) PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  storeId VARCHAR(32) NOT NULL,
  storeLabel VARCHAR(255) NOT NULL,
  rangeFrom VARCHAR(10) NOT NULL,
  rangeTo VARCHAR(10) NOT NULL,
  comparisonFrom VARCHAR(10) NULL,
  comparisonTo VARCHAR(10) NULL,
  salesCents INT NOT NULL,
  comparisonSalesCents INT NULL,
  revenueCents INT NOT NULL,
  comparisonRevenueCents INT NULL,
  orders INT NOT NULL,
  comparisonOrders INT NULL,
  newCustomers INT NULL,
  observedAt TIMESTAMP NOT NULL,
  screenshotSha256 CHAR(64) NOT NULL,
  extractionVersion VARCHAR(64) NOT NULL,
  source VARCHAR(64) NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cc_dashboard_witness_observation (tenantId, storeId, rangeFrom, rangeTo, screenshotSha256),
  KEY idx_cc_dashboard_witness_period (tenantId, rangeFrom, rangeTo, observedAt)
);
CREATE TABLE IF NOT EXISTS cleancloud_dashboard_witness_screenshots (
  witnessId VARCHAR(36) PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  pngBase64 MEDIUMTEXT NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cc_dashboard_witness_screenshot_tenant (tenantId)
);
CREATE TABLE IF NOT EXISTS cleancloud_economic_reconciliations (
  id VARCHAR(36) PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  storeId VARCHAR(32) NOT NULL,
  rangeFrom VARCHAR(10) NOT NULL,
  rangeTo VARCHAR(10) NOT NULL,
  status ENUM('reconciled', 'mismatch', 'insufficient_evidence') NOT NULL,
  dashboardWitnessId VARCHAR(36) NULL,
  dashboardRevenueCents INT NULL,
  revenueReportCents INT NULL,
  bookCents INT NULL,
  discrepancyCents INT NULL,
  evidenceIdsJson JSON NOT NULL,
  evidenceHash CHAR(64) NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cc_economic_reconciliation_evidence (tenantId, storeId, rangeFrom, rangeTo, evidenceHash),
  KEY idx_cc_economic_reconciliation_period (tenantId, rangeFrom, rangeTo, createdAt)
);
CREATE TABLE IF NOT EXISTS cleancloud_verified_economic_events (
  id VARCHAR(36) PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  eventType VARCHAR(64) NOT NULL,
  periodFrom VARCHAR(10) NOT NULL,
  periodTo VARCHAR(10) NOT NULL,
  comparisonFrom VARCHAR(10) NULL,
  comparisonTo VARCHAR(10) NULL,
  currentRevenueCents INT NOT NULL,
  comparisonRevenueCents INT NULL,
  deltaCents INT NOT NULL,
  deltaPercentHundredths INT NULL,
  evidenceIdsJson JSON NOT NULL,
  idempotencyKey CHAR(64) NOT NULL,
  verifiedAt TIMESTAMP NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cc_verified_economic_event (tenantId, idempotencyKey)
);
CREATE TABLE IF NOT EXISTS cleancloud_economic_reconciliations (
  id VARCHAR(36) PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  storeId VARCHAR(32) NOT NULL,
  rangeFrom VARCHAR(10) NOT NULL,
  rangeTo VARCHAR(10) NOT NULL,
  status ENUM('reconciled', 'mismatch', 'insufficient_evidence') NOT NULL,
  dashboardWitnessId VARCHAR(36) NULL,
  dashboardRevenueCents INT NULL,
  revenueReportCents INT NULL,
  bookCents INT NULL,
  discrepancyCents INT NULL,
  evidenceIdsJson JSON NOT NULL,
  evidenceHash CHAR(64) NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cc_economic_reconciliation_evidence (tenantId, storeId, rangeFrom, rangeTo, evidenceHash),
  KEY idx_cc_economic_reconciliation_period (tenantId, rangeFrom, rangeTo, createdAt)
);
CREATE TABLE IF NOT EXISTS cleancloud_verified_economic_events (
  id VARCHAR(36) PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  eventType VARCHAR(64) NOT NULL,
  periodFrom VARCHAR(10) NOT NULL,
  periodTo VARCHAR(10) NOT NULL,
  comparisonFrom VARCHAR(10) NULL,
  comparisonTo VARCHAR(10) NULL,
  currentRevenueCents INT NOT NULL,
  comparisonRevenueCents INT NULL,
  deltaCents INT NOT NULL,
  deltaPercentHundredths INT NULL,
  evidenceIdsJson JSON NOT NULL,
  idempotencyKey CHAR(64) NOT NULL,
  verifiedAt TIMESTAMP NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cc_verified_economic_event (tenantId, idempotencyKey)
);
