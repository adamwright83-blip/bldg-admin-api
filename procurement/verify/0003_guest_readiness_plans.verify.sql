SELECT
  'guest readiness plan tables' AS verification_name,
  COUNT(*) = 2 AS passed
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('guest_readiness_plans', 'guest_readiness_plan_items');
--> statement-breakpoint
SELECT
  'guest readiness plan required columns' AS verification_name,
  COUNT(*) = 20 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'guest_readiness_plans'
  AND column_name IN (
    'id','authority_grant_id','tenant_id','bldg_user_id','building_slug','objective_text',
    'budget_cap_cents','estimated_total_cents','deadline_at','access_constraints_json',
    'sensitivity_constraints_json','truth_state','plan_status','approval_gates_json',
    'decision_evidence_json','unsupported_reasons_json','evaluated_at','cancelled_at',
    'created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'guest readiness item required columns' AS verification_name,
  COUNT(*) = 16 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'guest_readiness_plan_items'
  AND column_name IN (
    'id','plan_id','category','description_text','estimated_cost_cents','scheduled_at',
    'access_pattern','sensitivity_tags_json','risk_category','feasibility_classification',
    'item_state','resident_approval_required','operator_review_required',
    'decision_evidence_json','created_at','updated_at'
  );
--> statement-breakpoint
SELECT
  'guest readiness plan indexes' AS verification_name,
  COUNT(DISTINCT CONCAT(table_name, ':', index_name)) = 5 AS passed
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND (
    (table_name = 'guest_readiness_plans' AND index_name IN (
      'idx_guest_plans_authority','idx_guest_plans_resident_state','idx_guest_plans_deadline'
    )) OR
    (table_name = 'guest_readiness_plan_items' AND index_name IN (
      'idx_guest_plan_items_plan_state','idx_guest_plan_items_risk'
    ))
  );
--> statement-breakpoint
SELECT
  'guest readiness plan foreign keys' AS verification_name,
  COUNT(*) = 2 AS passed
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND constraint_name IN ('fk_guest_plans_authority','fk_guest_plan_items_plan');
--> statement-breakpoint
SELECT
  'guest readiness item states exclude booked' AS verification_name,
  LOCATE('booked', LOWER(column_type)) = 0 AS passed
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'guest_readiness_plan_items'
  AND column_name = 'item_state';
