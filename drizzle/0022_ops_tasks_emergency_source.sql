ALTER TABLE `ops_tasks` MODIFY COLUMN `source` enum('manual','agent_suggested','system_detected','level_4','voice','quick_input','emergency_composer') NOT NULL DEFAULT 'manual';
