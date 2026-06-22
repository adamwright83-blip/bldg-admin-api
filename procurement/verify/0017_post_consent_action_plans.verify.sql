SELECT 'post consent action plans table exists' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'post_consent_action_plans';
--> statement-breakpoint
SELECT 'post consent action plans required columns' AS verification_name, COUNT(*) = 11 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'post_consent_action_plans'
  AND column_name IN ('id','consent_id','proposal_version_id','tenant_id','bldg_user_id','status',
    'reasons_json','eligible_for_auto_send_pilot','proposal_version_snapshot_hash','created_by','created_at');
--> statement-breakpoint
SELECT 'post consent action plans indexes exist' AS verification_name, COUNT(DISTINCT index_name) = 2 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'post_consent_action_plans'
  AND index_name IN ('uq_post_consent_action_plans_consent','idx_post_consent_action_plans_tenant_user');
--> statement-breakpoint
SELECT 'post consent action plans unique key covers consent_id' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'post_consent_action_plans'
  AND index_name = 'uq_post_consent_action_plans_consent' AND column_name = 'consent_id';
--> statement-breakpoint
SELECT 'post consent action plans foreign keys exist' AS verification_name, COUNT(*) = 2 AS passed
FROM information_schema.table_constraints
WHERE table_schema = DATABASE() AND table_name = 'post_consent_action_plans'
  AND constraint_type = 'FOREIGN KEY'
  AND constraint_name IN ('fk_post_consent_action_plans_consent','fk_post_consent_action_plans_version');
--> statement-breakpoint
SELECT 'post consent action plans has zero seed rows' AS verification_name, COUNT(*) = 0 AS passed
FROM post_consent_action_plans;
--> statement-breakpoint
SELECT 'post consent outreach drafts table exists' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'post_consent_outreach_drafts';
--> statement-breakpoint
SELECT 'post consent outreach drafts required columns' AS verification_name, COUNT(*) = 20 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'post_consent_outreach_drafts'
  AND column_name IN ('id','plan_id','consent_id','proposal_version_id','tenant_id','bldg_user_id',
    'vendor_candidate_id','service_category','template_key','template_version','subject_rendered',
    'draft_body','draft_body_hash','variables_json','lint_result_json','founder_escalation_present',
    'status','created_by','created_at','updated_at');
--> statement-breakpoint
SELECT 'post consent outreach drafts indexes exist' AS verification_name, COUNT(DISTINCT index_name) = 3 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'post_consent_outreach_drafts'
  AND index_name IN ('uq_post_consent_outreach_drafts_plan','idx_post_consent_outreach_drafts_tenant_user',
    'idx_post_consent_outreach_drafts_candidate');
--> statement-breakpoint
SELECT 'post consent outreach drafts unique key covers plan_id' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'post_consent_outreach_drafts'
  AND index_name = 'uq_post_consent_outreach_drafts_plan' AND column_name = 'plan_id';
--> statement-breakpoint
SELECT 'post consent outreach drafts foreign keys exist' AS verification_name, COUNT(*) = 4 AS passed
FROM information_schema.table_constraints
WHERE table_schema = DATABASE() AND table_name = 'post_consent_outreach_drafts'
  AND constraint_type = 'FOREIGN KEY'
  AND constraint_name IN ('fk_post_consent_outreach_drafts_plan','fk_post_consent_outreach_drafts_consent',
    'fk_post_consent_outreach_drafts_version','fk_post_consent_outreach_drafts_candidate');
--> statement-breakpoint
SELECT 'post consent outreach drafts has zero seed rows' AS verification_name, COUNT(*) = 0 AS passed
FROM post_consent_outreach_drafts;
--> statement-breakpoint
SELECT 'vendor_outreach_drafts workflow_id remains NOT NULL (untouched)' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'vendor_outreach_drafts'
  AND column_name = 'workflow_id' AND is_nullable = 'NO';
