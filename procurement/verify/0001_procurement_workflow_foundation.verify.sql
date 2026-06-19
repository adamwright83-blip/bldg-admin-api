SELECT
  'six procurement foundation tables' AS verification_name,
  COUNT(*) = 6 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'procurement_workflows',
    'procurement_workflow_steps',
    'procurement_outbox_events',
    'procurement_operator_gates',
    'procurement_execution_history',
    'procurement_dead_letters'
  );
--> statement-breakpoint
SELECT
  'workflow step lease and retry columns' AS verification_name,
  COUNT(*) = 8 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'procurement_workflow_steps'
  AND column_name IN (
    'status', 'idempotency_key', 'available_at', 'deadline_at',
    'max_attempts', 'attempt_count', 'lease_owner', 'lease_expires_at'
  );
--> statement-breakpoint
SELECT
  'workflow and outbox idempotency indexes' AS verification_name,
  COUNT(DISTINCT index_name) = 2 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND non_unique = 0
  AND index_name IN (
    'uq_procurement_steps_idempotency',
    'uq_procurement_outbox_idempotency'
  );
