CREATE TABLE IF NOT EXISTS `vendor_candidate_availability_intake` (
  `id` char(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'default',
  `candidate_id` char(36) NOT NULL,
  `mobile_service_confirmed` enum('yes','no','unknown') NOT NULL DEFAULT 'unknown',
  `service_areas_json` json NULL,
  `recurring_availability_json` json NULL,
  `minimum_notice_hours` int NULL,
  `appointment_duration_minutes` int NULL,
  `travel_buffer_minutes` int NULL,
  `booking_url` varchar(2048) NULL,
  `calendar_method` enum('held_schedule','booking_url','google_calendar_later','manual_confirmation') NULL,
  `preferred_contact_channel` enum('phone','email','text','website','booking_url') NULL,
  `blackout_notes` text NULL,
  `onboarding_notes` text NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vendor_candidate_availability_intake_candidate` (`tenant_id`,`candidate_id`),
  CONSTRAINT `fk_vendor_candidate_availability_intake_candidate` FOREIGN KEY (`candidate_id`)
    REFERENCES `vendor_sourcing_candidates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
