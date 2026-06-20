CREATE TABLE IF NOT EXISTS `vendor_response_terms` (
  `id` char(36) NOT NULL,
  `workflow_id` bigint unsigned NULL,
  `candidate_id` char(36) NOT NULL,
  `outreach_event_id` char(36) NOT NULL,
  `interpretation_status` enum('interpreted','needs_clarification','unsupported','declined','invalid') NOT NULL,
  `availability_status` enum('available','unavailable','unknown','needs_clarification') NOT NULL DEFAULT 'unknown',
  `rate_status` enum('provided','not_provided','needs_clarification') NOT NULL DEFAULT 'not_provided',
  `quoted_amount` decimal(10,2) NULL,
  `quoted_currency` char(3) NULL,
  `rate_unit` varchar(64) NULL,
  `availability_windows_json` json NOT NULL,
  `constraints_json` json NOT NULL,
  `terms_summary_json` json NOT NULL,
  `confidence` enum('high','medium','low') NOT NULL DEFAULT 'low',
  `observed_at` timestamp(3) NOT NULL,
  `expires_at` timestamp(3) NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_response_terms_workflow` (`workflow_id`),
  KEY `idx_vendor_response_terms_candidate` (`candidate_id`),
  KEY `idx_vendor_response_terms_outreach_event` (`outreach_event_id`),
  KEY `idx_vendor_response_terms_status_observed` (`interpretation_status`,`observed_at`),
  CONSTRAINT `fk_vendor_response_terms_workflow` FOREIGN KEY (`workflow_id`)
    REFERENCES `procurement_workflows` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_response_terms_candidate` FOREIGN KEY (`candidate_id`)
    REFERENCES `vendor_sourcing_candidates` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_response_terms_outreach_event` FOREIGN KEY (`outreach_event_id`)
    REFERENCES `vendor_outreach_conversation_events` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
