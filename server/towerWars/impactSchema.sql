CREATE TABLE IF NOT EXISTS goldline_tower_impacts (
  id VARCHAR(64) PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  KEY idx_tower_impacts_tenant (tenantId)
);
