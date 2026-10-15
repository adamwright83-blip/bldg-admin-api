-- Scheduled outreach messages and revisions (PR #583: Android personal-number outreach system).
CREATE TABLE IF NOT EXISTS `scheduled_outreach_messages` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `customer_id` varchar(128) NOT NULL,
  `customer_name` varchar(255) NOT NULL,
  `recipient_phone` varchar(32) NOT NULL,
  `sender_phone` varchar(32) NULL,
  `original_suggested_draft` text NOT NULL,
  `current_message_body` text NOT NULL,
  `revision_count` int NOT NULL DEFAULT 1,
  `scheduled_for` timestamp NOT NULL,
  `timezone` varchar(64) NOT NULL DEFAULT 'America/Los_Angeles',
  `status` enum('pending','claimed','dispatched','cancelled','failed','awaiting_sender_setup') NOT NULL DEFAULT 'pending',
  `lease_holder` varchar(64) NULL,
  `leased_until` timestamp NULL,
  `dispatch_attempted_at` timestamp NULL,
  `dispatched_at` timestamp NULL,
  `cancelled_at` timestamp NULL,
  `cancellation_reason` text NULL,
  `failure_reason` text NULL,
  `external_message_id` varchar(128) NULL,
  `slot_id` varchar(32) NULL,
  `territory_id` varchar(64) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_som_tenant_customer_status` (`tenant_id`, `customer_id`, `status`),
  INDEX `idx_som_tenant_sched_status` (`tenant_id`, `status`, `scheduled_for`),
  INDEX `idx_som_lease` (`status`, `leased_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `scheduled_outreach_revisions` (
  `id` varchar(64) NOT NULL,
  `outreach_message_id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `revision_number` int NOT NULL,
  `message_body` text NOT NULL,
  `edited_by` varchar(128) NOT NULL,
  `reason` varchar(255) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_sor_message_revision` (`outreach_message_id`, `revision_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
