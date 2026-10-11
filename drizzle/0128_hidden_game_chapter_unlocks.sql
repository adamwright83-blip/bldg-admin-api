CREATE TABLE `hidden_game_chapter_unlocks` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `operator_id` varchar(191) NOT NULL,
  `chapter` int NOT NULL,
  `unlocked_on_local_date` varchar(10) NOT NULL,
  `evidence_json` json NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_hidden_game_unlock_chapter` (`tenant_id`, `operator_id`, `chapter`),
  UNIQUE KEY `uq_hidden_game_unlock_date` (`tenant_id`, `operator_id`, `unlocked_on_local_date`)
);
