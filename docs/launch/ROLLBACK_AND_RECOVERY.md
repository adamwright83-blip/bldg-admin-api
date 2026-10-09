<!-- LEGACY DAYFORGE COMPATIBILITY: retained historical migration/schema references only; canonical product is JOYSTICK. -->
# JOYSTICK Rollback and Recovery Playbook

**Scope:** Incident recovery procedures for deployment failures, schema errors, or customer isolation incidents.

---

## 1. Schema Migration Recovery & Preservation (PR #535 Scope)

All DDL statements introduced in PR #535 are additive:
- New historical context tables: `operations_events`, `territory_operator_profiles`, `territory_scan_sessions`, `territory_scan_results`, `commercial_mission_field_states`, `tenant_field_checklist_templates`, `commercial_mission_field_checklist_items`, `commercial_mission_phone_handoffs`, `tenant_commercial_proposal_profiles`, `commercial_proposals`, `commercial_proposal_events`, `commercial_mission_coaching_artifacts`, `sales_intel_sources`, `sales_intel_teachings`.
- Additive nullable columns: `sales_intel_source_artifacts.sourceRegistryId`, plus 7 nullable/defaulted columns on `commercial_visit_outcomes`.

### Data Safety and Migration Rules
1. **Mandatory Pre-Migration Backup:** Always capture and verify a complete logical database backup (`mysqldump` or verified snapshot) immediately prior to applying schema migrations.
2. **Preserve Existing Data:** Never run automated `DROP TABLE` commands, truncate existing stores, or reverse additive DDL on a populated production database.
3. **Halting on Verification Failure:** If post-migration verification or reader checks fail, immediately halt deployment. Do not proceed to traffic routing or customer invitation.
4. **Controlled Recovery Procedure:** Restore database state from backup only when strictly necessary, using an explicitly reviewed and approved recovery procedure. Never execute destructive DDL in anger or haste.

---

## 2. Application Deployment Failure Recovery

1. Identify deployment status in Railway / hosting platform.
2. If health checks fail or application startup crashes:
   - Assess schema and configuration compatibility before initiating rollback.
   - If rolling back application code to previous stable commit (`main@ce72f47d`), verify whether previous application code functions cleanly alongside any applied additive schema.
   - Inspect container logs for environment or database connection failures.
   - Retain logs, error traces, and process status for post-mortem analysis.

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
