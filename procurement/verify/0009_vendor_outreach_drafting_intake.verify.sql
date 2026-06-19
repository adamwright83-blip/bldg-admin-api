SELECT 'vendor outreach drafting tables' AS verification_name, COUNT(*) = 2 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('vendor_outreach_drafts','vendor_outreach_conversation_events');
--> statement-breakpoint
SELECT 'vendor outreach draft required columns' AS verification_name, COUNT(*) = 19 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_outreach_drafts'
  AND column_name IN (
    'id','candidate_id','workflow_id','score_id','template_key','template_version',
    'legal_document_key','legal_document_version','outreach_channel','draft_status',
    'subject_rendered','body_rendered','body_hash','render_variables_json','lint_result_json',
    'operator_gate_id','created_by','created_at','updated_at'
  );
--> statement-breakpoint
SELECT 'vendor outreach conversation required columns' AS verification_name, COUNT(*) = 13 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_outreach_conversation_events'
  AND column_name IN (
    'id','candidate_id','outreach_draft_id','workflow_id','direction','channel','event_status',
    'occurred_at','summary','raw_payload_json','evidence_json','created_by','created_at'
  );
--> statement-breakpoint
SELECT 'vendor outreach drafting indexes' AS verification_name,
  COUNT(DISTINCT CONCAT(table_name, ':', index_name)) = 8 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND (
  (table_name = 'vendor_outreach_drafts' AND index_name IN (
    'idx_vendor_outreach_drafts_candidate_status','idx_vendor_outreach_drafts_workflow',
    'idx_vendor_outreach_drafts_template','idx_vendor_outreach_drafts_legal','idx_vendor_outreach_drafts_gate'
  )) OR
  (table_name = 'vendor_outreach_conversation_events' AND index_name IN (
    'idx_vendor_outreach_events_candidate_time','idx_vendor_outreach_events_draft_time',
    'idx_vendor_outreach_events_workflow_status'
  ))
);
--> statement-breakpoint
SELECT 'vendor outreach drafting foreign keys' AS verification_name, COUNT(*) = 9 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND constraint_name IN (
    'fk_vendor_outreach_drafts_candidate','fk_vendor_outreach_drafts_workflow',
    'fk_vendor_outreach_drafts_score','fk_vendor_outreach_drafts_template',
    'fk_vendor_outreach_drafts_legal','fk_vendor_outreach_drafts_gate',
    'fk_vendor_outreach_events_candidate','fk_vendor_outreach_events_draft',
    'fk_vendor_outreach_events_workflow'
  );
--> statement-breakpoint
SELECT 'vendor outreach schema excludes send and delivery fields' AS verification_name, COUNT(*) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN ('vendor_outreach_drafts','vendor_outreach_conversation_events')
  AND column_name IN (
    'sent_at','provider_message_id','webhook_send_id','delivery_status','delivered_at',
    'agreement_accepted_at','provider_accepted_at','dispatched_at'
  );
--> statement-breakpoint
SELECT 'vendor outreach schema has no seed rows' AS verification_name,
  (SELECT COUNT(*) FROM vendor_outreach_drafts) = 0
  AND (SELECT COUNT(*) FROM vendor_outreach_conversation_events) = 0 AS passed;
--> statement-breakpoint
SELECT 'vendor outreach schema has no legacy vendor foreign keys' AS verification_name, COUNT(*) = 0 AS passed
FROM information_schema.key_column_usage
WHERE table_schema = DATABASE()
  AND table_name IN ('vendor_outreach_drafts','vendor_outreach_conversation_events')
  AND referenced_table_name IN ('vendors','vendorProfiles','vendorServices');
