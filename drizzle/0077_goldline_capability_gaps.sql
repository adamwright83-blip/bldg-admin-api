-- Additive Goldline capability-gap ledger. NOT applied to production until Adam
-- approves this migration. Railway start uses scripts/migrate.mjs, which does
-- not include this file until explicitly added.
CREATE TABLE IF NOT EXISTS goldline_capability_gaps (
  id VARCHAR(36) PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  operatorUserId VARCHAR(128) NOT NULL,
  capabilityKey VARCHAR(64) NOT NULL,
  operatorRequest TEXT NOT NULL,
  conversationSessionId VARCHAR(36) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'IDENTIFIED',
  engineeringSessionId VARCHAR(128) NULL,
  engineeringStatus VARCHAR(32) NULL,
  terminalResultJson JSON NULL,
  branch VARCHAR(191) NULL,
  prUrl VARCHAR(512) NULL,
  blocker TEXT NULL,
  requiresHumanApproval TINYINT(1) NOT NULL DEFAULT 0,
  demandCount INT NOT NULL DEFAULT 1,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_goldline_capability_gap_operator (tenantId, operatorUserId, createdAt),
  INDEX idx_goldline_capability_gap_key (tenantId, capabilityKey, status)
);
