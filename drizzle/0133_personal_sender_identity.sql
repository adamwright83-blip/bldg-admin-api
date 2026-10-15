-- Personal sender identity observations for Lantern City personal-number outreach.
-- Stores handset observations only. No pairing codes, tokens, cookies, or session secrets.
-- Additive and idempotent. Classification is recomputed on read; a stored row is not a send grant.
CREATE TABLE IF NOT EXISTS `personal_sender_identities` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `operator_id` varchar(64) NOT NULL,
  `pairing_present` boolean NOT NULL DEFAULT false,
  `displaces_existing_web_session` boolean NOT NULL DEFAULT false,
  `page_loaded` boolean NOT NULL DEFAULT false,
  `device_online` boolean NOT NULL DEFAULT false,
  `session_observed_at` timestamp NULL,
  `originating_phone` varchar(32) NULL,
  `phone_verified` boolean NOT NULL DEFAULT false,
  `observation_source` varchar(64) NOT NULL,
  `device_id` varchar(128) NULL,
  `expected_device_id` varchar(128) NULL,
  `transport_probe_ok` boolean NOT NULL DEFAULT false,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_psi_tenant_operator` (`tenant_id`, `operator_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
