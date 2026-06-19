SELECT
  'vendor sourcing tables' AS verification_name,
  COUNT(*) = 2 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('vendor_source_registry','vendor_sourcing_candidates');
--> statement-breakpoint
SELECT
  'vendor source registry required columns' AS verification_name,
  COUNT(*) = 8 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_source_registry'
  AND column_name IN (
    'source_type','compliance_class','allowed_use_flags_json','prohibited_use_flags_json',
    'source_policy_json','notes','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'vendor sourcing candidate required columns' AS verification_name,
  COUNT(*) = 16 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_sourcing_candidates'
  AND column_name IN (
    'id','tenant_id','building_slug','source_type','source_reference','category','business_name',
    'contact_json','public_profile_json','pricing_signals_json','evidence_json',
    'source_compliance_snapshot_json','sourcing_status','created_by','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'vendor source registry exact seed set' AS verification_name,
  COUNT(*) = 3
    AND SUM(source_type = 'manual_operator_list') = 1
    AND SUM(source_type = 'public_business_directory') = 1
    AND SUM(source_type = 'permitted_public_fetch') = 1 AS passed
FROM vendor_source_registry;
--> statement-breakpoint
SELECT
  'vendor source registry compliance prohibitions' AS verification_name,
  COUNT(*) = 3 AS passed
FROM vendor_source_registry
WHERE JSON_EXTRACT(prohibited_use_flags_json, '$.login_bypass') = true
  AND JSON_EXTRACT(prohibited_use_flags_json, '$.tos_violating_access') = true
  AND JSON_EXTRACT(prohibited_use_flags_json, '$.hidden_bulk_scraping') = true
  AND JSON_EXTRACT(prohibited_use_flags_json, '$.purchased_lead_lists') = true;
--> statement-breakpoint
SELECT
  'vendor sourcing indexes' AS verification_name,
  COUNT(DISTINCT index_name) = 3 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_sourcing_candidates'
  AND index_name IN (
    'idx_vendor_sourcing_candidates_tenant_status',
    'idx_vendor_sourcing_candidates_building_category',
    'idx_vendor_sourcing_candidates_source'
  );
--> statement-breakpoint
SELECT
  'vendor sourcing source foreign key' AS verification_name,
  COUNT(*) = 1 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND table_name = 'vendor_sourcing_candidates'
  AND constraint_name = 'fk_vendor_sourcing_candidates_source';
--> statement-breakpoint
SELECT
  'vendor sourcing has no legacy vendor foreign keys' AS verification_name,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'vendor_sourcing_candidates'
      AND column_name = 'vendor_id') = 0
  AND
  (SELECT COUNT(*) FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE()
      AND table_name = 'vendor_sourcing_candidates'
      AND referenced_table_name IN ('vendors','vendorProfiles','vendorServices')) = 0 AS passed;
--> statement-breakpoint
SELECT
  'vendor source names avoid unrestricted scraping language' AS verification_name,
  COUNT(*) = 0 AS passed
FROM vendor_source_registry
WHERE source_type LIKE '%scrape%';
