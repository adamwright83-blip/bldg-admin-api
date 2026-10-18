-- Phase 2 · Slice B: operator decisions that settle the operating mandate.
-- Append-only: which goal comes first, an area confirmed or set aside as a
-- focus, and the operator's stated method for a goal. A newer decision about
-- the same subject supersedes the older one, which is kept with
-- `supersededById`. `activeSlot` is 1 while a decision is in force and NULL
-- once superseded, so a subject has at most one decision in force.
-- No table options: it takes the database's charset and collation.
CREATE TABLE IF NOT EXISTS `operating_mandate_decisions` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `kind` varchar(32) NOT NULL,
  `subjectKey` varchar(191) NOT NULL,
  `payloadJson` json NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `activeSlot` tinyint NULL DEFAULT 1,
  `supersedesId` varchar(36) NULL,
  `supersededById` varchar(36) NULL,
  `decidedByOpenId` varchar(128) NOT NULL,
  `source` varchar(32) NOT NULL,
  `decidedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_operating_mandate_decisions_active` (`tenantId`, `canonicalOperatorId`, `subjectKey`, `activeSlot`),
  KEY `idx_operating_mandate_decisions_operator` (`tenantId`, `canonicalOperatorId`, `decidedAt`)
);
