-- Additive schema registered in scripts/migrate.mjs.
CREATE TABLE IF NOT EXISTS goldline_cleancloud_economic_heads (
  economicKey VARCHAR(64) PRIMARY KEY,
  revision INT NOT NULL,
  fingerprint VARCHAR(64) NOT NULL
);
CREATE TABLE IF NOT EXISTS goldline_cleancloud_outbox (
  id VARCHAR(80) PRIMARY KEY,
  payload JSON NOT NULL,
  publishedAt TIMESTAMP NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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
