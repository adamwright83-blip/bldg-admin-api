SELECT 'vendor agreement onboarding tables' AS verification_name, COUNT(*) = 2 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('vendor_agreements','vendor_agreement_events');
--> statement-breakpoint
SELECT 'vendor agreement required columns' AS verification_name, COUNT(*) = 23 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_agreements'
  AND column_name IN (
    'id','candidate_id','workflow_id','outreach_draft_id','legal_document_key','legal_document_version',
    'vendor_agreement_status','agreement_subject_type','agreement_subject_id','signer_name','signer_email',
    'terms_version','terms_hash','body_hash','rendered_agreement_hash','signature_evidence_json','signed_at',
    'revoked_at','expires_at','evidence_json','created_by','created_at','updated_at'
  );
--> statement-breakpoint
SELECT 'vendor agreement event required columns' AS verification_name, COUNT(*) = 11 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_agreement_events'
  AND column_name IN (
    'id','vendor_agreement_id','event_type','event_status','occurred_at','actor_type',
    'actor_identifier','summary','evidence_json','created_by','created_at'
  );
--> statement-breakpoint
SELECT 'vendor agreement onboarding indexes' AS verification_name,
  COUNT(DISTINCT CONCAT(table_name, ':', index_name)) = 7 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND (
  (table_name = 'vendor_agreements' AND index_name IN (
    'idx_vendor_agreements_candidate_status','idx_vendor_agreements_workflow',
    'idx_vendor_agreements_outreach_draft','idx_vendor_agreements_legal_document',
    'idx_vendor_agreements_expiry'
  )) OR
  (table_name = 'vendor_agreement_events' AND index_name IN (
    'idx_vendor_agreement_events_agreement_time','idx_vendor_agreement_events_type_status'
  ))
);
--> statement-breakpoint
SELECT 'vendor agreement onboarding foreign keys' AS verification_name, COUNT(*) = 5 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND constraint_name IN (
    'fk_vendor_agreements_candidate','fk_vendor_agreements_workflow',
    'fk_vendor_agreements_outreach_draft','fk_vendor_agreements_legal_document',
    'fk_vendor_agreement_events_agreement'
  );
--> statement-breakpoint
SELECT 'vendor agreement exact status and evidence fields' AS verification_name,
  SUM(column_name = 'vendor_agreement_status'
    AND column_type = "enum('draft','pending_vendor_review','signed','revoked','expired','rejected')") = 1
  AND SUM(column_name IN ('terms_version','terms_hash','body_hash','rendered_agreement_hash',
    'signature_evidence_json','signed_at')) = 6 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_agreements';
--> statement-breakpoint
SELECT 'vendor agreement schema excludes legacy payment and execution fields' AS verification_name, COUNT(*) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN ('vendor_agreements','vendor_agreement_events')
  AND column_name IN (
    'vendor_id','acceptance_status','stripe_account_id','stripe_connect_account_id','payment_method_id',
    'authorization_id','capture_id','dispatch_id','dispatched_at','provider_accepted_at','booking_verified_at'
  );
--> statement-breakpoint
SELECT 'vendor agreement schema has no legacy vendor foreign keys' AS verification_name, COUNT(*) = 0 AS passed
FROM information_schema.key_column_usage
WHERE table_schema = DATABASE()
  AND table_name IN ('vendor_agreements','vendor_agreement_events')
  AND referenced_table_name IN ('vendors','vendorProfiles','vendorServices');
--> statement-breakpoint
SELECT 'vendor agreement schema has no seed rows' AS verification_name,
  (SELECT COUNT(*) FROM vendor_agreements) = 0
  AND (SELECT COUNT(*) FROM vendor_agreement_events) = 0 AS passed;
