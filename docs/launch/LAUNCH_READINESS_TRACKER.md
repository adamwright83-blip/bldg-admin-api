<!-- LEGACY DAYFORGE COMPATIBILITY: historical route literal reference retained for launch audit tracking. Canonical product is JOYSTICK. -->
# JOYSTICK Launch Readiness Tracker

**Target:** First 10 Trial Customers  
**Started at:** `main@c142c0d55d441f004c6943b11e061657b1c1dd4e`  
**Current Status:** IN PROGRESS

---

## 1. Issues & Launch Blockers

| ID | Severity | Area | Issue Description | Customer Impact | Evidence / Reproduction | Acceptance Criteria | PR / Commit | Status |
|---|---|---|---|---|---|---|---|---|
| ISS-001 | P0 | Landing Routing | Visiting `/` on standard hosts renders legacy concierge (`HeldLanding`) instead of JOYSTICK | New visitors to the domain see laundry concierge and never see JOYSTICK or start flow | `client/src/App.tsx` routes non-driver, non-vendor to `HeldLandingRoute` | Visiting `/` on non-held/non-butler host renders `JoystickLanding` | PR #527 (`e8f2dfc9`) | RESOLVED |
| ISS-002 | P1 | Test Suite | `client/src/pages/JoystickLanding.test.ts` fails asserting legacy `START_PATH = "/dayforge-onboarding"` | Vitest suite fails in CI/local runs | `pnpm test client/src/pages/JoystickLanding.test.ts` exits with code 1 | Test asserts `START_PATH = "/joystick-start"` and passes cleanly | PR #527 (`e8f2dfc9`) | RESOLVED |
| ISS-003 | P1 | Onboarding / First Mission | `FirstMissionDriver.tsx` and `GoldlineGameNav.tsx` contain hardcoded `https://admin.bldg.chat/growth/lantern-city` | Trial customers on any other host/domain lose authentication and are stranded on external host | `FirstMissionDriver.tsx` lines 29, 40 and `GoldlineGameNav.tsx` line 4 | Origin-relative path `/growth/lantern-city` used everywhere | PR #527 (`e8f2dfc9`) | RESOLVED |
| ISS-004 | P2 | Telemetry | Missing key PostHog launch events (`landing_page_visited`, `first_mission_started`, `returning_session`, etc.) | Cannot track trial funnel conversion or activation drop-off | Audit of `captureProductEvent` calls in client | Key lifecycle events instrumented with tenant attribution | PR #528 (`5bfb95dd`) | RESOLVED |
| ISS-005 | P1 | First Action Experience | Journey from onboarding reveal to first real-world action and Day Line reflection needs seamless feedback | Trial customer needs immediate clarity on their first objective and earn progress without third-party integration | Audit of `/play` and `/growth/lantern-city` after acquisition | First action immediately visible, executable, updates Day Line and rewards progress | PR #529 | In Progress |

---

## 2. Launch Certification Criteria & Execution Matrix

All 6 tests must pass before launch readiness signoff.

| Test ID | Certification Name | Scope / Target Scenario | Method & Preconditions | Expected Result | Result & Evidence | Status |
|---|---|---|---|---|---|---|
| CERT-1 | New Customer Signup & Activation | Visitor -> 3 prepay questions -> Stripe checkout (test mode) -> password set -> world revealed | Stripe test mode checkout, verify session & tenant provisioning | Account active, world created, first mission assigned | Pending | PENDING |
| CERT-2 | First Action & Day Line Update | Execute first field action, submit observation evidence, defeat guardian | First mission driver interaction, submit observation | Outcome recorded, Day Line reflects progress, XP/stats updated | Pending | PENDING |
| CERT-3 | Returning Customer Session | Log out, log back in as trial customer | Session cookie expiration & re-login | Restores active mission, Day Line state, and world progress | Pending | PENDING |
| CERT-4 | Tenant Isolation Verification | 2 separate trial tenants created; verify zero data leakage | Check orders, missions, goldline sessions, and tenant configs | Strict boundary between tenant A and tenant B; no cross-tenant reads or writes | Pending | PENDING |
| CERT-5 | Webhook Replay Idempotency | Replay Stripe checkout session completed webhook | Simulated duplicate webhook delivery | Exactly one receipt/admission recorded; second run is idempotent no-op | Pending | PENDING |
| CERT-6 | Interrupted Session Recovery | Drop session mid-onboarding or mid-first-mission; resume | Resume from stored session state | Recovers at exact step without data corruption or duplicate records | Pending | PENDING |

---

## 3. Pull Request History

| PR # | Branch | Summary | Merged SHA | Status |
|---|---|---|---|---|
| #527 | `fix/launch-landing-routing` | Fix public landing route, JoystickLanding vitest, and origin-relative links | `e8f2dfc9` | MERGED |
| #528 | `feat/launch-analytics-posthog` | Complete PostHog lifecycle telemetry: onboarding, mission start, Claire calls, returning session | `5bfb95dd` | MERGED |
| #529 | `feat/launch-first-action-dayline` | Direct entry to First Mission from reveal, prominent Day Line empty state & Next Up card, unconditional action telemetry | TBD | In Progress |
