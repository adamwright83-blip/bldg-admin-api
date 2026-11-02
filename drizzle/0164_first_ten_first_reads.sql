-- JOYSTICK's first ten minutes: the first read. A few lines about the person, from their own mail and files, shown
-- within about a minute of connecting Google and before Claire is named (server/firstTenMinutes/firstRead). One row
-- per journey. Only the lines that passed every check are kept for the screen; what the reading concluded and what
-- public research verified are kept beside them, with their sources, for later. Behind JOYSTICK_FIRST_READ_REVEAL.
-- Applied by scripts/migrate.mjs; idempotent (CREATE TABLE IF NOT EXISTS). Nothing existing is altered.
CREATE TABLE IF NOT EXISTS `first_ten_first_reads` (
  `journey_id` varchar(36) NOT NULL,
  `status` varchar(16) NOT NULL,
  `started_at` timestamp(3) NOT NULL,
  `reveal_json` json NULL,
  `understanding_json` json NULL,
  `public_json` json NULL,
  `timings_json` json NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`journey_id`)
);
