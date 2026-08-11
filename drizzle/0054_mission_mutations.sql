-- Slice 14 — Mission Mutation Library.
--
-- Additive only. One new table. 0051, 0052, 0053 are not touched.
--
-- `mission_mutations` is an append-only audit trail of world interpretations
-- derived from authoritative business evidence. It never itself declares a
-- business fact — `triggerReference` points back to the real evidence that
-- justified the mutation. The unique constraint on
-- (tenantId, actorId, missionId, triggerReference) is the idempotency
-- guarantee: evaluating the same evidence twice is a no-op, not a duplicate.

CREATE TABLE IF NOT EXISTS `mission_mutations` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `actorId` varchar(128) NOT NULL,
  `missionId` int NOT NULL,
  `sourceState` varchar(64) NOT NULL,
  `mutationType` enum('RECOVERY_PATH','ALT_ROUTE','WATCH_WINDOW','NEW_CONTACT_ROUTE','FOLLOW_UP_ROUTE','ESCALATION_ROUTE','SCOUT_BRANCH','CLOSED_PATH','CAPTURED_PATH') NOT NULL,
  `triggerType` enum('follow_up_commitment','decision_maker_discovered','pipeline_stage_change','verified_win','verified_loss','scout_discovery','contact_route_discovered') NOT NULL,
  `triggerReference` varchar(255) NOT NULL,
  `worldEffectJson` json NOT NULL,
  `businessReferencesJson` json NOT NULL,
  `metadataJson` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `mission_mutations_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_mission_mutation_trigger` UNIQUE (`tenantId`,`actorId`,`missionId`,`triggerReference`),
  INDEX `idx_mission_mutation_lookup` (`tenantId`,`actorId`,`missionId`,`createdAt`)
);
