-- President autonomous improvement cycles and approved overnight missions.
-- Company-only durable state. No customer/order/revenue table access.

CREATE TABLE IF NOT EXISTS president_cycles (
  id char(36) PRIMARY KEY,
  state varchar(40) NOT NULL,
  evidenceIdsJson json NOT NULL,
  initialCandidatesJson json NULL,
  claudeCritiqueJson json NULL,
  finalCandidatesJson json NULL,
  proposedCandidateIdsJson json NOT NULL,
  approvalJson json NULL,
  blockReason text NULL,
  version int NOT NULL DEFAULT 1,
  createdAt datetime(3) NOT NULL,
  updatedAt datetime(3) NOT NULL,
  KEY idx_president_cycles_state (state,updatedAt)
);

CREATE TABLE IF NOT EXISTS president_cycle_rounds (
  id char(36) PRIMARY KEY,
  cycleId char(36) NOT NULL,
  stage varchar(40) NOT NULL,
  provider varchar(191) NOT NULL,
  model varchar(191) NOT NULL,
  providerRunId varchar(191) NULL,
  inputHash char(64) NOT NULL,
  outputJson json NOT NULL,
  createdAt datetime(3) NOT NULL,
  UNIQUE KEY uq_president_cycle_stage (cycleId,stage),
  KEY idx_president_cycle_rounds_cycle (cycleId,createdAt)
);

CREATE TABLE IF NOT EXISTS president_cycle_missions (
  id char(36) PRIMARY KEY,
  cycleId char(36) NOT NULL,
  candidateId varchar(96) NOT NULL,
  title varchar(240) NOT NULL,
  objective text NOT NULL,
  evidenceIdsJson json NOT NULL,
  acceptanceCriteriaJson json NOT NULL,
  executionDomain varchar(40) NOT NULL,
  state varchar(40) NOT NULL,
  attemptCount int NOT NULL DEFAULT 0,
  maxAttempts int NOT NULL DEFAULT 3,
  executorId varchar(191) NULL,
  reviewerId varchar(191) NULL,
  baseSha char(40) NULL,
  branch varchar(512) NULL,
  commitSha char(40) NULL,
  pullRequestUrl varchar(2048) NULL,
  resultJson json NULL,
  reviewJson json NULL,
  blocker text NULL,
  leaseOwner varchar(191) NULL,
  leaseExpiresAt datetime(3) NULL,
  createdAt datetime(3) NOT NULL,
  updatedAt datetime(3) NOT NULL,
  UNIQUE KEY uq_president_cycle_candidate (cycleId,candidateId),
  KEY idx_president_cycle_missions_claim (state,leaseExpiresAt,updatedAt)
);
