SELECT 'vendor proposal tables exist' AS verification_name, COUNT(*) = 3 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('vendor_proposals','vendor_proposal_versions','vendor_proposal_version_evidence');
--> statement-breakpoint
SELECT 'vendor proposals required columns' AS verification_name, COUNT(*) = 9 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_proposals'
  AND column_name IN ('id','workflow_id','candidate_id','job_card_source_type','job_card_source_id',
    'proposal_status','created_by','created_at','updated_at');
--> statement-breakpoint
SELECT 'vendor proposal versions required columns' AS verification_name, COUNT(*) = 15 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_proposal_versions'
  AND column_name IN ('id','proposal_id','version','response_terms_id','job_card_snapshot_json',
    'job_card_snapshot_hash','eligibility_decision_json','fit_decision_json','truth_flags_json',
    'resident_truth_inputs_json','review_state','expires_at','audit_metadata_json','created_by','created_at');
--> statement-breakpoint
SELECT 'vendor proposal evidence required columns' AS verification_name, COUNT(*) = 4 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_proposal_version_evidence'
  AND column_name IN ('proposal_version_id','evidence_snapshot_id','evidence_role','created_at');
--> statement-breakpoint
SELECT 'vendor proposal indexes exist' AS verification_name, COUNT(DISTINCT CONCAT(table_name,':',index_name)) = 8 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND ((table_name = 'vendor_proposals' AND index_name IN (
      'idx_vendor_proposals_workflow_status','idx_vendor_proposals_candidate_status','idx_vendor_proposals_job_card_source'))
    OR (table_name = 'vendor_proposal_versions' AND index_name IN (
      'uq_vendor_proposal_versions_proposal_version','idx_vendor_proposal_versions_proposal_review',
      'idx_vendor_proposal_versions_terms','idx_vendor_proposal_versions_expiry'))
    OR (table_name = 'vendor_proposal_version_evidence' AND index_name = 'idx_vendor_proposal_version_evidence_snapshot'));
--> statement-breakpoint
SELECT 'vendor proposal foreign keys exist' AS verification_name, COUNT(*) = 6 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND constraint_name IN ('fk_vendor_proposals_workflow','fk_vendor_proposals_candidate',
    'fk_vendor_proposal_versions_proposal','fk_vendor_proposal_versions_terms',
    'fk_vendor_proposal_version_evidence_version','fk_vendor_proposal_version_evidence_snapshot');
--> statement-breakpoint
SELECT 'vendor proposal storage has no seed rows' AS verification_name,
  ((SELECT COUNT(*) FROM vendor_proposals) = 0
   AND (SELECT COUNT(*) FROM vendor_proposal_versions) = 0
   AND (SELECT COUNT(*) FROM vendor_proposal_version_evidence) = 0) AS passed;
--> statement-breakpoint
SELECT 'vendor proposal storage has no legacy vendor foreign keys' AS verification_name, COUNT(*) = 0 AS passed
FROM information_schema.key_column_usage
WHERE table_schema = DATABASE()
  AND table_name IN ('vendor_proposals','vendor_proposal_versions','vendor_proposal_version_evidence')
  AND referenced_table_name IN ('vendors','vendorProfiles','vendorServices');
--> statement-breakpoint
SELECT 'vendor proposal storage has no execution truth columns' AS verification_name, COUNT(*) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN ('vendor_proposals','vendor_proposal_versions','vendor_proposal_version_evidence')
  AND column_name IN ('booked','booking','provider_accepted','accepted','paid','captured','dispatched','completed',
    'payment_authorization_id','capture_id','stripe','invoice','payable','provider_message_id','delivery_status',
    'send_status','sent_at','selected_for_execution');
