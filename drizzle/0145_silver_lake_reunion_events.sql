CREATE TABLE IF NOT EXISTS `silver_lake_reunion_events` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `territory_id` varchar(64) NOT NULL,
  `customer_id` varchar(191) NOT NULL,
  `operator_id` varchar(191) NOT NULL,
  `template_id` varchar(64) NOT NULL,
  `event_kind` varchar(32) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_slre_scope` (`tenant_id`, `territory_id`, `created_at`)
);
