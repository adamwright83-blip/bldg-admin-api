-- Operator-confirmed Day Line recurrence. A rule is not an order and must
-- never mint orders rows. Applied by scripts/migrate.mjs (keep both in sync).

CREATE TABLE IF NOT EXISTS `day_director_recurrence_rules` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `actorId` varchar(128) NOT NULL,
  `sourceIdentity` varchar(64) NOT NULL,
  `title` varchar(255) NOT NULL,
  `kind` enum('growth','prep','operations') NOT NULL,
  `weekday` varchar(16) NOT NULL,
  `windowStart` varchar(8) DEFAULT NULL,
  `windowEnd` varchar(8) DEFAULT NULL,
  `sourceText` text,
  `status` enum('active','cancelled') NOT NULL DEFAULT 'active',
  `metadataJson` json DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_day_director_recurrence_source` (`tenantId`,`actorId`,`sourceIdentity`),
  KEY `idx_day_director_recurrence_actor` (`tenantId`,`actorId`,`status`)
);
