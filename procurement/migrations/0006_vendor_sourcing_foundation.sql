CREATE TABLE IF NOT EXISTS `vendor_source_registry` (
  `source_type` varchar(100) NOT NULL,
  `compliance_class` enum('operator_curated','public_directory','permitted_public') NOT NULL,
  `allowed_use_flags_json` json NOT NULL,
  `prohibited_use_flags_json` json NOT NULL,
  `source_policy_json` json NOT NULL,
  `notes` text NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`source_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
INSERT INTO `vendor_source_registry`
  (`source_type`,`compliance_class`,`allowed_use_flags_json`,`prohibited_use_flags_json`,`source_policy_json`,`notes`)
VALUES
  (
    'manual_operator_list',
    'operator_curated',
    JSON_OBJECT('candidate_discovery', true, 'public_evidence_capture', false),
    JSON_OBJECT('login_bypass', true, 'tos_violating_access', true, 'hidden_bulk_scraping', true, 'purchased_lead_lists', true),
    JSON_OBJECT('operator_supplied_only', true, 'publicly_accessible_only', false, 'automated_fetch_allowed', false),
    'Candidate details supplied directly by an authorized operator.'
  ),
  (
    'public_business_directory',
    'public_directory',
    JSON_OBJECT('candidate_discovery', true, 'public_evidence_capture', true),
    JSON_OBJECT('login_bypass', true, 'tos_violating_access', true, 'hidden_bulk_scraping', true, 'purchased_lead_lists', true),
    JSON_OBJECT('operator_supplied_only', false, 'publicly_accessible_only', true, 'automated_fetch_allowed', false),
    'Public business-directory evidence may be recorded without automated collection.'
  ),
  (
    'permitted_public_fetch',
    'permitted_public',
    JSON_OBJECT('candidate_discovery', true, 'public_evidence_capture', true),
    JSON_OBJECT('login_bypass', true, 'tos_violating_access', true, 'hidden_bulk_scraping', true, 'purchased_lead_lists', true),
    JSON_OBJECT('operator_supplied_only', false, 'publicly_accessible_only', true, 'automated_fetch_allowed', true, 'permission_required', true),
    'Public evidence capture is allowed only when the fetch is explicitly permitted.'
  )
ON DUPLICATE KEY UPDATE `source_type` = VALUES(`source_type`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vendor_sourcing_candidates` (
  `id` char(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'default',
  `building_slug` varchar(100) NULL,
  `source_type` varchar(100) NOT NULL,
  `source_reference` varchar(2048) NOT NULL,
  `category` varchar(100) NOT NULL,
  `business_name` varchar(255) NOT NULL,
  `contact_json` json NULL,
  `public_profile_json` json NULL,
  `pricing_signals_json` json NULL,
  `evidence_json` json NOT NULL,
  `source_compliance_snapshot_json` json NOT NULL,
  `sourcing_status` enum('discovered','enriched','pending_scoring','pending_operator_review','approved_for_outreach','rejected','archived') NOT NULL DEFAULT 'discovered',
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_sourcing_candidates_tenant_status` (`tenant_id`,`sourcing_status`,`created_at`),
  KEY `idx_vendor_sourcing_candidates_building_category` (`building_slug`,`category`,`sourcing_status`),
  KEY `idx_vendor_sourcing_candidates_source` (`source_type`,`created_at`),
  CONSTRAINT `fk_vendor_sourcing_candidates_source` FOREIGN KEY (`source_type`)
    REFERENCES `vendor_source_registry` (`source_type`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
