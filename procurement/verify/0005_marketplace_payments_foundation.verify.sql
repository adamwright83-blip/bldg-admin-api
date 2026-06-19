SELECT
  'marketplace payment tables' AS verification_name,
  COUNT(*) = 8 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'marketplace_payment_authorizations','marketplace_payment_captures',
    'marketplace_payment_allocations','marketplace_vendor_payables',
    'marketplace_stripe_events','marketplace_refunds','marketplace_disputes',
    'marketplace_payment_idempotency_keys'
  );
--> statement-breakpoint
SELECT
  'marketplace authorization required columns' AS verification_name,
  COUNT(*) = 22 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'marketplace_payment_authorizations'
  AND column_name IN (
    'id','guest_readiness_plan_item_id','provider_acceptance_id','authority_grant_id',
    'tenant_id','bldg_user_id','building_slug','vendor_id','vendor_connect_account_id_snapshot',
    'amount_cents','currency','state','stripe_customer_id','stripe_payment_method_id',
    'stripe_payment_intent_id','policy_decision_json','idempotency_key','expires_at',
    'authorized_at','cancelled_at','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'marketplace capture required columns' AS verification_name,
  COUNT(*) = 12 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'marketplace_payment_captures'
  AND column_name IN (
    'id','authorization_id','captured_amount_cents','state','stripe_payment_intent_id',
    'failure_code','failure_message','truth_check_decision_json','idempotency_key',
    'captured_at','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'marketplace allocation required columns' AS verification_name,
  COUNT(*) = 6 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'marketplace_payment_allocations'
  AND column_name IN ('id','capture_id','allocation_type','target_vendor_id','amount_cents','created_at');
--> statement-breakpoint
SELECT
  'marketplace vendor payable required columns' AS verification_name,
  COUNT(*) = 10 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'marketplace_vendor_payables'
  AND column_name IN (
    'id','allocation_id','vendor_id','amount_cents','state','stripe_transfer_id',
    'idempotency_key','transferred_at','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'marketplace stripe event required columns' AS verification_name,
  COUNT(*) = 10 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'marketplace_stripe_events'
  AND column_name IN (
    'id','stripe_event_id','event_type','livemode','payload_json','related_authorization_id',
    'processing_status','error_text','processed_at','created_at'
  );
--> statement-breakpoint
SELECT
  'marketplace refund required columns' AS verification_name,
  COUNT(*) = 10 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'marketplace_refunds'
  AND column_name IN (
    'id','capture_id','amount_cents','reason','state','stripe_refund_id',
    'idempotency_key','refunded_at','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'marketplace dispute required columns' AS verification_name,
  COUNT(*) = 9 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'marketplace_disputes'
  AND column_name IN (
    'id','capture_id','stripe_dispute_id','status','amount_cents',
    'evidence_due_by','outcome','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'marketplace idempotency key required columns' AS verification_name,
  COUNT(*) = 6 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'marketplace_payment_idempotency_keys'
  AND column_name IN ('id','idempotency_key','operation_type','request_payload_hash','stripe_response_json','created_at');
--> statement-breakpoint
SELECT
  'marketplace payment indexes' AS verification_name,
  COUNT(DISTINCT CONCAT(table_name, ':', index_name)) = 18 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND (
    (table_name = 'marketplace_payment_authorizations' AND index_name IN (
      'uq_mp_authorizations_idempotency','idx_mp_authorizations_item',
      'idx_mp_authorizations_resident_state','idx_mp_authorizations_expiry'
    )) OR
    (table_name = 'marketplace_payment_captures' AND index_name IN (
      'uq_mp_captures_authorization','uq_mp_captures_idempotency','idx_mp_captures_state'
    )) OR
    (table_name = 'marketplace_payment_allocations' AND index_name IN ('idx_mp_allocations_capture')) OR
    (table_name = 'marketplace_vendor_payables' AND index_name IN (
      'uq_mp_payables_idempotency','idx_mp_payables_allocation','idx_mp_payables_state'
    )) OR
    (table_name = 'marketplace_stripe_events' AND index_name IN (
      'uq_mp_stripe_events_event_id','idx_mp_stripe_events_status'
    )) OR
    (table_name = 'marketplace_refunds' AND index_name IN (
      'uq_mp_refunds_idempotency','idx_mp_refunds_capture'
    )) OR
    (table_name = 'marketplace_disputes' AND index_name IN (
      'uq_mp_disputes_stripe_id','idx_mp_disputes_capture'
    )) OR
    (table_name = 'marketplace_payment_idempotency_keys' AND index_name IN ('uq_mp_idempotency_keys_key'))
  );
--> statement-breakpoint
SELECT
  'marketplace payment foreign keys' AS verification_name,
  COUNT(*) = 9 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND constraint_name IN (
    'fk_mp_authorizations_item','fk_mp_authorizations_acceptance','fk_mp_authorizations_grant',
    'fk_mp_captures_authorization','fk_mp_allocations_capture','fk_mp_payables_allocation',
    'fk_mp_stripe_events_authorization','fk_mp_refunds_capture','fk_mp_disputes_capture'
  );
--> statement-breakpoint
SELECT
  'authorization state excludes fake booked state' AS verification_name,
  LOCATE('booked', LOWER(column_type)) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'marketplace_payment_authorizations'
  AND column_name = 'state';
--> statement-breakpoint
SELECT
  'capture state excludes fake booked state' AS verification_name,
  LOCATE('booked', LOWER(column_type)) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'marketplace_payment_captures'
  AND column_name = 'state';
--> statement-breakpoint
SELECT
  'vendor payable state excludes fake booked state' AS verification_name,
  LOCATE('booked', LOWER(column_type)) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'marketplace_vendor_payables'
  AND column_name = 'state';
--> statement-breakpoint
SELECT
  'refund state excludes fake booked state' AS verification_name,
  LOCATE('booked', LOWER(column_type)) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'marketplace_refunds'
  AND column_name = 'state';
