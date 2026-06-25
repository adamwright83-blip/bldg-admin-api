SELECT
  'vendor acquisition mission candidate matches table' AS verification_name,
  COUNT(*) = 1 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_acquisition_mission_candidate_matches';
--> statement-breakpoint
SELECT
  'vendor acquisition mission candidate matches required columns' AS verification_name,
  COUNT(*) = 13 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_acquisition_mission_candidate_matches'
  AND column_name IN (
    'id','tenant_id','mission_id','candidate_id','matched_query','query_planner_source',
    'service_mode','rank_score','rank_position','is_shortlisted','match_evidence_json',
    'created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'vendor acquisition mission candidate matches query_planner_source enum is constrained' AS verification_name,
  COLUMN_TYPE = "enum('anthropic_structured','deterministic_fallback','unknown')" AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_acquisition_mission_candidate_matches'
  AND column_name = 'query_planner_source';
--> statement-breakpoint
SELECT
  'vendor acquisition mission candidate matches service_mode enum is constrained' AS verification_name,
  COLUMN_TYPE = "enum('mobile_required','building_service_required','storefront_ok','unknown')" AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_acquisition_mission_candidate_matches'
  AND column_name = 'service_mode';
--> statement-breakpoint
SELECT
  'vendor acquisition mission candidate matches unique mission/candidate index' AS verification_name,
  COUNT(*) = 3 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_acquisition_mission_candidate_matches'
  AND index_name = 'uq_vendor_mission_candidate_matches_mission_candidate'
  AND non_unique = 0;
--> statement-breakpoint
SELECT
  'vendor acquisition mission candidate matches shortlist index' AS verification_name,
  COUNT(*) = 4 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_acquisition_mission_candidate_matches'
  AND index_name = 'idx_vendor_mission_candidate_matches_shortlist';
--> statement-breakpoint
SELECT
  'vendor acquisition mission candidate matches candidate index' AS verification_name,
  COUNT(*) = 2 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_acquisition_mission_candidate_matches'
  AND index_name = 'idx_vendor_mission_candidate_matches_candidate';
--> statement-breakpoint
SELECT
  'vendor acquisition mission candidate matches references only missions and sourcing candidates' AS verification_name,
  (SELECT COUNT(*) FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE()
      AND table_name = 'vendor_acquisition_mission_candidate_matches'
      AND referenced_table_name IS NOT NULL
      AND referenced_table_name NOT IN ('vendor_acquisition_missions', 'vendor_sourcing_candidates')) = 0 AS passed;
