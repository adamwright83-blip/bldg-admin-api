-- Applied by scripts/migrate.mjs (this file is not executed directly; see
-- SLICE_4_MISSION_DIRECTOR.md section 8 — migrate.mjs does not run
-- drizzle/*.sql). Keep this file and migrate.mjs's Spirit Human rescue
-- block in sync; migrate.mjs is what production actually runs.
--
-- Authoritative rescue missions cannot live in process memory. sendStatus is
-- a first-class column so a send attempt can be claimed with compare-and-set.

CREATE TABLE IF NOT EXISTS `spirit_human_rescue_missions` (
  `missionId` VARCHAR(64) NOT NULL,
  `tenantId` VARCHAR(64) NOT NULL,
  `operatorUserId` VARCHAR(128) NOT NULL,
  `snapshotCustomerId` VARCHAR(64) NOT NULL,
  `villagerId` VARCHAR(32) NOT NULL,
  `lifecycle` VARCHAR(32) NOT NULL,
  `sendStatus` VARCHAR(32) NOT NULL,
  `missionJson` JSON NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`missionId`),
  KEY `idx_shr_missions_tenant_operator` (`tenantId`, `operatorUserId`),
  KEY `idx_shr_missions_tenant_customer` (`tenantId`, `snapshotCustomerId`)
);
