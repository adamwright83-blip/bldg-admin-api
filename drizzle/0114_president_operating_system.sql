-- President full operating-system lifecycle. Company-only; no customer-business tables.
CREATE TABLE IF NOT EXISTS president_authority_policies (
  policyVersion varchar(64) PRIMARY KEY,
  founderId varchar(191) NOT NULL,
  internalMergeAllowed boolean NOT NULL DEFAULT false,
  internalDeployAllowed boolean NOT NULL DEFAULT false,
  maxAutonomousUsdPerDay double NOT NULL DEFAULT 0,
  allowedRepositoriesJson json NOT NULL,
  allowedEnvironmentsJson json NOT NULL,
  prohibitedDomainsJson json NOT NULL,
  updatedAt datetime(3) NOT NULL,
  KEY idx_president_authority_updated (updatedAt)
);

CREATE TABLE IF NOT EXISTS president_programs (
  id char(36) PRIMARY KEY,
  assessmentId varchar(128) NULL,
  candidateId varchar(128) NULL,
  objectiveRecordId char(36) NULL,
  title varchar(255) NOT NULL,
  outcome text NOT NULL,
  state varchar(48) NOT NULL,
  selectedBy varchar(191) NOT NULL,
  selectedAt datetime(3) NOT NULL,
  authorityPolicyVersion varchar(64) NOT NULL,
  maxProgramUsd double NOT NULL DEFAULT 0,
  spentUsd double NOT NULL DEFAULT 0,
  currentStepId char(36) NULL,
  verifiedArtifactId varchar(512) NULL,
  blockReason text NULL,
  stopReason text NULL,
  createdAt datetime(3) NOT NULL,
  updatedAt datetime(3) NOT NULL,
  UNIQUE KEY uq_president_program_candidate (assessmentId,candidateId),
  KEY idx_president_program_state (state,updatedAt)
);

CREATE TABLE IF NOT EXISTS president_program_preflights (
  programId char(36) PRIMARY KEY,
  reversible boolean NOT NULL,
  rollbackPlan text NOT NULL,
  estimatedUsd double NOT NULL DEFAULT 0,
  licensesJson json NOT NULL,
  secretRequirementsJson json NOT NULL,
  customerImpact boolean NOT NULL DEFAULT false,
  productionMutation boolean NOT NULL DEFAULT false,
  billingMutation boolean NOT NULL DEFAULT false,
  credentialMutation boolean NOT NULL DEFAULT false,
  dnsMutation boolean NOT NULL DEFAULT false,
  legalCommitment boolean NOT NULL DEFAULT false,
  commercialRelease boolean NOT NULL DEFAULT false,
  externalSpend boolean NOT NULL DEFAULT false,
  unknownsJson json NOT NULL,
  requiredFounderDecisionsJson json NOT NULL,
  result varchar(32) NOT NULL,
  checkedAt datetime(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS president_program_steps (
  id char(36) PRIMARY KEY,
  programId char(36) NOT NULL,
  sequence int NOT NULL,
  type varchar(32) NOT NULL,
  title varchar(255) NOT NULL,
  outcome text NOT NULL,
  acceptanceCriteriaJson json NOT NULL,
  nonGoalsJson json NOT NULL,
  requiredEvidenceJson json NOT NULL,
  authorityClass varchar(40) NOT NULL,
  consequentialDomain varchar(40) NOT NULL,
  maxUsd double NOT NULL DEFAULT 0,
  spentUsd double NOT NULL DEFAULT 0,
  executorCapability varchar(191) NOT NULL,
  reviewerCapability varchar(191) NOT NULL,
  executorId varchar(191) NULL,
  reviewerId varchar(191) NULL,
  baseRef varchar(512) NULL,
  baseSha varchar(40) NULL,
  state varchar(40) NOT NULL,
  attemptCount int NOT NULL DEFAULT 0,
  maxAttempts int NOT NULL DEFAULT 3,
  leaseOwner varchar(191) NULL,
  leaseExpiresAt datetime(3) NULL,
  nextAttemptAt datetime(3) NULL,
  exactArtifactId varchar(512) NULL,
  error text NULL,
  createdAt datetime(3) NOT NULL,
  updatedAt datetime(3) NOT NULL,
  UNIQUE KEY uq_president_program_step_sequence (programId,sequence),
  KEY idx_president_steps_claim (state,nextAttemptAt,leaseExpiresAt,sequence)
);

CREATE TABLE IF NOT EXISTS president_execution_handbacks (
  id char(36) PRIMARY KEY,
  eventId char(36) NOT NULL,
  stepId char(36) NOT NULL,
  executorId varchar(191) NOT NULL,
  exactArtifactId varchar(512) NOT NULL,
  branch varchar(512) NULL,
  commitSha varchar(40) NULL,
  summary text NOT NULL,
  changedFilesJson json NOT NULL,
  testsActuallyRunJson json NOT NULL,
  testsNotRunJson json NOT NULL,
  evidenceJson json NOT NULL,
  knownLimitationsJson json NOT NULL,
  costUsd double NULL,
  reversible boolean NOT NULL,
  rollbackInstructions text NOT NULL,
  completedAt datetime(3) NOT NULL,
  createdAt datetime(3) NOT NULL,
  UNIQUE KEY uq_president_handback_event (eventId),
  UNIQUE KEY uq_president_handback_step_artifact (stepId,exactArtifactId)
);

CREATE TABLE IF NOT EXISTS president_independent_reviews (
  id char(36) PRIMARY KEY,
  eventId char(36) NOT NULL,
  stepId char(36) NOT NULL,
  reviewerId varchar(191) NOT NULL,
  exactArtifactId varchar(512) NOT NULL,
  verdict varchar(32) NOT NULL,
  acceptanceResultsJson json NOT NULL,
  observedRisksJson json NOT NULL,
  requiredRevision text NULL,
  evidenceJson json NOT NULL,
  reviewedAt datetime(3) NOT NULL,
  createdAt datetime(3) NOT NULL,
  UNIQUE KEY uq_president_review_event (eventId),
  UNIQUE KEY uq_president_review_step_artifact_reviewer (stepId,exactArtifactId,reviewerId)
);

CREATE TABLE IF NOT EXISTS president_founder_decisions (
  id char(36) PRIMARY KEY,
  programId char(36) NULL,
  stepId char(36) NULL,
  questionKey varchar(191) NOT NULL,
  decisionRound int NOT NULL,
  question text NOT NULL,
  optionsJson json NOT NULL,
  recommendedOption varchar(512) NULL,
  reason text NOT NULL,
  status varchar(24) NOT NULL,
  answer text NULL,
  askedAt datetime(3) NOT NULL,
  answeredAt datetime(3) NULL,
  UNIQUE KEY uq_president_founder_question_round (questionKey,decisionRound),
  KEY idx_president_founder_question_status (questionKey,status),
  KEY idx_president_founder_open (status,askedAt)
);

CREATE TABLE IF NOT EXISTS president_executive_seats (
  id char(36) PRIMARY KEY,
  roleKey varchar(128) NOT NULL,
  title varchar(191) NOT NULL,
  mandate text NOT NULL,
  proposedByProgramId char(36) NULL,
  capabilityGap text NOT NULL,
  skillNamesJson json NOT NULL,
  provider varchar(191) NULL,
  monthlyBudgetUsd double NOT NULL DEFAULT 0,
  state varchar(24) NOT NULL,
  founderDecisionId char(36) NULL,
  createdAt datetime(3) NOT NULL,
  updatedAt datetime(3) NOT NULL,
  UNIQUE KEY uq_president_executive_role (roleKey)
);

CREATE TABLE IF NOT EXISTS president_program_events (
  id char(36) PRIMARY KEY,
  programId char(36) NOT NULL,
  stepId char(36) NULL,
  eventType varchar(64) NOT NULL,
  actorId varchar(191) NOT NULL,
  detailsJson json NOT NULL,
  occurredAt datetime(3) NOT NULL,
  KEY idx_president_program_events (programId,occurredAt)
);
