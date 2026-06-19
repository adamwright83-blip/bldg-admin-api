CREATE TABLE IF NOT EXISTS `held_schema_migrations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `migration_key` varchar(191) NOT NULL,
  `checksum` char(64) NOT NULL,
  `status` enum('applying','applied','failed') NOT NULL,
  `started_at` timestamp(3) NULL,
  `applied_at` timestamp(3) NULL,
  `execution_ms` int unsigned NULL,
  `error_text` text NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_held_schema_migrations_key` (`migration_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
