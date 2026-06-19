SELECT
  'held_schema_migrations table' AS verification_name,
  COUNT(*) = 1 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'held_schema_migrations';
--> statement-breakpoint
SELECT
  'held_schema_migrations required columns' AS verification_name,
  COUNT(*) = 8 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'held_schema_migrations'
  AND column_name IN (
    'migration_key', 'checksum', 'status', 'started_at',
    'applied_at', 'execution_ms', 'error_text', 'id'
  );
