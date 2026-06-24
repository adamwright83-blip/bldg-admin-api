CREATE TABLE IF NOT EXISTS `vendor_acquisition_missions` (
  `id` char(36) NOT NULL,
  `tenant_id` varchar(64) NOT NULL DEFAULT 'default',
  `category` varchar(100) NOT NULL,
  `geography_label` varchar(255) NOT NULL,
  `target_quantity` int NOT NULL,
  `quality_gates_json` json NOT NULL,
  `outreach_mode` enum('draft_only','supervised_send','auto_send') NOT NULL DEFAULT 'draft_only',
  `status` enum('draft','active','completed','cancelled') NOT NULL DEFAULT 'draft',
  `deadline_at` timestamp(3) NULL,
  `created_by` varchar(191) NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_vendor_acquisition_missions_tenant_status` (`tenant_id`,`status`,`created_at`),
  KEY `idx_vendor_acquisition_missions_category` (`category`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
