CREATE TABLE IF NOT EXISTS `vendor_outreach_drafts` (
  `id` char(36) NOT NULL,
  `candidate_id` char(36) NOT NULL,
  `workflow_id` bigint unsigned NOT NULL,
  `score_id` char(36) NULL,
  `template_key` varchar(191) NOT NULL,
  `template_version` varchar(64) NOT NULL,
  `legal_document_key` varchar(191) NULL,
  `legal_document_version` varchar(64) NULL,
  `outreach_channel` enum('email','sms','dm','manual') NOT NULL,
  `draft_status` enum('draft','needs_operator_review','approved_for_manual_send','rejected','archived') NOT NULL DEFAULT 'draft',
  `subject_rendered` text NULL,
  `body_rendered` longtext NOT NULL,
  `body_hash` char(64) NOT NULL,
  `render_variables_json` json NOT NULL,
  `lint_result_json` json NOT NULL,
  `operator_gate_id` bigint unsigned NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_outreach_drafts_candidate_status` (`candidate_id`,`draft_status`,`created_at`),
  KEY `idx_vendor_outreach_drafts_workflow` (`workflow_id`,`created_at`),
  KEY `idx_vendor_outreach_drafts_template` (`template_key`,`template_version`),
  KEY `idx_vendor_outreach_drafts_legal` (`legal_document_key`,`legal_document_version`),
  KEY `idx_vendor_outreach_drafts_gate` (`operator_gate_id`),
  CONSTRAINT `fk_vendor_outreach_drafts_candidate` FOREIGN KEY (`candidate_id`)
    REFERENCES `vendor_sourcing_candidates` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_outreach_drafts_workflow` FOREIGN KEY (`workflow_id`)
    REFERENCES `procurement_workflows` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_outreach_drafts_score` FOREIGN KEY (`score_id`)
    REFERENCES `vendor_sourcing_candidate_scores` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_outreach_drafts_template` FOREIGN KEY (`template_key`,`template_version`)
    REFERENCES `outreach_template_versions` (`template_key`,`version`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_outreach_drafts_legal` FOREIGN KEY (`legal_document_key`,`legal_document_version`)
    REFERENCES `legal_document_versions` (`document_key`,`version`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_outreach_drafts_gate` FOREIGN KEY (`operator_gate_id`)
    REFERENCES `procurement_operator_gates` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_vendor_outreach_drafts_legal_pair` CHECK (
    (`legal_document_key` IS NULL AND `legal_document_version` IS NULL)
    OR (`legal_document_key` IS NOT NULL AND `legal_document_version` IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vendor_outreach_conversation_events` (
  `id` char(36) NOT NULL,
  `candidate_id` char(36) NOT NULL,
  `outreach_draft_id` char(36) NULL,
  `workflow_id` bigint unsigned NOT NULL,
  `direction` enum('inbound','outbound_manual_note') NOT NULL,
  `channel` enum('email','sms','dm','manual','phone','other') NOT NULL,
  `event_status` enum('recorded','needs_review','rejected') NOT NULL DEFAULT 'recorded',
  `occurred_at` timestamp(3) NOT NULL,
  `summary` text NOT NULL,
  `raw_payload_json` json NOT NULL,
  `evidence_json` json NOT NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_outreach_events_candidate_time` (`candidate_id`,`occurred_at`),
  KEY `idx_vendor_outreach_events_draft_time` (`outreach_draft_id`,`occurred_at`),
  KEY `idx_vendor_outreach_events_workflow_status` (`workflow_id`,`event_status`,`created_at`),
  CONSTRAINT `fk_vendor_outreach_events_candidate` FOREIGN KEY (`candidate_id`)
    REFERENCES `vendor_sourcing_candidates` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_outreach_events_draft` FOREIGN KEY (`outreach_draft_id`)
    REFERENCES `vendor_outreach_drafts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_outreach_events_workflow` FOREIGN KEY (`workflow_id`)
    REFERENCES `procurement_workflows` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
