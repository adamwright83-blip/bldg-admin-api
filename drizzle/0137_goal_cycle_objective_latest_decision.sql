-- Stage 1 · 1B: every goal-cycle occurrence decides afresh. An open objective
-- for the same run, selection and business date is re-selected instead of
-- minted again, and records the latest decision that re-selected it.
-- Additive and nullable; no existing rows are rewritten.
ALTER TABLE `goal_cycle_objectives` ADD COLUMN `latestDecisionId` varchar(36) NULL;
ALTER TABLE `goal_cycle_objectives` ADD KEY `idx_goal_cycle_objectives_latest_decision` (`tenantId`, `latestDecisionId`);
