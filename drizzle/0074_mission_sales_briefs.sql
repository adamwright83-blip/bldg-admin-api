-- Claire Pass 2: the single authoritative, versioned sales brief per
-- commercial mission. Append-only — a new mission reality creates a new
-- version row, never a mutation of a previous one.
-- Hand-written to match this repo's manual migration convention; the
-- actual production apply path is scripts/migrate.mjs, kept in sync below.

CREATE TABLE IF NOT EXISTS `mission_sales_briefs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `missionId` int NOT NULL,
  `accountId` int NULL,
  `version` int NOT NULL DEFAULT 1,
  `briefJson` json NOT NULL,
  `source` varchar(16) NOT NULL,
  `compilerVersion` varchar(64) NOT NULL,
  `frameworkId` varchar(36) NULL,
  `confidence` int NOT NULL DEFAULT 0,
  `generatedFromEvidenceThrough` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mission_sales_brief_version` (`tenantId`,`missionId`,`version`),
  KEY `idx_mission_sales_brief_tenant_mission` (`tenantId`,`missionId`,`version`)
);
