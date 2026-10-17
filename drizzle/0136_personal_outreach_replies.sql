-- Operator-reported customer reply from the operator's personal SMS thread.
-- Provenance is always operator_reported (never a carrier webhook receipt).
-- Recording a reply does not mark a paid order or complete the recovery objective.
CREATE TABLE IF NOT EXISTS `personal_outreach_replies` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `operator_id` varchar(64) NOT NULL,
  `customer_id` varchar(128) NOT NULL,
  `customer_name` varchar(255) NOT NULL,
  `message_id` varchar(64) NULL,
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
  KEY `idx_por_scope` (`tenant_id`, `operator_id`, `customer_id`, `reported_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
