CREATE TABLE IF NOT EXISTS `authority_grants` (
  `id` char(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'default',
  `bldg_user_id` int NOT NULL,
  `building_slug` varchar(100) NOT NULL,
  `authority_type` enum('guest_readiness') NOT NULL,
  `objective_text` text NOT NULL,
  `budget_cap_cents` int unsigned NOT NULL,
  `deadline_at` timestamp(3) NOT NULL,
  `access_constraints_json` json NOT NULL,
  `sensitivity_constraints_json` json NOT NULL,
  `allowed_risk_categories_json` json NOT NULL,
  `disallowed_categories_json` json NOT NULL,
  `status` enum('draft','signed','active','revoked','expired') NOT NULL DEFAULT 'draft',
  `terms_version` varchar(64) NOT NULL,
  `terms_hash` char(64) NOT NULL,
  `signature_evidence_json` json NULL,
  `signed_at` timestamp(3) NULL,
  `expires_at` timestamp(3) NOT NULL,
  `revoked_at` timestamp(3) NULL,
  `revoked_by` varchar(191) NULL,
  `revoke_reason` text NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_authority_grants_resident_status` (`tenant_id`,`bldg_user_id`,`status`),
  KEY `idx_authority_grants_building_status` (`building_slug`,`status`),
  KEY `idx_authority_grants_expiry` (`status`,`expires_at`),
  CONSTRAINT `chk_authority_budget_nonnegative` CHECK (`budget_cap_cents` >= 0),
  CONSTRAINT `chk_authority_expiry_before_deadline` CHECK (`expires_at` <= `deadline_at`),
  CONSTRAINT `chk_authority_revocation_complete` CHECK (
    (`status` <> 'revoked') OR (`revoked_at` IS NOT NULL AND `revoked_by` IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `authority_grant_audit` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `authority_grant_id` char(36) NOT NULL,
  `event_type` enum(
    'created','signed','activated','revoked','expired',
    'policy_check_performed','attempted_use_denied','attempted_use_allowed'
  ) NOT NULL,
  `actor_type` enum('resident','operator','system','policy') NOT NULL,
  `actor_id` varchar(191) NULL,
  `event_data_json` json NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_authority_audit_grant_time` (`authority_grant_id`,`created_at`,`id`),
  KEY `idx_authority_audit_event_time` (`event_type`,`created_at`),
  CONSTRAINT `fk_authority_audit_grant` FOREIGN KEY (`authority_grant_id`)
    REFERENCES `authority_grants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
