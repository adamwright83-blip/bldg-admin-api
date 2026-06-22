CREATE TABLE IF NOT EXISTS `resident_proposal_consents` (
  `id` char(36) NOT NULL,
  `proposal_version_id` char(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `bldg_user_id` int NOT NULL,
  `consent_action` enum('approve_held_to_try_to_book') NOT NULL,
  `copy_version` varchar(32) NOT NULL,
  `proposal_version_snapshot_hash` char(64) NOT NULL,
  `audit_metadata_json` json NOT NULL,
  `created_by` varchar(191) NOT NULL,
  `consented_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_resident_proposal_consents_version_tenant_user` (`proposal_version_id`,`tenant_id`,`bldg_user_id`),
  KEY `idx_resident_proposal_consents_tenant_user` (`tenant_id`,`bldg_user_id`,`consented_at`),
  CONSTRAINT `fk_resident_proposal_consents_version` FOREIGN KEY (`proposal_version_id`)
    REFERENCES `vendor_proposal_versions` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
