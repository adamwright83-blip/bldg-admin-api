-- JOYSTICK's first ten minutes, slice 2: the crew's reading of a journey's connected sources, and what it found.
-- One reading per journey (re-read in place), and findings with their sources: short verbatim quotes, never copies
-- of the person's mail, calendar or files. A finding's id is stable per journey, so a re-read keeps a correction.
-- Applied by scripts/migrate.mjs; idempotent (CREATE TABLE IF NOT EXISTS). Nothing existing is altered.
CREATE TABLE IF NOT EXISTS `first_ten_readings` (
  `journey_id` varchar(36) NOT NULL,
  `run_id` varchar(36) NOT NULL,
  `status` varchar(16) NOT NULL,
  `stage` varchar(24) NULL,
  `finished_json` json NULL,
  `counts_json` json NULL,
  `notes_json` json NULL,
  `lease_until` timestamp NULL,
  `started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` timestamp NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`journey_id`)
);
CREATE TABLE IF NOT EXISTS `first_ten_findings` (
  `id` varchar(36) NOT NULL,
  `journey_id` varchar(36) NOT NULL,
  `run_id` varchar(36) NOT NULL,
  `kind` varchar(24) NOT NULL,
  `companion` varchar(16) NULL,
  `rank` int NOT NULL DEFAULT 0,
  `payload_json` json NOT NULL,
  `sources_json` json NOT NULL,
  `status` varchar(16) NOT NULL,
  `correction_text` text NULL,
  `origin_json` json NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_first_ten_findings_journey` (`journey_id`, `kind`)
);
