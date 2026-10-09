<!-- LEGACY DAYFORGE COMPATIBILITY: retained historical migration/schema and deployment literals only; canonical product is JOYSTICK. -->
# JOYSTICK Production Deployment Sequence

**Target:** First 10 Trial Customers  
**Standard Environment:** Production Web & API on Railway  
**Status:** BLOCKED pending explicit approval of PR #535 and live Stripe test credentials.

---

## Pre-Deployment Verification Checklist

1. [ ] **Repository Status:** Clean working tree on `main` branch.
2. [ ] **CI Matrix:** Verify all acceptance exams pass in hosted CI.
3. [ ] **Gate 1 (Schema Approval):** PR #535 (`codex/acceptance-schema-approval`) must receive explicit human review and approval before merging.
4. [ ] **Gate 2 (Billing Credentials):** Dedicated JOYSTICK Stripe test-mode keys configured in target environment:
   - `DAYFORGE_BILLING_STRIPE_SECRET_KEY` (must start with `sk_test_`)
   - `DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET` (must start with `whsec_`)
   - `DAYFORGE_BILLING_APP_URL` (canonical app origin)
   - Verified that Laundry Farm live Stripe account is **never** referenced or modified.

---

## Step-by-Step Deployment Order

### Phase 1: Pre-Flight Database Snapshot & Health Check
1. Execute a logical backup/snapshot of the production database (`mysqldump` or Railway snapshot).
2. Verify active connections and storage capacity.
3. Confirm absence of lock-heavy long-running queries (`SHOW PROCESSLIST`).

### Phase 2: Schema Migration Execution (PR #535)
1. Merge PR #535 into `main` only after explicit approval is documented.
2. Run migration runner:
   ```sh
   DATABASE_URL="$PRODUCTION_DATABASE_URL" node scripts/migrate.mjs
   ```
3. Verify migration logs for all 8 historical context store additions:
   - `operations_events`
   - `territory_operator_profiles`, `territory_scan_sessions`, `territory_scan_results`
   - `commercial_visit_outcomes` (7 additive visit fields)
   - `commercial_mission_field_states`, `tenant_field_checklist_templates`, `commercial_mission_field_checklist_items`, `commercial_mission_phone_handoffs`
   - `tenant_commercial_proposal_profiles`, `commercial_proposals`, `commercial_proposal_events`
   - `commercial_mission_coaching_artifacts`
   - `sales_intel_sources`, `sales_intel_source_artifacts` (`sourceRegistryId` column & index), `sales_intel_teachings`
4. Confirm existing production data survived with zero data loss or row corruption.

### Phase 3: Application Server Deployment
1. Deploy updated application bundle to Railway (`bldg-admin-api`).
2. Verify application health check endpoint responds 200 OK:
   ```sh
   curl -f https://admin.bldg.chat/health || curl -f https://admin.bldg.chat/
   ```
3. Verify environment variable resolution:
   - PostHog configuration active
   - Stripe test billing credentials active

### Phase 4: Post-Deployment Smoke Verification
1. Execute live anonymous landing page load at `/` and `/joystick-start`.
2. Verify 3-question onboarding preview generates clean draft tokens.
3. Validate Day Line view renders active state without 500 errors.
4. Verify error tracking and PostHog ingestion receiving telemetry.
EOF
