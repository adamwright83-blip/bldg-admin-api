-- Persistent Growth Operator PR3 — non-conversational authority + Claire appointments.

CREATE TABLE IF NOT EXISTS tenant_standing_authorizations (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  canonicalOperatorId VARCHAR(191) NOT NULL,
  operatorUserId VARCHAR(128) NOT NULL,
  channel VARCHAR(32) NOT NULL,
  recipientClass VARCHAR(64) NOT NULL,
  exactAction VARCHAR(128) NOT NULL,
  dailyLimit INT NOT NULL DEFAULT 1,
  allowedLocalStart VARCHAR(5) NULL,
  allowedLocalEnd VARCHAR(5) NULL,
  timeZone VARCHAR(64) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  sourceReference VARCHAR(191) NOT NULL,
  authorizedByUserId VARCHAR(128) NOT NULL,
  createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revokedAt TIMESTAMP(3) NULL,
  KEY idx_tenant_standing_authorizations_lookup
    (tenantId, canonicalOperatorId, exactAction, revokedAt),
  UNIQUE KEY uq_tenant_standing_authorizations_version
    (tenantId, canonicalOperatorId, exactAction, version)
);

CREATE TABLE IF NOT EXISTS operator_appointments (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenantId VARCHAR(64) NOT NULL,
  canonicalOperatorId VARCHAR(191) NOT NULL,
  operatorUserId VARCHAR(128) NOT NULL,
  appointmentKind ENUM('sunday_weekly_planning','weekly_planning_callback') NOT NULL,
  weekStart VARCHAR(10) NOT NULL,
  scheduledFor TIMESTAMP(3) NOT NULL,
  timeZone VARCHAR(64) NOT NULL,
  source ENUM('standing_weekly_authorization','explicit_operator_request') NOT NULL,
  sourceReference VARCHAR(191) NOT NULL,
  standingAuthorizationId VARCHAR(36) NULL,
  unprompted BOOLEAN NOT NULL DEFAULT FALSE,
  idempotencyKey VARCHAR(191) NOT NULL,
  status ENUM(
    'scheduled','leased','running','retry_scheduled',
    'completed','missed','cancelled','dead_letter'
  ) NOT NULL DEFAULT 'scheduled',
  leaseOwner VARCHAR(191) NULL,
  leaseExpiresAt TIMESTAMP(3) NULL,
  heartbeatAt TIMESTAMP(3) NULL,
  attemptCount INT NOT NULL DEFAULT 0,
  maxAttempts INT NOT NULL DEFAULT 3,
  callDispatchStartedAt TIMESTAMP(3) NULL,
  callSid VARCHAR(64) NULL,
  calendarEventId VARCHAR(191) NULL,
  calendarStatus VARCHAR(32) NULL,
  followupTextSentAt TIMESTAMP(3) NULL,
  lastError TEXT NULL,
  resultJson JSON NULL,
  completedAt TIMESTAMP(3) NULL,
  createdAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_operator_appointments_tenant_idempotency (tenantId, idempotencyKey),
  UNIQUE KEY uq_operator_appointments_call_sid (callSid),
  KEY idx_operator_appointments_due (status, scheduledFor, leaseExpiresAt),
  KEY idx_operator_appointments_operator_week
    (tenantId, canonicalOperatorId, weekStart, appointmentKind, status)
);
