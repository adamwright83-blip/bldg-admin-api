CREATE TABLE IF NOT EXISTS `post_consent_action_plans` (
  `id` char(36) NOT NULL,
  `consent_id` char(36) NOT NULL,
  `proposal_version_id` char(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `bldg_user_id` int NOT NULL,
  `status` enum('draft_vendor_outreach','needs_resident_clarification','needs_operator_review','blocked_expired','blocked_missing_vendor_contact','blocked_terms_changed','blocked_unsafe_to_contact') NOT NULL,
  `reasons_json` json NOT NULL,
  `eligible_for_auto_send_pilot` tinyint(1) NOT NULL DEFAULT 0,
  `proposal_version_snapshot_hash` char(64) NOT NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_post_consent_action_plans_consent` (`consent_id`),
  KEY `idx_post_consent_action_plans_tenant_user` (`tenant_id`,`bldg_user_id`,`created_at`),
  CONSTRAINT `fk_post_consent_action_plans_consent` FOREIGN KEY (`consent_id`)
    REFERENCES `resident_proposal_consents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_post_consent_action_plans_version` FOREIGN KEY (`proposal_version_id`)
    REFERENCES `vendor_proposal_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `post_consent_outreach_drafts` (
  `id` char(36) NOT NULL,
  `plan_id` char(36) NOT NULL,
  `consent_id` char(36) NOT NULL,
  `proposal_version_id` char(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `bldg_user_id` int NOT NULL,
  `vendor_candidate_id` char(36) NOT NULL,
  `service_category` varchar(100) NULL,
  `template_key` varchar(191) NOT NULL,
  `template_version` varchar(64) NOT NULL,
  `subject_rendered` text NULL,
  `draft_body` longtext NOT NULL,
  `draft_body_hash` char(64) NOT NULL,
  `variables_json` json NOT NULL,
  `lint_result_json` json NOT NULL,
  `founder_escalation_present` tinyint(1) NOT NULL DEFAULT 0,
  `status` enum('drafted','blocked','stale','superseded') NOT NULL DEFAULT 'drafted',
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_post_consent_outreach_drafts_plan` (`plan_id`),
  KEY `idx_post_consent_outreach_drafts_tenant_user` (`tenant_id`,`bldg_user_id`,`created_at`),
  KEY `idx_post_consent_outreach_drafts_candidate` (`vendor_candidate_id`),
  CONSTRAINT `fk_post_consent_outreach_drafts_plan` FOREIGN KEY (`plan_id`)
    REFERENCES `post_consent_action_plans` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_post_consent_outreach_drafts_consent` FOREIGN KEY (`consent_id`)
    REFERENCES `resident_proposal_consents` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_post_consent_outreach_drafts_version` FOREIGN KEY (`proposal_version_id`)
    REFERENCES `vendor_proposal_versions` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_post_consent_outreach_drafts_candidate` FOREIGN KEY (`vendor_candidate_id`)
    REFERENCES `vendor_sourcing_candidates` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
