CREATE TABLE IF NOT EXISTS strategic_diagnoses (
 id varchar(64) PRIMARY KEY, tenantId varchar(64) NOT NULL, canonicalOperatorId varchar(191) NOT NULL,
 businessDate varchar(10) NOT NULL, payloadJson json NOT NULL, createdAt timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_strategic_diagnosis_owner (tenantId, canonicalOperatorId, businessDate, createdAt)
);
CREATE TABLE IF NOT EXISTS strategic_planning_proposals (
 id varchar(64) PRIMARY KEY, tenantId varchar(64) NOT NULL, canonicalOperatorId varchar(191) NOT NULL,
 weekStart varchar(10) NOT NULL, revision varchar(64) NOT NULL, payloadJson json NOT NULL,
 createdAt timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_strategic_proposal_owner (tenantId, canonicalOperatorId, weekStart, createdAt)
);
CREATE TABLE IF NOT EXISTS strategic_proposal_responses (
 id varchar(64) PRIMARY KEY, proposalId varchar(64) NOT NULL, tenantId varchar(64) NOT NULL,
 canonicalOperatorId varchar(191) NOT NULL, responseJson json NOT NULL, createdAt timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_strategic_response_proposal (tenantId, proposalId)
);
