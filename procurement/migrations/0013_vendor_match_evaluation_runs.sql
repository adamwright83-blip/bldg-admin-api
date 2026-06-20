CREATE TABLE IF NOT EXISTS `vendor_match_evaluation_runs` (
  `id` char(36) NOT NULL,
  `workflow_id` bigint unsigned NULL,
  `evaluation_status` enum('draft','evaluated','needs_operator_review','blocked','cancelled') NOT NULL DEFAULT 'draft',
  `request_context_json` json NOT NULL,
  `preference_request_json` json NOT NULL,
  `evaluation_summary_json` json NOT NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_match_evaluation_runs_workflow_status` (`workflow_id`,`evaluation_status`,`created_at`),
  KEY `idx_vendor_match_evaluation_runs_status_created` (`evaluation_status`,`created_at`),
  CONSTRAINT `fk_vendor_match_evaluation_runs_workflow` FOREIGN KEY (`workflow_id`)
    REFERENCES `procurement_workflows` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vendor_match_evaluation_candidates` (
  `id` char(36) NOT NULL,
  `evaluation_run_id` char(36) NOT NULL,
  `candidate_id` char(36) NOT NULL,
  `evidence_snapshot_id` char(36) NULL,
  `match_status` enum('matched','not_matched','needs_review','blocked') NOT NULL,
  `rank_order` int unsigned NULL,
  `score` decimal(6,3) NULL,
  `decision_reasons_json` json NOT NULL,
  `risk_flags_json` json NOT NULL,
  `evidence_summary_json` json NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vendor_match_evaluation_candidates_run_candidate` (`evaluation_run_id`,`candidate_id`),
  KEY `idx_vendor_match_evaluation_candidates_run_rank` (`evaluation_run_id`,`rank_order`),
  KEY `idx_vendor_match_evaluation_candidates_candidate_status` (`candidate_id`,`match_status`),
  KEY `idx_vendor_match_evaluation_candidates_evidence` (`evidence_snapshot_id`),
  CONSTRAINT `fk_vendor_match_evaluation_candidates_run` FOREIGN KEY (`evaluation_run_id`)
    REFERENCES `vendor_match_evaluation_runs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_vendor_match_evaluation_candidates_candidate` FOREIGN KEY (`candidate_id`)
    REFERENCES `vendor_sourcing_candidates` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_vendor_match_evaluation_candidates_evidence` FOREIGN KEY (`evidence_snapshot_id`)
    REFERENCES `vendor_reputation_evidence_snapshots` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_vendor_match_evaluation_candidates_score` CHECK (
    `score` IS NULL OR (`score` >= 0 AND `score` <= 100)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
