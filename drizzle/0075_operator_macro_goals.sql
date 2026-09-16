-- Prompt A: durable operator-attested macro goals. These are distinct from
-- goldline_campaigns.objective, which remains campaign-template metadata.
-- At most one active row per scoped metric is enforced by the serializable
-- replacement transaction in server/claire/macroGoalService.ts.

CREATE TABLE IF NOT EXISTS `operator_macro_goals` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `objective` varchar(512) NOT NULL,
  `metricKey` varchar(64) NOT NULL,
  `targetValue` decimal(15,2) NOT NULL,
  `unit` varchar(64) NOT NULL,
  `urgencyText` varchar(191) NULL,
  `targetDate` varchar(10) NULL,
  `source` enum('operator_attested','admin') NOT NULL,
  `sourceNote` varchar(512) NOT NULL,
  `secondaryTargetsJson` json NULL,
  `status` enum('active','superseded','closed') NOT NULL DEFAULT 'active',
  `supersededById` varchar(36) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_operator_macro_goals_active` (`tenantId`,`operatorUserId`,`metricKey`,`status`)
);
