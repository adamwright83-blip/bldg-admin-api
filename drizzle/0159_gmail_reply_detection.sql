-- Gmail reply detection: which mailboxes JOYSTICK watches (Gmail users.watch + Cloud Pub/Sub), the push notices it
-- received (deduplicated by Pub/Sub message id), and the inbound messages it recorded in conversations it tracks.
-- A notice says only that a mailbox changed; a reply is recorded only after its message was fetched from Gmail and
-- matched to a tracked conversation. Nothing about mail outside a tracked conversation is stored.
-- Applied by scripts/migrate.mjs; idempotent (CREATE TABLE IF NOT EXISTS). Nothing existing is altered.
CREATE TABLE IF NOT EXISTS `gmail_mailbox_watches` (
  `mailbox_key` varchar(191) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `source` varchar(32) NOT NULL,
  `account_email` varchar(320) NOT NULL,
  `history_id` varchar(32) NULL,
  `status` varchar(24) NOT NULL,
  `status_reason` varchar(255) NULL,
  `watch_expires_at` timestamp NULL,
  `last_watch_at` timestamp NULL,
  `last_notice_at` timestamp NULL,
  `last_processed_at` timestamp NULL,
  `processing_until` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`mailbox_key`),
  KEY `idx_gmail_mailbox_watches_email` (`account_email`),
  KEY `idx_gmail_mailbox_watches_tenant` (`tenant_id`)
);
CREATE TABLE IF NOT EXISTS `gmail_push_notices` (
  `pubsub_message_id` varchar(191) NOT NULL,
  `account_email` varchar(320) NOT NULL,
  `history_id` varchar(32) NOT NULL,
  `received_at` timestamp NOT NULL,
  `processed_at` timestamp NULL,
  `outcome` varchar(48) NULL,
  `attempts` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`pubsub_message_id`),
  KEY `idx_gmail_push_notices_pending` (`processed_at`, `received_at`)
);
CREATE TABLE IF NOT EXISTS `gmail_inbound_messages` (
  `mailbox_key` varchar(191) NOT NULL,
  `gmail_message_id` varchar(191) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `gmail_thread_id` varchar(191) NOT NULL,
  `kind` varchar(24) NOT NULL,
  `from_address` varchar(320) NOT NULL,
  `subject` varchar(500) NOT NULL,
  `snippet` varchar(500) NOT NULL,
  `received_at` timestamp NOT NULL,
  `conversation_kind` varchar(32) NOT NULL,
  `conversation_ref` varchar(191) NOT NULL,
  `effects_applied_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`mailbox_key`, `gmail_message_id`),
  KEY `idx_gmail_inbound_tenant_received` (`tenant_id`, `received_at`),
  KEY `idx_gmail_inbound_conversation` (`conversation_kind`, `conversation_ref`)
);
