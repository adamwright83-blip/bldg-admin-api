CREATE TABLE IF NOT EXISTS playground_rules (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  monthlySpendCeilingCents INT NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  approvalCategoriesJson JSON NOT NULL,
  effectiveFrom TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effectiveTo TIMESTAMP NULL,
  source ENUM('operator_attested', 'admin') NOT NULL DEFAULT 'admin',
  macroGoalId VARCHAR(36) NULL,
  status ENUM('active', 'superseded') NOT NULL DEFAULT 'active',
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_playground_rules_tenant_status (tenantId, status),
  KEY idx_playground_rules_tenant_version (tenantId, version)
);

CREATE TABLE IF NOT EXISTS strategy_spend_ledger (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  businessMonth VARCHAR(7) NOT NULL,
  category VARCHAR(64) NOT NULL,
  amountCents INT NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  status ENUM('planned', 'committed', 'released') NOT NULL,
  sourcePlayId VARCHAR(64) NULL,
  sourceMissionId VARCHAR(64) NULL,
  sourceRef VARCHAR(191) NULL,
  dedupeKey VARCHAR(191) NOT NULL,
  approvedByUserId VARCHAR(128) NULL,
  metadataJson JSON NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_strategy_spend_tenant_dedupe (tenantId, dedupeKey),
  KEY idx_strategy_spend_tenant_month_status (tenantId, businessMonth, status)
);
