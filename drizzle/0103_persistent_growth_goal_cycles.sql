-- Persistent Growth Operator PR2 — Macro Goal Run + Durable Goal Cycles.
-- Slices A + B only. No background authority is granted by these tables.

CREATE TABLE IF NOT EXISTS macro_goal_runs (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  canonicalOperatorId VARCHAR(191) NOT NULL,
  operatorUserId VARCHAR(128) NOT NULL,
  macroGoalId VARCHAR(36) NOT NULL,
  verticalKey VARCHAR(64) NOT NULL,
  status ENUM('active','paused','completed','superseded') NOT NULL DEFAULT 'active',
  goalSnapshotJson JSON NOT NULL,
  metricKey VARCHAR(64) NOT NULL,
  targetValue DECIMAL(15,2) NOT NULL,
  unit VARCHAR(64) NOT NULL,
  baselineObservationRef VARCHAR(191) NULL,
  baselineValue DECIMAL(15,2) NULL,
  baselinePrecision VARCHAR(32) NOT NULL,
  baselineCoverage VARCHAR(32) NOT NULL,
  startedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lastEvaluatedAt TIMESTAMP(3) NULL,
  nextEvaluationAt TIMESTAMP(3) NULL,
  policyVersion VARCHAR(96) NOT NULL,
  completedAt TIMESTAMP(3) NULL,
  completionEvidenceRef VARCHAR(191) NULL,
  createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_macro_goal_runs_tenant_goal (tenantId, macroGoalId),
  KEY idx_macro_goal_runs_operator_status (tenantId, canonicalOperatorId, status, updatedAt),
  KEY idx_macro_goal_runs_due (tenantId, status, nextEvaluationAt)
);

CREATE TABLE IF NOT EXISTS goal_cycle_tenant_state (
  tenantId VARCHAR(64) NOT NULL PRIMARY KEY,
  lastClaimedAt TIMESTAMP(3) NULL,
  createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS goal_cycle_requests (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  goalRunId VARCHAR(36) NOT NULL,
  triggerType ENUM(
    'goal_activated',
    'scheduled_tick',
    'business_event',
    'action_result',
    'human_result',
    'source_freshness_changed',
    'week_locked',
    'manual_replan'
  ) NOT NULL,
  triggerSourceReference VARCHAR(191) NULL,
  idempotencyKey VARCHAR(191) NOT NULL,
  status ENUM('queued','leased','running','retry_scheduled','completed','dead_letter','cancelled') NOT NULL DEFAULT 'queued',
  availableAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  deadlineAt TIMESTAMP(3) NULL,
  leaseOwner VARCHAR(191) NULL,
  leaseExpiresAt TIMESTAMP(3) NULL,
  heartbeatAt TIMESTAMP(3) NULL,
  attemptCount INT NOT NULL DEFAULT 0,
  maxAttempts INT NOT NULL DEFAULT 5,
  lastError TEXT NULL,
  resultJson JSON NULL,
  completedAt TIMESTAMP(3) NULL,
  createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_goal_cycle_requests_tenant_idempotency (tenantId, idempotencyKey),
  KEY idx_goal_cycle_requests_claim (status, availableAt, leaseExpiresAt),
  KEY idx_goal_cycle_requests_tenant_claim (tenantId, status, availableAt, leaseExpiresAt),
  KEY idx_goal_cycle_requests_run (tenantId, goalRunId, createdAt)
);

CREATE TABLE IF NOT EXISTS goal_cycle_history (
  id INT AUTO_INCREMENT NOT NULL PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  goalRunId VARCHAR(36) NOT NULL,
  requestId VARCHAR(36) NOT NULL,
  eventType VARCHAR(64) NOT NULL,
  fromStatus VARCHAR(32) NULL,
  toStatus VARCHAR(32) NULL,
  leaseOwner VARCHAR(191) NULL,
  attemptNumber INT NULL,
  detailsJson JSON NULL,
  errorText TEXT NULL,
  createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_goal_cycle_history_request (tenantId, requestId, id),
  KEY idx_goal_cycle_history_run (tenantId, goalRunId, id)
);

CREATE TABLE IF NOT EXISTS goal_cycle_dead_letters (
  id INT AUTO_INCREMENT NOT NULL PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  goalRunId VARCHAR(36) NOT NULL,
  requestId VARCHAR(36) NOT NULL,
  reason VARCHAR(64) NOT NULL,
  errorText TEXT NULL,
  attemptCount INT NOT NULL,
  triggerType VARCHAR(64) NOT NULL,
  triggerSourceReference VARCHAR(191) NULL,
  deadLetteredAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_goal_cycle_dead_letters_request (tenantId, requestId),
  KEY idx_goal_cycle_dead_letters_run (tenantId, goalRunId, deadLetteredAt)
);
