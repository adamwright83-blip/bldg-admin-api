SELECT
  'vendor acquisition mission table' AS verification_name,
  COUNT(*) = 1 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_acquisition_missions';
--> statement-breakpoint
SELECT
  'vendor acquisition mission required columns' AS verification_name,
  COUNT(*) = 12 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_acquisition_missions'
  AND column_name IN (
    'id','tenant_id','category','geography_label','target_quantity','quality_gates_json',
    'outreach_mode','status','deadline_at','created_by','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'vendor acquisition mission outreach mode enum excludes nothing unexpected' AS verification_name,
  COLUMN_TYPE = "enum('draft_only','supervised_send','auto_send')" AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_acquisition_missions'
  AND column_name = 'outreach_mode';
--> statement-breakpoint
SELECT
  'vendor acquisition mission status enum is the expected lifecycle' AS verification_name,
  COLUMN_TYPE = "enum('draft','active','completed','cancelled')" AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_acquisition_missions'
  AND column_name = 'status';
--> statement-breakpoint
SELECT
  'vendor acquisition mission indexes' AS verification_name,
  COUNT(DISTINCT index_name) = 2 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_acquisition_missions'
  AND index_name IN (
    'idx_vendor_acquisition_missions_tenant_status',
    'idx_vendor_acquisition_missions_category'
  );
--> statement-breakpoint
SELECT
  'vendor acquisition mission has no legacy vendor/payment foreign keys' AS verification_name,
  (SELECT COUNT(*) FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE()
      AND table_name = 'vendor_acquisition_missions'
      AND referenced_table_name IS NOT NULL) = 0 AS passed;
