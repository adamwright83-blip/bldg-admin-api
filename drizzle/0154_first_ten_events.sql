-- JOYSTICK's first ten minutes, slice 3: what the person decided during their journey, append-only (a rule confirmed,
-- a finding corrected, and in later slices a draft prepared, a message handed off). "Here is what changed because you
-- arrived" and Claire's answers read it. Applied by scripts/migrate.mjs; idempotent. Nothing existing is altered.
CREATE TABLE IF NOT EXISTS `first_ten_events` (
  `id` varchar(36) NOT NULL,
  `journey_id` varchar(36) NOT NULL,
  `kind` varchar(48) NOT NULL,
  `payload_json` json NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_first_ten_events_journey` (`journey_id`, `created_at`)
);
