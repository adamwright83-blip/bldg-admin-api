-- JOYSTICK's first ten minutes (docs/goldline/FIRST_TEN_MINUTES_BUILD.md): one journey per signup draft, and the
-- read-only Google / Slack connections the visitor makes from it. Tokens are stored encrypted (AES-256-GCM).
-- Applied by scripts/migrate.mjs; idempotent (CREATE TABLE IF NOT EXISTS). Nothing existing is altered.
CREATE TABLE IF NOT EXISTS `first_ten_journeys` (
  `id` varchar(36) NOT NULL,
  `acquisition_session_id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NULL,
  `kind` varchar(16) NOT NULL,
  `stage` varchar(32) NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_first_ten_journeys_session` (`acquisition_session_id`),
  KEY `idx_first_ten_journeys_tenant` (`tenant_id`)
);
CREATE TABLE IF NOT EXISTS `first_ten_connections` (
  `id` varchar(36) NOT NULL,
  `journey_id` varchar(36) NOT NULL,
  `provider` varchar(16) NOT NULL,
  `account_label` varchar(320) NULL,
  `account_subject` varchar(191) NULL,
  `granted_scopes` text NOT NULL,
  `encrypted_access_token` text NULL,
  `encrypted_refresh_token` text NULL,
  `access_expires_at` timestamp NULL,
  `status` varchar(16) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_first_ten_connections_provider` (`journey_id`, `provider`)
);
