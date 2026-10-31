-- Google capability evidence: the newest real answer JOYSTICK got from each Google API it calls, kept across restarts,
-- so the admin capabilities view can say "live and verified at <time>" or "permission denied at <time>" from evidence
-- rather than from a key being present. One row per capability; written by server/google/googleTelemetry.ts.
-- Applied by scripts/migrate.mjs; idempotent (CREATE TABLE IF NOT EXISTS). Nothing existing is altered.
CREATE TABLE IF NOT EXISTS `google_capability_evidence` (
  `capability` varchar(48) NOT NULL,
  `last_status` varchar(32) NOT NULL,
  `last_checked_at` timestamp NOT NULL,
  `last_success_at` timestamp NULL,
  `last_failure_at` timestamp NULL,
  `last_error` varchar(300) NULL,
  `last_latency_ms` int NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`capability`)
);
