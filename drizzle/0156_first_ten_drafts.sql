-- JOYSTICK's first ten minutes, slice 5: the real message prepared at the writing table, one per journey, composed
-- only from findings with sources. A draft is never sent from here: what happens to it later (handed to the person's
-- own mail, reported sent, seen in their Sent folder) is recorded in its own columns, never assumed.
-- Applied by scripts/migrate.mjs; idempotent (CREATE TABLE IF NOT EXISTS). Nothing existing is altered.
CREATE TABLE IF NOT EXISTS `first_ten_drafts` (
  `journey_id` varchar(36) NOT NULL,
  `opportunity_id` varchar(36) NOT NULL,
  `recipient_name` varchar(255) NULL,
  `recipient_address` varchar(320) NOT NULL,
  `subject` varchar(500) NOT NULL,
  `body` text NOT NULL,
  `approach` varchar(32) NOT NULL,
  `edited` tinyint(1) NOT NULL DEFAULT 0,
  `status` varchar(24) NOT NULL,
  `handed_off_at` timestamp NULL,
  `reported_sent_at` timestamp NULL,
  `verified_sent_at` timestamp NULL,
  `verified_message_id` varchar(191) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`journey_id`)
);
