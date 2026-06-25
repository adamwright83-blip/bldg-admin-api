SELECT
  'vendor candidate availability intake table' AS verification_name,
  COUNT(*) = 1 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_candidate_availability_intake';
--> statement-breakpoint
SELECT
  'vendor candidate availability intake required columns' AS verification_name,
  COUNT(*) = 17 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_candidate_availability_intake'
  AND column_name IN (
    'id','tenant_id','candidate_id','mobile_service_confirmed','service_areas_json',
    'recurring_availability_json','minimum_notice_hours','appointment_duration_minutes',
    'travel_buffer_minutes','booking_url','calendar_method','preferred_contact_channel',
    'blackout_notes','onboarding_notes','created_by','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'vendor candidate availability intake mobile_service_confirmed enum is constrained' AS verification_name,
  COLUMN_TYPE = "enum('yes','no','unknown')" AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_candidate_availability_intake'
  AND column_name = 'mobile_service_confirmed';
--> statement-breakpoint
SELECT
  'vendor candidate availability intake calendar_method enum is constrained' AS verification_name,
  COLUMN_TYPE = "enum('held_schedule','booking_url','google_calendar_later','manual_confirmation')" AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_candidate_availability_intake'
  AND column_name = 'calendar_method';
--> statement-breakpoint
SELECT
  'vendor candidate availability intake preferred_contact_channel enum is constrained' AS verification_name,
  COLUMN_TYPE = "enum('phone','email','text','website','booking_url')" AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_candidate_availability_intake'
  AND column_name = 'preferred_contact_channel';
--> statement-breakpoint
SELECT
  'vendor candidate availability intake one row per tenant/candidate' AS verification_name,
  COUNT(*) = 2 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_candidate_availability_intake'
  AND index_name = 'uq_vendor_candidate_availability_intake_candidate'
  AND non_unique = 0;
--> statement-breakpoint
SELECT
  'vendor candidate availability intake references only the sourcing candidates table' AS verification_name,
  (SELECT COUNT(*) FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE()
      AND table_name = 'vendor_candidate_availability_intake'
      AND referenced_table_name IS NOT NULL
      AND referenced_table_name != 'vendor_sourcing_candidates') = 0 AS passed;
