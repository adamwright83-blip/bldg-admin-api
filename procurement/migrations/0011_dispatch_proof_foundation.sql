CREATE TABLE IF NOT EXISTS `dispatch_requests` (
  `id` char(36) NOT NULL,
  `workflow_id` bigint unsigned NOT NULL,
  `mandate_state_snapshot_json` json NOT NULL,
  `candidate_id` char(36) NULL,
  `vendor_agreement_id` char(36) NULL,
  `provider_acceptance_id` char(36) NULL,
  `operator_gate_id` bigint unsigned NULL,
  `path_type` enum('vendor_service','runner_purchase','operator_manual','unsupported') NOT NULL,
  `dispatch_status` enum('draft','ready_for_manual_dispatch','dispatch_blocked','manually_dispatched','proof_pending','proof_verified','cancelled','rejected') NOT NULL DEFAULT 'draft',
  `dispatch_ready_reason_json` json NOT NULL,
  `blocked_reason_json` json NOT NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_dispatch_requests_workflow_status` (`workflow_id`,`dispatch_status`,`created_at`),
  KEY `idx_dispatch_requests_candidate` (`candidate_id`,`dispatch_status`),
  KEY `idx_dispatch_requests_agreement` (`vendor_agreement_id`),
  KEY `idx_dispatch_requests_acceptance` (`provider_acceptance_id`),
  KEY `idx_dispatch_requests_gate` (`operator_gate_id`),
  CONSTRAINT `fk_dispatch_requests_workflow` FOREIGN KEY (`workflow_id`)
    REFERENCES `procurement_workflows` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_dispatch_requests_candidate` FOREIGN KEY (`candidate_id`)
    REFERENCES `vendor_sourcing_candidates` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_dispatch_requests_agreement` FOREIGN KEY (`vendor_agreement_id`)
    REFERENCES `vendor_agreements` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_dispatch_requests_acceptance` FOREIGN KEY (`provider_acceptance_id`)
    REFERENCES `guest_readiness_provider_acceptances` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_dispatch_requests_gate` FOREIGN KEY (`operator_gate_id`)
    REFERENCES `procurement_operator_gates` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `dispatch_events` (
  `id` char(36) NOT NULL,
  `dispatch_request_id` char(36) NOT NULL,
  `event_type` enum('created','marked_ready','blocked','manual_dispatch_recorded','proof_requested','proof_recorded','proof_verified','cancelled','rejected','operator_note') NOT NULL,
  `event_status` enum('recorded','needs_review','rejected') NOT NULL DEFAULT 'recorded',
  `occurred_at` timestamp(3) NOT NULL,
  `actor_type` enum('operator','vendor','runner','system') NOT NULL,
  `actor_identifier` varchar(191) NULL,
  `summary` text NOT NULL,
  `evidence_json` json NOT NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_dispatch_events_request_time` (`dispatch_request_id`,`occurred_at`),
  KEY `idx_dispatch_events_type_status` (`event_type`,`event_status`,`created_at`),
  CONSTRAINT `fk_dispatch_events_request` FOREIGN KEY (`dispatch_request_id`)
    REFERENCES `dispatch_requests` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `proof_of_completion_records` (
  `id` char(36) NOT NULL,
  `dispatch_request_id` char(36) NOT NULL,
  `proof_status` enum('submitted','needs_review','verified','rejected') NOT NULL DEFAULT 'submitted',
  `proof_type` enum('photo_receipt','vendor_confirmation','operator_note','customer_confirmation','other') NOT NULL,
  `proof_summary` text NOT NULL,
  `proof_payload_json` json NOT NULL,
  `verified_by` varchar(191) NULL,
  `verified_at` timestamp(3) NULL,
  `rejected_reason` text NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_proof_records_request_status` (`dispatch_request_id`,`proof_status`,`created_at`),
  KEY `idx_proof_records_review` (`proof_status`,`updated_at`),
  CONSTRAINT `fk_proof_records_dispatch_request` FOREIGN KEY (`dispatch_request_id`)
    REFERENCES `dispatch_requests` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `chk_proof_verified_evidence` CHECK (
    (`proof_status` <> 'verified') OR (`verified_by` IS NOT NULL AND `verified_at` IS NOT NULL)
  ),
  CONSTRAINT `chk_proof_rejected_reason` CHECK (
    (`proof_status` <> 'rejected') OR (`rejected_reason` IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
