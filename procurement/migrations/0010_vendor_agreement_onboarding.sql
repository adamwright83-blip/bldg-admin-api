CREATE TABLE IF NOT EXISTS `vendor_agreements` (
  `id` char(36) NOT NULL,
  `candidate_id` char(36) NOT NULL,
  `workflow_id` bigint unsigned NOT NULL,
  `outreach_draft_id` char(36) NULL,
  `legal_document_key` varchar(191) NOT NULL,
  `legal_document_version` varchar(64) NOT NULL,
  `vendor_agreement_status` enum('draft','pending_vendor_review','signed','revoked','expired','rejected') NOT NULL DEFAULT 'draft',
  `agreement_subject_type` enum('vendor_candidate') NOT NULL,
  `agreement_subject_id` char(36) NOT NULL,
  `signer_name` varchar(255) NULL,
  `signer_email` varchar(320) NULL,
  `terms_version` varchar(64) NOT NULL,
  `terms_hash` char(64) NOT NULL,
  `body_hash` char(64) NOT NULL,
  `rendered_agreement_hash` char(64) NOT NULL,
  `signature_evidence_json` json NULL,
  `signed_at` timestamp(3) NULL,
  `revoked_at` timestamp(3) NULL,
  `expires_at` timestamp(3) NULL,
  `evidence_json` json NOT NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_agreements_candidate_status` (`candidate_id`,`vendor_agreement_status`,`created_at`),
  KEY `idx_vendor_agreements_workflow` (`workflow_id`,`created_at`),
  KEY `idx_vendor_agreements_outreach_draft` (`outreach_draft_id`),
  KEY `idx_vendor_agreements_legal_document` (`legal_document_key`,`legal_document_version`),
  KEY `idx_vendor_agreements_expiry` (`vendor_agreement_status`,`expires_at`),
  CONSTRAINT `fk_vendor_agreements_candidate` FOREIGN KEY (`candidate_id`)
    REFERENCES `vendor_sourcing_candidates` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_agreements_workflow` FOREIGN KEY (`workflow_id`)
    REFERENCES `procurement_workflows` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_agreements_outreach_draft` FOREIGN KEY (`outreach_draft_id`)
    REFERENCES `vendor_outreach_drafts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_agreements_legal_document` FOREIGN KEY (`legal_document_key`,`legal_document_version`)
    REFERENCES `legal_document_versions` (`document_key`,`version`) ON DELETE RESTRICT,
  CONSTRAINT `chk_vendor_agreements_subject` CHECK (
    `agreement_subject_type` = 'vendor_candidate' AND `agreement_subject_id` = `candidate_id`
  ),
  CONSTRAINT `chk_vendor_agreements_signed_evidence` CHECK (
    (`vendor_agreement_status` <> 'signed') OR
    (`signed_at` IS NOT NULL AND `signer_name` IS NOT NULL AND `signature_evidence_json` IS NOT NULL)
  ),
  CONSTRAINT `chk_vendor_agreements_revoked_at` CHECK (
    (`vendor_agreement_status` <> 'revoked') OR (`revoked_at` IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vendor_agreement_events` (
  `id` char(36) NOT NULL,
  `vendor_agreement_id` char(36) NOT NULL,
  `event_type` enum('created','sent_for_manual_review','vendor_question_recorded','signed','revoked','expired','rejected','operator_note') NOT NULL,
  `event_status` enum('recorded','needs_review','rejected') NOT NULL DEFAULT 'recorded',
  `occurred_at` timestamp(3) NOT NULL,
  `actor_type` enum('operator','vendor','system') NOT NULL,
  `actor_identifier` varchar(191) NULL,
  `summary` text NOT NULL,
  `evidence_json` json NOT NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_agreement_events_agreement_time` (`vendor_agreement_id`,`occurred_at`),
  KEY `idx_vendor_agreement_events_type_status` (`event_type`,`event_status`,`created_at`),
  CONSTRAINT `fk_vendor_agreement_events_agreement` FOREIGN KEY (`vendor_agreement_id`)
    REFERENCES `vendor_agreements` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
