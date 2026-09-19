-- Claire Intelligence Repair Part 2, Slice A: answer-path routing telemetry.
-- Additive and nullable. Extends claire_generation_logs rather than adding a
-- parallel table, so one query answers "which path answered this turn?" for
-- both model generations and deterministic renderings.
ALTER TABLE claire_generation_logs ADD COLUMN answerPath VARCHAR(32) NULL;
ALTER TABLE claire_generation_logs ADD COLUMN businessReader VARCHAR(48) NULL;
ALTER TABLE claire_generation_logs ADD COLUMN rendererProse TINYINT(1) NULL;
ALTER TABLE claire_generation_logs ADD COLUMN surface VARCHAR(16) NULL;
ALTER TABLE claire_generation_logs ADD COLUMN turnKind VARCHAR(32) NULL;
ALTER TABLE claire_generation_logs ADD COLUMN modelRequested VARCHAR(64) NULL;
ALTER TABLE claire_generation_logs ADD COLUMN modelServed VARCHAR(64) NULL;
ALTER TABLE claire_generation_logs ADD COLUMN promptChars INT NULL;
ALTER TABLE claire_generation_logs ADD COLUMN answerPathDetailJson JSON NULL;
CREATE INDEX idx_claire_generation_log_answer_path
  ON claire_generation_logs (tenantId, answerPath, createdAt);
