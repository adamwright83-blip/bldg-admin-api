CREATE TABLE IF NOT EXISTS goldline_tower_impacts (
  id VARCHAR(64) PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  KEY idx_tower_impacts_tenant (tenantId)
);
CREATE TABLE IF NOT EXISTS goldline_tower_season_revisions (
  id VARCHAR(64) PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  seasonId VARCHAR(10) NOT NULL,
  payload JSON NOT NULL,
  KEY idx_tower_season_revision (tenantId, seasonId)
);
