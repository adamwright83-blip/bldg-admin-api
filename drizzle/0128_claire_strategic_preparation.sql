-- LEGACY DAYFORGE COMPATIBILITY: historical tenant table names remain SQL compatibility, not current product names.
CREATE TABLE IF NOT EXISTS strategic_diagnoses (
 id varchar(64) PRIMARY KEY, tenantId varchar(64) NOT NULL, canonicalOperatorId varchar(191) NOT NULL,
 businessDate varchar(10) NOT NULL, payloadJson json NOT NULL, createdAt timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_strategic_diagnosis_owner (tenantId, canonicalOperatorId, businessDate, createdAt)
);
CREATE TABLE IF NOT EXISTS strategic_planning_proposals (
 id varchar(64) PRIMARY KEY, tenantId varchar(64) NOT NULL, canonicalOperatorId varchar(191) NOT NULL,
 weekStart varchar(10) NOT NULL, revision varchar(64) NOT NULL, payloadJson json NOT NULL,
 createdAt timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_strategic_proposal_owner (tenantId, canonicalOperatorId, weekStart, createdAt)
);
CREATE TABLE IF NOT EXISTS strategic_proposal_responses (
 id varchar(64) PRIMARY KEY, proposalId varchar(64) NOT NULL, tenantId varchar(64) NOT NULL,
 canonicalOperatorId varchar(191) NOT NULL, responseJson json NOT NULL, createdAt timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_strategic_response_proposal (tenantId, proposalId)
);

-- Strategic schema extensions (production boot applies these after existing tables).
SET @claire_strategy_vertical_sql = IF(
 EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'dayforge_saas_tenants' AND COLUMN_NAME = 'strategyVerticalKey'),
 'SELECT 1', 'ALTER TABLE dayforge_saas_tenants ADD COLUMN strategyVerticalKey varchar(64) NULL'
);
PREPARE claire_strategy_vertical_stmt FROM @claire_strategy_vertical_sql;
EXECUTE claire_strategy_vertical_stmt;
DEALLOCATE PREPARE claire_strategy_vertical_stmt;
SET @claire_strategy_weekdays_sql = IF(
 EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'tenant_standing_authorizations' AND COLUMN_NAME = 'allowedWeekdaysJson'),
 'SELECT 1', 'ALTER TABLE tenant_standing_authorizations ADD COLUMN allowedWeekdaysJson json NULL'
);
PREPARE claire_strategy_weekdays_stmt FROM @claire_strategy_weekdays_sql;
EXECUTE claire_strategy_weekdays_stmt;
DEALLOCATE PREPARE claire_strategy_weekdays_stmt;
ALTER TABLE operator_appointments MODIFY COLUMN appointmentKind
 enum('sunday_weekly_planning','weekly_planning_callback','weekday_strategic_planning') NOT NULL;
