CREATE TABLE IF NOT EXISTS `vendor_sourcing_candidate_scores` (
  `id` char(36) NOT NULL,
  `candidate_id` char(36) NOT NULL,
  `workflow_id` bigint unsigned NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'default',
  `score_version` varchar(64) NOT NULL,
  `score_status` enum('draft','scored','needs_operator_review','rejected') NOT NULL DEFAULT 'draft',
  `category_match_score` tinyint unsigned NOT NULL,
  `geographic_fit_score` tinyint unsigned NOT NULL,
  `contactability_score` tinyint unsigned NOT NULL,
  `pricing_signal_score` tinyint unsigned NOT NULL,
  `booking_signal_score` tinyint unsigned NOT NULL,
  `review_signal_score` tinyint unsigned NOT NULL,
  `overall_score` tinyint unsigned NOT NULL,
  `decision` enum('pass_to_operator_review','reject','needs_more_evidence') NOT NULL,
  `decision_reasons_json` json NOT NULL,
  `score_inputs_snapshot_json` json NOT NULL,
  `score_evidence_json` json NOT NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_candidate_scores_version` (`candidate_id`,`score_version`,`created_at`),
  KEY `idx_vendor_candidate_scores_tenant_status` (`tenant_id`,`score_status`,`created_at`),
  KEY `idx_vendor_candidate_scores_workflow` (`workflow_id`,`created_at`),
  CONSTRAINT `fk_vendor_candidate_scores_candidate` FOREIGN KEY (`candidate_id`)
    REFERENCES `vendor_sourcing_candidates` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_candidate_scores_workflow` FOREIGN KEY (`workflow_id`)
    REFERENCES `procurement_workflows` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_vendor_candidate_scores_overall` CHECK (`overall_score` <= 100),
  CONSTRAINT `chk_vendor_candidate_scores_components` CHECK (
    `category_match_score` <= 25
    AND `geographic_fit_score` <= 20
    AND `contactability_score` <= 15
    AND `pricing_signal_score` <= 15
    AND `booking_signal_score` <= 15
    AND `review_signal_score` <= 10
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
