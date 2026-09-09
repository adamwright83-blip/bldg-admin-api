-- Goldline chapter real-event binding — Slice 5
--
-- Records that a qualifying real TowerWarsBusinessEvent unlocked a fictional
-- consequence, exactly once. Never stores order/payment/customer fields from
-- that event — only its id, for idempotent consumption.
--
-- NOT YET APPLIED to any database as of authoring. Apply via
-- applyDayforgeReleaseMigrations with DAYFORGE_RELEASE_DB=1, not scripts/migrate.mjs.

CREATE TABLE IF NOT EXISTS `goldline_chapter_event_bindings` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `chapterId` varchar(64) NOT NULL,
  `buildingId` varchar(32) NOT NULL,
  `armedAt` timestamp NULL,
  `resolvedEventId` varchar(191) NULL,
  `resolvedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goldline_chapter_event_binding` (`tenantId`,`chapterId`,`buildingId`)
);
