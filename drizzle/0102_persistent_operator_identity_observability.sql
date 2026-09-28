CREATE TABLE persistent_operator_identity_bindings (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  canonicalOpenId VARCHAR(64) NOT NULL,
  aliasOpenId VARCHAR(64) NOT NULL,
  activeAliasKey VARCHAR(191) NULL,
  surface VARCHAR(32) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  createdByOpenId VARCHAR(64) NULL,
  revokedAt TIMESTAMP NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_persistent_operator_identity_active_alias (activeAliasKey),
  KEY idx_persistent_operator_identity_alias (tenantId, aliasOpenId, active),
  KEY idx_persistent_operator_identity_canonical (tenantId, canonicalOpenId, active)
);

CREATE TABLE persistent_operator_diagnostic_events (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  canonicalOperatorId VARCHAR(191) NULL,
  operatorUserId VARCHAR(128) NULL,
  subsystem VARCHAR(64) NOT NULL,
  eventKind VARCHAR(64) NOT NULL,
  reason VARCHAR(64) NULL,
  sourceIdentityType VARCHAR(32) NULL,
  targetIdentityType VARCHAR(32) NULL,
  objectiveId VARCHAR(191) NULL,
  occurredAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_persistent_operator_diag_tenant_time (tenantId, occurredAt),
  KEY idx_persistent_operator_diag_operator_time (tenantId, canonicalOperatorId, occurredAt),
  KEY idx_persistent_operator_diag_reason (tenantId, reason, occurredAt)
);
