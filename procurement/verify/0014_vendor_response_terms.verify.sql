SELECT
  'vendor response terms table exists' AS verification_name,
  COUNT(*) = 1 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_response_terms';
--> statement-breakpoint
SELECT
  'vendor response terms required columns' AS verification_name,
  COUNT(*) = 19 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_response_terms'
  AND column_name IN (
    'id', 'workflow_id', 'candidate_id', 'outreach_event_id',
    'interpretation_status', 'availability_status', 'rate_status',
    'quoted_amount', 'quoted_currency', 'rate_unit',
    'availability_windows_json', 'constraints_json', 'terms_summary_json',
    'confidence', 'observed_at', 'expires_at', 'created_by',
    'created_at', 'updated_at'
  );
--> statement-breakpoint
SELECT
  'vendor response terms indexes' AS verification_name,
  COUNT(DISTINCT index_name) = 4 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_response_terms'
  AND index_name IN (
    'idx_vendor_response_terms_workflow',
    'idx_vendor_response_terms_candidate',
    'idx_vendor_response_terms_outreach_event',
    'idx_vendor_response_terms_status_observed'
  );
--> statement-breakpoint
SELECT
  'vendor response terms foreign keys' AS verification_name,
  COUNT(*) = 3 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND table_name = 'vendor_response_terms'
  AND constraint_name IN (
    'fk_vendor_response_terms_workflow',
    'fk_vendor_response_terms_candidate',
    'fk_vendor_response_terms_outreach_event'
  );
--> statement-breakpoint
SELECT
  'vendor response terms has no seed rows' AS verification_name,
  COUNT(*) = 0 AS passed
FROM vendor_response_terms;
--> statement-breakpoint
SELECT
  'vendor response terms table has no legacy vendor foreign keys' AS verification_name,
  COUNT(*) = 0 AS passed
FROM information_schema.key_column_usage
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_response_terms'
  AND referenced_table_name IN ('vendors','vendorProfiles','vendorServices');
--> statement-breakpoint
SELECT
  'vendor response terms table has no booking, contact, send, or payment fields' AS verification_name,
  COUNT(*) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'vendor_response_terms'
  AND column_name IN (
    'booked', 'booking', 'accepted', 'dispatched', 'completed', 'paid', 'captured',
    'payment_authorization_id', 'capture_id', 'stripe', 'invoice', 'payable',
    'provider_message_id', 'delivery_status', 'send_status', 'sent_at', 'selected_for_execution'
  );
