CREATE TABLE IF NOT EXISTS `vendor_reputation_evidence_snapshots` (
  `id` char(36) NOT NULL,
  `candidate_id` char(36) NOT NULL,
  `source_type` varchar(100) NOT NULL,
  `source_key` varchar(191) NOT NULL,
  `evidence_status` enum('recorded','usable','quarantined','rejected') NOT NULL DEFAULT 'recorded',
  `rating` decimal(3,2) NULL,
  `rating_scale_min` decimal(3,2) NOT NULL DEFAULT 0.00,
  `rating_scale_max` decimal(3,2) NOT NULL DEFAULT 5.00,
  `review_count` int unsigned NULL,
  `source_confidence` enum('trusted','medium','low','untrusted') NOT NULL,
  `source_approved` boolean NOT NULL DEFAULT false,
  `observed_at` timestamp(3) NOT NULL,
  `expires_at` timestamp(3) NOT NULL,
  `source_url` varchar(2048) NULL,
  `evidence_payload_json` json NOT NULL,
  `compliance_snapshot_json` json NOT NULL,
  `recorded_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_reputation_evidence_candidate_status` (`candidate_id`,`evidence_status`,`created_at`),
  KEY `idx_vendor_reputation_evidence_source_key_status` (`source_key`,`evidence_status`,`created_at`),
  KEY `idx_vendor_reputation_evidence_source_type_status` (`source_type`,`evidence_status`,`created_at`),
  KEY `idx_vendor_reputation_evidence_expires_at` (`expires_at`),
  CONSTRAINT `fk_vendor_reputation_evidence_candidate` FOREIGN KEY (`candidate_id`)
    REFERENCES `vendor_sourcing_candidates` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_reputation_evidence_source_type` FOREIGN KEY (`source_type`)
    REFERENCES `vendor_source_registry` (`source_type`) ON DELETE RESTRICT,
  CONSTRAINT `chk_vendor_reputation_evidence_rating_scale` CHECK (
    `rating` IS NULL OR (`rating` >= `rating_scale_min` AND `rating` <= `rating_scale_max`)
  ),
  CONSTRAINT `chk_vendor_reputation_evidence_review_count` CHECK (
    `review_count` IS NULL OR `review_count` >= 0
  ),
  CONSTRAINT `chk_vendor_reputation_evidence_expiry_order` CHECK (
    `expires_at` > `observed_at`
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
