-- Fix: ops_task_events could not previously distinguish a task being started
-- from a task being accepted (updateOpsTaskStatus's fallback mapped
-- status "in_progress" to eventType "accepted"). Start latency was
-- unobservable. See docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md §4.
ALTER TABLE `ops_task_events`
  MODIFY COLUMN `eventType` enum(
    'created',
    'viewed',
    'accepted',
    'started',
    'completed',
    'dismissed',
    'expired',
    'agent_suggested',
    'human_approved',
    'revenue_recovered',
    'outcome_recorded'
  ) NOT NULL;

-- Behavioral Ledger (Slice 1). See docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md.
-- Append-only. Observed behavior only; interpretation lives elsewhere with its own
-- provenance and version, never as a column here.
CREATE TABLE IF NOT EXISTS `behavioral_ledger_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenantId` varchar(64) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  -- Groups the whole lifecycle of one piece of work across subsystems.
  `correlationId` varchar(128) NOT NULL,
  `sourceSystem` enum(
    'ops_task',
    'strategy_path_offer',
    'commercial_mission',
    'mission_director',
    'campaign_run',
    'first_mission'
  ) NOT NULL,
  `sourceEntityType` varchar(96) NOT NULL,
  `sourceEntityId` varchar(128) NOT NULL,
  `eventType` enum(
    'DELIVERED',
    'VIEWABLE',
    'ENGAGED',
    'ACCEPTED',
    'STARTED',
    'COMPLETED',
    'VERIFIED',
    'DEFERRED',
    'DISMISSED',
    'EXPIRED',
    'SUPERSEDED',
    'NOT_COMPLETED'
  ) NOT NULL,
  -- Server clock only. Never trust a client-supplied timestamp for this column.
  `occurredAt` timestamp NOT NULL,
  `verificationClass` enum('VERIFIED', 'ATTESTED', 'CLAIMED') DEFAULT NULL,
  `provenance` varchar(191) NOT NULL,
  `evidenceSource` varchar(191) DEFAULT NULL,
  -- Decision-point / MRT-readiness fields (foundation doc §5). Null except on
  -- events that ARE an intervention-selection decision point.
  `decisionPointId` varchar(128) DEFAULT NULL,
  `availability` boolean DEFAULT NULL,
  `eligibleOptionsJson` json DEFAULT NULL,
  `assignedOption` varchar(128) DEFAULT NULL,
  `assignmentProbability` decimal(6, 5) DEFAULT NULL,
  `interventionPolicyVersion` int DEFAULT NULL,
  `interventionDefinitionVersion` int DEFAULT NULL,
  `proximalOutcomeWindowMinutes` int DEFAULT NULL,
  -- Prevents duplicate rows from retries/replays of the same authoritative transition.
  `idempotencyKey` varchar(191) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_behavioral_ledger_idempotency` (`tenantId`, `idempotencyKey`),
  KEY `idx_behavioral_ledger_tenant_operator` (`tenantId`, `operatorUserId`),
  KEY `idx_behavioral_ledger_correlation` (`tenantId`, `correlationId`),
  KEY `idx_behavioral_ledger_source` (`tenantId`, `sourceSystem`, `sourceEntityId`),
  KEY `idx_behavioral_ledger_decision_point` (`tenantId`, `decisionPointId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Versioned intervention/annotation registry (foundation doc §6). COM-B/TDF/BCT
-- annotations live here, never on raw ledger events, because annotations are
-- hypotheses that get revised — history under them must never be rewritten.
CREATE TABLE IF NOT EXISTS `intervention_definitions` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `interventionKey` varchar(96) NOT NULL,
  `version` int NOT NULL,
  `framework` varchar(64) DEFAULT NULL,
  `frameworkVersion` varchar(32) DEFAULT NULL,
  `proposedConstructJson` json DEFAULT NULL,
  `bctAnnotationsJson` json DEFAULT NULL,
  `evidenceReferencesJson` json DEFAULT NULL,
  `annotationStatus` enum('proposed', 'expert_reviewed', 'empirically_supported') NOT NULL DEFAULT 'proposed',
  `reviewedBy` varchar(128) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_intervention_definitions_key_version` (`tenantId`, `interventionKey`, `version`),
  KEY `idx_intervention_definitions_tenant_key` (`tenantId`, `interventionKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
