SELECT
  'authority grant tables' AS verification_name,
  COUNT(*) = 2 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('authority_grants', 'authority_grant_audit');
--> statement-breakpoint
SELECT
  'authority grant required columns' AS verification_name,
  COUNT(*) = 23 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'authority_grants'
  AND column_name IN (
    'id', 'tenant_id', 'bldg_user_id', 'building_slug', 'authority_type',
    'objective_text', 'budget_cap_cents', 'deadline_at', 'access_constraints_json',
    'sensitivity_constraints_json', 'allowed_risk_categories_json',
    'disallowed_categories_json', 'status', 'terms_version', 'terms_hash',
    'signature_evidence_json', 'signed_at', 'expires_at', 'revoked_at',
    'revoked_by', 'revoke_reason', 'created_at', 'updated_at'
  );
--> statement-breakpoint
SELECT
  'authority grant policy indexes' AS verification_name,
  COUNT(DISTINCT index_name) = 3 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'authority_grants'
  AND index_name IN (
    'idx_authority_grants_resident_status',
    'idx_authority_grants_building_status',
    'idx_authority_grants_expiry'
  );
--> statement-breakpoint
SELECT
  'authority audit append fields and foreign key' AS verification_name,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'authority_grant_audit'
      AND column_name IN (
        'id', 'authority_grant_id', 'event_type', 'actor_type',
        'actor_id', 'event_data_json', 'created_at'
      )) = 7
  AND
  (SELECT COUNT(*) FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'authority_grant_audit'
      AND constraint_name = 'fk_authority_audit_grant') = 1 AS passed;
