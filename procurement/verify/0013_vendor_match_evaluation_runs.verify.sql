SELECT
  'vendor match evaluation tables exist' AS verification_name,
  COUNT(*) = 2 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('vendor_match_evaluation_runs', 'vendor_match_evaluation_candidates');
--> statement-breakpoint
SELECT
  'vendor match evaluation runs required columns' AS verification_name,
  COUNT(*) = 9 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_match_evaluation_runs'
  AND column_name IN (
    'id','workflow_id','evaluation_status','request_context_json','preference_request_json',
    'evaluation_summary_json','created_by','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'vendor match evaluation candidates required columns' AS verification_name,
  COUNT(*) = 11 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_match_evaluation_candidates'
  AND column_name IN (
    'id','evaluation_run_id','candidate_id','evidence_snapshot_id','match_status','rank_order','score',
    'decision_reasons_json','risk_flags_json','evidence_summary_json','created_at'
  );
--> statement-breakpoint
SELECT
  'vendor match evaluation runs indexes' AS verification_name,
  COUNT(DISTINCT index_name) = 2 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_match_evaluation_runs'
  AND index_name IN (
    'idx_vendor_match_evaluation_runs_workflow_status',
    'idx_vendor_match_evaluation_runs_status_created'
  );
--> statement-breakpoint
SELECT
  'vendor match evaluation candidates indexes' AS verification_name,
  COUNT(DISTINCT index_name) = 4 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_match_evaluation_candidates'
  AND index_name IN (
    'uq_vendor_match_evaluation_candidates_run_candidate',
    'idx_vendor_match_evaluation_candidates_run_rank',
    'idx_vendor_match_evaluation_candidates_candidate_status',
    'idx_vendor_match_evaluation_candidates_evidence'
  );
--> statement-breakpoint
SELECT
  'vendor match evaluation runs foreign keys' AS verification_name,
  COUNT(*) = 1 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND table_name = 'vendor_match_evaluation_runs'
  AND constraint_name IN ('fk_vendor_match_evaluation_runs_workflow');
--> statement-breakpoint
SELECT
  'vendor match evaluation candidates foreign keys' AS verification_name,
  COUNT(*) = 3 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND table_name = 'vendor_match_evaluation_candidates'
  AND constraint_name IN (
    'fk_vendor_match_evaluation_candidates_run',
    'fk_vendor_match_evaluation_candidates_candidate',
    'fk_vendor_match_evaluation_candidates_evidence'
  );
--> statement-breakpoint
SELECT
  'vendor match evaluation runs has no seed rows' AS verification_name,
  COUNT(*) = 0 AS passed
FROM vendor_match_evaluation_runs;
--> statement-breakpoint
SELECT
  'vendor match evaluation candidates has no seed rows' AS verification_name,
  COUNT(*) = 0 AS passed
FROM vendor_match_evaluation_candidates;
--> statement-breakpoint
SELECT
  'vendor match evaluation tables have no legacy vendor foreign keys' AS verification_name,
  COUNT(*) = 0 AS passed
FROM information_schema.key_column_usage
WHERE table_schema = DATABASE()
  AND table_name IN ('vendor_match_evaluation_runs', 'vendor_match_evaluation_candidates')
  AND referenced_table_name IN ('vendors','vendorProfiles','vendorServices');
--> statement-breakpoint
SELECT
  'vendor match evaluation tables have no booking, contact, send, or payment fields' AS verification_name,
  COUNT(*) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN ('vendor_match_evaluation_runs', 'vendor_match_evaluation_candidates')
  AND column_name IN (
    'booked','booking','accepted','dispatched','completed','paid','captured','payment','stripe',
    'send','sent','delivery','provider_message','outreach_sent','contacted','selected_for_execution'
  );
