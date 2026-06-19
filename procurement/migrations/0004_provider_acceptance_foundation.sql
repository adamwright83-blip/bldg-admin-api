CREATE TABLE IF NOT EXISTS `guest_readiness_provider_acceptances` (
  `id` char(36) NOT NULL,
  `guest_readiness_plan_item_id` char(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'default',
  `bldg_user_id` int NOT NULL,
  `building_slug` varchar(100) NOT NULL,
  `vendor_id` int NULL,
  `vendor_name_snapshot` varchar(255) NULL,
  `vendor_contact_snapshot_json` json NULL,
  `vendor_source_type` varchar(100) NOT NULL,
  `acceptance_type` enum('provider_accepted','verified_existing_booking','operator_verified') NOT NULL,
  `acceptance_status` enum('draft','offered','accepted','declined','countered','expired','cancelled','operator_verified') NOT NULL DEFAULT 'draft',
  `accepted_at` timestamp(3) NULL,
  `declined_at` timestamp(3) NULL,
  `countered_at` timestamp(3) NULL,
  `expires_at` timestamp(3) NULL,
  `service_window_start` timestamp(3) NULL,
  `service_window_end` timestamp(3) NULL,
  `accepted_price_cents` int unsigned NULL,
  `currency` char(3) NOT NULL DEFAULT 'usd',
  `terms_snapshot_json` json NULL,
  `evidence_json` json NULL,
  `decision_evidence_json` json NOT NULL,
  `created_by` varchar(191) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_provider_acceptances_item` (`guest_readiness_plan_item_id`,`acceptance_status`),
  KEY `idx_provider_acceptances_resident` (`tenant_id`,`bldg_user_id`,`acceptance_status`),
  KEY `idx_provider_acceptances_expiry` (`acceptance_status`,`expires_at`),
  KEY `idx_provider_acceptances_vendor` (`vendor_id`),
  CONSTRAINT `fk_provider_acceptances_item` FOREIGN KEY (`guest_readiness_plan_item_id`)
    REFERENCES `guest_readiness_plan_items` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `guest_readiness_booking_truth_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `provider_acceptance_id` char(36) NOT NULL,
  `guest_readiness_plan_item_id` char(36) NOT NULL,
  `event_type` enum(
    'offer_created','provider_accepted','provider_declined','provider_countered',
    'operator_verified','expired','cancelled',
    'truth_check_performed','truth_check_allowed','truth_check_denied'
  ) NOT NULL,
  `actor_type` enum('system','operator','provider','policy') NOT NULL,
  `actor_id` varchar(191) NULL,
  `event_data_json` json NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_booking_truth_events_acceptance_time` (`provider_acceptance_id`,`created_at`,`id`),
  KEY `idx_booking_truth_events_item_time` (`guest_readiness_plan_item_id`,`created_at`),
  KEY `idx_booking_truth_events_type_time` (`event_type`,`created_at`),
  CONSTRAINT `fk_booking_truth_events_acceptance` FOREIGN KEY (`provider_acceptance_id`)
    REFERENCES `guest_readiness_provider_acceptances` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_booking_truth_events_item` FOREIGN KEY (`guest_readiness_plan_item_id`)
    REFERENCES `guest_readiness_plan_items` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
