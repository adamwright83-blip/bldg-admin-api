SELECT
  'vendor reputation evidence table' AS verification_name,
  COUNT(*) = 1 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_reputation_evidence_snapshots';
--> statement-breakpoint
SELECT
  'vendor reputation evidence required columns' AS verification_name,
  COUNT(*) = 19 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_reputation_evidence_snapshots'
  AND column_name IN (
    'id','candidate_id','source_type','source_key','evidence_status','rating',
    'rating_scale_min','rating_scale_max','review_count','source_confidence',
    'source_approved','observed_at','expires_at','source_url','evidence_payload_json',
    'compliance_snapshot_json','recorded_by','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'vendor reputation evidence indexes' AS verification_name,
  COUNT(DISTINCT index_name) = 4 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_reputation_evidence_snapshots'
  AND index_name IN (
    'idx_vendor_reputation_evidence_candidate_status',
    'idx_vendor_reputation_evidence_source_key_status',
    'idx_vendor_reputation_evidence_source_type_status',
    'idx_vendor_reputation_evidence_expires_at'
  );
--> statement-breakpoint
SELECT
  'vendor reputation evidence foreign keys' AS verification_name,
  COUNT(*) = 2 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND table_name = 'vendor_reputation_evidence_snapshots'
  AND constraint_name IN (
    'fk_vendor_reputation_evidence_candidate',
    'fk_vendor_reputation_evidence_source_type'
  );
--> statement-breakpoint
SELECT
  'vendor reputation evidence has no seed rows' AS verification_name,
  COUNT(*) = 0 AS passed
FROM vendor_reputation_evidence_snapshots;
--> statement-breakpoint
SELECT
  'vendor reputation evidence has no legacy vendor foreign keys' AS verification_name,
  COUNT(*) = 0 AS passed
FROM information_schema.key_column_usage
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_reputation_evidence_snapshots'
  AND referenced_table_name IN ('vendors','vendorProfiles','vendorServices');
--> statement-breakpoint
SELECT
  'vendor reputation evidence has no payment, dispatch, or outreach columns' AS verification_name,
  COUNT(*) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_reputation_evidence_snapshots'
  AND column_name IN (
    'payment_authorization_id','capture_id','dispatch_request_id','proof_of_completion_id',
    'outreach_draft_id','provider_message','send_status','delivery_status'
  );
--> statement-breakpoint
SELECT
  'vendor reputation evidence has no raw review text column' AS verification_name,
  COUNT(*) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_reputation_evidence_snapshots'
  AND column_name IN ('review_text','raw_review_text','review_body','reviews_json');
--> statement-breakpoint
SELECT
  'vendor reputation evidence has no protected or proxy columns' AS verification_name,
  COUNT(*) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_reputation_evidence_snapshots'
  AND column_name IN (
    'race','ethnicity','gender','age','religion','disability','protected_class',
    'sexual_orientation','national_origin','zip_code','postal_code'
  );
