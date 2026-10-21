CREATE TABLE IF NOT EXISTS `lantern_neighborhood_memories` (
  `id` varchar(128) NOT NULL,
  `tenant_id` varchar(64) NOT NULL,
  `territory_id` varchar(64) NOT NULL,
  `courtyard_feature` varchar(64) NULL,
  `courtyard_placed_at` timestamp NULL,
  `last_visited_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `visit_count` int NOT NULL DEFAULT 1,
  `encounter_history_json` json NULL,
  `villager_relationships_json` json NULL,
  `unfinished_activities_json` json NULL,
  `celebrated_events_json` json NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`, `territory_id`),
  INDEX `idx_lnm_scope` (`tenant_id`, `territory_id`, `last_visited_at`)
);
