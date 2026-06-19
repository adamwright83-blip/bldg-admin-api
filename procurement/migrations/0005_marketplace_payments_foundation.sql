CREATE TABLE IF NOT EXISTS `marketplace_payment_authorizations` (
  `id` char(36) NOT NULL,
  `guest_readiness_plan_item_id` char(36) NOT NULL,
  `provider_acceptance_id` char(36) NULL,
  `authority_grant_id` char(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'default',
  `bldg_user_id` int NOT NULL,
  `building_slug` varchar(100) NOT NULL,
  `vendor_id` int NULL,
  `vendor_connect_account_id_snapshot` varchar(255) NULL,
  `amount_cents` int unsigned NOT NULL,
  `currency` char(3) NOT NULL DEFAULT 'usd',
  `state` enum('no_payment_required','authorization_required','authorization_pending','authorized','cancelled') NOT NULL DEFAULT 'authorization_required',
  `stripe_customer_id` varchar(255) NULL,
  `stripe_payment_method_id` varchar(255) NULL,
  `stripe_payment_intent_id` varchar(255) NULL,
  `policy_decision_json` json NOT NULL,
  `idempotency_key` varchar(191) NOT NULL,
  `expires_at` timestamp(3) NULL,
  `authorized_at` timestamp(3) NULL,
  `cancelled_at` timestamp(3) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mp_authorizations_idempotency` (`idempotency_key`),
  KEY `idx_mp_authorizations_item` (`guest_readiness_plan_item_id`,`state`),
  KEY `idx_mp_authorizations_resident_state` (`tenant_id`,`bldg_user_id`,`state`),
  KEY `idx_mp_authorizations_expiry` (`state`,`expires_at`),
  CONSTRAINT `fk_mp_authorizations_item` FOREIGN KEY (`guest_readiness_plan_item_id`)
    REFERENCES `guest_readiness_plan_items` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_mp_authorizations_acceptance` FOREIGN KEY (`provider_acceptance_id`)
    REFERENCES `guest_readiness_provider_acceptances` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_mp_authorizations_grant` FOREIGN KEY (`authority_grant_id`)
    REFERENCES `authority_grants` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `marketplace_payment_captures` (
  `id` char(36) NOT NULL,
  `authorization_id` char(36) NOT NULL,
  `captured_amount_cents` int unsigned NULL,
  `state` enum('capture_pending','captured','capture_failed') NOT NULL DEFAULT 'capture_pending',
  `stripe_payment_intent_id` varchar(255) NULL,
  `failure_code` varchar(100) NULL,
  `failure_message` text NULL,
  `truth_check_decision_json` json NOT NULL,
  `idempotency_key` varchar(191) NOT NULL,
  `captured_at` timestamp(3) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mp_captures_authorization` (`authorization_id`),
  UNIQUE KEY `uq_mp_captures_idempotency` (`idempotency_key`),
  KEY `idx_mp_captures_state` (`state`),
  CONSTRAINT `fk_mp_captures_authorization` FOREIGN KEY (`authorization_id`)
    REFERENCES `marketplace_payment_authorizations` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `marketplace_payment_allocations` (
  `id` char(36) NOT NULL,
  `capture_id` char(36) NOT NULL,
  `allocation_type` enum('vendor_payable','platform_fee','tax','refund_reserve') NOT NULL,
  `target_vendor_id` int NULL,
  `amount_cents` int unsigned NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_mp_allocations_capture` (`capture_id`,`allocation_type`),
  CONSTRAINT `fk_mp_allocations_capture` FOREIGN KEY (`capture_id`)
    REFERENCES `marketplace_payment_captures` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `marketplace_vendor_payables` (
  `id` char(36) NOT NULL,
  `allocation_id` char(36) NOT NULL,
  `vendor_id` int NULL,
  `amount_cents` int unsigned NOT NULL,
  `state` enum('transfer_pending','transferred','transfer_failed','cancelled') NOT NULL DEFAULT 'transfer_pending',
  `stripe_transfer_id` varchar(255) NULL,
  `idempotency_key` varchar(191) NOT NULL,
  `transferred_at` timestamp(3) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mp_payables_idempotency` (`idempotency_key`),
  KEY `idx_mp_payables_allocation` (`allocation_id`),
  KEY `idx_mp_payables_state` (`state`),
  CONSTRAINT `fk_mp_payables_allocation` FOREIGN KEY (`allocation_id`)
    REFERENCES `marketplace_payment_allocations` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `marketplace_stripe_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `stripe_event_id` varchar(255) NOT NULL,
  `event_type` varchar(128) NOT NULL,
  `livemode` boolean NOT NULL DEFAULT false,
  `payload_json` json NULL,
  `related_authorization_id` char(36) NULL,
  `processing_status` enum('received','processed','ignored','failed') NOT NULL DEFAULT 'received',
  `error_text` text NULL,
  `processed_at` timestamp(3) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mp_stripe_events_event_id` (`stripe_event_id`),
  KEY `idx_mp_stripe_events_status` (`processing_status`,`created_at`),
  CONSTRAINT `fk_mp_stripe_events_authorization` FOREIGN KEY (`related_authorization_id`)
    REFERENCES `marketplace_payment_authorizations` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `marketplace_refunds` (
  `id` char(36) NOT NULL,
  `capture_id` char(36) NOT NULL,
  `amount_cents` int unsigned NOT NULL,
  `reason` varchar(255) NULL,
  `state` enum('refund_pending','refunded','refund_failed') NOT NULL DEFAULT 'refund_pending',
  `stripe_refund_id` varchar(255) NULL,
  `idempotency_key` varchar(191) NOT NULL,
  `refunded_at` timestamp(3) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mp_refunds_idempotency` (`idempotency_key`),
  KEY `idx_mp_refunds_capture` (`capture_id`,`state`),
  CONSTRAINT `fk_mp_refunds_capture` FOREIGN KEY (`capture_id`)
    REFERENCES `marketplace_payment_captures` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `marketplace_disputes` (
  `id` char(36) NOT NULL,
  `capture_id` char(36) NOT NULL,
  `stripe_dispute_id` varchar(255) NOT NULL,
  `status` varchar(64) NOT NULL,
  `amount_cents` int unsigned NOT NULL,
  `evidence_due_by` timestamp(3) NULL,
  `outcome` varchar(64) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mp_disputes_stripe_id` (`stripe_dispute_id`),
  KEY `idx_mp_disputes_capture` (`capture_id`,`status`),
  CONSTRAINT `fk_mp_disputes_capture` FOREIGN KEY (`capture_id`)
    REFERENCES `marketplace_payment_captures` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `marketplace_payment_idempotency_keys` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `idempotency_key` varchar(191) NOT NULL,
  `operation_type` varchar(64) NOT NULL,
  `request_payload_hash` char(64) NOT NULL,
  `stripe_response_json` json NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mp_idempotency_keys_key` (`idempotency_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
