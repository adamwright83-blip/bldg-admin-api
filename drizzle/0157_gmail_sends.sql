-- Gmail sends: one row per message JOYSTICK sends from a person's own Gmail (users.messages.send), keyed by the caller's
-- idempotency key so a retry, a reload or a replay never sends twice. Status is what Google showed, never assumed:
-- `sent` only with Google's message id; `unknown` when the answer was lost, until the Sent folder settles it.
-- Applied by scripts/migrate.mjs; idempotent (CREATE TABLE IF NOT EXISTS). Nothing existing is altered.
CREATE TABLE IF NOT EXISTS `gmail_sends` (
  `send_key` varchar(191) NOT NULL,
  `actor` varchar(64) NOT NULL,
  `account_email` varchar(320) NOT NULL,
  `recipient` varchar(320) NOT NULL,
  `subject` varchar(500) NOT NULL,
  `approval_digest` char(64) NOT NULL,
  `approved_by` varchar(191) NOT NULL,
  `approved_at` timestamp NOT NULL,
  `rfc822_message_id` varchar(191) NOT NULL,
  `status` varchar(16) NOT NULL,
  `gmail_message_id` varchar(191) NULL,
  `gmail_thread_id` varchar(191) NULL,
  `attempts` int NOT NULL DEFAULT 1,
  `last_attempt_at` timestamp NOT NULL,
  `sent_at` timestamp NULL,
  `failure` varchar(255) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`send_key`)
);
