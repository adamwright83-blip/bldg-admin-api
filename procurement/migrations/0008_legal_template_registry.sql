CREATE TABLE IF NOT EXISTS `legal_document_versions` (
  `id` char(36) NOT NULL,
  `document_key` varchar(191) NOT NULL,
  `document_type` enum('vendor_agreement','resident_terms','privacy_policy','operator_policy','other') NOT NULL,
  `version` varchar(64) NOT NULL,
  `status` enum('draft','approved','retired') NOT NULL DEFAULT 'draft',
  `title` varchar(255) NOT NULL,
  `body_template` longtext NOT NULL,
  `body_hash` char(64) NOT NULL,
  `variable_schema_json` json NOT NULL,
  `jurisdiction` varchar(64) NOT NULL,
  `locale` varchar(32) NOT NULL DEFAULT 'en-US',
  `terms_version` varchar(64) NOT NULL,
  `terms_hash` char(64) NOT NULL,
  `approved_by` varchar(191) NULL,
  `approved_at` timestamp(3) NULL,
  `effective_at` timestamp(3) NULL,
  `retired_at` timestamp(3) NULL,
  `evidence_json` json NOT NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_legal_document_key_version` (`document_key`,`version`),
  KEY `idx_legal_document_type_status` (`document_type`,`status`,`effective_at`),
  KEY `idx_legal_document_jurisdiction_locale` (`jurisdiction`,`locale`,`status`),
  CONSTRAINT `chk_legal_document_approval` CHECK (
    (`status` <> 'approved') OR (`approved_by` IS NOT NULL AND `approved_at` IS NOT NULL AND `effective_at` IS NOT NULL)
  ),
  CONSTRAINT `chk_legal_document_retirement` CHECK (
    (`status` <> 'retired') OR (`retired_at` IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `outreach_template_versions` (
  `id` char(36) NOT NULL,
  `template_key` varchar(191) NOT NULL,
  `outreach_channel` enum('email','sms','dm','manual') NOT NULL,
  `template_purpose` enum('vendor_availability_request','vendor_rate_request','vendor_onboarding_invite','operator_note','other') NOT NULL,
  `version` varchar(64) NOT NULL,
  `status` enum('draft','approved','retired') NOT NULL DEFAULT 'draft',
  `subject_template` text NULL,
  `body_template` longtext NOT NULL,
  `body_hash` char(64) NOT NULL,
  `variable_schema_json` json NOT NULL,
  `required_legal_document_key` varchar(191) NULL,
  `required_legal_document_version` varchar(64) NULL,
  `approved_by` varchar(191) NULL,
  `approved_at` timestamp(3) NULL,
  `effective_at` timestamp(3) NULL,
  `retired_at` timestamp(3) NULL,
  `evidence_json` json NOT NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_outreach_template_key_version` (`template_key`,`version`),
  KEY `idx_outreach_template_purpose_status` (`template_purpose`,`status`,`effective_at`),
  KEY `idx_outreach_template_channel_status` (`outreach_channel`,`status`),
  KEY `idx_outreach_template_legal_document` (`required_legal_document_key`,`required_legal_document_version`),
  CONSTRAINT `fk_outreach_template_legal_document` FOREIGN KEY (`required_legal_document_key`,`required_legal_document_version`)
    REFERENCES `legal_document_versions` (`document_key`,`version`) ON DELETE RESTRICT,
  CONSTRAINT `chk_outreach_template_legal_pair` CHECK (
    (`required_legal_document_key` IS NULL AND `required_legal_document_version` IS NULL)
    OR (`required_legal_document_key` IS NOT NULL AND `required_legal_document_version` IS NOT NULL)
  ),
  CONSTRAINT `chk_outreach_template_approval` CHECK (
    (`status` <> 'approved') OR (`approved_by` IS NOT NULL AND `approved_at` IS NOT NULL AND `effective_at` IS NOT NULL)
  ),
  CONSTRAINT `chk_outreach_template_retirement` CHECK (
    (`status` <> 'retired') OR (`retired_at` IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `outreach_template_lint_rules` (
  `rule_key` varchar(191) NOT NULL,
  `rule_type` enum('banned_claim','required_disclosure','variable_required') NOT NULL,
  `severity` enum('block','warn') NOT NULL,
  `pattern_or_claim` text NOT NULL,
  `applies_to_purpose` enum('vendor_availability_request','vendor_rate_request','vendor_onboarding_invite','operator_note','other') NULL,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`rule_key`),
  KEY `idx_outreach_lint_rules_type_status` (`rule_type`,`status`,`severity`),
  KEY `idx_outreach_lint_rules_purpose` (`applies_to_purpose`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
