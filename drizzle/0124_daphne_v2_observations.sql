CREATE TABLE `daphne_observations` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `canonicalOperatorId` varchar(191) NOT NULL,
  `operatorUserId` varchar(128),
  `sessionId` varchar(191),
  `actorType` enum('user','agent','system','tool','external') NOT NULL,
  `actorId` varchar(191),
  `agentId` varchar(128),
  `observationKind` enum(
    'user_statement',
    'agent_message',
    'user_action',
    'agent_action',
    'tool_event',
    'correction',
    'preference_declaration',
    'verified_operational_outcome',
    'verified_business_outcome',
    'relationship_event',
    'system_context_event'
  ) NOT NULL,
  `evidenceChannel` enum('stated','revealed','system_record','authoritative_external') NOT NULL,
  `verificationStatus` enum('unverified','attested','verified','rejected','disputed') NOT NULL DEFAULT 'unverified',
  `sourceType` varchar(64) NOT NULL,
  `sourceReference` varchar(191) NOT NULL,
  `occurredAt` timestamp(3) NOT NULL,
  `contextJson` json,
  `payloadJson` json,
  `metadataJson` json,
  `idempotencyKey` varchar(191) NOT NULL,
  `createdAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT `daphne_observations_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_daphne_observations_idempotency` UNIQUE(`tenantId`,`canonicalOperatorId`,`idempotencyKey`)
);

CREATE INDEX `idx_daphne_observations_operator_occurred`
  ON `daphne_observations` (`tenantId`,`canonicalOperatorId`,`occurredAt`);

CREATE INDEX `idx_daphne_observations_session_occurred`
  ON `daphne_observations` (`tenantId`,`sessionId`,`occurredAt`);

CREATE INDEX `idx_daphne_observations_source`
  ON `daphne_observations` (`tenantId`,`sourceType`,`sourceReference`);
