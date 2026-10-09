<!-- LEGACY DAYFORGE COMPATIBILITY: retained historical operational literals only; canonical product is JOYSTICK. -->
# JOYSTICK First 10 Trial Customers Operational Playbook

**Scope:** Step-by-step operational checklist for onboarding, monitoring, and supporting the first 10 trial customers of JOYSTICK.

---

## 1. Onboarding Checklist (Per Customer)

- [ ] **Account Setup & Provisioning:**
  - Verify customer completes 3-question briefing on `/joystick-start`.
  - Confirm custom personalized preview generates accurately for their industry/service model.
  - Confirm Stripe Checkout completes with valid test-mode card and 7-day trial.
- [ ] **Tenant Verification:**
  - Verify distinct `tenantId` created in `tenants` and `saas_tenants`.
  - Verify owner record provisioned in `users` with hashed credentials.
  - Verify initial mission assigned with correct industry context.
- [ ] **First Action Verification:**
  - Customer receives First Mission briefing on Day Line.
  - Customer records field outcome/observation.
  - Confirm authority receipt persisted in `authority_receipts` table.
  - Confirm Day Line updates dynamically without browser errors.

---

## 2. Telemetry and Health Monitoring

- [ ] **PostHog Dashboard Monitoring:**
  - Verify `landing_page_visited` firing on landing.
  - Verify `onboarding_started` and `onboarding_completed` firing during funnel.
  - Verify `first_mission_started` and `first_mission_completed` firing during activation.
  - Verify tenant attribution is present on all telemetry events (`tenantId` property).
- [ ] **Error Rate Monitoring:**
  - Zero 500-level HTTP responses on core customer routes.
  - Zero unhandled client-side exceptions in browser console.
- [ ] **Tenant Isolation Monitoring:**
  - Regularly assert that queries scoped to customer tenant return only rows with that exact `tenantId`.

---

## 3. Support & Incident Response

- **Point of Contact:** JOYSTICK Core Engineering Team.
- **Support Window:** 24/7 monitoring during initial 10-customer trial window.
- **Feedback Collection:** Record qualitative debrief after Day 1, Day 3, and Day 7 (trial conclusion).
EOF
