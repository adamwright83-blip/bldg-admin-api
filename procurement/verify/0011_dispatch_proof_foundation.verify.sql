SELECT 'dispatch proof foundation tables' AS verification_name, COUNT(*) = 3 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('dispatch_requests','dispatch_events','proof_of_completion_records');
--> statement-breakpoint
SELECT 'dispatch request required columns' AS verification_name, COUNT(*) = 14 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'dispatch_requests'
  AND column_name IN (
    'id','workflow_id','mandate_state_snapshot_json','candidate_id','vendor_agreement_id',
    'provider_acceptance_id','operator_gate_id','path_type','dispatch_status',
    'dispatch_ready_reason_json','blocked_reason_json','created_by','created_at','updated_at'
  );
--> statement-breakpoint
SELECT 'dispatch event required columns' AS verification_name, COUNT(*) = 11 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'dispatch_events'
  AND column_name IN (
    'id','dispatch_request_id','event_type','event_status','occurred_at','actor_type',
    'actor_identifier','summary','evidence_json','created_by','created_at'
  );
--> statement-breakpoint
SELECT 'proof required columns' AS verification_name, COUNT(*) = 12 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'proof_of_completion_records'
  AND column_name IN (
    'id','dispatch_request_id','proof_status','proof_type','proof_summary','proof_payload_json',
    'verified_by','verified_at','rejected_reason','created_by','created_at','updated_at'
  );
--> statement-breakpoint
SELECT 'dispatch proof indexes' AS verification_name,
  COUNT(DISTINCT CONCAT(table_name, ':', index_name)) = 9 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND (
  (table_name = 'dispatch_requests' AND index_name IN (
    'idx_dispatch_requests_workflow_status','idx_dispatch_requests_candidate',
    'idx_dispatch_requests_agreement','idx_dispatch_requests_acceptance','idx_dispatch_requests_gate'
  )) OR
  (table_name = 'dispatch_events' AND index_name IN (
    'idx_dispatch_events_request_time','idx_dispatch_events_type_status'
  )) OR
  (table_name = 'proof_of_completion_records' AND index_name IN (
    'idx_proof_records_request_status','idx_proof_records_review'
  ))
);
--> statement-breakpoint
SELECT 'dispatch proof foreign keys' AS verification_name, COUNT(*) = 7 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND constraint_name IN (
    'fk_dispatch_requests_workflow','fk_dispatch_requests_candidate','fk_dispatch_requests_agreement',
    'fk_dispatch_requests_acceptance','fk_dispatch_requests_gate','fk_dispatch_events_request',
    'fk_proof_records_dispatch_request'
  );
--> statement-breakpoint
SELECT 'dispatch proof excludes send integration and payment fields' AS verification_name, COUNT(*) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN ('dispatch_requests','dispatch_events','proof_of_completion_records')
  AND column_name IN (
    'sent_at','provider_message_id','delivery_status','delivered_at','webhook_send_id',
    'payment_authorization_id','authorization_id','capture_id','payment_intent_id','stripe_account_id'
  );
--> statement-breakpoint
SELECT 'dispatch proof has no legacy vendor foreign keys' AS verification_name, COUNT(*) = 0 AS passed
FROM information_schema.key_column_usage
WHERE table_schema = DATABASE()
  AND table_name IN ('dispatch_requests','dispatch_events','proof_of_completion_records')
  AND referenced_table_name IN ('vendors','vendorProfiles','vendorServices');
--> statement-breakpoint
SELECT 'dispatch proof schema has no seed rows' AS verification_name,
  (SELECT COUNT(*) FROM dispatch_requests) = 0
  AND (SELECT COUNT(*) FROM dispatch_events) = 0
  AND (SELECT COUNT(*) FROM proof_of_completion_records) = 0 AS passed;
