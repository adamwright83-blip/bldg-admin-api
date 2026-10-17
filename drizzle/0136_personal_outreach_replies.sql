-- Messaging evidence events for personal-number and provider-connected outreach.
-- Every event carries a distinct source (`provider_webhook`, `device_observed`, `operator_reported`),
-- direction (`outbound`, `inbound`), tenant, operator, matched customer (or raw phone if unmatched),
-- provider message id, observed_at, and body.
-- Recording an event never marks a paid order or completes the recovery objective.
CREATE TABLE IF NOT EXISTS `personal_outreach_replies` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `operator_id` varchar(64) NOT NULL,
  `customer_id` varchar(128) NULL,
  `customer_name` varchar(255) NOT NULL,
  `raw_phone` varchar(32) NULL,
  `direction` varchar(16) NOT NULL DEFAULT 'inbound',
  `source` varchar(40) NOT NULL DEFAULT 'operator_reported',
  `provider_message_id` varchar(128) NULL,
  `message_id` varchar(128) NULL,
  `territory_id` varchar(64) NULL,
  `reply_text` text NOT NULL,
  `classification` varchar(40) NOT NULL,
  `next_step_kind` varchar(64) NOT NULL,
  `next_action` text NOT NULL,
  `prepared_follow_up_draft` text NULL,
  `permission_effect` varchar(40) NOT NULL DEFAULT 'none',
  `provenance` varchar(40) NOT NULL DEFAULT 'operator_reported',
  `surface` varchar(32) NOT NULL DEFAULT 'cozy_composer',
  `reported_at` timestamp NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_por_scope` (`tenant_id`, `operator_id`, `customer_id`, `reported_at`),
  KEY `idx_por_direction_source` (`tenant_id`, `operator_id`, `direction`, `source`, `reported_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
