SELECT
  'legal template registry tables' AS verification_name,
  COUNT(*) = 3 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('legal_document_versions','outreach_template_versions','outreach_template_lint_rules');
--> statement-breakpoint
SELECT
  'legal document version required columns' AS verification_name,
  COUNT(*) = 21 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'legal_document_versions'
  AND column_name IN (
    'id','document_key','document_type','version','status','title','body_template','body_hash',
    'variable_schema_json','jurisdiction','locale','terms_version','terms_hash','approved_by',
    'approved_at','effective_at','retired_at','evidence_json','created_by','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'outreach template version required columns' AS verification_name,
  COUNT(*) = 20 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'outreach_template_versions'
  AND column_name IN (
    'id','template_key','outreach_channel','template_purpose','version','status','subject_template',
    'body_template','body_hash','variable_schema_json','required_legal_document_key',
    'required_legal_document_version','approved_by','approved_at','effective_at','retired_at',
    'evidence_json','created_by','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'outreach lint rule required columns' AS verification_name,
  COUNT(*) = 8 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'outreach_template_lint_rules'
  AND column_name IN (
    'rule_key','rule_type','severity','pattern_or_claim','applies_to_purpose','status','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'legal template registry hashes' AS verification_name,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'legal_document_versions'
      AND column_name IN ('body_hash','terms_hash') AND column_type = 'char(64)') = 2
  AND
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'outreach_template_versions'
      AND column_name = 'body_hash' AND column_type = 'char(64)') = 1 AS passed;
--> statement-breakpoint
SELECT
  'legal template registry indexes' AS verification_name,
  COUNT(DISTINCT CONCAT(table_name, ':', index_name)) = 9 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND (
    (table_name = 'legal_document_versions' AND index_name IN (
      'uq_legal_document_key_version','idx_legal_document_type_status','idx_legal_document_jurisdiction_locale'
    )) OR
    (table_name = 'outreach_template_versions' AND index_name IN (
      'uq_outreach_template_key_version','idx_outreach_template_purpose_status',
      'idx_outreach_template_channel_status','idx_outreach_template_legal_document'
    )) OR
    (table_name = 'outreach_template_lint_rules' AND index_name IN (
      'idx_outreach_lint_rules_type_status','idx_outreach_lint_rules_purpose'
    ))
  );
--> statement-breakpoint
SELECT
  'outreach template legal document foreign key' AS verification_name,
  COUNT(*) = 1 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND table_name = 'outreach_template_versions'
  AND constraint_name = 'fk_outreach_template_legal_document';
--> statement-breakpoint
SELECT
  'legal template registry has no seed rows' AS verification_name,
  (SELECT COUNT(*) FROM legal_document_versions) = 0
  AND (SELECT COUNT(*) FROM outreach_template_versions) = 0
  AND (SELECT COUNT(*) FROM outreach_template_lint_rules) = 0 AS passed;
--> statement-breakpoint
SELECT
  'legal template registry has no legacy vendor foreign keys' AS verification_name,
  COUNT(*) = 0 AS passed
FROM information_schema.key_column_usage
WHERE table_schema = DATABASE()
  AND table_name IN ('legal_document_versions','outreach_template_versions','outreach_template_lint_rules')
  AND referenced_table_name IN ('vendors','vendorProfiles','vendorServices');
