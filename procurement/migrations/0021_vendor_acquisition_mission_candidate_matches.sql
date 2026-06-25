CREATE TABLE IF NOT EXISTS `vendor_acquisition_mission_candidate_matches` (
  `id` char(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'default',
  `mission_id` char(36) NOT NULL,
  `candidate_id` char(36) NOT NULL,
  `matched_query` text NULL,
  `query_planner_source` enum('anthropic_structured','deterministic_fallback','unknown') NOT NULL DEFAULT 'unknown',
  `service_mode` enum('mobile_required','building_service_required','storefront_ok','unknown') NOT NULL DEFAULT 'unknown',
  `rank_score` decimal(10,4) NULL,
  `rank_position` int NULL,
  `is_shortlisted` tinyint(1) NOT NULL DEFAULT 0,
  `match_evidence_json` json NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vendor_mission_candidate_matches_mission_candidate` (`tenant_id`,`mission_id`,`candidate_id`),
  KEY `idx_vendor_mission_candidate_matches_shortlist` (`tenant_id`,`mission_id`,`is_shortlisted`,`rank_position`),
  KEY `idx_vendor_mission_candidate_matches_candidate` (`tenant_id`,`candidate_id`),
  CONSTRAINT `fk_vendor_mission_candidate_matches_mission` FOREIGN KEY (`mission_id`)
    REFERENCES `vendor_acquisition_missions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_vendor_mission_candidate_matches_candidate` FOREIGN KEY (`candidate_id`)
    REFERENCES `vendor_sourcing_candidates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
