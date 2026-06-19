SELECT
  'provider acceptance tables' AS verification_name,
  COUNT(*) = 2 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('guest_readiness_provider_acceptances', 'guest_readiness_booking_truth_events');
--> statement-breakpoint
SELECT
  'provider acceptance required columns' AS verification_name,
  COUNT(*) = 25 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'guest_readiness_provider_acceptances'
  AND column_name IN (
    'id','guest_readiness_plan_item_id','tenant_id','bldg_user_id','building_slug',
    'vendor_id','vendor_name_snapshot','vendor_contact_snapshot_json','vendor_source_type',
    'acceptance_type','acceptance_status','accepted_at','declined_at','countered_at',
    'expires_at','service_window_start','service_window_end','accepted_price_cents',
    'currency','terms_snapshot_json','evidence_json','decision_evidence_json',
    'created_by','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'booking truth event required columns' AS verification_name,
  COUNT(*) = 8 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'guest_readiness_booking_truth_events'
  AND column_name IN (
    'id','provider_acceptance_id','guest_readiness_plan_item_id','event_type',
    'actor_type','actor_id','event_data_json','created_at'
  );
--> statement-breakpoint
SELECT
  'provider acceptance indexes' AS verification_name,
  COUNT(DISTINCT CONCAT(table_name, ':', index_name)) = 7 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND (
    (table_name = 'guest_readiness_provider_acceptances' AND index_name IN (
      'idx_provider_acceptances_item','idx_provider_acceptances_resident',
      'idx_provider_acceptances_expiry','idx_provider_acceptances_vendor'
    )) OR
    (table_name = 'guest_readiness_booking_truth_events' AND index_name IN (
      'idx_booking_truth_events_acceptance_time','idx_booking_truth_events_item_time',
      'idx_booking_truth_events_type_time'
    ))
  );
--> statement-breakpoint
SELECT
  'provider acceptance foreign keys' AS verification_name,
  COUNT(*) = 3 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND constraint_name IN (
    'fk_provider_acceptances_item','fk_booking_truth_events_acceptance','fk_booking_truth_events_item'
  );
--> statement-breakpoint
SELECT
  'acceptance status excludes fake booked state' AS verification_name,
  LOCATE('booked', LOWER(column_type)) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'guest_readiness_provider_acceptances'
  AND column_name = 'acceptance_status';
--> statement-breakpoint
SELECT
  'event type excludes fake booked state' AS verification_name,
  LOCATE('booked', LOWER(column_type)) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'guest_readiness_booking_truth_events'
  AND column_name = 'event_type';
