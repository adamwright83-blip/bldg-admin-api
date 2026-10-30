-- JOYSTICK's first ten minutes, slice 4: Claire's portrait of the person's working life. One per journey, written from
-- the findings still standing (each line cites them), and written again only while the person hasn't kept it and
-- what it rests on has changed. The person's own words in place of a line are kept beside it, never over it.
-- Applied by scripts/migrate.mjs; idempotent (CREATE TABLE IF NOT EXISTS). Nothing existing is altered.
CREATE TABLE IF NOT EXISTS `first_ten_portraits` (
  `journey_id` varchar(36) NOT NULL,
  `run_id` varchar(36) NOT NULL,
  `status` varchar(16) NOT NULL,
  `basis` varchar(64) NOT NULL,
  `portrait_json` json NULL,
  `edits_json` json NULL,
  `written_by` varchar(16) NULL,
  `lease_until` timestamp NULL,
  `kept_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`journey_id`)
);
