-- Insert-once Lost Property chapter unlocks for one tenant and operator.
-- openedAt is the ledger time that opened the chapter. createdAt is the insert time.
-- A later recompute does not delete a row. Chapter 4 is not a legal value.
CREATE TABLE IF NOT EXISTS `hidden_game_chapter_unlocks` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `chapter` tinyint NOT NULL,
  `openedAt` timestamp(3) NOT NULL,
  `evidenceJson` json NOT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hidden_game_chapter_unlock` (`tenantId`, `canonicalOperatorId`, `chapter`),
  CONSTRAINT `chk_hidden_game_chapter_playable` CHECK (`chapter` IN (1, 2, 3))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
