-- Goldline chapter fiction state — cross-device checkpoint/mechanism sync
--
-- One row per tenant/operator/chapter. Fiction only (room, checkpoint,
-- mechanism heading, cleared rooms, completion) — never business truth.
-- Additive, tenant-scoped, operator-scoped, restart-safe.
--
-- NOT YET APPLIED to any database as of authoring. Apply via
-- applyDayforgeReleaseMigrations with DAYFORGE_RELEASE_DB=1, not scripts/migrate.mjs.

CREATE TABLE IF NOT EXISTS `goldline_chapter_states` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorId` varchar(128) NOT NULL,
  `chapterId` varchar(64) NOT NULL,
  `revision` int NOT NULL DEFAULT 1,
  `stateJson` json NOT NULL,
  `lastRequestId` varchar(80) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goldline_chapter_state_player` (`tenantId`,`operatorId`,`chapterId`)
);
