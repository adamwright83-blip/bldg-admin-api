<!-- LEGACY DAYFORGE COMPATIBILITY: retained historical migration/schema references only; canonical product is JOYSTICK. -->
# JOYSTICK Rollback and Recovery Playbook

**Scope:** Incident recovery procedures for deployment failures, schema errors, or customer isolation incidents.

---

## 1. Schema Migration Rollback (PR #535 Scope)

All DDL statements introduced in PR #535 are **purely additive**:
- New standalone tables: `operations_events`, `territory_operator_profiles`, `territory_scan_sessions`, `territory_scan_results`, `commercial_mission_field_states`, `tenant_field_checklist_templates`, `commercial_mission_field_checklist_items`, `commercial_mission_phone_handoffs`, `tenant_commercial_proposal_profiles`, `commercial_proposals`, `commercial_proposal_events`, `commercial_mission_coaching_artifacts`, `sales_intel_sources`, `sales_intel_teachings`.
- Additive nullable columns: `sales_intel_source_artifacts.sourceRegistryId`, plus 7 nullable/defaulted columns on `commercial_visit_outcomes`.
- No table drops, column drops, column type changes, or data rewrites were included.

### Additive Safe-State Strategy
Because all changes are strictly additive:
1. **Application rollback without schema revert:** If application deployment fails, rolling back the application code to previous stable commit `aacc6ec4` is 100% backward-compatible with the migrated schema. Older code ignores the newly added tables and columns.
2. **Emergency DDL Reversion (if explicitly required):**
   - Individual added tables can be safely dropped without impacting legacy tables:
     ```sql
     DROP TABLE IF EXISTS operations_events, territory_operator_profiles, territory_scan_sessions, territory_scan_results, commercial_mission_field_states, tenant_field_checklist_templates, commercial_mission_field_checklist_items, commercial_mission_phone_handoffs, tenant_commercial_proposal_profiles, commercial_proposals, commercial_proposal_events, commercial_mission_coaching_artifacts, sales_intel_sources, sales_intel_teachings;
     ```
   - **Do not drop** `commercial_visit_outcomes` or `sales_intel_source_artifacts`. Leaving their added columns in place is zero-risk.

---

## 2. Application Deployment Failure Recovery

1. Identify deployment status in Railway / hosting provider.
2. If health check fails or startup crashes:
   - Roll back deployment to last known good build (`main@aacc6ec4`).
   - Inspect container logs for environment or database connection failures.
   - Retain logs and error traces for post-mortem analysis.

---

## 3. Stripe Billing / Checkout Anomaly Recovery

If customer reports checkout errors, subscription desync, or webhook processing failures:
1. Immediately inspect webhook delivery logs in Stripe Dashboard.
2. Verify webhook signature verification in application logs:
   - Search for `processLegacyDayforgeBillingWebhook` failures.
3. If an incorrect price or trial period was configured:
   - Deactivate the incorrect row in `dayforge_saas_billing_plans` (`UPDATE dayforge_saas_billing_plans SET active = false WHERE planKey = ?`).
   - Customer credit cards must never be charged unexpectedly; if an accidental charge occurs in test mode, cancel and void the subscription in Stripe.

---

## 4. Tenant Isolation Incident Protocol

If any cross-tenant data bleed or unauthorized access is detected:
1. **Immediate containment:** Suspend affected tenant session token via database or set tenant status to suspended.
2. **Audit trails:** Check authority receipts in `authority_receipts` table and inspect procedure access logs.
3. **Data verification:** Confirm whether any tenant data was mutated or read across tenant boundaries.
EOF
