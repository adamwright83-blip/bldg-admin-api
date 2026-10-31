-- Claire routines: recurring checks an operator asks for in their own words ("Every Monday morning, tell me who I'm
-- waiting to hear back from"), and the history of every run. A routine only reads and reports: nothing is sent,
-- labelled or changed outside JOYSTICK. One run per routine per period: (routine_id, period_key) is unique, so two
-- workers never run the same occurrence twice.
-- Applied by scripts/migrate.mjs; idempotent (CREATE TABLE IF NOT EXISTS). Nothing existing is altered.
CREATE TABLE IF NOT EXISTS `claire_routines` (
  `id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `operator_open_id` varchar(64) NOT NULL,
  `kind` varchar(32) NOT NULL,
  `instruction` varchar(500) NOT NULL,
  `cadence` varchar(16) NOT NULL,
  `weekday` int NULL,
  `local_time` varchar(5) NOT NULL,
  `time_zone` varchar(64) NOT NULL,
  `status` varchar(16) NOT NULL,
  `next_run_at` timestamp NULL,
  `last_run_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_claire_routines_due` (`status`, `next_run_at`),
  KEY `idx_claire_routines_tenant` (`tenant_id`)
);
CREATE TABLE IF NOT EXISTS `claire_routine_runs` (
  `id` varchar(36) NOT NULL,
  `routine_id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `period_key` varchar(40) NOT NULL,
  `trigger` varchar(16) NOT NULL,
  `status` varchar(16) NOT NULL,
  `attempts` int NOT NULL DEFAULT 0,
  `started_at` timestamp NOT NULL,
  `finished_at` timestamp NULL,
  `findings_json` json NULL,
  `summary` varchar(1000) NULL,
  `error` varchar(1000) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_claire_routine_runs_period` (`routine_id`, `period_key`),
  KEY `idx_claire_routine_runs_routine` (`routine_id`, `started_at`),
  KEY `idx_claire_routine_runs_tenant` (`tenant_id`, `finished_at`)
);
