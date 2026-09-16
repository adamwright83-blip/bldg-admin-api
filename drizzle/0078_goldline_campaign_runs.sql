-- Campaign Runs — the standing instance of one real operation across days.
-- docs/goldline/FICTION_PACKS.md section 2.
--
-- Applied by scripts/migrate.mjs (this file is not executed directly; see
-- SLICE_4_MISSION_DIRECTOR.md section 8 — migrate.mjs does not run drizzle/*.sql).

CREATE TABLE IF NOT EXISTS goldline_campaign_runs (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  operatorUserId VARCHAR(128) NOT NULL,
  campaignId VARCHAR(64) NOT NULL,
  campaignVersion INT NOT NULL DEFAULT 1,
  fictionPackId VARCHAR(64) NULL,
  fictionPackVersion INT NULL,
  targetSetId VARCHAR(64) NOT NULL,
  startedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('active','complete','abandoned') NOT NULL DEFAULT 'active',
  completedAt TIMESTAMP NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_goldline_campaign_runs_active (tenantId,operatorUserId,status),
  KEY idx_goldline_campaign_runs_campaign (tenantId,campaignId)
);

-- Targets are frozen into a set at run start. A target is never silently
-- edited; it is retired by a target_replaced event (REALITY_BRIDGE section 4 —
-- nothing may invent an address).
CREATE TABLE IF NOT EXISTS goldline_campaign_targets (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  targetSetId VARCHAR(64) NOT NULL,
  targetId VARCHAR(64) NOT NULL,
  label VARCHAR(191) NOT NULL,
  address VARCHAR(512) NOT NULL,
  lat DECIMAL(10,7) NULL,
  lng DECIMAL(10,7) NULL,
  placementPoint VARCHAR(32) NOT NULL,
  sourceNote VARCHAR(512) NOT NULL,
  provenance VARCHAR(64) NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_goldline_campaign_target (tenantId,targetSetId,targetId),
  KEY idx_goldline_campaign_targets_set (tenantId,targetSetId)
);

-- Evidence. Append-only in practice: progress is derived from these rows and
-- never stored as a counter. Follows the opsTaskEvents philosophy.
CREATE TABLE IF NOT EXISTS goldline_campaign_target_events (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  campaignRunId VARCHAR(36) NOT NULL,
  targetId VARCHAR(64) NULL,
  kind ENUM('territory_presence','placement_reported','supporting_photo','target_replaced') NOT NULL,
  occurredAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  operatorUserId VARCHAR(128) NOT NULL,
  provenance VARCHAR(64) NOT NULL,
  epistemicState VARCHAR(32) NOT NULL,
  supportingPresenceEventId VARCHAR(36) NULL,
  replacementTargetId VARCHAR(64) NULL,
  note VARCHAR(512) NULL,
  payloadJson JSON NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_goldline_campaign_target_events_run (tenantId,campaignRunId,kind),
  KEY idx_goldline_campaign_target_events_target (campaignRunId,targetId)
);
