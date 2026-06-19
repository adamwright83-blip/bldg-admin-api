SELECT
  'vendor sourcing score table' AS verification_name,
  COUNT(*) = 1 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_sourcing_candidate_scores';
--> statement-breakpoint
SELECT
  'vendor sourcing score required columns' AS verification_name,
  COUNT(*) = 20 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_sourcing_candidate_scores'
  AND column_name IN (
    'id','candidate_id','workflow_id','tenant_id','score_version','score_status',
    'category_match_score','geographic_fit_score','contactability_score',
    'pricing_signal_score','booking_signal_score','review_signal_score','overall_score',
    'decision','decision_reasons_json','score_inputs_snapshot_json','score_evidence_json',
    'created_by','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'vendor sourcing score indexes' AS verification_name,
  COUNT(DISTINCT index_name) = 3 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_sourcing_candidate_scores'
  AND index_name IN (
    'idx_vendor_candidate_scores_version',
    'idx_vendor_candidate_scores_tenant_status',
    'idx_vendor_candidate_scores_workflow'
  );
--> statement-breakpoint
SELECT
  'vendor sourcing score foreign keys' AS verification_name,
  COUNT(*) = 2 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND table_name = 'vendor_sourcing_candidate_scores'
  AND constraint_name IN (
    'fk_vendor_candidate_scores_candidate',
    'fk_vendor_candidate_scores_workflow'
  );
--> statement-breakpoint
SELECT
  'vendor sourcing score reuses operator gates' AS verification_name,
  COUNT(*) = 1 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'procurement_operator_gates';
--> statement-breakpoint
SELECT
  'vendor sourcing score has no legacy vendor foreign keys' AS verification_name,
  COUNT(*) = 0 AS passed
FROM information_schema.key_column_usage
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_sourcing_candidate_scores'
  AND referenced_table_name IN ('vendors','vendorProfiles','vendorServices');
--> statement-breakpoint
SELECT
  'vendor sourcing score has no restricted decision fields' AS verification_name,
  COUNT(*) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_sourcing_candidate_scores'
  AND column_name IN (
    'creditworthiness','race','ethnicity','gender','age','religion',
    'disability','protected_class','llm_vibe','vibe_score'
  );
