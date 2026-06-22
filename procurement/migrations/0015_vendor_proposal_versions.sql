CREATE TABLE IF NOT EXISTS `vendor_proposals` (
  `id` char(36) NOT NULL,
  `workflow_id` bigint unsigned NULL,
  `candidate_id` char(36) NOT NULL,
  `job_card_source_type` enum('service_request','resident_coordinated_request','resident_agent_plan','manual') NOT NULL,
  `job_card_source_id` varchar(191) NOT NULL,
  `proposal_status` enum('draft','under_admin_review','ready_for_resident_presentation','rejected','expired','retired') NOT NULL DEFAULT 'draft',
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_proposals_workflow_status` (`workflow_id`,`proposal_status`,`created_at`),
  KEY `idx_vendor_proposals_candidate_status` (`candidate_id`,`proposal_status`,`created_at`),
  KEY `idx_vendor_proposals_job_card_source` (`job_card_source_type`,`job_card_source_id`),
  CONSTRAINT `fk_vendor_proposals_workflow` FOREIGN KEY (`workflow_id`)
    REFERENCES `procurement_workflows` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_proposals_candidate` FOREIGN KEY (`candidate_id`)
    REFERENCES `vendor_sourcing_candidates` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vendor_proposal_versions` (
  `id` char(36) NOT NULL,
  `proposal_id` char(36) NOT NULL,
  `version` int unsigned NOT NULL,
  `response_terms_id` char(36) NOT NULL,
  `job_card_snapshot_json` json NOT NULL,
  `job_card_snapshot_hash` char(64) NOT NULL,
  `eligibility_decision_json` json NOT NULL,
  `fit_decision_json` json NOT NULL,
  `truth_flags_json` json NOT NULL,
  `resident_truth_inputs_json` json NOT NULL,
  `review_state` enum('draft','needs_operator_review','ready_for_admin_review','rejected','expired','superseded') NOT NULL DEFAULT 'draft',
  `expires_at` timestamp(3) NOT NULL,
  `audit_metadata_json` json NOT NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vendor_proposal_versions_proposal_version` (`proposal_id`,`version`),
  KEY `idx_vendor_proposal_versions_proposal_review` (`proposal_id`,`review_state`,`created_at`),
  KEY `idx_vendor_proposal_versions_terms` (`response_terms_id`),
  KEY `idx_vendor_proposal_versions_expiry` (`expires_at`,`review_state`),
  CONSTRAINT `fk_vendor_proposal_versions_proposal` FOREIGN KEY (`proposal_id`)
    REFERENCES `vendor_proposals` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_vendor_proposal_versions_terms` FOREIGN KEY (`response_terms_id`)
    REFERENCES `vendor_response_terms` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_vendor_proposal_versions_version` CHECK (`version` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vendor_proposal_version_evidence` (
  `proposal_version_id` char(36) NOT NULL,
  `evidence_snapshot_id` char(36) NOT NULL,
  `evidence_role` enum('eligibility','reputation','request_fit') NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`proposal_version_id`,`evidence_snapshot_id`,`evidence_role`),
  KEY `idx_vendor_proposal_version_evidence_snapshot` (`evidence_snapshot_id`,`proposal_version_id`),
  CONSTRAINT `fk_vendor_proposal_version_evidence_version` FOREIGN KEY (`proposal_version_id`)
    REFERENCES `vendor_proposal_versions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_vendor_proposal_version_evidence_snapshot` FOREIGN KEY (`evidence_snapshot_id`)
    REFERENCES `vendor_reputation_evidence_snapshots` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
