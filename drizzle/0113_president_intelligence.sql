-- Company-only immutable intelligence; fixture evidence is isolated by origin.
CREATE TABLE IF NOT EXISTS president_evidence (
 id varchar(64) PRIMARY KEY, origin varchar(16) NOT NULL, source varchar(512) NOT NULL,
 capturedAt datetime(3) NOT NULL, sourceAt datetime(3) NULL, sha256 char(64) NOT NULL,
 kind varchar(24) NOT NULL, confidence double NOT NULL, availability varchar(16) NOT NULL,
 expiresAt datetime(3) NULL, statement text NOT NULL,
 KEY idx_president_evidence_origin (origin,capturedAt)
);
CREATE TABLE IF NOT EXISTS president_intelligence_records (
 id varchar(64) PRIMARY KEY, origin varchar(16) NOT NULL, kind varchar(32) NOT NULL,
 recordKey varchar(191) NOT NULL, version int NOT NULL, createdAt datetime(3) NOT NULL,
 evidenceIds json NOT NULL, payload json NOT NULL, supersedesId varchar(64) NULL,
 idempotencyKey varchar(191) NOT NULL, requestHash char(64) NOT NULL,
 UNIQUE KEY uq_president_record_revision (origin,kind,recordKey,version),
 UNIQUE KEY uq_president_record_retry (origin,idempotencyKey),
 KEY idx_president_record_kind (origin,kind,createdAt)
);
