SELECT 'vendor contact drafts table exists' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'vendor_contact_drafts';
--> statement-breakpoint
SELECT 'vendor contact drafts required columns' AS verification_name, COUNT(*) = 19 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_contact_drafts'
  AND column_name IN ('id','tenant_id','source_key','candidate_id','lead_id','lane','channel',
    'recipient_snapshot','subject_rendered','body_rendered','body_hash','template_key','template_version',
    'founder_escalation_present','forbidden_claims_scan_json','draft_status','created_by','created_at','updated_at');
--> statement-breakpoint
SELECT 'vendor contact drafts candidate_id has no hard FK' AS verification_name, COUNT(*) = 0 AS passed
FROM information_schema.table_constraints
WHERE table_schema = DATABASE() AND table_name = 'vendor_contact_drafts'
  AND constraint_type = 'FOREIGN KEY';
--> statement-breakpoint
SELECT 'vendor contact drafts indexes exist' AS verification_name, COUNT(DISTINCT index_name) = 2 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'vendor_contact_drafts'
  AND index_name IN ('idx_vendor_contact_drafts_source','idx_vendor_contact_drafts_candidate');
--> statement-breakpoint
SELECT 'vendor contact drafts has zero seed rows' AS verification_name, COUNT(*) = 0 AS passed
FROM vendor_contact_drafts;
--> statement-breakpoint
SELECT 'vendor contact attempts table exists' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'vendor_contact_attempts';
--> statement-breakpoint
SELECT 'vendor contact attempts required columns' AS verification_name, COUNT(*) = 38 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_contact_attempts'
  AND column_name IN ('id','tenant_id','outreach_draft_id','source_key','service_request_id','candidate_id',
    'lead_id','lane','channel','recipient_snapshot','draft_subject','draft_body_snapshot','draft_body_hash',
    'template_key','template_version','founder_escalation_present','forbidden_claims_scan_json',
    'send_gate_result_json','automation_mode','provider_adapter','provider_attempt_id','status',
    'status_history_json','latest_reply_json','latest_terms_packet_json','live_provider_invoked',
    'outreach_sent_by_held','provider_responded','provider_accepted','booking_confirmed','payment_authorized',
    'dispatched','idempotency_key','occurred_at','sent_at','created_by','created_at','updated_at');
--> statement-breakpoint
SELECT 'vendor contact attempts foreign key to drafts exists' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.table_constraints
WHERE table_schema = DATABASE() AND table_name = 'vendor_contact_attempts'
  AND constraint_type = 'FOREIGN KEY' AND constraint_name = 'fk_vendor_contact_attempts_draft';
--> statement-breakpoint
SELECT 'vendor contact attempts has exactly one foreign key' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.table_constraints
WHERE table_schema = DATABASE() AND table_name = 'vendor_contact_attempts'
  AND constraint_type = 'FOREIGN KEY';
--> statement-breakpoint
SELECT 'vendor contact attempts unique idempotency key exists' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'vendor_contact_attempts'
  AND index_name = 'uq_vendor_contact_attempts_idempotency' AND non_unique = 0;
--> statement-breakpoint
SELECT 'vendor contact attempts source/candidate/status indexes exist' AS verification_name, COUNT(DISTINCT index_name) = 3 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'vendor_contact_attempts'
  AND index_name IN ('idx_vendor_contact_attempts_source','idx_vendor_contact_attempts_candidate',
    'idx_vendor_contact_attempts_status');
--> statement-breakpoint
SELECT 'vendor contact attempts no-truth-yet check constraint exists' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.table_constraints
WHERE table_schema = DATABASE() AND table_name = 'vendor_contact_attempts'
  AND constraint_type = 'CHECK' AND constraint_name = 'chk_vendor_contact_attempts_no_truth_yet';
--> statement-breakpoint
SELECT 'vendor contact attempts automation_mode enum matches Slice 74a' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_contact_attempts'
  AND column_name = 'automation_mode'
  AND column_type = "enum('noop_provider','gated_provider_future','manual_fallback')";
--> statement-breakpoint
SELECT 'vendor contact attempts status enum matches Slice 74a' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_contact_attempts'
  AND column_name = 'status'
  AND column_type = "enum('draft_ready','gate_passed','queued_noop','sent_noop','response_pending','reply_received','interpreted','blocked')";
--> statement-breakpoint
SELECT 'vendor contact attempts has zero seed rows' AS verification_name, COUNT(*) = 0 AS passed
FROM vendor_contact_attempts;
--> statement-breakpoint
SELECT 'vendor_outreach_drafts remains structurally untouched (candidate_id still NOT NULL)' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_outreach_drafts'
  AND column_name = 'candidate_id' AND is_nullable = 'NO';
--> statement-breakpoint
SELECT 'vendor_outreach_drafts workflow_id remains structurally untouched (still NOT NULL)' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_outreach_drafts'
  AND column_name = 'workflow_id' AND is_nullable = 'NO';
--> statement-breakpoint
SELECT 'vendor_outreach_drafts column count unchanged' AS verification_name, COUNT(*) = 19 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_outreach_drafts';
--> statement-breakpoint
SELECT 'vendor_outreach_conversation_events column count unchanged' AS verification_name, COUNT(*) = 13 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_outreach_conversation_events';
--> statement-breakpoint
SELECT 'vendor_sourcing_candidates structurally untouched (no new FK from this migration)' AS verification_name, COUNT(*) = 0 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE() AND referenced_table_name = 'vendor_sourcing_candidates'
  AND table_name IN ('vendor_contact_drafts','vendor_contact_attempts');
--> statement-breakpoint
SELECT 'procurement_workflows structurally untouched (no new FK from this migration)' AS verification_name, COUNT(*) = 0 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE() AND referenced_table_name = 'procurement_workflows'
  AND table_name IN ('vendor_contact_drafts','vendor_contact_attempts');
