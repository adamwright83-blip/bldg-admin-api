SELECT 'resident proposal consents table exists' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = 'resident_proposal_consents';
--> statement-breakpoint
SELECT 'resident proposal consents required columns' AS verification_name, COUNT(*) = 10 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'resident_proposal_consents'
  AND column_name IN ('id','proposal_version_id','tenant_id','bldg_user_id','consent_action',
    'copy_version','proposal_version_snapshot_hash','audit_metadata_json','created_by','consented_at');
--> statement-breakpoint
SELECT 'resident proposal consents indexes exist' AS verification_name, COUNT(DISTINCT index_name) = 2 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'resident_proposal_consents'
  AND index_name IN ('uq_resident_proposal_consents_version_tenant_user','idx_resident_proposal_consents_tenant_user');
--> statement-breakpoint
SELECT 'resident proposal consents unique key covers tenant_id' AS verification_name, COUNT(*) = 3 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'resident_proposal_consents'
  AND index_name = 'uq_resident_proposal_consents_version_tenant_user'
  AND column_name IN ('proposal_version_id','tenant_id','bldg_user_id');
--> statement-breakpoint
SELECT 'resident proposal consents foreign key exists' AS verification_name, COUNT(*) = 1 AS passed
FROM information_schema.table_constraints
WHERE table_schema = DATABASE() AND table_name = 'resident_proposal_consents'
  AND constraint_name = 'fk_resident_proposal_consents_version' AND constraint_type = 'FOREIGN KEY';
--> statement-breakpoint
SELECT 'resident proposal consents has zero seed rows' AS verification_name, COUNT(*) = 0 AS passed
FROM resident_proposal_consents;
