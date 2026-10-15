-- Operator audit that an approved draft was handed to the device SMS composer.
-- Stores tenant, operator, message, and revision only. No recipient, body,
-- pairing secret, token, or unrelated thread. A row does not dispatch the outbox.
CREATE TABLE IF NOT EXISTS `sms_compose_handoff_audits` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `operator_id` varchar(64) NOT NULL,
  `message_id` varchar(64) NOT NULL,
  `revision_count` int NOT NULL,
  `body_digest` varchar(64) NOT NULL,
  `handoff_state` varchar(40) NOT NULL,
  `surface` varchar(32) NOT NULL,
  `invoked_at` timestamp NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_scha_scope` (`tenant_id`, `operator_id`, `message_id`, `revision_count`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
