-- JOYSTICK accounts: a person who signed up with Google, before any workspace exists (server/joystickAccount).
--
-- An account is not a `users` row: a users row is a workspace identity (it defaults to tenant 'default'), and a person
-- who has only signed up has no workspace yet. The account has its own session cookie, which reaches nothing but
-- their own first-ten journeys. Once they activate a workspace, signing in with Google opens it.
--
--   joystick_accounts           one per Google account (`google_sub`); the funnel timestamps are counts, no content
--   joystick_account_journeys   which first-ten journeys belong to which account
--
-- Applied by scripts/migrate.mjs; idempotent (CREATE TABLE IF NOT EXISTS). Nothing existing is altered.
CREATE TABLE IF NOT EXISTS `joystick_accounts` (
  `id` varchar(36) NOT NULL,
  `google_sub` varchar(255) NOT NULL,
  `email` varchar(320) NOT NULL,
  `name` varchar(255) NULL,
  `given_name` varchar(255) NULL,
  `session_version` int NOT NULL DEFAULT 1,
  `preview_version` varchar(32) NULL,
  `signed_up_at` timestamp(3) NOT NULL,
  `last_signed_in_at` timestamp(3) NULL,
  `google_connected_at` timestamp(3) NULL,
  `first_lines_at` timestamp(3) NULL,
  `portrait_kept_at` timestamp(3) NULL,
  `activated_at` timestamp(3) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_joystick_accounts_google_sub` (`google_sub`)
);

CREATE TABLE IF NOT EXISTS `joystick_account_journeys` (
  `journey_id` varchar(36) NOT NULL,
  `account_id` varchar(36) NOT NULL,
  `acquisition_session_id` varchar(36) NOT NULL,
  `created_at` timestamp(3) NOT NULL,
  PRIMARY KEY (`journey_id`),
  KEY `idx_joystick_account_journeys_account` (`account_id`, `created_at`),
  KEY `idx_joystick_account_journeys_session` (`acquisition_session_id`)
);
